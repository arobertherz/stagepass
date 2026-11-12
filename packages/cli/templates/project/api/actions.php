<?php

/**
 * Action allowlist. This is the one file you edit to register a new action.
 * Point each name at a file in api/actions/. Unknown names are rejected.
 * The "boom" action is registered only when APP_ENV=local.
 */

declare(strict_types=1);

if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"fail","data":null,"message":"Not found."}';
    exit;
}

/**
 * @return array<string, array{file: string, methods: list<string>, honeypot: bool, rate_limit: bool, origin: string}>
 */
function action_catalog(array $config): array
{
    $actions = [
        'ping' => [
            'file' => 'ping.php',
            'methods' => ['GET'],
            'honeypot' => false,
            'rate_limit' => true,
            'origin' => 'optional',
        ],
        'contact' => [
            'file' => 'contact.php',
            'methods' => ['POST'],
            'honeypot' => true,
            'rate_limit' => true,
            'origin' => 'required',
        ],
        // Add your action here, then create the matching file in api/actions/.
        // 'newsletter' => [
        //     'file' => 'newsletter.php',
        //     'methods' => ['POST'],
        //     'honeypot' => true,
        //     'rate_limit' => true,
        //     'origin' => 'required',
        // ],
    ];

    if (is_local_env($config)) {
        $actions['boom'] = [
            'file' => 'boom.php',
            'methods' => ['GET'],
            'honeypot' => false,
            'rate_limit' => false,
            'origin' => 'optional',
        ];
    }

    return $actions;
}
