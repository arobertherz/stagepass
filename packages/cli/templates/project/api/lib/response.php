<?php

/**
 * JSend envelope and HTTP helpers (success, fail, error).
 * Core file: you rarely need to edit this.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

function json_headers(int $http): void
{
    if (headers_sent()) {
        return;
    }
    header_remove('X-Powered-By');
    http_response_code($http);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
}

/**
 * @param mixed $data
 */
function respond(string $status, $data, ?string $message, int $http): never
{
    json_headers($http);
    $json = json_encode(
        [
            'status' => $status,
            'data' => $data,
            'message' => $message,
        ],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    echo $json === false ? '{"status":"error","data":null,"message":"Could not encode the response."}' : $json;
    exit;
}

/** @param mixed $data */
function respond_success($data = null, ?string $message = null, int $http = 200): never
{
    respond('success', $data, $message, $http);
}

/** @param mixed $data */
function respond_fail($data, ?string $message = null, int $http = 400): never
{
    respond('fail', $data, $message ?? 'The request was rejected.', $http);
}

/** @param mixed $data */
function respond_error(string $message, int $http = 500, $data = null): never
{
    respond('error', $data, $message, $http);
}

function install_error_handlers(): void
{
    set_exception_handler(static function (Throwable $e): void {
        if ($e instanceof ValidationException) {
            respond_fail($e->errors(), $e->getMessage(), 422);
        }

        error_log('stagepass-php: ' . $e::class . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        respond_error('An unexpected error occurred. Try again later.', 500);
    });

    set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
        if ((error_reporting() & $severity) === 0) {
            return false;
        }
        throw new ErrorException($message, 0, $severity, $file, $line);
    });

    register_shutdown_function(static function (): void {
        $err = error_get_last();
        if ($err === null) {
            return;
        }
        $fatal = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR];
        if (!in_array($err['type'], $fatal, true)) {
            return;
        }
        error_log('stagepass-php fatal: ' . $err['message'] . ' in ' . $err['file'] . ':' . $err['line']);
        if (!headers_sent()) {
            respond_error('An unexpected error occurred. Try again later.', 500);
        }
    });
}
