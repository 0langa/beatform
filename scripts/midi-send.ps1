# Minimal MIDI sender for VERIFY-003 — no dependencies, straight winmm
# P/Invoke. Finds the first output port whose name contains -Port, opens it,
# sends each dash-separated hex triplet in -Messages (comma-separated list),
# then closes. Example:
#   powershell -File scripts/midi-send.ps1 -Port "loopMIDI Beatform" `
#     -Messages "B0-07-64,90-3C-7F" -DelayMs 40
param(
    [string]$Port = "loopMIDI",
    [Parameter(Mandatory = $true)][string]$Messages,
    [int]$DelayMs = 40
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class WinMidi
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MIDIOUTCAPS
    {
        public ushort wMid;
        public ushort wPid;
        public uint vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szPname;
        public ushort wTechnology;
        public ushort wVoices;
        public ushort wNotes;
        public ushort wChannelMask;
        public uint dwSupport;
    }

    [DllImport("winmm.dll")]
    public static extern uint midiOutGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern uint midiOutGetDevCaps(uint uDeviceID, ref MIDIOUTCAPS caps, uint cbCaps);
    [DllImport("winmm.dll")]
    public static extern uint midiOutOpen(ref IntPtr handle, uint uDeviceID, IntPtr cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")]
    public static extern uint midiOutShortMsg(IntPtr handle, uint dwMsg);
    [DllImport("winmm.dll")]
    public static extern uint midiOutClose(IntPtr handle);
}
"@

$count = [WinMidi]::midiOutGetNumDevs()
$deviceId = [uint32]::MaxValue
$deviceName = ""
for ($i = 0; $i -lt $count; $i++) {
    $caps = New-Object WinMidi+MIDIOUTCAPS
    $size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WinMidi+MIDIOUTCAPS])
    [void][WinMidi]::midiOutGetDevCaps($i, [ref]$caps, $size)
    if ($caps.szPname -like "*$Port*") { $deviceId = $i; $deviceName = $caps.szPname; break }
}
if ($deviceId -eq [uint32]::MaxValue) {
    Write-Error "No MIDI output port matching '$Port' (found $count ports)"
    exit 1
}

$handle = [IntPtr]::Zero
$rc = [WinMidi]::midiOutOpen([ref]$handle, $deviceId, [IntPtr]::Zero, [IntPtr]::Zero, 0)
if ($rc -ne 0) { Write-Error "midiOutOpen failed: $rc"; exit 1 }

$sent = 0
try {
    foreach ($msg in $Messages.Split(",")) {
        $bytes = $msg.Trim().Split("-") | ForEach-Object { [Convert]::ToInt32($_, 16) }
        $dword = [uint32]($bytes[0] -bor ($bytes[1] -shl 8) -bor ($bytes[2] -shl 16))
        $rc = [WinMidi]::midiOutShortMsg($handle, $dword)
        if ($rc -ne 0) { Write-Error "midiOutShortMsg failed: $rc"; exit 1 }
        $sent++
        Start-Sleep -Milliseconds $DelayMs
    }
}
finally {
    [void][WinMidi]::midiOutClose($handle)
}
Write-Output "SENT $sent to '$deviceName' (device $deviceId)"
