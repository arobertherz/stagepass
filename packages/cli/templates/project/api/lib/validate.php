<?php

/**
 * Field checks used by your actions.
 * Throw ValidationException when input is invalid. That becomes a 422 fail.
 * Add a helper here only when several actions share the same check.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

/**
 * Validation failure with per-field messages (JSend "fail", HTTP 422).
 */
final class ValidationException extends RuntimeException
{
    /** @param array<string, string> $errors */
    public function __construct(private array $errors)
    {
        parent::__construct('Validation failed.');
    }

    /** @return array<string, string> */
    public function errors(): array
    {
        return $this->errors;
    }
}

function validate_required(array $input, string $key, array &$errors): void
{
    if (input_string($input, $key) === '') {
        $errors[$key] = 'This field is required.';
    }
}

function validate_email(array $input, string $key, array &$errors): void
{
    if (isset($errors[$key])) {
        return;
    }
    $value = input_string($input, $key);
    if ($value === '') {
        return;
    }
    if (filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
        $errors[$key] = 'A valid email is required.';
    }
}

function validate_max_length(array $input, string $key, int $max, array &$errors): void
{
    if (isset($errors[$key])) {
        return;
    }
    $value = input_string($input, $key);
    if ($value === '') {
        return;
    }
    if (strlen($value) > $max) {
        $errors[$key] = 'This field is too long (maximum ' . $max . ' characters).';
    }
}
