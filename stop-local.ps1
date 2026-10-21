$ErrorActionPreference = 'Stop'
$jarPath = Join-Path $PSScriptRoot 'target\library-0.0.1-SNAPSHOT.jar'
$pidPath = Join-Path $PSScriptRoot '.local\server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Host 'No managed server process was found.'; exit 0 }
$serverProcessId = [int](Get-Content -LiteralPath $pidPath -Raw)
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
if ($null -ne $serverProcess -and $serverProcess.Name -eq 'java.exe' -and $serverProcess.CommandLine.Contains($jarPath)) {
    Stop-Process -Id $serverProcessId
    Write-Host 'Library server stopped.'
} else { Write-Host 'The recorded process is no longer the library server.' }
