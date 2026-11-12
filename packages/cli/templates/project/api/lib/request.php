<?php

/**
 * Reads the HTTP method, Origin, and JSON or form bodies.
 * Core file: you rarely need to edit this.
 * In your actions, use input_string() to read a field.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

function request_method(): string
{
    return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

function request_origin(): string
{
    return trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
}

function client_ip(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    return $ip !== '' ? $ip : '0.0.0.0';
}

/**
 * Parse JSON or form bodies. Query parameters are the base; body fields win.
 *
 * @return array<string, mixed>
 */
function parse_input(int $maxBodyBytes): array
{
    $input = $_GET;
    $method = request_method();
    if (!in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
        return $input;
    }

    $contentType = (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    $mediaType = strtolower(trim(explode(';', $contentType, 2)[0]));

    if ($mediaType === 'application/json') {
        $raw = file_get_contents('php://input', false, null, 0, $maxBodyBytes + 1);
        if ($raw === false) {
            respond_fail(['body' => 'Could not read the request body.'], 'Invalid request body.', 400);
        }
        if (strlen($raw) > $maxBodyBytes) {
            respond_fail(['body' => 'The request body is too large.'], 'The request body is too large.', 413);
        }
        $raw = trim($raw);
        if ($raw === '') {
            return $input;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            respond_fail(['body' => 'Invalid JSON.'], 'Invalid JSON.', 400);
        }
        return array_merge($input, $decoded);
    }

    if (
        $mediaType === ''
        || $mediaType === 'application/x-www-form-urlencoded'
        || $mediaType === 'multipart/form-data'
    ) {
        return array_merge($input, $_POST);
    }

    respond_fail(
        ['content_type' => 'Use application/json or a form content type.'],
        'Unsupported content type.',
        415
    );
}

function input_string(array $input, string $key): string
{
    $value = $input[$key] ?? '';
    if (is_int($value) || is_float($value)) {
        $value = (string) $value;
    }
    if (!is_string($value)) {
        return '';
    }
    return trim($value);
}
