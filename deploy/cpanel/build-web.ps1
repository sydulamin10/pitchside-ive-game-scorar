# Build the web app pointed at the ODCC production API, then drop .htaccess into dist/.
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File deploy/cpanel/build-web.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$frontend = Join-Path $repoRoot "frontend"

Set-Location $frontend
$env:VITE_API_BASE_URL = "https://api.odcc.nextframesoft.com"
# npm.cmd avoids PowerShell's ExecutionPolicy block on npm.ps1
npm.cmd ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Copy-Item (Join-Path $PSScriptRoot "web.htaccess") (Join-Path $frontend "dist\.htaccess") -Force
Write-Host ""
Write-Host "Upload everything inside: $frontend\dist"
Write-Host "  → web.odcc.nextframesoft.com document root"
Write-Host "API base baked in: $env:VITE_API_BASE_URL"
