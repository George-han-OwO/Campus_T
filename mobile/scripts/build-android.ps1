param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
Set-Location $mobileRoot

if (-not $SkipInstall) {
  npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

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

$shortTmp = Join-Path $env:LOCALAPPDATA 'AtlasGo\jvm'
New-Item -ItemType Directory -Force -Path $shortTmp | Out-Null
$shortTmp = $shortTmp.Replace('\', '/')
$env:JAVA_TOOL_OPTIONS = "-Djava.net.preferIPv4Stack=true -Djdk.net.unixdomain.tmpdir=`"$shortTmp`" -Djava.io.tmpdir=`"$shortTmp`""

Set-Location (Join-Path $mobileRoot 'android')
# Prefer a compatible cached Gradle when available, useful on intermittent networks.
$cachedGradle = Get-ChildItem -Path (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.14-all') -Filter gradle.bat -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cachedGradle) { & $cachedGradle.FullName --no-daemon assembleDebug }
else { & .\gradlew.bat --no-daemon assembleDebug }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "APK: $((Get-Item 'app\build\outputs\apk\debug\app-debug.apk').FullName)"
