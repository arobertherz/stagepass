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

/**
 * File-based fixed-window limiter, keyed by IP and action.
 *
 * @return bool True when the request may proceed.
 */
function rate_limit_allows(string $ip, string $action, int $max, int $window): bool
{
    if ($max <= 0 || $window <= 0) {
        return true;
    }

    $dir = private_dir() . '/rate-limit';
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
        error_log('stagepass-php: could not create the rate-limit directory.');
        return true;
    }

    $file = $dir . '/' . hash('sha256', $ip . '|' . $action) . '.json';
    $handle = fopen($file, 'c+');
    if ($handle === false) {
        error_log('stagepass-php: could not open a rate-limit file.');
        return true;
    }

    try {
        if (!flock($handle, LOCK_EX)) {
            return true;
        }
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
            return false;
        }

        $hits[] = $now;
        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode($hits, JSON_THROW_ON_ERROR));
        fflush($handle);

        return true;
    } catch (Throwable $e) {
        error_log('stagepass-php: rate-limit error: ' . $e->getMessage());
        return true;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}
