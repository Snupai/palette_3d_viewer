param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CaseId,

  [Parameter(Mandatory = $true)]
  [double]$PackageLengthMm,

  [Parameter(Mandatory = $true)]
  [double]$PackageWidthMm,

  [Parameter(Mandatory = $true)]
  [double]$PackageHeightMm,

  [Parameter(Mandatory = $true)]
  [double]$ClearanceMm,

  [int]$InputDirection = 0,

  [Parameter(Mandatory = $true)]
  [double]$PalletLengthMm,

  [Parameter(Mandatory = $true)]
  [double]$PalletWidthMm,

  [Nullable[int]]$RequestedPackagesPerLayer = $null,

  [Nullable[int]]$ExpectedCandidateCount = $null,

  [int]$ProcessId = 0,

  [switch]$InventoryOnly,

  [switch]$Resume,

  [int]$StabilizationMilliseconds = 150
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$expectedFileVersion = "2.1.315.25"
$oracleProduct = "MULTIPACK f$([char]0x00FC)r Roboter"
$expectedExecutableSha256 =
  "629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class MultiPackOracleNative
{
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct Input
    {
        public uint type;
        public InputUnion union;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MouseInput mouse;
        [FieldOffset(0)] public KeyboardInput keyboard;
        [FieldOffset(0)] public HardwareInput hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MouseInput
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KeyboardInput
    {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HardwareInput
    {
        public uint message;
        public ushort parameterLow;
        public ushort parameterHigh;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWnd, EnumProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attachThreadId, uint attachToThreadId, bool attach);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern int GetDlgCtrlID(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetFocus();

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowEnabled(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, Input[] inputs, int inputSize);

    public static string WindowText(IntPtr hWnd)
    {
        var buffer = new StringBuilder(2048);
        GetWindowText(hWnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    public static string WindowClass(IntPtr hWnd)
    {
        var buffer = new StringBuilder(256);
        GetClassName(hWnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    public static IntPtr FindTopWindow(int processId, string className)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, _) =>
        {
            uint ownerProcessId;
            GetWindowThreadProcessId(hWnd, out ownerProcessId);
            if (ownerProcessId == processId &&
                IsWindowVisible(hWnd) &&
                WindowClass(hWnd) == className)
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static IntPtr FindVisibleChildByClass(IntPtr parent, string className)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (hWnd, _) =>
        {
            if (IsWindowVisible(hWnd) && WindowClass(hWnd) == className)
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static IntPtr FindVisibleChildByClassAndText(
        IntPtr parent,
        string className,
        string text)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (hWnd, _) =>
        {
            if (IsWindowVisible(hWnd) &&
                WindowClass(hWnd) == className &&
                WindowText(hWnd) == text)
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static IntPtr FindVisibleDescendantByControlId(IntPtr parent, int controlId)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (hWnd, _) =>
        {
            if (IsWindowVisible(hWnd) && GetDlgCtrlID(hWnd) == controlId)
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool FocusControl(IntPtr window, IntPtr control)
    {
        uint processId;
        var targetThreadId = GetWindowThreadProcessId(window, out processId);
        var currentThreadId = GetCurrentThreadId();
        if (!AttachThreadInput(currentThreadId, targetThreadId, true))
        {
            return false;
        }
        try
        {
            SetActiveWindow(window);
            SetFocus(control);
            return GetFocus() == control;
        }
        finally
        {
            AttachThreadInput(currentThreadId, targetThreadId, false);
        }
    }

    public static bool ActivateWindow(IntPtr window)
    {
        var foreground = GetForegroundWindow();
        uint foregroundProcessId;
        uint targetProcessId;
        var foregroundThreadId = foreground == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(foreground, out foregroundProcessId);
        var targetThreadId = GetWindowThreadProcessId(window, out targetProcessId);
        var currentThreadId = GetCurrentThreadId();
        var attachedForeground = foregroundThreadId != 0 &&
            foregroundThreadId != currentThreadId &&
            AttachThreadInput(currentThreadId, foregroundThreadId, true);
        var attachedTarget = targetThreadId != currentThreadId &&
            AttachThreadInput(currentThreadId, targetThreadId, true);
        try
        {
            ShowWindow(window, 9);
            BringWindowToTop(window);
            SetActiveWindow(window);
            SetForegroundWindow(window);
            return GetForegroundWindow() == window;
        }
        finally
        {
            if (attachedTarget)
            {
                AttachThreadInput(currentThreadId, targetThreadId, false);
            }
            if (attachedForeground)
            {
                AttachThreadInput(currentThreadId, foregroundThreadId, false);
            }
        }
    }

    private static Input KeyInput(ushort virtualKey, uint flags)
    {
        return new Input
        {
            type = 1,
            union = new InputUnion
            {
                keyboard = new KeyboardInput
                {
                    virtualKey = virtualKey,
                    flags = flags
                }
            }
        };
    }

    public static bool SendKey(ushort virtualKey)
    {
        var inputs = new[]
        {
            KeyInput(virtualKey, 0),
            KeyInput(virtualKey, 2)
        };
        return SendInput(
            (uint)inputs.Length,
            inputs,
            Marshal.SizeOf(typeof(Input))) == inputs.Length;
    }

    public static bool SendChord(ushort modifier, ushort key)
    {
        var inputs = new[]
        {
            KeyInput(modifier, 0),
            KeyInput(key, 0),
            KeyInput(key, 2),
            KeyInput(modifier, 2)
        };
        return SendInput(
            (uint)inputs.Length,
            inputs,
            Marshal.SizeOf(typeof(Input))) == inputs.Length;
    }

    public static bool SendUnicodeText(string text)
    {
        var inputs = new List<Input>();
        foreach (var character in text)
        {
            inputs.Add(new Input
            {
                type = 1,
                union = new InputUnion
                {
                    keyboard = new KeyboardInput
                    {
                        scanCode = character,
                        flags = 4
                    }
                }
            });
            inputs.Add(new Input
            {
                type = 1,
                union = new InputUnion
                {
                    keyboard = new KeyboardInput
                    {
                        scanCode = character,
                        flags = 6
                    }
                }
            });
        }
        return SendInput(
            (uint)inputs.Count,
            inputs.ToArray(),
            Marshal.SizeOf(typeof(Input))) == inputs.Count;
    }
}
"@

function Assert-AbsoluteOutputDirectory {
  if (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
    throw "OutputDirectory must be absolute."
  }
  $normalizedOutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
  $repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\..")
  )
  $repositoryPrefix = $repositoryRoot.TrimEnd("\") + "\"
  if ($normalizedOutputDirectory.Equals(
        $repositoryRoot,
        [System.StringComparison]::OrdinalIgnoreCase
      ) -or
      $normalizedOutputDirectory.StartsWith(
        $repositoryPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
    throw "OutputDirectory must stay outside the Git repository."
  }

  if (Test-Path -LiteralPath $OutputDirectory) {
    $entries = @(Get-ChildItem -LiteralPath $OutputDirectory -Force)
    if ($entries.Count -gt 0 -and -not $Resume) {
      throw "OutputDirectory must be empty unless -Resume is used."
    }
    if ($Resume) {
      $unexpectedEntries = @(
        $entries |
          Where-Object Name -notin @(
            "exports",
            "oracle-session.json",
            "oracle-capture.lock",
            "oracle-manifest.pending.json"
          )
      )
      if ($unexpectedEntries.Count -gt 0) {
        throw "A resumable output directory may contain only the exports directory."
      }
    }
  }
  else {
    [void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
  }
}

function Resolve-MultiPackProcess {
  $processes = @(Get-Process -Name mpick32 -ErrorAction Stop)
  if ($ProcessId -ne 0) {
    $selected = $processes | Where-Object Id -eq $ProcessId
    if ($null -eq $selected) {
      throw "The configured mpick32 process was not found."
    }
    return $selected
  }
  if ($processes.Count -ne 1) {
    throw "Multiple mpick32 processes are running; pass -ProcessId explicitly."
  }
  return $processes[0]
}

function Assert-OracleBuild {
  param([System.Diagnostics.Process]$Process)

  $executablePath = $Process.Path
  $file = Get-Item -LiteralPath $executablePath
  $fileVersion = $file.VersionInfo.FileVersion
  $digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $executablePath).Hash.ToLowerInvariant()
  if ($fileVersion -ne $expectedFileVersion) {
    throw "Unsupported MultiPack file version '$fileVersion'."
  }
  if ($digest -ne $expectedExecutableSha256) {
    throw "The MultiPack executable digest does not match the pinned oracle build."
  }

  return [PSCustomObject]@{
    FileVersion = $fileVersion
    Digest = $digest
  }
}

function Assert-WritableOracleDirectory {
  param([System.Diagnostics.Process]$Process)

  if ($InventoryOnly) {
    return
  }

  $directory = Split-Path -Parent $Process.Path
  $probePath = Join-Path $directory ".multipack-oracle-write-probe-$PID.tmp"
  if (Test-Path -LiteralPath $probePath) {
    throw "The oracle write probe path already exists."
  }
  try {
    [System.IO.File]::WriteAllBytes($probePath, [byte[]]@())
  }
  catch {
    throw "A full capture requires the writable MultiPack oracle copy."
  }
  finally {
    if (Test-Path -LiteralPath $probePath) {
      Remove-Item -LiteralPath $probePath -Force
    }
  }
}

function Get-SolutionNumber {
  param([IntPtr]$SolutionWindow)

  $title = [MultiPackOracleNative]::WindowText($SolutionWindow)
  if ($title -notmatch "(\d+)$") {
    throw "The active MultiPack solution number is not readable."
  }
  return [int]$Matches[1]
}

function Send-GridKey {
  param(
    [IntPtr]$Grid,
    [int]$VirtualKey
  )

  [void][MultiPackOracleNative]::SendMessage(
    $Grid,
    0x0100,
    [IntPtr]$VirtualKey,
    [IntPtr]1
  )
  [void][MultiPackOracleNative]::SendMessage(
    $Grid,
    0x0101,
    [IntPtr]$VirtualKey,
    [IntPtr]::new([int]0xC0000001)
  )
}

function Wait-SolutionNumber {
  param(
    [IntPtr]$SolutionWindow,
    [int]$Expected,
    [int]$TimeoutSeconds = 5
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ((Get-SolutionNumber -SolutionWindow $SolutionWindow) -eq $Expected) {
      return
    }
    Start-Sleep -Milliseconds $StabilizationMilliseconds
  }
  throw "MultiPack did not select solution $Expected."
}

function Get-MultiPackCandidateCount {
  param(
    [IntPtr]$Grid,
    [IntPtr]$SolutionWindow,
    [int]$StepTimeoutSeconds = 2
  )

  $current = 1
  while ($true) {
    Send-GridKey -Grid $Grid -VirtualKey 0x28
    $deadline = (Get-Date).AddSeconds($StepTimeoutSeconds)
    $advanced = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds $StabilizationMilliseconds
      $observed = Get-SolutionNumber -SolutionWindow $SolutionWindow
      if ($observed -eq ($current + 1)) {
        $advanced = $true
        break
      }
      if ($observed -ne $current) {
        throw "The MultiPack candidate sequence skipped an ordinal."
      }
    }
    if ($advanced) {
      $current += 1
      if ($current -gt 9999) {
        throw "The MultiPack candidate count exceeds the supported basename range."
      }
      continue
    }

    if ($current -gt 1) {
      Send-GridKey -Grid $Grid -VirtualKey 0x26
      Wait-SolutionNumber -SolutionWindow $SolutionWindow -Expected ($current - 1)
      Send-GridKey -Grid $Grid -VirtualKey 0x28
      Wait-SolutionNumber -SolutionWindow $SolutionWindow -Expected $current
    }
    else {
      if ($ExpectedCandidateCount -eq 1) {
        return 1
      }
      throw "A single-candidate list requires ExpectedCandidateCount 1."
    }
    return $current
  }
}

function Restore-Solution {
  param(
    [IntPtr]$Grid,
    [IntPtr]$SolutionWindow,
    [int]$Ordinal
  )

  if (-not [MultiPackOracleNative]::IsWindow($Grid) -or
      -not [MultiPackOracleNative]::IsWindow($SolutionWindow)) {
    return
  }
  Send-GridKey -Grid $Grid -VirtualKey 0x24
  Wait-SolutionNumber -SolutionWindow $SolutionWindow -Expected 1
  for ($index = 1; $index -lt $Ordinal; $index += 1) {
    Send-GridKey -Grid $Grid -VirtualKey 0x28
    Wait-SolutionNumber -SolutionWindow $SolutionWindow -Expected ($index + 1)
  }
}

function Wait-TopModal {
  param(
    [int]$OwnerProcessId,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $window = [MultiPackOracleNative]::FindTopWindow($OwnerProcessId, "#32770")
    if ($window -ne [IntPtr]::Zero) {
      return $window
    }
    Start-Sleep -Milliseconds 100
  }
  throw "MultiPack did not open the expected modal dialog."
}

function Close-KnownModal {
  param([IntPtr]$Modal)

  if ($Modal -eq [IntPtr]::Zero -or -not [MultiPackOracleNative]::IsWindow($Modal)) {
    return
  }
  $title = [MultiPackOracleNative]::WindowText($Modal)
  $buttonTexts = if ($title -in @("Fehler", "Informationen")) {
    @("OK")
  }
  else {
    @("Cancel", "Abbrechen")
  }
  $button = [IntPtr]::Zero
  foreach ($buttonText in $buttonTexts) {
    $button = [MultiPackOracleNative]::FindVisibleChildByClassAndText(
      $Modal,
      "Button",
      $buttonText
    )
    if ($button -ne [IntPtr]::Zero) {
      break
    }
  }
  if ($button -ne [IntPtr]::Zero) {
    [void][MultiPackOracleNative]::SendMessage(
      $button,
      0x00F5,
      [IntPtr]::Zero,
      [IntPtr]::Zero
    )
  }
}

function Assert-InteractiveDesktop {
  $foreground = [MultiPackOracleNative]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) {
    throw "No interactive Windows foreground is available; unlock the desktop and rerun."
  }
  $foregroundClass = [MultiPackOracleNative]::WindowClass($foreground)
  $foregroundTitle = [MultiPackOracleNative]::WindowText($foreground)
  if ($foregroundClass -eq "Windows.UI.Core.CoreWindow" -and
      $foregroundTitle -match "Lock Screen") {
    throw "The Windows desktop is locked; unlock it before running a full export capture."
  }
}

function Send-SaveDialogInput {
  param(
    [IntPtr]$Dialog,
    [string]$Directory,
    [string]$Basename,
    [bool]$SetDirectory
  )

  Assert-InteractiveDesktop
  if (-not [MultiPackOracleNative]::ActivateWindow($Dialog)) {
    throw "The Save As dialog could not become the foreground window."
  }
  Start-Sleep -Milliseconds 300
  if ($SetDirectory) {
    if (-not [MultiPackOracleNative]::SendChord(0x11, 0x4C)) {
      throw "Unable to focus the Save As address bar."
    }
    Start-Sleep -Milliseconds 300
    if (-not [MultiPackOracleNative]::SendUnicodeText($Directory)) {
      throw "Unable to type the Save As directory."
    }
    Start-Sleep -Milliseconds 200
    if (-not [MultiPackOracleNative]::SendKey(0x0D)) {
      throw "Unable to navigate to the Save As directory."
    }
    Start-Sleep -Milliseconds 1000
  }

  $fileNameEdit = [MultiPackOracleNative]::FindVisibleDescendantByControlId(
    $Dialog,
    1001
  )
  if ($fileNameEdit -eq [IntPtr]::Zero) {
    throw "The Save As file name field was not found."
  }
  if (-not [MultiPackOracleNative]::FocusControl($Dialog, $fileNameEdit)) {
    throw "The Save As file name field could not receive focus."
  }
  Start-Sleep -Milliseconds 300
  if (-not [MultiPackOracleNative]::SendChord(0x11, 0x41)) {
    throw "Unable to select the existing Save As file name."
  }
  Start-Sleep -Milliseconds 150
  if (-not [MultiPackOracleNative]::SendUnicodeText($Basename)) {
    throw "Unable to type the candidate export basename."
  }
  Start-Sleep -Milliseconds 500
  if (-not [MultiPackOracleNative]::SendKey(0x0D)) {
    throw "Unable to submit the Save As dialog."
  }
}

function Assert-RobEncodedInput {
  param([string]$Path)

  $enumerator = [System.IO.File]::ReadLines($Path).GetEnumerator()
  try {
    if (-not $enumerator.MoveNext()) {
      throw "The candidate ROB export has no pallet header."
    }
    $palletValues = @(
      $enumerator.Current.Trim() -split "\s+" |
        ForEach-Object {
          [double]::Parse($_, [System.Globalization.CultureInfo]::InvariantCulture)
        }
    )
    if (-not $enumerator.MoveNext()) {
      throw "The candidate ROB export has no package header."
    }
    $packageValues = @(
      $enumerator.Current.Trim() -split "\s+" |
        ForEach-Object {
          [double]::Parse($_, [System.Globalization.CultureInfo]::InvariantCulture)
        }
    )
  }
  finally {
    $enumerator.Dispose()
  }

  if ($palletValues.Count -lt 2 -or
      $palletValues[0] -ne $PalletLengthMm -or
      $palletValues[1] -ne $PalletWidthMm) {
    throw "The candidate ROB pallet dimensions do not match the asserted case."
  }
  if ($packageValues.Count -lt 3 -or
      $packageValues[0] -ne $PackageLengthMm -or
      $packageValues[1] -ne $PackageWidthMm -or
      $packageValues[2] -ne $PackageHeightMm) {
    throw "The candidate ROB package dimensions do not match the asserted case."
  }
  $encodedInputDirection = if ($packageValues.Count -gt 3) {
    [int]$packageValues[3]
  }
  else {
    0
  }
  if ($encodedInputDirection -ne $InputDirection) {
    throw "The candidate ROB input direction does not match the asserted case."
  }
}

function Wait-StableExport {
  param(
    [string]$Path,
    [int]$OwnerProcessId,
    [IntPtr]$SaveDialog,
    [int]$TimeoutSeconds = 15
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $stableLength = -1L
  $stableObservations = 0
  while ((Get-Date) -lt $deadline) {
    $modal = [MultiPackOracleNative]::FindTopWindow($OwnerProcessId, "#32770")
    if ($modal -ne [IntPtr]::Zero -and $modal -ne $SaveDialog) {
      $title = [MultiPackOracleNative]::WindowText($modal)
      Close-KnownModal -Modal $modal
      if ($title -ne "Informationen") {
        throw "MultiPack opened an unexpected '$title' dialog during export."
      }
      Start-Sleep -Milliseconds 100
    }
    if (Test-Path -LiteralPath $Path) {
      $file = Get-Item -LiteralPath $Path
      if ($file.Length -gt 0 -and $file.Length -eq $stableLength) {
        $stableObservations += 1
        if ($stableObservations -ge 3) {
          return $file
        }
      }
      else {
        $stableLength = $file.Length
        $stableObservations = 0
      }
    }
    Start-Sleep -Milliseconds 100
  }
  throw "The candidate ROB export was not created and stabilized."
}

function Export-CurrentCandidate {
  param(
    [System.Diagnostics.Process]$Process,
    [IntPtr]$ExportButton,
    [string]$ExportDirectory,
    [IntPtr]$SolutionWindow,
    [int]$Ordinal,
    [bool]$SetDirectory,
    [string]$Basename = ""
  )

  $basename = if ($Basename -eq "") {
    "candidate-{0:D4}.rob" -f $Ordinal
  }
  else {
    $Basename
  }
  if ($basename -notmatch "^(candidate|resume-check)-\d{4}\.rob$") {
    throw "The candidate export basename is invalid."
  }
  $path = Join-Path $ExportDirectory $basename
  if (Test-Path -LiteralPath $path) {
    throw "Candidate export '$basename' already exists."
  }

  if ((Get-SolutionNumber -SolutionWindow $SolutionWindow) -ne $Ordinal) {
    throw "The active MultiPack solution changed before export."
  }

  $existingModal = [MultiPackOracleNative]::FindTopWindow($Process.Id, "#32770")
  if ($existingModal -ne [IntPtr]::Zero) {
    throw "MultiPack already has a modal dialog open."
  }

  [void][MultiPackOracleNative]::PostMessage(
    $ExportButton,
    0x00F5,
    [IntPtr]::Zero,
    [IntPtr]::Zero
  )
  $saveDialog = Wait-TopModal -OwnerProcessId $Process.Id
  $title = [MultiPackOracleNative]::WindowText($saveDialog)
  if ($title -notin @("Save As", "Speichern unter")) {
    Close-KnownModal -Modal $saveDialog
    throw "MultiPack opened '$title' instead of the Save As dialog."
  }

  try {
    Send-SaveDialogInput `
      -Dialog $saveDialog `
      -Directory $ExportDirectory `
      -Basename $basename `
      -SetDirectory $SetDirectory
    $file = Wait-StableExport `
      -Path $path `
      -OwnerProcessId $Process.Id `
      -SaveDialog $saveDialog
    Assert-RobEncodedInput -Path $path
    if ((Get-SolutionNumber -SolutionWindow $SolutionWindow) -ne $Ordinal) {
      throw "The active MultiPack solution changed during export."
    }
    return [PSCustomObject]@{
      basename = $basename
      byteLength = [int64]$file.Length
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    }
  }
  catch {
    Close-KnownModal -Modal $saveDialog
    throw
  }
}

function New-OracleSessionIdentity {
  param(
    [int]$CandidateCount,
    [object]$Build
  )

  return [PSCustomObject]@{
    schemaVersion = 1
    oracle = [PSCustomObject]@{
      fileVersion = $Build.FileVersion
      executableSha256 = $Build.Digest
    }
    caseId = $CaseId
    candidateCount = $CandidateCount
    expectedCandidateCount = $ExpectedCandidateCount
    input = [PSCustomObject]@{
      packageLengthMm = $PackageLengthMm
      packageWidthMm = $PackageWidthMm
      packageHeightMm = $PackageHeightMm
      inputDirection = $InputDirection
      clearanceMm = $ClearanceMm
      palletLengthMm = $PalletLengthMm
      palletWidthMm = $PalletWidthMm
      requestedPackagesPerLayer = $RequestedPackagesPerLayer
    }
  }
}

function Write-OrValidateOracleSession {
  param(
    [object]$Session,
    [string]$Directory
  )

  $path = Join-Path $Directory "oracle-session.json"
  $expectedJson = $Session | ConvertTo-Json -Depth 8 -Compress
  if ($Resume) {
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Resume requires the original oracle-session.json."
    }
    $actual = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $actualJson = $actual | ConvertTo-Json -Depth 8 -Compress
    if ($actualJson -ne $expectedJson) {
      throw "The resume metadata does not match the active capture case."
    }
  }
  else {
    if (Test-Path -LiteralPath $path) {
      throw "The oracle session identity already exists."
    }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, "$expectedJson`n", $encoding)
  }
  return $path
}

function Write-Manifest {
  param(
    [object]$Manifest,
    [string]$Directory
  )

  $path = Join-Path $Directory "oracle-manifest.json"
  $pendingPath = Join-Path $Directory "oracle-manifest.pending.json"
  if ((Test-Path -LiteralPath $path) -or
      (Test-Path -LiteralPath $pendingPath)) {
    throw "The oracle manifest output already exists."
  }
  $json = $Manifest | ConvertTo-Json -Depth 12
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($pendingPath, "$json`n", $encoding)

  $repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\..")
  )
  $validationCli = Join-Path `
    $repositoryRoot `
    "src\lib\parity\oracleCaptureValidationCli.node.ts"
  $bun = Get-Command bun -ErrorAction Stop
  try {
    Push-Location $repositoryRoot
    try {
      $validationOutput = & $bun.Source run $validationCli $pendingPath 2>&1
      if ($LASTEXITCODE -ne 0) {
        throw "Oracle capture validation failed."
      }
      [void]$validationOutput
      Move-Item -LiteralPath $pendingPath -Destination $path
      $finalValidationOutput = & $bun.Source run $validationCli $path 2>&1
      if ($LASTEXITCODE -ne 0) {
        throw "Final oracle capture validation failed."
      }
      [void]$finalValidationOutput
    }
    finally {
      Pop-Location
    }
  }
  catch {
    if (Test-Path -LiteralPath $pendingPath) {
      Remove-Item -LiteralPath $pendingPath -Force
    }
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
    throw
  }
  return $path
}

if ($StabilizationMilliseconds -lt 25 -or $StabilizationMilliseconds -gt 5000) {
  throw "StabilizationMilliseconds must be between 25 and 5000."
}
if ($Resume -and $InventoryOnly) {
  throw "-Resume cannot be combined with -InventoryOnly."
}
if ($CaseId -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]*$" -or
    $CaseId.EndsWith(".rob", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "CaseId must be anonymized and must not resemble a ROB basename."
}
if ($InputDirection -notin @(0, 1)) {
  throw "InputDirection must be 0 or 1."
}
if ($PackageLengthMm -le 0 -or
    $PackageWidthMm -le 0 -or
    $PackageHeightMm -le 0 -or
    $ClearanceMm -lt 0 -or
    $PalletLengthMm -le 0 -or
    $PalletWidthMm -le 0) {
  throw "Package and pallet dimensions must be positive and clearance non-negative."
}
if ($null -ne $RequestedPackagesPerLayer -and
    $RequestedPackagesPerLayer -le 0) {
  throw "RequestedPackagesPerLayer must be positive when provided."
}
if ($null -eq $ExpectedCandidateCount) {
  throw "Capture requires ExpectedCandidateCount."
}
if ($null -ne $ExpectedCandidateCount -and $ExpectedCandidateCount -le 0) {
  throw "ExpectedCandidateCount must be positive when provided."
}

Assert-AbsoluteOutputDirectory
$lockPath = Join-Path $OutputDirectory "oracle-capture.lock"
try {
  $lockStream = [System.IO.File]::Open(
    $lockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
}
catch {
  throw "Another oracle capture is using this output directory."
}
$processMutex = $null
$processMutexOwned = $false
try {
if ($Resume) {
  $stalePendingManifest = Join-Path `
    $OutputDirectory `
    "oracle-manifest.pending.json"
  if (Test-Path -LiteralPath $stalePendingManifest) {
    Remove-Item -LiteralPath $stalePendingManifest -Force
  }
}
$process = Resolve-MultiPackProcess
$processMutex = [System.Threading.Mutex]::new(
  $false,
  "Local\MultiPackOracleCapture-$($process.Id)"
)
try {
  $processMutexOwned = $processMutex.WaitOne(0)
}
catch [System.Threading.AbandonedMutexException] {
  $processMutexOwned = $true
}
if (-not $processMutexOwned) {
  throw "Another oracle capture is already controlling this MultiPack process."
}
$build = Assert-OracleBuild -Process $process
Assert-WritableOracleDirectory -Process $process
$mainWindow = [MultiPackOracleNative]::FindTopWindow($process.Id, "Tmain")
if ($mainWindow -eq [IntPtr]::Zero) {
  throw "The MultiPack main window was not found."
}
$grid = [MultiPackOracleNative]::FindVisibleChildByClass($mainWindow, "TcxGridSite")
$solutionWindow = [MultiPackOracleNative]::FindVisibleChildByClass(
  $mainWindow,
  "TFormQSolution"
)
$exportButton = [MultiPackOracleNative]::FindVisibleChildByClassAndText(
  $mainWindow,
  "TButton",
  "Roboterdatei..."
)
if ($grid -eq [IntPtr]::Zero -or $solutionWindow -eq [IntPtr]::Zero) {
  throw "MultiPack does not currently show a generated candidate set."
}
if (-not $InventoryOnly -and $exportButton -eq [IntPtr]::Zero) {
  throw "The MultiPack robot export button was not found."
}
$initialModal = [MultiPackOracleNative]::FindTopWindow($process.Id, "#32770")
if ($initialModal -ne [IntPtr]::Zero) {
  throw "MultiPack has a modal dialog open before candidate enumeration."
}

$originalOrdinal = Get-SolutionNumber -SolutionWindow $solutionWindow
$candidates = New-Object System.Collections.Generic.List[object]
$exportSetComplete = $false
try {
  Send-GridKey -Grid $grid -VirtualKey 0x24
  Wait-SolutionNumber -SolutionWindow $solutionWindow -Expected 1
  $candidateCount = Get-MultiPackCandidateCount `
    -Grid $grid `
    -SolutionWindow $solutionWindow
  if ($null -ne $ExpectedCandidateCount -and
      $candidateCount -ne $ExpectedCandidateCount) {
    throw "The active MultiPack candidate count does not match ExpectedCandidateCount."
  }
  Send-GridKey -Grid $grid -VirtualKey 0x24
  Wait-SolutionNumber -SolutionWindow $solutionWindow -Expected 1

  $sessionPath = $null
  if (-not $InventoryOnly) {
    $session = New-OracleSessionIdentity `
      -CandidateCount $candidateCount `
      -Build $build
    $sessionPath = Write-OrValidateOracleSession `
      -Session $session `
      -Directory $OutputDirectory
  }

  $exportDirectory = Join-Path $OutputDirectory "exports"
  $existingExportCount = 0
  $setExportDirectory = $true
  if (-not $InventoryOnly) {
    [void](New-Item -ItemType Directory -Path $exportDirectory -Force)
    if ($Resume) {
      $staleVerificationEntries = @(
        Get-ChildItem -LiteralPath $exportDirectory -File -Force |
          Where-Object Name -match "^resume-check-\d{4}\.rob$"
      )
      foreach ($staleVerificationEntry in $staleVerificationEntries) {
        Remove-Item -LiteralPath $staleVerificationEntry.FullName -Force
      }
      $exportEntries = @(
        Get-ChildItem -LiteralPath $exportDirectory -Force |
          Sort-Object Name
      )
      $invalidEntries = @(
        $exportEntries | Where-Object {
          $_.PSIsContainer -or $_.Name -notmatch "^candidate-\d{4}\.rob$"
        }
      )
      if ($invalidEntries.Count -gt 0) {
        throw "The resumable exports directory contains unexpected entries."
      }
      for ($index = 0; $index -lt $exportEntries.Count; $index += 1) {
        $expectedBasename = "candidate-{0:D4}.rob" -f ($index + 1)
        if ($exportEntries[$index].Name -ne $expectedBasename -or
            $exportEntries[$index].Length -le 0) {
          throw "Existing candidate exports must be contiguous and non-empty."
        }
      }
      $existingExportCount = $exportEntries.Count
      if ($existingExportCount -gt $candidateCount) {
        throw "The resumable capture contains more exports than MultiPack candidates."
      }
      $setExportDirectory = $true
    }
  }

  for ($ordinal = 1; $ordinal -le $candidateCount; $ordinal += 1) {
    Wait-SolutionNumber -SolutionWindow $solutionWindow -Expected $ordinal
    $activeSolutionNumber = Get-SolutionNumber -SolutionWindow $solutionWindow
    $candidateExport = if ($InventoryOnly) {
      $null
    }
    elseif ($ordinal -le $existingExportCount) {
      $basename = "candidate-{0:D4}.rob" -f $ordinal
      $existingPath = Join-Path $exportDirectory $basename
      Assert-RobEncodedInput -Path $existingPath
      $existingFile = Get-Item -LiteralPath $existingPath
      $existingEvidence = [PSCustomObject]@{
        basename = $basename
        byteLength = [int64]$existingFile.Length
        sha256 = (
          Get-FileHash -Algorithm SHA256 -LiteralPath $existingPath
        ).Hash.ToLowerInvariant()
      }
      $verificationBasename = "resume-check-{0:D4}.rob" -f $ordinal
      $verificationPath = Join-Path $exportDirectory $verificationBasename
      try {
        $verificationEvidence = Export-CurrentCandidate `
          -Process $process `
          -ExportButton $exportButton `
          -ExportDirectory $exportDirectory `
          -SolutionWindow $solutionWindow `
          -Ordinal $ordinal `
          -SetDirectory $setExportDirectory `
          -Basename $verificationBasename
        $setExportDirectory = $false
        if ($verificationEvidence.byteLength -ne $existingEvidence.byteLength -or
            $verificationEvidence.sha256 -ne $existingEvidence.sha256) {
          throw "An existing candidate export does not match the active MultiPack solution."
        }
      }
      finally {
        if (Test-Path -LiteralPath $verificationPath) {
          Remove-Item -LiteralPath $verificationPath -Force
        }
      }
      $existingEvidence
    }
    else {
      $capturedExport = Export-CurrentCandidate `
        -Process $process `
        -ExportButton $exportButton `
        -ExportDirectory $exportDirectory `
        -SolutionWindow $solutionWindow `
        -Ordinal $ordinal `
        -SetDirectory $setExportDirectory
      $setExportDirectory = $false
      $capturedExport
    }
    $candidates.Add([PSCustomObject]@{
      ordinal = $ordinal
      solutionNumber = $activeSolutionNumber
      table = $null
      export = $candidateExport
    })

    if ($ordinal -lt $candidateCount) {
      Send-GridKey -Grid $grid -VirtualKey 0x28
      Wait-SolutionNumber `
        -SolutionWindow $solutionWindow `
        -Expected ($ordinal + 1)
    }
  }

  if (-not $InventoryOnly) {
    $missingExportCount = @(
      $candidates | Where-Object { $null -eq $_.export }
    ).Count
    $exportSetComplete =
      $candidates.Count -eq $candidateCount -and $missingExportCount -eq 0
  }

  $manifest = [PSCustomObject]@{
    schemaVersion = 2
    oracle = [PSCustomObject]@{
      product = $oracleProduct
      fileVersion = $build.FileVersion
      executableSha256 = $build.Digest
      architecture = "x86"
    }
    privacy = [PSCustomObject]@{
      absolutePathsStored = $false
      sourceTextStored = $false
      sourceBasenamesStored = $false
      operatorProvidedCaseIdStored = $true
      screenshotsStored = $false
    }
    capture = [PSCustomObject]@{
      caseId = $CaseId
      generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
      candidateCount = $candidateCount
      expectedCandidateCount = $ExpectedCandidateCount
      exportSetComplete = $exportSetComplete
    }
    input = [PSCustomObject]@{
      provenance = [PSCustomObject]@{
        caseId = "operator-asserted"
        encodedDimensions = if ($exportSetComplete) {
          "verified-from-rob-export"
        }
        else {
          "operator-asserted-unverified"
        }
        clearance = "operator-asserted-not-encoded"
        requestedPackagesPerLayer = "operator-asserted-not-encoded"
      }
      package = [PSCustomObject]@{
        lengthMm = $PackageLengthMm
        widthMm = $PackageWidthMm
        heightMm = $PackageHeightMm
        inputDirection = $InputDirection
        clearanceMm = $ClearanceMm
      }
      pallet = [PSCustomObject]@{
        lengthMm = $PalletLengthMm
        widthMm = $PalletWidthMm
      }
      requestedPackagesPerLayer = $RequestedPackagesPerLayer
    }
    candidates = $candidates
  }
  $manifestPath = Write-Manifest -Manifest $manifest -Directory $OutputDirectory
  if ($null -ne $sessionPath -and (Test-Path -LiteralPath $sessionPath)) {
    try {
      Remove-Item -LiteralPath $sessionPath -Force
    }
    catch {
      Write-Warning "The validated capture is complete, but oracle-session.json could not be removed."
    }
  }

  [PSCustomObject]@{
    processId = $process.Id
    fileVersion = $build.FileVersion
    candidateCount = $candidateCount
    exportSetComplete = $exportSetComplete
    manifestPath = $manifestPath
  } | ConvertTo-Json -Depth 3
}
finally {
  try {
    Restore-Solution `
      -Grid $grid `
      -SolutionWindow $solutionWindow `
      -Ordinal $originalOrdinal
  }
  catch {
    Write-Warning "MultiPack solution selection could not be restored."
  }
}
}
finally {
  try {
    if ($processMutexOwned -and $null -ne $processMutex) {
      $processMutex.ReleaseMutex()
    }
    if ($null -ne $processMutex) {
      $processMutex.Dispose()
    }
  }
  catch {
    Write-Warning "The MultiPack process mutex could not be released cleanly."
  }
  try {
    $lockStream.Dispose()
    if (Test-Path -LiteralPath $lockPath) {
      Remove-Item -LiteralPath $lockPath -Force
    }
  }
  catch {
    Write-Warning "The output-directory lock could not be removed cleanly."
  }
}
