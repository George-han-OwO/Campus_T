param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
Set-Location $mobileRoot

if (-not $SkipInstall) {
  npm ci
}

npm run build
npx cap sync android

$javaCandidates = @(
  (Join-Path ${env:ProgramFiles} 'Java\jdk-21*'),
  (Join-Path ${env:ProgramFiles} 'Eclipse Adoptium\jdk-21*')
)
if (-not $env:JAVA_HOME) {
  foreach ($pattern in $javaCandidates) {
    $candidate = Get-ChildItem -Path $pattern -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { $env:JAVA_HOME = $candidate.FullName; break }
  }
}
if (-not $env:JAVA_HOME) { throw '找不到 JDK 21，请设置 JAVA_HOME。' }

$shortTmp = Join-Path $mobileRoot '..\..\tmp\atlas-go-jvm'
New-Item -ItemType Directory -Force -Path $shortTmp | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djava.net.preferIPv4Stack=true -Djdk.net.unixdomain.tmpdir=$shortTmp -Djava.io.tmpdir=$shortTmp"

Set-Location (Join-Path $mobileRoot 'android')
& .\gradlew.bat --no-daemon assembleDebug
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "APK: $((Get-Item 'app\build\outputs\apk\debug\app-debug.apk').FullName)"
