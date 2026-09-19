# Run from the Codex Desktop app terminal (or a desktop task's shell).
$ErrorActionPreference = 'Stop'
$pipePath = $env:CODEX_APP_TOOLS_PIPE_PATH
if ([string]::IsNullOrWhiteSpace($pipePath) -or -not $pipePath.StartsWith('\\.\pipe\')) {
    throw 'Run this setup from a Codex Desktop terminal/task with the app bridge environment.'
}
$probe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipePath.Substring(9), [System.IO.Pipes.PipeDirection]::InOut)
try { $probe.Connect(2000) }
finally { $probe.Dispose() }
@{ pipePath = $pipePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.chatgpt-bridge.json') -Encoding UTF8
Write-Output 'Desktop bridge setup saved. Keep Codex Desktop running while sending from CLI.'
