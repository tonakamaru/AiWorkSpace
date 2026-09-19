[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$To,

    [Parameter(Mandatory = $true, Position = 1)]
    [ValidateNotNullOrEmpty()]
    [string]$Message
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Message)) {
    throw 'Message must not be blank.'
}

# Resolve relative to this file, not to the caller's current directory.
$targetsPath = Join-Path $PSScriptRoot 'chatgpt-targets.json'
try {
    $targets = Get-Content -LiteralPath $targetsPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
catch {
    throw "Invalid destination JSON: $targetsPath. Check commas and braces. $($_.Exception.Message)"
}
$entry = @($targets.PSObject.Properties | Where-Object { $_.Name -ceq $To })
if ($entry.Count -ne 1) {
    $names = @($targets.PSObject.Properties.Name) -join ', '
    throw "Unknown destination '$To'. Available names: $names"
}
$destination = $entry[0].Value
if ($destination.threadId -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
    throw "Invalid threadId in $targetsPath"
}
if ([string]::IsNullOrWhiteSpace($destination.title)) {
    throw "Missing title in $targetsPath"
}
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw 'Codex CLI was not found. Install/sign in to Codex CLI first.'
}

# Use the official desktop-bundled MCP server. An enabled flag alone is not
# sufficient: CLI config overrides need a complete stdio transport definition.
$bridgeConfig = & codex mcp get codex_app --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $bridgeConfig.transport.cwd) {
    throw 'Codex desktop MCP configuration was not found. Open Codex Desktop first.'
}
$bridgeNode = $bridgeConfig.transport.env.CODEX_MCP_NODE_PATH
$bridgeServer = Join-Path $bridgeConfig.transport.cwd 'server.mjs'
if (-not (Test-Path -LiteralPath $bridgeNode) -or -not (Test-Path -LiteralPath $bridgeServer)) {
    throw 'Desktop MCP runtime files are missing. Open/update Codex Desktop and refresh the bridge setup.'
}
$savedPipePath = $env:CODEX_APP_TOOLS_PIPE_PATH
$pipePath = $savedPipePath
if ([string]::IsNullOrWhiteSpace($pipePath)) {
    $bridgeSettingsPath = Join-Path $PSScriptRoot '.chatgpt-bridge.json'
    if (Test-Path -LiteralPath $bridgeSettingsPath) {
        $pipePath = (Get-Content -LiteralPath $bridgeSettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json).pipePath
    }
}
if ([string]::IsNullOrWhiteSpace($pipePath) -or -not $pipePath.StartsWith('\\.\pipe\')) {
    throw 'Desktop bridge is unavailable. Run from the Codex app terminal or refresh .chatgpt-bridge.json from a desktop task.'
}
# Preflight before spending a model turn. No protocol messages are sent here.
$probe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipePath.Substring(9), [System.IO.Pipes.PipeDirection]::InOut)
try { $probe.Connect(2000) }
catch { throw 'Cannot connect to Codex Desktop. Keep the app running; refresh the bridge setup if the app restarted.' }
finally { $probe.Dispose() }

function ConvertTo-TomlString([string]$Value) {
    # TOML literal strings survive Windows PowerShell 5.1 native argument handling.
    if ($Value.Contains("'")) { throw 'The desktop runtime path contains an unsupported single quote.' }
    return "'" + $Value + "'"
}
$bridgeArguments = @(
    '-c', ('mcp_servers.codex_app.command=' + (ConvertTo-TomlString $bridgeNode.Replace('\', '/'))),
    '-c', ('mcp_servers.codex_app.args=[' + (ConvertTo-TomlString $bridgeServer.Replace('\', '/')) + ']'),
    '-c', "mcp_servers.codex_app.env_vars=['CODEX_APP_TOOLS_PIPE_PATH']",
    '-c', 'mcp_servers.codex_app.enabled=true',
    '-c', "mcp_servers.codex_app.enabled_tools=['read_thread','send_message_to_thread']"
)

# The host persists actual MCP responses; the worker cannot invent history.
$payload = [ordered]@{
    codex = (Get-Command codex -CommandType Application | Select-Object -First 1).Source
    cwd = $PSScriptRoot
    bridgeArguments = $bridgeArguments
    target = [ordered]@{
        threadId = $destination.threadId
        expectedTitle = $destination.title
        message = $Message
    }
} | ConvertTo-Json -Depth 6
$savedOutputEncoding = $OutputEncoding
$savedConsoleEncoding = [Console]::OutputEncoding
try {
    $env:CODEX_APP_TOOLS_PIPE_PATH = $pipePath
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    # Windows PowerShell 5.1 wraps redirected native stderr in error records.
    # Progress is not failure; use the process exit code below instead.
    $ErrorActionPreference = 'Continue'
    $payload | & $bridgeNode (Join-Path $PSScriptRoot 'history-runner.mjs')
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) {
        throw 'ChatGPT delivery failed. Read stderr and check the destination before retrying.'
    }
}
finally {
    $env:CODEX_APP_TOOLS_PIPE_PATH = $savedPipePath
    $OutputEncoding = $savedOutputEncoding
    [Console]::OutputEncoding = $savedConsoleEncoding
}
