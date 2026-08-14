$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$deps = Join-Path $root 'resources\windows-deps'
$wheels = Join-Path $deps 'wheels'
$requirements = Join-Path $PSScriptRoot 'windows-runtime-requirements.txt'
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

# Tesseract's upstream NSIS installer is machine-scoped and its custom /D path
# is not reliable. Install it only on the disposable CI runner, then embed its
# full directory as a portable per-user runtime for member computers.
$tesseractPortable = Join-Path $deps 'tesseract'
$tesseractPortableExe = Join-Path $tesseractPortable 'tesseract.exe'
if (!(Test-Path $tesseractPortableExe)) {
  $tesseractInstalled = Join-Path $env:ProgramFiles 'Tesseract-OCR'
  if (!(Test-Path (Join-Path $tesseractInstalled 'tesseract.exe'))) {
    Start-Process -FilePath (Join-Path $deps 'tesseract-installer.exe') -ArgumentList '/S' -Wait
  }
  if (!(Test-Path (Join-Path $tesseractInstalled 'tesseract.exe'))) { throw 'Tesseract did not install on the build runner' }
  Copy-Item $tesseractInstalled $tesseractPortable -Recurse -Force
}
Remove-Item (Join-Path $deps 'tesseract-installer.exe') -Force -ErrorAction SilentlyContinue

# Download ABI-compatible, pinned wheels on Windows for fully offline installation.
$pythonForWheels = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
if (!(Test-Path $pythonForWheels)) {
  Start-Process -FilePath $python -ArgumentList '/quiet InstallAllUsers=0 PrependPath=0 Include_test=0' -Wait
}
if (!(Test-Path $pythonForWheels)) { throw 'Bundled Python 3.12 was not installed on the build runner' }
if (!(Test-Path $requirements)) { throw 'Windows runtime requirements file is missing' }
& $pythonForWheels -m pip download --only-binary=:all: --dest $wheels --requirement $requirements
if ($LASTEXITCODE -ne 0) { throw 'Unable to download pinned Python wheels' }

# Fail before packaging if any required offline payload is absent or empty.
$requiredPayloads = @(
  (Join-Path $deps 'python-installer.exe'),
  (Join-Path $deps 'tesseract\tesseract.exe'),
  (Join-Path $deps 'poppler.zip'),
  (Join-Path $deps 'repair-runtime.bat')
)
foreach ($file in $requiredPayloads) {
  if (!(Test-Path $file) -or (Get-Item $file).Length -eq 0) { throw "Required Windows runtime payload is missing or empty: $file" }
}
foreach ($package in @('pypdf', 'pillow', 'numpy', 'openpyxl', 'pytesseract')) {
  if (!(Get-ChildItem $wheels -File | Where-Object { $_.Name -like "$package-*.whl" } | Select-Object -First 1)) {
    throw "Required wheel is missing: $package"
  }
}

# The verifier reads this manifest from win-unpacked and confirms the exact files
# copied into the installer. This catches a partial CI download before Release.
$manifestPath = Join-Path $deps 'runtime-manifest.json'
$base = (Resolve-Path $deps).Path.TrimEnd('\')
$files = Get-ChildItem $deps -Recurse -File |
  Where-Object { $_.Name -ne 'runtime-manifest.json' -and $_.Length -gt 0 } |
  ForEach-Object {
    [ordered]@{
      path = $_.FullName.Substring($base.Length).TrimStart('\').Replace('\', '/')
      size = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
$manifest = [ordered]@{
  schemaVersion = 1
  pythonVersion = '3.12.6'
  requirements = (Get-Content $requirements | Where-Object { $_ -and !$_.StartsWith('#') })
  files = @($files)
}
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
