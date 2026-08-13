$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$deps = Join-Path $root 'resources\windows-deps'
$wheels = Join-Path $deps 'wheels'
New-Item -ItemType Directory -Force -Path $wheels | Out-Null

# Pin a verified Python 3.12 x64 installer for fully offline setup.
$python = Join-Path $deps 'python-installer.exe'
if (!(Test-Path $python)) {
  Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.6/python-3.12.6-amd64.exe' -OutFile $python
}

# winget runs only on the CI builder. Downloaded files are embedded in NSIS.
function Get-WingetPackage($id, $pattern, $target) {
  if (Test-Path $target) { return }
  $staging = Join-Path $env:TEMP ("agent-workbench-" + $id.Replace('.', '-'))
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  winget download --id $id --exact --source winget --download-directory $staging --accept-package-agreements --accept-source-agreements
  $source = Get-ChildItem $staging -Recurse -File | Where-Object { $_.Name -match $pattern } | Select-Object -First 1
  if (!$source) { throw "Offline installer not found for $id" }
  Copy-Item $source.FullName $target -Force
}

Get-WingetPackage 'UB-Mannheim.TesseractOCR' '\.exe$' (Join-Path $deps 'tesseract-installer.exe')
Get-WingetPackage 'oschwartz10612.Poppler' '\.zip$' (Join-Path $deps 'poppler.zip')

# Download ABI-compatible wheels on Windows for fully offline installation.
$pythonForWheels = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
if (!(Test-Path $pythonForWheels)) {
  Start-Process -FilePath $python -ArgumentList '/quiet InstallAllUsers=0 PrependPath=0 Include_test=0' -Wait
}
& $pythonForWheels -m pip download --only-binary=:all: --dest $wheels pypdf pillow numpy openpyxl pytesseract
