<?php

/**
 * Health-check action. GET only.
 * You can change the returned array if you want a richer status payload.
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
    return [
        'pong' => true,
    ];
};
