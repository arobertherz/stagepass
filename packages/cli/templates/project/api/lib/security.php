<?php

/**
 * Origin allowlist, CORS, honeypot, and the file-based rate limiter.
 * Core file: you rarely need to edit this.
 * Change origins, limits, and the honeypot field name in .env.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

function origin_is_allowed(string $origin, array $allowed): bool
{
    if ($origin === '' || $allowed === []) {
        return false;
    }
    return in_array($origin, $allowed, true);
}

/**
 * Send CORS headers when the Origin is on the allowlist. Never echo an unknown origin.
 */
function apply_cors_headers(string $origin, array $allowed): void
{
    if (!origin_is_allowed($origin, $allowed)) {
        return;
    }
    if (headers_sent()) {
        return;
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Accept');
    header('Access-Control-Max-Age: 86400');
    header('Access-Control-Allow-Credentials: false');
}

function honeypot_is_filled(array $input, string $field): bool
{
    return $field !== '' && input_string($input, $field) !== '';
}

/** Swallow storage warnings so they cannot become HTTP 500. */
function rate_limit_call(callable $fn)
{
    set_error_handler(static function (): bool {
        return true;
    });
    try {
        return $fn();
    } finally {
        restore_error_handler();
    }
}

/**
 * File-based fixed-window limiter, keyed by IP and action.
 * Storage faults fail closed unless APP_ENV is local, development, or dev.
 *
 * @return bool True when the request may proceed.
 */
function rate_limit_allows(string $ip, string $action, int $max, int $window, ?string $env = null): bool
{
    if ($max <= 0 || $window <= 0) {
        return true;
    }

    $env = rate_limit_env($env);
    $dir = private_dir() . '/rate-limit';
    $ready = rate_limit_call(static function () use ($dir): bool {
        return is_dir($dir) || mkdir($dir, 0700, true) || is_dir($dir);
    });
    if ($ready !== true) {
        rate_limit_refuse_storage($env, 'could not create the rate-limit directory.');
        return true;
    }

    $file = $dir . '/' . hash('sha256', $ip . '|' . $action) . '.json';
    $handle = rate_limit_call(static function () use ($file) {
        return fopen($file, 'c+');
    });
    if ($handle === false) {
        rate_limit_refuse_storage($env, 'could not open a rate-limit file.');
        return true;
    }

    $decision = 'allow';
    try {
        if (!flock($handle, LOCK_EX)) {
            error_log('stagepass-php: could not lock a rate-limit file.');
            $decision = 'unavailable';
        } else {
            $raw = stream_get_contents($handle);
            $decoded = [];
            if (is_string($raw) && $raw !== '') {
                $parsed = json_decode($raw, true);
                if (is_array($parsed)) {
                    $decoded = $parsed;
                }
            }

            $now = time();
            $cutoff = $now - $window;
            $hits = [];
            foreach ($decoded as $ts) {
                if (is_numeric($ts) && (int) $ts > $cutoff) {
                    $hits[] = (int) $ts;
                }
            }

            if (count($hits) >= $max) {
                $decision = 'deny';
            } else {
                $hits[] = $now;
                rewind($handle);
                ftruncate($handle, 0);
                fwrite($handle, json_encode($hits, JSON_THROW_ON_ERROR));
                fflush($handle);
            }
        }
    } catch (Throwable $e) {
        error_log('stagepass-php: rate-limit error: ' . $e->getMessage());
        $decision = 'unavailable';
    } finally {
        if (is_resource($handle)) {
            rate_limit_call(static function () use ($handle): void {
                flock($handle, LOCK_UN);
                fclose($handle);
            });
        }
    }

    if ($decision === 'unavailable') {
        if (!rate_limit_fails_open($env)) {
            rate_limit_unavailable_response();
        }
        return true;
    }

    return $decision === 'allow';
}

function rate_limit_storage_available(string $env): bool
{
    $dir = private_dir() . '/rate-limit';
    $state = rate_limit_call(static function () use ($dir): array {
        $ok = is_dir($dir) || mkdir($dir, 0700, true) || is_dir($dir);
        return ['ok' => $ok, 'writable' => $ok && is_writable($dir)];
    });
    if ($state['ok'] !== true) {
        return rate_limit_refuse_storage($env, 'could not create the rate-limit directory.');
    }
    if ($state['writable'] !== true) {
        return rate_limit_refuse_storage($env, 'could not open a rate-limit file.');
    }
    return true;
}

function rate_limit_env(?string $env): string
{
    if (is_string($env)) {
        return $env;
    }
    $loaded = load_config();
    return (string) ($loaded['env'] ?? 'production');
}

/** True only for local, development, or dev. Every other value fails closed. */
function rate_limit_fails_open(string $env): bool
{
    return in_array(strtolower(trim($env)), ['local', 'development', 'dev'], true);
}

function rate_limit_refuse_storage(string $env, string $message): bool
{
    error_log('stagepass-php: ' . $message);
    if (!rate_limit_fails_open($env)) {
        rate_limit_unavailable_response();
    }
    return false;
}

function rate_limit_unavailable_response(): never
{
    if (!headers_sent()) {
        header('Retry-After: 60');
    }
    respond_error('The service is temporarily unavailable. Try again later.', 503);
}
