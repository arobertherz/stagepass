<?php

/**
 * Optional PHP config, kept outside the public api/ directory.
 * Edit values here or in .env. Values in this file override the .env defaults.
 * On Stagepass, Caddy already returns 404 for hidden path segments such as ".php".
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
