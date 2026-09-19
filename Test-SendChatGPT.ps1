# Model execution is mocked; reads CLI bridge configuration and probes its pipe.
$ErrorActionPreference = 'Stop'
$realCodexCommand = (Get-Command codex).Source
$bridgeTestFixture = & codex mcp get codex_app --json | Out-String
$global:chatgptWrapperTest = @{ callCount = 0; capturedArgs = @(); capturedPrompt = '' }
$global:chatgptWrapperTest.bridgeConfig = $bridgeTestFixture
function codex {
    if ($args[0] -eq 'mcp') { $global:LASTEXITCODE = 0; return $global:chatgptWrapperTest.bridgeConfig }
    $global:chatgptWrapperTest.callCount++
    $global:chatgptWrapperTest.capturedArgs = @($args)
    $global:chatgptWrapperTest.capturedPrompt = ($input | Out-String)
    $global:LASTEXITCODE = 0
}
function Assert($condition, $description) {
    if (-not $condition) { throw "FAIL: $description" }
}
$sender = Join-Path $PSScriptRoot 'Send-ChatGPT.ps1'
# Unicode, quotes, newlines and shell-like text must remain payload data.
$sample = ([string][char]0x65E5) + ([string][char]0x672C) + "`n" + '"quoted" $env:USERNAME $(Write-Output SHOULD_NOT_RUN) `backtick`'
$previousLocation = Get-Location
$previousPipePath = $env:CODEX_APP_TOOLS_PIPE_PATH
try {
    # Emulate an ordinary terminal without inherited desktop environment.
    $env:CODEX_APP_TOOLS_PIPE_PATH = $null
    Set-Location $env:TEMP
    & $sender -To github -Message $sample
}
finally {
    Set-Location $previousLocation
    $env:CODEX_APP_TOOLS_PIPE_PATH = $previousPipePath
}
Assert ($global:chatgptWrapperTest.callCount -eq 1) 'one CLI invocation'
$modelIndex = [Array]::IndexOf($global:chatgptWrapperTest.capturedArgs, '-m')
Assert ($modelIndex -ge 0 -and $global:chatgptWrapperTest.capturedArgs[$modelIndex + 1] -eq 'gpt-5.6-luna') 'fixed Luna model'
$nativeConfigArgs = $global:chatgptWrapperTest.capturedArgs[1..($modelIndex - 1)]
$nativeConfig = & $realCodexCommand @nativeConfigArgs mcp get codex_app --json | ConvertFrom-Json
Assert ($LASTEXITCODE -eq 0 -and $nativeConfig.enabled) 'native CLI parses bridge overrides'
Assert ($nativeConfig.enabled_tools.Count -eq 2) 'only delivery tools exposed'
Assert ($global:chatgptWrapperTest.capturedArgs -contains 'model_reasoning_effort="low"') 'fixed reasoning effort'
Assert ($global:chatgptWrapperTest.capturedArgs[-1] -eq '-') 'prompt on stdin'
Assert (-not ($global:chatgptWrapperTest.capturedArgs -contains $sample)) 'message absent from command arguments'
$jsonText = ($global:chatgptWrapperTest.capturedPrompt -split 'Delivery payload \(JSON\):', 2)[1]
$payload = $jsonText | ConvertFrom-Json
Assert ($payload.message -ceq $sample) 'exact message round trip'
Assert ($payload.threadId -eq '6aae4a91-41f8-83e8-be3f-43d231427920') 'JSON destination resolution from other cwd'
$rejected = $false
try { & $sender -To missing -Message 'test' } catch { $rejected = $true }
Assert $rejected 'unknown destination rejected'
$rejected = $false
try { & $sender -To github -Message '   ' } catch { $rejected = $true }
Assert $rejected 'blank message rejected'
Assert ($global:chatgptWrapperTest.callCount -eq 1) 'invalid requests never launch CLI'
Write-Output 'PASS: Luna arguments, stdin payload, Unicode/quoting, destination lookup, validation. No messages sent.'

