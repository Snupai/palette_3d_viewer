$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Exercise the capture runner's wait policy with controlled producer observations.
# No desktop, exports, or corpus are accessed by the test doubles.
$source = Get-Content (Join-Path $PSScriptRoot "Capture-MultiPackOracle.ps1") -Raw
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$errors
)
if ($errors.Count -ne 0) { throw "Capture runner has parse errors." }
$definition = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq "Wait-StableExport"
}, $true)
. ([scriptblock]::Create($definition.Extent.Text))
Add-Type -TypeDefinition @"
using System;
public static class MultiPackOracleNative {
  public static IntPtr FindTopWindow(int process, string name) { return IntPtr.Zero; }
}
"@

function Get-Date { [datetime]::new(2026, 1, 1).AddMilliseconds($script:tick * 100) }
function Start-Sleep { param($Milliseconds) $script:tick += 1 }
function Test-Path {
  param($LiteralPath)
  return $script:observations[[Math]::Min($script:tick, $script:observations.Count - 1)] -ne "absent"
}
function Get-Item {
  param($LiteralPath, $ErrorAction)
  $script:reads += 1
  $observation = $script:observations[[Math]::Min($script:tick, $script:observations.Count - 1)]
  if ($observation -eq "disappeared") {
    throw [System.Management.Automation.ItemNotFoundException]::new("Producer replaced file")
  }
  if ($observation -eq "denied") {
    throw [System.UnauthorizedAccessException]::new("Read denied")
  }
  return [pscustomobject]@{ Length = [long]$observation }
}

$script:tick = 0
$script:reads = 0
$script:observations = @(100, 100, "disappeared", 100, "absent", 100, 100, 100, 100)
$result = Wait-StableExport -Path "synthetic.rob" -OwnerProcessId 1 -SaveDialog ([IntPtr]::Zero)
if ($result.Length -ne 100 -or $script:tick -ne 8 -or $script:reads -ne 8) {
  throw "A disappearance must restart the consecutive stability sequence."
}

$script:tick = 0
$script:observations = @("denied")
$propagated = $false
try { Wait-StableExport -Path "synthetic.rob" -OwnerProcessId 1 -SaveDialog ([IntPtr]::Zero) }
catch [System.UnauthorizedAccessException] { $propagated = $true }
if (-not $propagated) { throw "Access errors must propagate." }

$script:tick = 0
$script:observations = @("absent")
$timedOut = $false
try {
  Wait-StableExport -Path "synthetic.rob" -OwnerProcessId 1 -SaveDialog ([IntPtr]::Zero) -TimeoutSeconds 1
}
catch { $timedOut = $_.Exception.Message -eq "The candidate ROB export was not created and stabilized." }
if (-not $timedOut -or $script:tick -ne 10) { throw "Missing exports must time out." }
Write-Output "Stable export: 3 behavior checks passed."
