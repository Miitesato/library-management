param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$appUrl = 'http://127.0.0.1:8088'
$jarPath = Join-Path $appRoot 'target\library-0.0.1-SNAPSHOT.jar'
$runtimePath = Join-Path $appRoot '.local'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
function Test-LibraryReady {
    try {
        $reply = Invoke-RestMethod -Uri "$appUrl/api/data" -TimeoutSec 2
        return ($null -ne $reply.books -and $null -ne $reply.source)
    } catch { return $false }
}
if (Test-LibraryReady) {
    Write-Host "Library is already running: $appUrl"
    if (-not $NoBrowser) { Start-Process $appUrl }
    exit 0
}
if (-not (Test-Path -LiteralPath $jarPath)) {
    Push-Location $appRoot
    try {
        & mvn -B -DskipTests package
        if ($LASTEXITCODE -ne 0) { throw 'Maven build failed.' }
    } finally { Pop-Location }
}
$javaCommand = (Get-Command java -ErrorAction Stop).Source
$appProcess = Start-Process -FilePath $javaCommand -ArgumentList @('-jar', ('"{0}"' -f $jarPath), '--debug=false', '--logging.level.root=INFO', '--logging.level.org.springframework=INFO') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'server-error.log') -PassThru
Set-Content -LiteralPath (Join-Path $runtimePath 'server.pid') -Value $appProcess.Id -Encoding Ascii
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Test-LibraryReady) {
        Write-Host "Library is ready: $appUrl"
        if (-not $NoBrowser) { Start-Process $appUrl }
        exit 0
    }
    if ($appProcess.HasExited) { break }
    Start-Sleep -Milliseconds 400
}
throw "Startup failed. See $runtimePath\server.log and server-error.log."
