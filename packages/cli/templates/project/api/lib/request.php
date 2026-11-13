<?php

/**
 * Reads the HTTP method, Origin, and JSON or form bodies.
 * Core file: you rarely need to edit this.
 * In your actions, use input_string() to read a field.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

function request_method(): string
{
    return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

function request_origin(): string
{
    return trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
}

function client_ip(?array $config = null): string
{
    if ($config === null) {
        $config = load_config();
    }

    $remoteRaw = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    $remote = normalize_ip($remoteRaw);
    if ($remote === null) {
        return $remoteRaw !== '' ? $remoteRaw : '0.0.0.0';
    }

    $rules = compile_trusted_proxies(trusted_proxy_entries($config));
    if ($rules === [] || !ip_in_trusted($remote, $rules)) {
        return $remote;
    }

    $header = trusted_proxy_header_name($config);
    if ($header === null) {
        error_log('stagepass-php: unknown TRUSTED_PROXY_HEADER; using REMOTE_ADDR.');
        return $remote;
    }

    $serverKey = $header === 'forwarded' ? 'HTTP_FORWARDED' : 'HTTP_X_FORWARDED_FOR';
    $raw = trim((string) ($_SERVER[$serverKey] ?? ''));
    if ($raw === '') {
        return $remote;
    }

    // Stop at the first untrusted hop. Left of it is ignored; a bad hop in this suffix falls back.
    $chosen = select_client_hop($raw, $header, $rules);
    if ($chosen === null) {
        error_log('stagepass-php: invalid proxy hop; using REMOTE_ADDR.');
        return $remote;
    }
    return $chosen;
}

function trusted_proxy_entries(array $config): array
{
    if (!array_key_exists('trusted_proxies', $config)) {
        return [];
    }
    $raw = $config['trusted_proxies'];
    if (is_string($raw)) {
        $split = preg_split('/\s*,\s*/', $raw);
        $raw = $split === false ? [] : $split;
    }
    if (!is_array($raw)) {
        error_log('stagepass-php: ignoring invalid trusted proxy list.');
        return [];
    }
    $entries = [];
    foreach ($raw as $entry) {
        if (!is_string($entry)) {
            log_invalid_proxy_entry('');
            continue;
        }
        $entries[] = $entry;
    }
    return $entries;
}

function trusted_proxy_header_name(array $config): ?string
{
    $name = strtolower(trim((string) ($config['trusted_proxy_header'] ?? 'x-forwarded-for')));
    if ($name === '' || $name === 'x-forwarded-for') {
        return 'x-forwarded-for';
    }
    if ($name === 'forwarded') {
        return 'forwarded';
    }
    return null;
}

function normalize_ip(string $value): ?string
{
    $value = trim($value);
    if (filter_var($value, FILTER_VALIDATE_IP) === false) {
        return null;
    }
    $packed = inet_pton($value);
    if ($packed === false) {
        return null;
    }
    $text = inet_ntop($packed);
    return $text === false ? null : $text;
}

function compile_trusted_proxies(array $entries): array
{
    $rules = [];
    foreach ($entries as $entry) {
        $entry = trim($entry);
        if ($entry === '') {
            continue;
        }
        $addr = $entry;
        $bits = null;
        if (str_contains($entry, '/')) {
            [$addr, $prefix] = explode('/', $entry, 2);
            if ($prefix === '' || preg_match('/^\d+$/', $prefix) !== 1) {
                log_invalid_proxy_entry($entry);
                continue;
            }
            $bits = (int) $prefix;
        }
        $norm = normalize_ip(trim($addr));
        if ($norm === null) {
            log_invalid_proxy_entry($entry);
            continue;
        }
        $packed = inet_pton($norm);
        if ($packed === false) {
            log_invalid_proxy_entry($entry);
            continue;
        }
        $max = strlen($packed) * 8;
        if ($bits === null) {
            $bits = $max;
        }
        if ($bits > $max) {
            log_invalid_proxy_entry($entry);
            continue;
        }
        $rules[] = ['packed' => $packed, 'bits' => $bits];
    }
    return $rules;
}

function log_invalid_proxy_entry(string $entry): void
{
    static $seen = [];
    $safe = preg_replace('/[^\x20-\x7E]/', '', $entry) ?? '';
    $safe = substr($safe, 0, 80);
    if (isset($seen[$safe])) {
        return;
    }
    $seen[$safe] = true;
    error_log('stagepass-php: ignoring invalid trusted proxy entry: ' . $safe);
}

function ip_in_trusted(string $ip, array $rules): bool
{
    $packed = inet_pton($ip);
    if ($packed === false) {
        return false;
    }
    foreach ($rules as $rule) {
        if (strlen($packed) !== strlen($rule['packed'])) {
            continue;
        }
        if (ip_prefix_match($packed, $rule['packed'], $rule['bits'])) {
            return true;
        }
    }
    return false;
}

function ip_prefix_match(string $ip, string $network, int $bits): bool
{
    $full = intdiv($bits, 8);
    if ($full > 0 && substr($ip, 0, $full) !== substr($network, 0, $full)) {
        return false;
    }
    $rest = $bits % 8;
    if ($rest === 0) {
        return true;
    }
    $mask = (0xff << (8 - $rest)) & 0xff;
    return (ord($ip[$full]) & $mask) === (ord($network[$full]) & $mask);
}

function ip_from_hop(string $hop): ?string
{
    $hop = trim($hop);
    if ($hop === '') {
        return null;
    }
    if ($hop[0] === '"' && str_ends_with($hop, '"') && strlen($hop) >= 2) {
        $hop = substr($hop, 1, -1);
    }
    if (strcasecmp($hop, 'unknown') === 0 || str_starts_with($hop, '_')) {
        return null;
    }
    if ($hop[0] === '[') {
        $end = strpos($hop, ']');
        if ($end === false) {
            return null;
        }
        $ip = substr($hop, 1, $end - 1);
        $rest = substr($hop, $end + 1);
        if ($rest !== '' && preg_match('/^:\d{1,5}$/', $rest) !== 1) {
            return null;
        }
        return normalize_ip($ip);
    }
    if (preg_match('/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/', $hop, $match) === 1) {
        return normalize_ip($match[1]);
    }
    return normalize_ip($hop);
}

function select_client_hop(string $header, string $kind, array $rules): ?string
{
    // Only the rightmost hops are read, so a long prefix cannot change the result.
    $maxHops = 32;
    $maxScan = 8192;
    $maxHop = 512;
    $end = strlen($header);
    $scanned = 0;
    $seen = 0;
    $leftmost = null;
    while ($end > 0 && $seen < $maxHops && $scanned < $maxScan) {
        $budget = $maxScan - $scanned;
        $hop = $kind === 'forwarded'
            ? forwarded_hop_before($header, $end, $maxHop, $budget)
            : xff_hop_before($header, $end, $maxHop, $budget);
        if ($hop['kind'] === 'invalid') {
            return null;
        }
        $seen++;
        $scanned += $hop['consumed'];
        $end = $hop['end'];
        $ip = $kind === 'forwarded' ? ip_from_forwarded_element($hop['text']) : ip_from_hop($hop['text']);
        if ($ip === null) {
            return null;
        }
        $leftmost = $ip;
        if (!ip_in_trusted($ip, $rules)) {
            return $ip;
        }
        if ($hop['kind'] === 'start') {
            break;
        }
    }
    return $leftmost;
}

function xff_hop_before(string $header, int $end, int $maxHop, int $budget): array
{
    $i = $end - 1;
    $n = 0;
    while ($i >= 0 && $header[$i] !== ',') {
        $n++;
        if ($n > $maxHop || $n > $budget) {
            return ['kind' => 'invalid', 'text' => '', 'end' => $end, 'consumed' => $n];
        }
        $i--;
    }
    $start = $i + 1;
    return [
        'kind' => $i < 0 ? 'start' : 'next',
        'text' => substr($header, $start, $end - $start),
        'end' => $i < 0 ? 0 : $i,
        'consumed' => $end - ($i < 0 ? 0 : $i),
    ];
}

function forwarded_hop_before(string $header, int $end, int $maxHop, int $budget): array
{
    $i = $end - 1;
    $n = 0;
    $inQuote = false;
    while ($i >= 0) {
        $n++;
        if ($n > $maxHop || $n > $budget) {
            return ['kind' => 'invalid', 'text' => '', 'end' => $end, 'consumed' => $n];
        }
        $ch = $header[$i];
        if ($ch === '"') {
            $slashes = 0;
            $j = $i - 1;
            while ($j >= 0 && $header[$j] === '\\' && $slashes < 8) {
                $slashes++;
                $j--;
            }
            if ($slashes % 2 === 0) {
                $inQuote = !$inQuote;
            }
        } elseif ($ch === ',' && !$inQuote) {
            return [
                'kind' => 'next',
                'text' => substr($header, $i + 1, $end - $i - 1),
                'end' => $i,
                'consumed' => $end - $i,
            ];
        }
        $i--;
    }
    if ($inQuote) {
        return ['kind' => 'invalid', 'text' => '', 'end' => 0, 'consumed' => $n];
    }
    return [
        'kind' => 'start',
        'text' => substr($header, 0, $end),
        'end' => 0,
        'consumed' => $end,
    ];
}

function ip_from_forwarded_element(string $element): ?string
{
    if (trim($element) === '') {
        return null;
    }
    $value = forwarded_for_value($element);
    if ($value === null || $value === '') {
        return null;
    }
    return ip_from_hop($value);
}

function forwarded_for_value(string $element): ?string
{
    $len = strlen($element);
    $i = 0;
    $found = null;
    while ($i < $len) {
        while ($i < $len && ($element[$i] === ' ' || $element[$i] === "\t" || $element[$i] === ';')) {
            $i++;
        }
        if ($i >= $len) {
            break;
        }
        $start = $i;
        while ($i < $len && $element[$i] !== '=' && $element[$i] !== ';') {
            $i++;
        }
        if ($i >= $len || $element[$i] !== '=') {
            return null;
        }
        $name = strtolower(trim(substr($element, $start, $i - $start)));
        $i++;
        if ($i < $len && $element[$i] === '"') {
            $i++;
            $val = '';
            $closed = false;
            while ($i < $len) {
                if ($element[$i] === '\\' && $i + 1 < $len) {
                    $val .= $element[$i + 1];
                    $i += 2;
                    continue;
                }
                if ($element[$i] === '"') {
                    $i++;
                    $closed = true;
                    break;
                }
                $val .= $element[$i];
                $i++;
            }
            if (!$closed) {
                return null;
            }
        } else {
            $start = $i;
            while ($i < $len && $element[$i] !== ';') {
                $i++;
            }
            $val = trim(substr($element, $start, $i - $start));
        }
        if ($name === 'for' && $found === null) {
            $found = $val;
        }
    }
    return $found;
}

/**
 * Parse JSON or form bodies. Query parameters are the base; body fields win.
 *
 * @return array<string, mixed>
 */
function parse_input(int $maxBodyBytes): array
{
    $input = $_GET;
    $method = request_method();
    if (!in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
        return $input;
    }

    $contentType = (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    $mediaType = strtolower(trim(explode(';', $contentType, 2)[0]));

    if ($mediaType === 'application/json') {
        $raw = file_get_contents('php://input', false, null, 0, $maxBodyBytes + 1);
        if ($raw === false) {
            respond_fail(['body' => 'Could not read the request body.'], 'Invalid request body.', 400);
        }
        if (strlen($raw) > $maxBodyBytes) {
            respond_fail(['body' => 'The request body is too large.'], 'The request body is too large.', 413);
        }
        $raw = trim($raw);
        if ($raw === '') {
            return $input;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            respond_fail(['body' => 'Invalid JSON.'], 'Invalid JSON.', 400);
        }
        return array_merge($input, $decoded);
    }

    if (
        $mediaType === ''
        || $mediaType === 'application/x-www-form-urlencoded'
        || $mediaType === 'multipart/form-data'
    ) {
        return array_merge($input, $_POST);
    }

    respond_fail(
        ['content_type' => 'Use application/json or a form content type.'],
        'Unsupported content type.',
        415
    );
}

function input_string(array $input, string $key): string
{
    $value = $input[$key] ?? '';
    if (is_int($value) || is_float($value)) {
        $value = (string) $value;
    }
    if (!is_string($value)) {
        return '';
    }
    return trim($value);
}
