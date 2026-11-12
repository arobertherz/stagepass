<?php

/**
 * Contact form action. POST only.
 * Write your own logic where the comment says. This starter does not send mail.
 *
 * Invalid input: throw ValidationException (status "fail", HTTP 422).
 * Anything else that is not caught becomes status "error" with a generic HTTP 500.
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
    $errors = [];

    validate_required($input, 'name', $errors);
    validate_max_length($input, 'name', 120, $errors);

    validate_required($input, 'email', $errors);
    validate_email($input, 'email', $errors);
    validate_max_length($input, 'email', 254, $errors);

    validate_required($input, 'message', $errors);
    validate_max_length($input, 'message', 4000, $errors);

    if ($errors !== []) {
        throw new ValidationException($errors);
    }

    // Your logic here (save a record, call an API, enqueue a job).
    // Do not add mail sending in this starter.

    return [
        'received' => true,
        'name' => input_string($input, 'name'),
    ];
};
