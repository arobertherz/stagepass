<?php

/**
 * Optional PHP config. The document root is the folder that contains api/, so this file is inside it.
 * load_config() reads .env in the project root and .php/.env. Values here override those defaults.
 * Hidden paths: shipped .htaccess on Apache, the nginx snippet in api/README.md, Caddy 404 locally.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    exit;
}

return [
    'env' => env_string('APP_ENV', 'production'),
    'allowed_origins' => env_list('ALLOWED_ORIGINS'),
    'honeypot_field' => env_string('HONEYPOT_FIELD', 'website'),
    'rate_limit_max' => env_int('RATE_LIMIT_MAX', 20),
    'rate_limit_window' => env_int('RATE_LIMIT_WINDOW', 60),
    'max_body_bytes' => env_int('MAX_BODY_BYTES', 65536),
    'timezone' => env_string('APP_TIMEZONE', 'Europe/Berlin'),
];
