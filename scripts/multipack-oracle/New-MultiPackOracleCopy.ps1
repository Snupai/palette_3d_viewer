param(
  [string]$SourceDirectory = "C:\Program Files (x86)\MultiPack Roboter",

  [string]$TargetDirectory = "",

  [switch]$Launch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$expectedFileVersion = "2.1.315.25"
$expectedExecutableSha256 =
  "629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff"

if ($TargetDirectory -eq "") {
  $TargetDirectory = Join-Path $env:LOCALAPPDATA "MultiPackOracle\2.1.315.25"
}
if (-not [System.IO.Path]::IsPathFullyQualified($SourceDirectory) -or
    -not [System.IO.Path]::IsPathFullyQualified($TargetDirectory)) {
  throw "SourceDirectory and TargetDirectory must be fully qualified."
}
$normalizedTargetDirectory = [System.IO.Path]::GetFullPath($TargetDirectory)
$repositoryRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..\..")
)
$repositoryPrefix = $repositoryRoot.TrimEnd("\") + "\"
if ($normalizedTargetDirectory.Equals(
      $repositoryRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -or
    $normalizedTargetDirectory.StartsWith(
      $repositoryPrefix,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
  throw "TargetDirectory must stay outside the Git repository."
}

$sourceExecutable = Join-Path $SourceDirectory "mpick32.exe"
$sourceDatabase = Join-Path $SourceDirectory "mpick32.ini"
if (-not (Test-Path -LiteralPath $sourceExecutable) -or
    -not (Test-Path -LiteralPath $sourceDatabase)) {
  throw "The MultiPack executable and database were not found in SourceDirectory."
}

$sourceFile = Get-Item -LiteralPath $sourceExecutable
$sourceVersion = $sourceFile.VersionInfo.FileVersion
$sourceDigest = (
  Get-FileHash -Algorithm SHA256 -LiteralPath $sourceExecutable
).Hash.ToLowerInvariant()
if ($sourceVersion -ne $expectedFileVersion) {
  throw "Unsupported MultiPack file version '$sourceVersion'."
}
if ($sourceDigest -ne $expectedExecutableSha256) {
  throw "The source executable digest does not match the pinned oracle build."
}

$created = $false
$targetExecutable = Join-Path $TargetDirectory "mpick32.exe"
$targetDatabase = Join-Path $TargetDirectory "mpick32.ini"
if (-not (Test-Path -LiteralPath $TargetDirectory)) {
  $targetParent = Split-Path -Parent $TargetDirectory
  [void](New-Item -ItemType Directory -Path $targetParent -Force)
  $temporaryTarget = Join-Path `
    $targetParent `
    ".multipack-oracle-copy-$PID"
  if (Test-Path -LiteralPath $temporaryTarget) {
    throw "The temporary oracle copy path already exists."
  }
  try {
    [void](New-Item -ItemType Directory -Path $temporaryTarget)
    $temporaryExecutable = Join-Path $temporaryTarget "mpick32.exe"
    $temporaryDatabase = Join-Path $temporaryTarget "mpick32.ini"
    Copy-Item -LiteralPath $sourceExecutable -Destination $temporaryExecutable
    Copy-Item -LiteralPath $sourceDatabase -Destination $temporaryDatabase
    $temporaryDigest = (
      Get-FileHash -Algorithm SHA256 -LiteralPath $temporaryExecutable
    ).Hash.ToLowerInvariant()
    $temporaryDatabaseFile = Get-Item -LiteralPath $temporaryDatabase
    if ($temporaryDigest -ne $expectedExecutableSha256 -or
        $temporaryDatabaseFile.PSIsContainer -or
        $temporaryDatabaseFile.Length -le 0) {
      throw "The temporary oracle copy failed validation."
    }
    Move-Item -LiteralPath $temporaryTarget -Destination $TargetDirectory
    $created = $true
  }
  catch {
    if (Test-Path -LiteralPath $temporaryTarget) {
      Remove-Item -LiteralPath $temporaryTarget -Recurse -Force
    }
    throw
  }
}
else {
  if (-not (Test-Path -LiteralPath $targetExecutable) -or
      -not (Test-Path -LiteralPath $targetDatabase)) {
    throw "The existing oracle directory is incomplete and will not be overwritten."
  }
}

$targetDatabaseFile = Get-Item -LiteralPath $targetDatabase
if ($targetDatabaseFile.PSIsContainer -or $targetDatabaseFile.Length -le 0) {
  throw "The writable oracle database must be a non-empty regular file."
}

$targetDigest = (
  Get-FileHash -Algorithm SHA256 -LiteralPath $targetExecutable
).Hash.ToLowerInvariant()
if ($targetDigest -ne $expectedExecutableSha256) {
  throw "The oracle executable digest does not match the pinned build."
}

$process = $null
if ($Launch) {
  $running = @(
    Get-Process -Name mpick32 -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $targetExecutable }
  )
  if ($running.Count -gt 1) {
    throw "Multiple writable MultiPack oracle processes are already running."
  }
  if ($running.Count -eq 1) {
    $process = $running[0]
  }
  else {
    $process = Start-Process `
      -FilePath $targetExecutable `
      -WorkingDirectory $TargetDirectory `
      -PassThru
  }
}

[PSCustomObject]@{
  targetDirectory = $TargetDirectory
  created = $created
  fileVersion = $sourceVersion
  executableSha256 = $targetDigest
  processId = if ($null -eq $process) { $null } else { $process.Id }
} | ConvertTo-Json -Depth 3
