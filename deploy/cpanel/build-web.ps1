# Build the web app pointed at the ODCC production API, then drop .htaccess into dist/.
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File deploy/cpanel/build-web.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$frontend = Join-Path $repoRoot "frontend"

Set-Location $frontend
# Use Render until api.odcc.nextframesoft.com CNAMEs to this service.
if (-not $env:VITE_API_BASE_URL) {
  $env:VITE_API_BASE_URL = "https://pitchside-api-kugn.onrender.com"
}
# npm.cmd avoids PowerShell's ExecutionPolicy block on npm.ps1
npm.cmd ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Copy-Item (Join-Path $PSScriptRoot "web.htaccess") (Join-Path $frontend "dist\.htaccess") -Force
$runtime = Join-Path $frontend "dist\runtime-config.js"
[System.IO.File]::WriteAllText(
  $runtime,
  "window.__PITCHSIDE_API_BASE_URL__ = `"$($env:VITE_API_BASE_URL)`";"
)
Write-Host ""
Write-Host "Upload everything inside: $frontend\dist"
Write-Host "  → web.odcc.nextframesoft.com document root"
Write-Host "API base: $env:VITE_API_BASE_URL"
