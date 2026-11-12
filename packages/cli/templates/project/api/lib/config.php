<?php

/**
 * Loads .env and the optional .php/config.php.
 * Edit values in .env (or in .php/config.php), not in this file.
 * Core file: leave this alone.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

/** Project root (parent of api/). */
function project_root(): string
{
    return dirname(__DIR__, 2);
}

/**
 * Hidden directory for config and rate-limit files.
 *
 * On Stagepass, Caddy already returns 404 for any path segment starting with ".".
 */
function private_dir(): string
{
    return project_root() . '/.php';
}

/**
 * True when this file is the script PHP was asked to run (direct HTTP hit).
 */
function is_direct_script_access(string $file): bool
{
    $script = (string) ($_SERVER['SCRIPT_FILENAME'] ?? '');
    if ($script === '') {
        return false;
    }

    $scriptReal = realpath($script);
    $fileReal = realpath($file);

    return $scriptReal !== false && $fileReal !== false && $scriptReal === $fileReal;
}

/**
 * Load KEY=value pairs from a .env file without overwriting real environment variables.
 */
function load_dotenv(string $path): void
{
    if (!is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (str_starts_with($line, 'export ')) {
            $line = trim(substr($line, 7));
        }
        $pos = strpos($line, '=');
        if ($pos === false) {
            continue;
        }
        $key = trim(substr($line, 0, $pos));
        $value = trim(substr($line, $pos + 1));
        if ($key === '' || !preg_match('/^[A-Z_][A-Z0-9_]*$/', $key)) {
            continue;
        }
        if (getenv($key) !== false) {
            continue;
        }
        if (
            (str_starts_with($value, '"') && str_ends_with($value, '"'))
            || (str_starts_with($value, "'") && str_ends_with($value, "'"))
        ) {
            $value = substr($value, 1, -1);
        }
        putenv($key . '=' . $value);
        $_ENV[$key] = $value;
    }
}

function env_string(string $key, string $default = ''): string
{
    $value = getenv($key);
    return $value === false ? $default : $value;
}

function env_int(string $key, int $default): int
{
    $value = getenv($key);
    if ($value === false || $value === '') {
        return $default;
    }
    if (!preg_match('/^-?\d+$/', $value)) {
        return $default;
    }
    return (int) $value;
}

/**
 * @return list<string>
 */
function env_list(string $key): array
{
    $raw = env_string($key, '');
    if ($raw === '') {
        return [];
    }
    $items = [];
    foreach (explode(',', $raw) as $part) {
        $item = trim($part);
        if ($item !== '') {
            $items[] = $item;
        }
    }
    return array_values(array_unique($items));
}

/**
 * Load configuration from .env and an optional PHP config file outside the public root.
 *
 * @return array{
 *   env: string,
 *   allowed_origins: list<string>,
 *   honeypot_field: string,
 *   rate_limit_max: int,
 *   rate_limit_window: int,
 *   max_body_bytes: int,
 *   timezone: string
 * }
 */
function load_config(): array
{
    load_dotenv(project_root() . '/.env');
    load_dotenv(private_dir() . '/.env');

    $defaults = [
        'env' => env_string('APP_ENV', 'production'),
        'allowed_origins' => env_list('ALLOWED_ORIGINS'),
        'honeypot_field' => env_string('HONEYPOT_FIELD', 'website'),
        'rate_limit_max' => env_int('RATE_LIMIT_MAX', 20),
        'rate_limit_window' => env_int('RATE_LIMIT_WINDOW', 60),
        'max_body_bytes' => env_int('MAX_BODY_BYTES', 65536),
        'timezone' => env_string('APP_TIMEZONE', 'Europe/Berlin'),
    ];

    $file = null;
    if (is_readable(private_dir() . '/config.php')) {
        $file = private_dir() . '/config.php';
    } elseif (is_readable(project_root() . '/config.php')) {
        $file = project_root() . '/config.php';
    }

    if ($file !== null) {
        $fromFile = require $file;
        if (is_array($fromFile)) {
            return array_merge($defaults, $fromFile);
        }
    }

    return $defaults;
}

function is_local_env(array $config): bool
{
    return ($config['env'] ?? '') === 'local';
}
