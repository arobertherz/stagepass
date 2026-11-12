<?php

/**
 * Local-only hook to confirm unexpected exceptions become a generic HTTP 500.
 * It is not registered unless APP_ENV is "local". Leave this as a test hook.
 *
 * @return callable(array<string, mixed>, array): array<string, mixed>
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

return static function (array $input, array $config): array {
    throw new RuntimeException('SECRET_INTERNAL_TRACE should never reach the client.');
};
