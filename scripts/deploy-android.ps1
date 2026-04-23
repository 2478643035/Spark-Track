param(
  [string]$SdkRoot = "",
  [string]$VaultPath = "/sdcard/Android/media/md.obsidian/SparkTrackDebug",
  [string]$PackageName = "md.obsidian",
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifestPath = Join-Path $repoRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$pluginId = [string]$manifest.id

if (-not $SdkRoot) {
  if ($env:ANDROID_SDK_ROOT) {
    $SdkRoot = $env:ANDROID_SDK_ROOT
  } elseif ($env:ANDROID_HOME) {
    $SdkRoot = $env:ANDROID_HOME
  } else {
    $SdkRoot = "E:\Androidsdk"
  }
}

$adb = Join-Path $SdkRoot "platform-tools\adb.exe"
if (-not (Test-Path -LiteralPath $adb)) {
  $adb = "adb"
}

$requiredFiles = @("main.js", "manifest.json", "styles.css", ".nomedia")
foreach ($file in $requiredFiles) {
  $path = Join-Path $repoRoot $file
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing build output: $path. Run npm run build first."
  }
}

$pluginPath = "$VaultPath/.obsidian/plugins/$pluginId"

& $adb wait-for-device | Out-Null

try {
  & $adb shell "appops set $PackageName MANAGE_EXTERNAL_STORAGE allow" | Out-Null
} catch {
  Write-Warning "Could not set MANAGE_EXTERNAL_STORAGE for $PackageName. You may need to grant storage access in Android settings."
}

& $adb shell "mkdir -p '$pluginPath' '$VaultPath/Tasks' '$VaultPath/Goals' '$VaultPath/Daily'"

foreach ($file in $requiredFiles) {
  & $adb push (Join-Path $repoRoot $file) "$pluginPath/$file"
}

$enabledPlugins = "[`"$pluginId`"]"
$enabledPluginsFile = Join-Path ([System.IO.Path]::GetTempPath()) "spark-track-community-plugins.json"
[System.IO.File]::WriteAllText($enabledPluginsFile, $enabledPlugins, [System.Text.UTF8Encoding]::new($false))
& $adb push $enabledPluginsFile "$VaultPath/.obsidian/community-plugins.json"

Write-Host "Deployed $pluginId to $pluginPath"

if (-not $NoLaunch) {
  & $adb shell "monkey -p $PackageName 1" | Out-Null
}
