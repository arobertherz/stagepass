<?php
/**
 * Example form handler for Stagepass projects.
 *
 * Security notes:
 * - POST only
 * - Input length limits
 * - HTML escaped with htmlspecialchars when rendering
 * - No secrets in this file
 *
 * Copy into /api/ (or another path under the project root) before using on .sp.
 */

declare(strict_types=1);

header('X-Content-Type-Options: nosniff');

const MAX_NAME_LEN = 120;
const MAX_EMAIL_LEN = 254;
const MAX_MESSAGE_LEN = 4000;

/**
 * @param mixed $value
 */
function field_string($value, int $maxLen): string
{
    if (!is_string($value)) {
        return '';
    }
    $trimmed = trim($value);
    if (strlen($trimmed) > $maxLen) {
        return substr($trimmed, 0, $maxLen);
    }
    return $trimmed;
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Method not allowed. Use POST.'], JSON_UNESCAPED_SLASHES);
    exit;
}

$name = field_string($_POST['name'] ?? '', MAX_NAME_LEN);
$email = field_string($_POST['email'] ?? '', MAX_EMAIL_LEN);
$message = field_string($_POST['message'] ?? '', MAX_MESSAGE_LEN);

$errors = [];
if ($name === '') {
    $errors[] = 'name is required';
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors[] = 'a valid email is required';
}
if ($message === '') {
    $errors[] = 'message is required';
}

$wantsJson = isset($_SERVER['HTTP_ACCEPT'])
    && str_contains(strtolower((string) $_SERVER['HTTP_ACCEPT']), 'application/json');

if ($errors !== []) {
    http_response_code(400);
    if ($wantsJson) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'errors' => $errors], JSON_UNESCAPED_SLASHES);
        exit;
    }
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html><body><p>Invalid form:</p><ul>';
    foreach ($errors as $err) {
        echo '<li>' . h($err) . '</li>';
    }
    echo '</ul></body></html>';
    exit;
}

// Demo only: acknowledge receipt. Wire this to mail()/a queue using env secrets.
$payload = [
    'ok' => true,
    'received' => [
        'name' => $name,
        'email' => $email,
        'message' => $message,
    ],
];

if ($wantsJson) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><html><body>';
echo '<p>Thanks, ' . h($name) . '. We received your message.</p>';
echo '<p>Email: ' . h($email) . '</p>';
echo '<pre>' . h($message) . '</pre>';
echo '</body></html>';
