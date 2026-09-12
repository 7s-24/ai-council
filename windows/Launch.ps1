$ErrorActionPreference = 'Stop'
$PackageRoot = $PSScriptRoot
$NodeBinary = Join-Path $PackageRoot 'runtime\node.exe'
$ServerScript = Join-Path $PackageRoot 'app\scripts\chat-server.mjs'
if (!(Test-Path $NodeBinary) -or !(Test-Path $ServerScript)) {
  throw 'Extract the entire ZIP before starting AI Council. Do not run it inside the ZIP viewer.'
}
$DataRoot = Join-Path $env:LOCALAPPDATA 'AI Council'
$ProjectsRoot = Join-Path $DataRoot 'Projects'
New-Item -ItemType Directory -Path $ProjectsRoot -Force | Out-Null
$env:PATH = (Join-Path $DataRoot 'cli') + ';' + (Join-Path $PackageRoot 'runtime') + ';' + $env:PATH
$env:AI_COUNCIL_DATA_DIR = Join-Path $DataRoot 'data'
$Mutex = [System.Threading.Mutex]::new($false, 'Local\AI-Council-Portable')
$Owned = $false
try {
  try { $Owned = $Mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $Owned = $true }
  if (!$Owned) { throw 'AI Council is already running. Use its browser tab or close its console first.' }
  Write-Host 'AI Council Windows Preview'
  Write-Host 'Keep this window open while chatting. Press Ctrl+C here to stop.'
  Write-Host "Local data: $DataRoot"
  & $NodeBinary $ServerScript --port 0 --projects-root $ProjectsRoot --open-browser
  if ($LASTEXITCODE -ne 0) { throw "AI Council stopped with code $LASTEXITCODE" }
} finally {
  if ($Owned) { $Mutex.ReleaseMutex() }
  $Mutex.Dispose()
}
