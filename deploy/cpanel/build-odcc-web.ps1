# ---------------------------------------------------------------------------
# Build the ODCC LIVE web app for cPanel (odcc.live) against the VPS API.
#
#   powershell -ExecutionPolicy Bypass -File deploy/cpanel/build-odcc-web.ps1
#
# Produces deploy/cpanel/odcc-live-web.zip, whose contents extract straight
# into the odcc.live document root.
#
# Kept deliberately ASCII-only: Windows PowerShell 5.1 reads .ps1 files as the
# system code page unless they carry a BOM, so a stray em-dash here ends up as
# mojibake inside the generated runtime-config.js.
# ---------------------------------------------------------------------------

param(
  [string]$ApiBaseUrl = "https://api.odcc.live",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$frontend = Join-Path $repoRoot "frontend"
$dist     = Join-Path $frontend "dist"
$zipPath  = Join-Path $PSScriptRoot "odcc-live-web.zip"

Write-Host "API base URL : $ApiBaseUrl"
Write-Host "Frontend     : $frontend"

Set-Location $frontend

# Baked fallback, used only if runtime-config.js fails to load.
$env:VITE_API_BASE_URL = $ApiBaseUrl

if (-not $SkipInstall) {
  Write-Host "`n--- npm ci ---"
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
}

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }

Write-Host "`n--- npm run build ---"
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

# The runtime override wins over the baked value (see resolveApiOrigin in
# src/lib/api/client.ts), so the API host can be repointed by editing this one
# file on the server instead of rebuilding. REST and SSE both go direct.
$runtimeConfig = @"
/* ODCC LIVE production runtime config: web on odcc.live, API on api.odcc.live.
   Edit these two values to repoint the app at a different API host; no rebuild
   is needed. Both must be absolute origins with no trailing slash. */
window.__PITCHSIDE_API_BASE_URL__ = "$ApiBaseUrl";
window.__PITCHSIDE_STREAM_BASE_URL__ = "$ApiBaseUrl";
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $dist "runtime-config.js"), $runtimeConfig, $utf8NoBom)

Copy-Item (Join-Path $PSScriptRoot "odcc.live.htaccess") (Join-Path $dist ".htaccess") -Force

# The browser calls the API directly, so the same-origin PHP forwarder is dead
# weight here. Shipping it would leave an unused proxy in the document root.
$proxy = Join-Path $dist "api-proxy.php"
if (Test-Path $proxy) { Remove-Item $proxy -Force }

Write-Host "`n--- packaging ---"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Built by hand rather than with Compress-Archive: a wildcard -Path skips
# dotfiles like .htaccess, and passing an explicit file list flattens the
# directory tree. This keeps relative paths and drops the .map files, which
# the build emits as "hidden" sourcemaps (nothing references them) and which
# would otherwise publish readable source into a public document root.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$distFull = (Resolve-Path $dist).Path.TrimEnd('\') + '\'
$files = Get-ChildItem -LiteralPath $dist -Recurse -File -Force |
  Where-Object { $_.Extension -ne ".map" }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($distFull.Length).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

$mapCount = (Get-ChildItem -LiteralPath $dist -Recurse -File -Filter *.map).Count
$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "ZIP      : $zipPath ($sizeMb MB)"
Write-Host "Files    : $($files.Count) packaged, $mapCount sourcemaps excluded"
Write-Host "Extract  : into the odcc.live document root (public_html)"
Write-Host "REST+SSE : $ApiBaseUrl"
