<?php
/**
 * LiteSpeed / cPanel fallback when RewriteRule [P] returns 403.
 *
 * Place in the api subdomain document root AND point .htaccess at this file
 * (see api.htaccess-php-fallback). Forwards HTTP to local uvicorn.
 *
 * Limits: long-lived SSE may time out under PHP; prefer real reverse-proxy
 * when the host enables it. Auth/API JSON routes usually work.
 */

declare(strict_types=1);

$upstream = getenv('PITCHSIDE_UPSTREAM') ?: 'http://127.0.0.1:8000';
$uri = $_SERVER['REQUEST_URI'] ?? '/';
$url = rtrim($upstream, '/') . $uri;

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$headers = [];

foreach ($_SERVER as $key => $value) {
    if (str_starts_with($key, 'HTTP_')) {
        $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
        if (in_array(strtolower($name), ['host', 'content-length', 'connection'], true)) {
            continue;
        }
        $headers[] = $name . ': ' . $value;
    }
}

if (!empty($_SERVER['CONTENT_TYPE'])) {
    $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
}

$headers[] = 'Host: api.odcc.nextframesoft.com';
$headers[] = 'X-Forwarded-Proto: https';
$headers[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');

$body = file_get_contents('php://input');
if ($body === false) {
    $body = '';
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_FOLLOWLOCATION => false,
]);

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => [
            'code' => 'upstream_unreachable',
            'message' => 'Could not reach local API (is uvicorn running on :8000?).',
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
        || str_starts_with($lower, 'content-length:')
    ) {
        continue;
    }
    header($line, false);
}

echo $rawBody;
