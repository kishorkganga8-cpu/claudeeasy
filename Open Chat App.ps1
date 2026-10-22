$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'http://127.0.0.1:3848/chat'
$node = Join-Path $root 'node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { throw 'Node.js is missing. Install Node.js 18 or newer, or use the Windows ZIP package.' }
  $node = $command.Source
}
function Test-Gateway {
  try {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3848/api/status' -TimeoutSec 2
    return $status.endpoint -eq 'http://127.0.0.1:3848'
  } catch { return $false }
}
if (-not (Test-Gateway)) {
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Gateway) { $ready = $true; break }
  }
  if (-not $ready) { throw 'claudeeasy could not start on port 3848. Check whether another app uses that port.' }
}
$browsers = @(
  (Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ${env:ProgramFiles} 'Microsoft\Edge\Application\msedge.exe')
)
$browser = $browsers | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$url", '--new-window' }
else { Start-Process $url }
