<?php
/**
 * Same-origin forwarder: browser → this host /api/* → the API host.
 *
 * Avoids cross-origin CORS. Place in the web document root with .htaccess
 * rewriting /api to this file.
 *
 * The odcc.live deployment does NOT use this file: the API allows odcc.live as
 * a CORS origin, so the browser calls https://api.odcc.live directly and gets
 * SSE too, which cannot be forwarded through PHP. Kept for hosts that block
 * cross-origin XHR.
 */

declare(strict_types=1);

$upstream = getenv('PITCHSIDE_UPSTREAM') ?: 'https://api.odcc.live';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (isset($_GET['ps_path'])) {
    $path = '/api/' . ltrim((string) $_GET['ps_path'], '/');
}
if (!str_starts_with($path, '/api')) {
    http_response_code(404);
    header('Content-Type: application/json');
    echo '{"error":{"code":"not_found","message":"Not an API path."}}';
    exit;
}

$query = $_GET;
unset($query['ps_path']);
$qs = http_build_query($query);
$host = parse_url($upstream, PHP_URL_HOST) ?: 'pitchside-api-kugn.onrender.com';
$url = rtrim($upstream, '/') . $path . ($qs !== '' ? '?' . $qs : '');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$headers = [];
foreach ($_SERVER as $key => $value) {
    if (!str_starts_with($key, 'HTTP_')) {
        continue;
    }
    $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
    if (in_array(strtolower($name), ['host', 'content-length', 'connection', 'origin', 'accept-encoding'], true)) {
        continue;
    }
    $headers[] = $name . ': ' . $value;
}
if (!empty($_SERVER['CONTENT_TYPE'])) {
    $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
}
$headers[] = 'Host: ' . $host;
$headers[] = 'X-Forwarded-Proto: https';
$headers[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
$headers[] = 'X-Forwarded-Host: ' . ($_SERVER['HTTP_HOST'] ?? 'web.odcc.nextframesoft.com');

$body = file_get_contents('php://input');
if ($body === false) {
    $body = '';
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => $method === 'GET' || $method === 'HEAD' ? null : $body,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_CONNECTTIMEOUT => 20,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_ENCODING => '',
]);

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => [
            'code' => 'upstream_unreachable',
            'message' => 'Could not reach the scoring API. Wait a few seconds and try again.',
            'detail' => curl_error($ch),
        ],
    ]);
    exit;
}

$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

$rawHeaders = substr($response, 0, $headerSize);
$rawBody = substr($response, $headerSize);

http_response_code($status > 0 ? $status : 502);

foreach (explode("\r\n", $rawHeaders) as $line) {
    if ($line === '' || str_starts_with(strtolower($line), 'http/')) {
        continue;
    }
    $lower = strtolower($line);
    if (
        str_starts_with($lower, 'transfer-encoding:')
        || str_starts_with($lower, 'connection:')
        ||         str_starts_with($lower, 'content-length:')
        || str_starts_with($lower, 'content-encoding:')
        || str_starts_with($lower, 'access-control-')
        || str_starts_with($lower, 'cross-origin-')
    ) {
        continue;
    }
    header($line, false);
}

echo $rawBody;
