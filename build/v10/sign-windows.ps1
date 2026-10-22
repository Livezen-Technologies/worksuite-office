# Authenticode-signs WorkSuite Office's Windows binaries with a code-signing certificate (UPD-06, NFR-08, G-03).
#   build/v10/sign-windows.ps1 -Path <file or folder> [-Recurse]
# The certificate is the base64 PFX in $env:WINDOWS_CERTIFICATE_PFX, unlocked with $env:WINDOWS_CERTIFICATE_PASSWORD.
# In a folder it signs every .exe and .dll that has no valid signature yet (CEF's and Qt's own signed files keep
# theirs), with SHA-256 and an RFC 3161 timestamp ($env:WINDOWS_TIMESTAMP_URL, default DigiCert's), and checks
# each one afterwards. (Azure Trusted Signing is done by the workflow with Microsoft's action instead.)
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$Recurse
)
$ErrorActionPreference = 'Stop'
if (-not $env:WINDOWS_CERTIFICATE_PFX) { throw 'WINDOWS_CERTIFICATE_PFX is not set' }
$timestamp = if ($env:WINDOWS_TIMESTAMP_URL) { $env:WINDOWS_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe (Windows SDK) not found' }

$pfx = Join-Path $env:RUNNER_TEMP 'codesign.pfx'
[IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_PFX))
try {
  $item = Get-Item $Path
  $files = if ($item.PSIsContainer) {
    Get-ChildItem $Path -File -Recurse:$Recurse -Include *.exe, *.dll |
      Where-Object { (Get-AuthenticodeSignature $_.FullName).Status -ne 'Valid' }
  } else { @($item) }
  $files = @($files)
  Write-Host "Signing $($files.Count) file(s) in $Path"
  # signtool takes many files at once; batches keep the command line short
  for ($i = 0; $i -lt $files.Count; $i += 50) {
    $batch = $files[$i..([Math]::Min($i + 49, $files.Count - 1))] | ForEach-Object { $_.FullName }
    & $signtool.FullName sign /f $pfx /p $env:WINDOWS_CERTIFICATE_PASSWORD /fd SHA256 /tr $timestamp /td SHA256 /d 'WorkSuite Office' $batch
    if ($LASTEXITCODE) { throw "signtool sign failed ($LASTEXITCODE)" }
  }
  foreach ($f in $files) {
    $s = Get-AuthenticodeSignature $f.FullName
    if ($s.Status -ne 'Valid') { throw "$($f.FullName): signature $($s.Status)" }
  }
  if ($files.Count) { Write-Host "Signed by $((Get-AuthenticodeSignature $files[0].FullName).SignerCertificate.Subject)" }
} finally {
  Remove-Item -Force $pfx -ErrorAction SilentlyContinue
}
