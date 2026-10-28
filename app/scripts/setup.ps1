# SceneForge setup for Windows: open-source tools, the local vision model and sample data.
# Run from the repo root or app/:  powershell -ExecutionPolicy Bypass -File app\scripts\setup.ps1
# Re-running is safe; finished downloads are skipped and interrupted ones resume.
param(
  [switch]$NoTools,    # skip FFmpeg / COLMAP / Brush (only needed to reconstruct your own videos)
  [switch]$NoSamples,  # skip the sample splat and test videos
  [switch]$Small       # use the 2B vision model (for GPUs under 4 GB)
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$tools = Join-Path $repo 'tools'
$dl = Join-Path $tools '_dl'
$scenes = Join-Path $repo 'data\scenes'
$videos = Join-Path $repo 'data\videos'
New-Item -ItemType Directory -Force $dl, $scenes, $videos | Out-Null
Set-Content -Path (Join-Path $tools '.gitignore') -Value '*'

function Get-File([string]$url, [string]$dest) {
  if (Test-Path $dest) { Write-Host "  have $(Split-Path $dest -Leaf)"; return }
  Write-Host "  downloading $(Split-Path $dest -Leaf)"
  $part = "$dest.part"
  # Some CDNs stall mid-transfer; abort slow stretches and resume.
  for ($i = 0; $i -lt 30; $i++) {
    curl.exe -L --fail -s -S --speed-limit 20000 --speed-time 30 -C - -o $part $url
    if ($LASTEXITCODE -eq 0) { Move-Item -Force $part $dest; return }
    Write-Host "    retrying ($i)"
  }
  throw "Download failed: $url"
}

Write-Host '1/4 Node packages'
Push-Location (Join-Path $repo 'app'); npm install --no-fund --no-audit; Pop-Location

if (-not $NoTools) {
  Write-Host '2/4 Capture tools (FFmpeg LGPL, COLMAP BSD, Brush Apache-2.0)'
  $pkgs = @(
    @{ n = 'ffmpeg'; u = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-lgpl-8.1.zip' },
    @{ n = 'colmap'; u = 'https://github.com/colmap/colmap/releases/download/4.2.1/colmap-x64-windows-nocuda.zip' },
    @{ n = 'brush';  u = 'https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip' }
  )
  foreach ($p in $pkgs) {
    $zip = Join-Path $dl "$($p.n).zip"
    Get-File $p.u $zip
    $out = Join-Path $tools $p.n
    if (-not (Test-Path $out)) { Expand-Archive -Force $zip $out }
  }
} else { Write-Host '2/4 Capture tools skipped' }

Write-Host '3/4 Vision model (Apache-2.0) via Ollama'
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw 'Ollama is not installed. Get it from https://ollama.com/download and run this again.' }
$model = if ($Small) { 'qwen3-vl:2b-instruct' } else { 'qwen3-vl:4b-instruct' }
ollama pull $model

if (-not $NoSamples) {
  Write-Host '4/4 Samples'
  # Mip-NeRF 360 "room", trained 3DGS splat (research dataset; see README for terms).
  Get-File 'https://huggingface.co/kishimisu/3d-gaussian-splatting-webgl/resolve/main/room.ply' (Join-Path $scenes 'room.ply')
  # Pexels videos (Pexels licence: free to use) for testing the video → splat pipeline.
  Get-File 'https://videos.pexels.com/video-files/7578552/7578552-hd_1920_1080_30fps.mp4' (Join-Path $videos 'pexels-7578552.mp4')
  Get-File 'https://videos.pexels.com/video-files/17211925/17211925-hd_1920_1080_30fps.mp4' (Join-Path $videos 'pexels-17211925.mp4')
} else { Write-Host '4/4 Samples skipped' }

Write-Host "`nDone. Start SceneForge:  cd app; npm run build; npm start   then open http://127.0.0.1:5180"
