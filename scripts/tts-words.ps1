# One WAV per word, for scripts/lyrics-timing-probe.mjs.
#
# Windows' built-in SAPI voice speaks each word into its own 44.1 kHz mono
# WAV. The probe trims and places them itself, so every word onset in the
# test song is KNOWN to the sample. (SAPI's SpeakProgress.AudioPosition looked
# like the obvious ground truth and is not: measured 2026-10-10 it ran 2.2-2.4x
# longer than the WAV it described, drifting through the file.)
#
#   powershell -File scripts/tts-words.ps1 -Words "Turn|the|lights" -OutDir <dir>
#   -> <dir>\w0.wav, <dir>\w1.wav, ...
param(
    [Parameter(Mandatory = $true)][string]$Words,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$Voice = "Microsoft Zira Desktop"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    44100,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$i = 0
foreach ($w in $Words.Split("|")) {
    $synth.SetOutputToWaveFile((Join-Path $OutDir "w$i.wav"), $fmt)
    $synth.Speak($w)
    $i++
}
$synth.SetOutputToNull()
$synth.Dispose()
"OK $i"
