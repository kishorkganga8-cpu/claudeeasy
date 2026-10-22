$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'Run Claude Code.cmd'
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', ('"' + $launcher + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Normal
