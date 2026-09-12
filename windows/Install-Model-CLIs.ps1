$ErrorActionPreference = 'Stop'
$NodeBinary = Join-Path $PSScriptRoot 'runtime\node.exe'
$NpmScript = Join-Path $PSScriptRoot 'runtime\node_modules\npm\bin\npm-cli.js'
$CliRoot = Join-Path $env:LOCALAPPDATA 'AI Council\cli'
$env:PATH = (Join-Path $PSScriptRoot 'runtime') + ';' + $env:PATH
Write-Host 'Installing Claude Code 2.1.261 and Codex 0.153.4 from the official npm registry.'
Write-Host "Install directory: $CliRoot"
Write-Host 'This step requires internet access. You will sign in with your own accounts afterward.'
& $NodeBinary $NpmScript install --global --prefix $CliRoot --registry https://registry.npmjs.org '@anthropic-ai/claude-code@2.1.261' '@openai/codex@0.153.4'
if ($LASTEXITCODE -ne 0) { throw 'CLI installation failed. Check internet/proxy settings and retry.' }
Write-Host 'Installation complete. Start AI Council, then choose Settings > Models > Sign in again.'
