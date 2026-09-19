# No messages are sent by this test entry point.
$ErrorActionPreference = 'Stop'
$sender = Join-Path $PSScriptRoot 'Send-ChatGPT.ps1'
foreach ($case in @(@{ To = 'missing'; Message = 'test' }, @{ To = 'github'; Message = '   ' })) {
    $rejected = $false
    try { & $sender @case } catch { $rejected = $true }
    if (-not $rejected) { throw 'Invalid request was accepted.' }
}
$bridge = & codex mcp get codex_app --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read desktop runtime configuration.' }
& $bridge.transport.env.CODEX_MCP_NODE_PATH (Join-Path $PSScriptRoot 'history-runner.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'History tests failed.' }
Write-Output 'PASS: wrapper validation and history tests. No messages sent.'
