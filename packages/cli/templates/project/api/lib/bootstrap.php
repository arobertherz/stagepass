<?php

/**
 * Loads the shared library files. Not a public endpoint.
 * Core file: leave this alone.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

require __DIR__ . '/config.php';
require __DIR__ . '/validate.php';
require __DIR__ . '/response.php';
require __DIR__ . '/request.php';
require __DIR__ . '/security.php';

/**
 * Include a handler from api/actions/. The file name must already come from the allowlist.
 */
function load_handler(string $file): callable
{
    if (basename($file) !== $file || preg_match('/^[a-z0-9_-]+\.php$/', $file) !== 1) {
        throw new RuntimeException('Invalid handler name.');
    }

    $dir = realpath(__DIR__ . '/../actions');
    $path = realpath(__DIR__ . '/../actions/' . $file);
    if ($dir === false || $path === false || !str_starts_with($path, $dir . DIRECTORY_SEPARATOR)) {
        throw new RuntimeException('Handler not found.');
    }

    $fn = require $path;
    if (!is_callable($fn)) {
        throw new RuntimeException('Handler must return a callable.');
    }

    return $fn;
}
