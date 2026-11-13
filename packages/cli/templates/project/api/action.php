<?php

/**
 * Single public entry for Stagepass PHP actions.
 * Core file: leave this alone unless you are changing how routing works.
 *
 * Usage:
 *   GET  /api/action.php?action=ping
 *   POST /api/action.php   with JSON { "action": "contact", "name": "...", ... }
 */

declare(strict_types=1);

define('STAGEPASS_PHP_ENTRY', true);

// Core library, then the allowlist you edit in actions.php.
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/actions.php';

install_error_handlers();

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

$config = load_config();

try {
    date_default_timezone_set((string) $config['timezone']);
} catch (Throwable $e) {
    date_default_timezone_set('UTC');
}

$origin = request_origin();
$allowedOrigins = $config['allowed_origins'];
$method = request_method();

apply_cors_headers($origin, $allowedOrigins);

if ($method === 'OPTIONS') {
    if ($origin === '' || !origin_is_allowed($origin, $allowedOrigins)) {
        respond_fail(['origin' => 'Origin is not allowed.'], 'Origin is not allowed.', 403);
    }
    if (!headers_sent()) {
        header_remove('X-Powered-By');
    }
    http_response_code(204);
    header('Content-Length: 0');
    exit;
}

$input = parse_input((int) $config['max_body_bytes']);

$action = input_string($input, 'action');
$catalog = action_catalog($config);

if ($action === '' || !isset($catalog[$action])) {
    respond_fail(['action' => 'Unknown action.'], 'Unknown action.', 404);
}

$spec = $catalog[$action];
$allowedMethods = $spec['methods'];
$env = (string) ($config['env'] ?? 'production');
$limitMax = (int) $config['rate_limit_max'];
$limitWindow = (int) $config['rate_limit_window'];
$rateLimit = $spec['rate_limit'] && $limitMax > 0 && $limitWindow > 0;
if ($rateLimit && !rate_limit_storage_available($env)) {
    $rateLimit = false;
}

if (!in_array($method, $allowedMethods, true)) {
    if (!headers_sent()) {
        header('Allow: ' . implode(', ', $allowedMethods));
    }
    respond_fail(
        ['method' => 'Use ' . implode(' or ', $allowedMethods) . '.'],
        'Method not allowed.',
        405
    );
}

$originRequired = $spec['origin'] === 'required';
if ($originRequired && $origin === '') {
    respond_fail(['origin' => 'Origin header is required.'], 'Origin is not allowed.', 403);
}
if ($origin !== '' && !origin_is_allowed($origin, $allowedOrigins)) {
    respond_fail(['origin' => 'Origin is not allowed.'], 'Origin is not allowed.', 403);
}
if ($allowedOrigins === [] && $originRequired) {
    respond_fail(['origin' => 'No origins are configured.'], 'Origin is not allowed.', 403);
}

if ($rateLimit && !rate_limit_allows(client_ip($config), $action, $limitMax, $limitWindow, $env)) {
    if (!headers_sent()) {
        header('Retry-After: ' . (string) $limitWindow);
    }
    respond_fail(['rate_limit' => 'Too many requests. Try again later.'], 'Too many requests.', 429);
}

if ($spec['honeypot']) {
    $honeypot = (string) $config['honeypot_field'];
    if (honeypot_is_filled($input, $honeypot)) {
        // Look like a normal success so bots do not learn the field name.
        respond_success(['received' => true]);
    }
}

$handler = load_handler($spec['file']);
$data = $handler($input, $config);

respond_success(is_array($data) ? $data : ['ok' => true]);
