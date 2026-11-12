<?php
/**
 * Example HTTPS API proxy with a strict host allowlist.
 *
 * Security notes:
 * - GET/POST only
 * - https only, exact host allowlist (no wildcards)
 * - Redirects are not followed to other hosts
 * - Timeouts and response size cap
 * - Secrets (tokens) come from the environment, never from this file
 *
 * Env:
 *   STAGEPASS_PROXY_ALLOWLIST  Comma-separated exact hosts (required), e.g. api.example.com
 *   STAGEPASS_PROXY_TOKEN      Optional Bearer token forwarded to the upstream
 *
 * Usage (after copying to /api/proxy.php):
 *   GET /api/proxy.php?path=/v1/items
 *   The upstream base is https://<first-allowlisted-host> unless ?host= matches the allowlist.
 */

declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('Content-Type: application/json; charset=utf-8');

const PROXY_TIMEOUT_SECONDS = 5;
const PROXY_MAX_BYTES = 1048576; // 1 MiB
const PROXY_MAX_PATH_LEN = 512;
const PROXY_MAX_BODY_LEN = 65536;

/**
 * @return list<string>
 */
function proxy_allowlist(): array
{
    $raw = getenv('STAGEPASS_PROXY_ALLOWLIST');
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }
    $hosts = [];
    foreach (explode(',', $raw) as $part) {
        $host = strtolower(trim($part));
        if ($host === '' || str_contains($host, '/') || str_contains($host, ':') || str_contains($host, '*')) {
            continue;
        }
        if (!preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/', $host)) {
            continue;
        }
        $hosts[] = $host;
    }
    return array_values(array_unique($hosts));
}

function json_exit(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method !== 'GET' && $method !== 'POST') {
    header('Allow: GET, POST');
    json_exit(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

$allowlist = proxy_allowlist();
if ($allowlist === []) {
    json_exit(500, [
        'ok' => false,
        'error' => 'Set STAGEPASS_PROXY_ALLOWLIST to a comma-separated list of exact https hosts.',
    ]);
}

$requestedHost = isset($_GET['host']) ? strtolower(trim((string) $_GET['host'])) : $allowlist[0];
if (!in_array($requestedHost, $allowlist, true)) {
    json_exit(403, ['ok' => false, 'error' => 'Host is not on the allowlist.']);
}

$path = isset($_GET['path']) ? (string) $_GET['path'] : '/';
if ($path === '' || $path[0] !== '/') {
    json_exit(400, ['ok' => false, 'error' => 'path must start with /.']);
}
if (strlen($path) > PROXY_MAX_PATH_LEN || str_contains($path, '\\') || preg_match('/[\x00-\x20\x7f]/', $path) === 1) {
    json_exit(400, ['ok' => false, 'error' => 'Invalid path.']);
}
// Block scheme-relative and open-redirect style paths.
if (str_starts_with($path, '//') || preg_match('#^[a-z][a-z0-9+.-]*:#i', $path) === 1) {
    json_exit(400, ['ok' => false, 'error' => 'Invalid path.']);
}

$upstream = 'https://' . $requestedHost . $path;
$query = $_GET;
unset($query['host'], $query['path']);
if ($query !== []) {
    $upstream .= (str_contains($path, '?') ? '&' : '?') . http_build_query($query);
}

$body = null;
if ($method === 'POST') {
    $body = file_get_contents('php://input', false, null, 0, PROXY_MAX_BODY_LEN + 1);
    if ($body === false) {
        json_exit(400, ['ok' => false, 'error' => 'Could not read request body.']);
    }
    if (strlen($body) > PROXY_MAX_BODY_LEN) {
        json_exit(413, ['ok' => false, 'error' => 'Request body too large.']);
    }
}

$headers = ['Accept: application/json'];
$contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
if (is_string($contentType) && $contentType !== '' && $method === 'POST') {
    // Only forward a simple media type (no CR/LF injection).
    if (preg_match('/^[a-z0-9!#$&.+\-^_]{1,127}\/[a-z0-9!#$&.+\-^_]{1,127}(?:\s*;\s*charset=utf-8)?$/i', $contentType) === 1) {
        $headers[] = 'Content-Type: ' . $contentType;
    }
}
$token = getenv('STAGEPASS_PROXY_TOKEN');
if (is_string($token) && $token !== '') {
    $headers[] = 'Authorization: Bearer ' . $token;
}

$buffer = '';
$tooLarge = false;
$ch = curl_init($upstream);
if ($ch === false) {
    json_exit(500, ['ok' => false, 'error' => 'Could not start upstream request.']);
}

curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => false,
    // Stream into a buffer and abort once the cap is exceeded (no unbounded memory use).
    CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$buffer, &$tooLarge): int {
        if (strlen($buffer) + strlen($chunk) > PROXY_MAX_BYTES) {
            $tooLarge = true;
            return 0;
        }
        $buffer .= $chunk;
        return strlen($chunk);
    },
    CURLOPT_FOLLOWLOCATION => false, // never follow redirects (SSRF / host hop)
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_TIMEOUT => PROXY_TIMEOUT_SECONDS,
    CURLOPT_CONNECTTIMEOUT => PROXY_TIMEOUT_SECONDS,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_USERAGENT => 'stagepass-php-proxy/1.0',
]);

if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body ?? '');
}

curl_exec($ch);
$errno = curl_errno($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($tooLarge) {
    json_exit(502, ['ok' => false, 'error' => 'Upstream response too large.']);
}
if ($errno !== 0) {
    // Do not echo curl details to the client.
    json_exit(502, ['ok' => false, 'error' => 'Upstream request failed.']);
}

http_response_code($status >= 100 && $status <= 599 ? $status : 502);
echo $buffer;
