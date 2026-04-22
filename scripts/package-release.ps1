$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReleaseRoot = Join-Path $Root "release"
$PackageDir = Join-Path $ReleaseRoot "spark-track"
$ZipPath = Join-Path $ReleaseRoot "spark-track.zip"

if (Test-Path $PackageDir) {
  Remove-Item -LiteralPath $PackageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

$RequiredFiles = @(
  "manifest.json",
  "main.js",
  "styles.css",
  ".nomedia"
)

foreach ($FileName in $RequiredFiles) {
  $SourcePath = Join-Path $Root $FileName
  if (-not (Test-Path $SourcePath)) {
    throw "Missing required release file: $FileName"
  }

  Copy-Item -LiteralPath $SourcePath -Destination (Join-Path $PackageDir $FileName) -Force
}

if (Test-Path $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($PackageDir, $ZipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)

Write-Host "Created release package: $ZipPath"
