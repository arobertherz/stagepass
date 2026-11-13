<?php

declare(strict_types=1);

/**
 * Behaviour tests for the PHP scaffold rate limiter and client IP.
 * Run: php packages/cli/src/lib/__tests__/php-security-behaviour.php
 */

$failures = 0;
$passes = 0;
register_shutdown_function(static function (): void {
    global $servers;
    if (!is_array($servers ?? null)) {
        return;
    }
    foreach (array_keys($servers) as $root) {
        stop_server($root);
    }
});
$templateRoot = dirname(__DIR__, 3) . '/templates/project';

function expect_true(bool $ok, string $name, string $detail = ''): void
{
    global $failures, $passes;
    if ($ok) {
        $passes++;
        echo "ok - {$name}\n";
        return;
    }
    $failures++;
    echo "not ok - {$name}\n";
    if ($detail !== '') {
        echo "  {$detail}\n";
    }
}

function rm_tree(string $dir): void
{
    if (function_exists('stop_server')) {
        stop_server($dir);
    }
    if (!is_dir($dir)) {
        return;
    }
    $items = scandir($dir);
    if ($items === false) {
        return;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . '/' . $item;
        if (is_dir($path) && !is_link($path)) {
            rm_tree($path);
        } else {
            unlink($path);
        }
    }
    rmdir($dir);
}

function env_file(array $pairs): string
{
    $lines = [];
    foreach ($pairs as $key => $value) {
        $lines[] = $key . '=' . $value;
    }
    return implode("\n", $lines) . "\n";
}

function make_project(string $env, ?callable $mutate = null): string
{
    global $templateRoot;
    $root = sys_get_temp_dir() . '/sp-phpsec-' . bin2hex(random_bytes(4));
    mkdir($root . '/api/lib', 0700, true);
    mkdir($root . '/api/actions', 0700, true);
    mkdir($root . '/.php', 0700, true);
    $map = [
        'api/action.php' => 'api/action.php',
        'api/actions.php' => 'api/actions.php',
        'api/actions/ping.php' => 'api/actions/ping.php',
        'api/actions/contact.php' => 'api/actions/contact.php',
        'api/actions/boom.php' => 'api/actions/boom.php',
        'api/lib/bootstrap.php' => 'api/lib/bootstrap.php',
        'api/lib/config.php' => 'api/lib/config.php',
        'api/lib/request.php' => 'api/lib/request.php',
        'api/lib/response.php' => 'api/lib/response.php',
        'api/lib/security.php' => 'api/lib/security.php',
        'api/lib/validate.php' => 'api/lib/validate.php',
        'php-private/config.php' => '.php/config.php',
    ];
    foreach ($map as $from => $to) {
        $dest = $root . '/' . $to;
        if (!copy($templateRoot . '/' . $from, $dest)) {
            throw new RuntimeException('Could not copy ' . $from);
        }
    }
    file_put_contents($root . '/.env', $env);
    if ($mutate !== null) {
        $mutate($root);
    }
    return $root;
}

function block_rate_dir(string $root): void
{
    $path = $root . '/.php/rate-limit';
    if (is_dir($path)) {
        rm_tree($path);
    } elseif (is_file($path)) {
        unlink($path);
    }
    file_put_contents($path, "blocked\n");
}

function block_rate_file(string $root, string $ip, string $action = 'ping'): void
{
    $dir = $root . '/.php/rate-limit';
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
    }
    $hash = hash('sha256', $ip . '|' . $action);
    $path = $dir . '/' . $hash . '.json';
    if (is_file($path)) {
        unlink($path);
    }
    if (!is_dir($path)) {
        mkdir($path, 0700);
    }
}

function header_value(array $headers, string $name): ?string
{
    $prefix = strtolower($name) . ':';
    foreach ($headers as $line) {
        if (str_starts_with(strtolower($line), $prefix)) {
            return trim(substr($line, strlen($prefix)));
        }
    }
    return null;
}

function run_php(string $root, string $script, string $log): array
{
    $cmd = [PHP_BINARY, $script];
    $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $root);
    if (!is_resource($proc)) {
        return ['body' => '', 'stderr' => 'proc_open failed', 'log' => '', 'code' => 0, 'headers' => [], 'json' => null];
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    $logText = is_file($log) ? (string) file_get_contents($log) : '';
    $decoded = json_decode($stdout === false ? '' : $stdout, true);
    return [
        'body' => $stdout === false ? '' : $stdout,
        'stderr' => $stderr === false ? '' : $stderr,
        'log' => $logText,
        'json' => is_array($decoded) ? $decoded : null,
    ];
}

/** @var array<string, array{proc: resource, port: int}> */
$servers = [];

function free_port(): int
{
    $sock = stream_socket_server('tcp://127.0.0.1:0', $errno, $err);
    if ($sock === false) {
        throw new RuntimeException('Could not bind a test port');
    }
    $name = stream_socket_get_name($sock, false);
    fclose($sock);
    $port = (int) substr((string) $name, (int) strrpos((string) $name, ':') + 1);
    return $port;
}

function ensure_server(string $root): int
{
    global $servers;
    if (isset($servers[$root])) {
        return $servers[$root]['port'];
    }
    $router = $root . '/_router.php';
    if (!is_file($router)) {
        file_put_contents($router, <<<'PHP'
<?php
declare(strict_types=1);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
$log = (string) ($_SERVER['HTTP_X_TEST_LOG'] ?? '');
if ($log !== '' && preg_match('#^/[A-Za-z0-9_./-]+$#', $log) === 1) {
    ini_set('error_log', $log);
}
$remote = (string) ($_SERVER['HTTP_X_TEST_REMOTE'] ?? '');
if ($remote !== '') {
    $_SERVER['REMOTE_ADDR'] = $remote;
}
require __DIR__ . '/api/action.php';
PHP);
    }
    $port = free_port();
    $proc = proc_open(
        [PHP_BINARY, '-S', '127.0.0.1:' . $port, '-t', $root, $router],
        [1 => ['file', '/dev/null', 'w'], 2 => ['file', $root . '/server.err', 'a']],
        $pipes,
        $root
    );
    if (!is_resource($proc)) {
        throw new RuntimeException('Could not start php -S');
    }
    $deadline = microtime(true) + 3;
    $up = false;
    while (microtime(true) < $deadline) {
        $fp = @fsockopen('127.0.0.1', $port, $errno, $err, 0.2);
        if (is_resource($fp)) {
            fclose($fp);
            $up = true;
            break;
        }
        usleep(50000);
    }
    if (!$up) {
        proc_terminate($proc);
        throw new RuntimeException('php -S did not accept connections');
    }
    $servers[$root] = ['proc' => $proc, 'port' => $port];
    return $port;
}

function stop_server(string $root): void
{
    global $servers;
    if (!isset($servers[$root])) {
        return;
    }
    $proc = $servers[$root]['proc'];
    if (is_resource($proc)) {
        proc_terminate($proc);
        proc_close($proc);
    }
    unset($servers[$root]);
}

function raw_http(int $port, string $method, string $path, array $headers): array
{
    $fp = fsockopen('127.0.0.1', $port, $errno, $err, 2);
    if (!is_resource($fp)) {
        return ['code' => 0, 'headers' => [], 'body' => '', 'stderr' => $err];
    }
    $lines = [$method . ' ' . $path . ' HTTP/1.1', 'Host: example.test', 'Connection: close'];
    foreach ($headers as $name => $value) {
        $lines[] = $name . ': ' . $value;
    }
    fwrite($fp, implode("\r\n", $lines) . "\r\n\r\n");
    $raw = stream_get_contents($fp);
    fclose($fp);
    $raw = $raw === false ? '' : $raw;
    $split = explode("\r\n\r\n", $raw, 2);
    $headLines = explode("\r\n", $split[0]);
    $code = 0;
    if (preg_match('/\s(\d{3})(?:\s|$)/', $headLines[0] ?? '', $match) === 1) {
        $code = (int) $match[1];
    }
    return [
        'code' => $code,
        'headers' => array_slice($headLines, 1),
        'body' => $split[1] ?? '',
        'stderr' => '',
    ];
}

function http_call(string $root, array $server, array $get = ['action' => 'ping']): array
{
    $port = ensure_server($root);
    $log = $root . '/req-' . bin2hex(random_bytes(3)) . '.log';
    $headers = ['X-Test-Log' => $log];
    if (($server['REMOTE_ADDR'] ?? '') !== '') {
        $headers['X-Test-Remote'] = (string) $server['REMOTE_ADDR'];
    }
    if (isset($server['HTTP_X_FORWARDED_FOR'])) {
        $headers['X-Forwarded-For'] = (string) $server['HTTP_X_FORWARDED_FOR'];
    }
    if (isset($server['HTTP_FORWARDED'])) {
        $headers['Forwarded'] = (string) $server['HTTP_FORWARDED'];
    }
    $method = (string) ($server['REQUEST_METHOD'] ?? 'GET');
    $query = http_build_query($get);
    $path = '/api/action.php' . ($query !== '' ? '?' . $query : '');
    $result = raw_http($port, $method, $path, $headers);
    $result['log'] = is_file($log) ? (string) file_get_contents($log) : '';
    $decoded = json_decode($result['body'], true);
    $result['json'] = is_array($decoded) ? $decoded : null;
    return $result;
}

function ip_call(string $root, array $server): array
{
    $log = $root . '/ip-' . bin2hex(random_bytes(3)) . '.log';
    $script = $root . '/_ip.php';
    if (!is_file($script)) {
        file_put_contents($script, <<<'PHP'
<?php
declare(strict_types=1);
define('STAGEPASS_PHP_ENTRY', true);
$case = json_decode((string) file_get_contents(__DIR__ . '/_ip.json'), true);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', $case['log']);
$_SERVER = $case['server'];
require __DIR__ . '/api/lib/config.php';
require __DIR__ . '/api/lib/request.php';
$config = load_config();
echo json_encode(['ip' => client_ip($config)]);
PHP);
    }
    file_put_contents($root . '/_ip.json', json_encode(['server' => $server, 'log' => $log]));
    $result = run_php($root, $script, $log);
    $result['ip'] = is_array($result['json']) ? (string) ($result['json']['ip'] ?? '') : '';
    return $result;
}

function server(array $extra = []): array
{
    return array_merge([
        'REQUEST_METHOD' => 'GET',
        'REMOTE_ADDR' => '203.0.113.10',
        'HTTP_HOST' => 'example.test',
    ], $extra);
}

function detail_http(array $res): string
{
    return 'code=' . $res['code']
        . ' body=' . trim($res['body'])
        . ' headers=' . implode(',', $res['headers'])
        . ' log=' . trim($res['log'])
        . ' stderr=' . trim($res['stderr']);
}

function rate_files(string $root): array
{
    $dir = $root . '/.php/rate-limit';
    if (!is_dir($dir)) {
        return [];
    }
    $names = [];
    foreach (scandir($dir) ?: [] as $name) {
        if ($name === '.' || $name === '..') {
            continue;
        }
        $names[] = $name;
    }
    sort($names);
    return $names;
}

function norm(string $ip): string
{
    $packed = inet_pton($ip);
    if ($packed === false) {
        return $ip;
    }
    $text = inet_ntop($packed);
    return $text === false ? $ip : $text;
}

function assert_ip(string $name, string $env, array $server, string $expected, ?string $logHas = null, array $logLacks = []): void
{
    $root = make_project($env);
    try {
        $res = ip_call($root, $server);
        $ok = $res['ip'] === $expected;
        if ($logHas !== null) {
            $ok = $ok && str_contains($res['log'], $logHas);
        }
        foreach ($logLacks as $needle) {
            $ok = $ok && !str_contains($res['log'], $needle);
        }
        expect_true($ok, $name, 'ip=' . $res['ip'] . ' log=' . trim($res['log']) . ' stderr=' . trim($res['stderr']));
    } finally {
        rm_tree($root);
    }
}

function assert_storage(string $name, string $env, string $method, bool $closed, string $logNeedle): void
{
    $root = make_project($env, 'block_rate_dir');
    try {
        $res = http_call($root, server(['REQUEST_METHOD' => $method]));
        if ($closed) {
            $ok = $res['code'] === 503
                && ($res['json']['status'] ?? '') === 'error'
                && is_array($res['json'])
                && array_key_exists('data', $res['json'])
                && $res['json']['data'] === null
                && ($res['json']['message'] ?? '') === 'The service is temporarily unavailable. Try again later.'
                && header_value($res['headers'], 'Retry-After') === '60'
                && !str_contains($res['body'], 'rate-limit')
                && !str_contains($res['body'], '.php')
                && !str_contains($res['body'], 'stagepass-php')
                && str_contains($res['log'], $logNeedle);
        } else {
            $ok = $res['code'] === 200
                && ($res['json']['status'] ?? '') === 'success'
                && ($res['json']['data']['pong'] ?? false) === true
                && str_contains($res['log'], $logNeedle);
        }
        expect_true($ok, $name, detail_http($res));
    } finally {
        rm_tree($root);
    }
}

$baseLimits = [
    'RATE_LIMIT_MAX' => '20',
    'RATE_LIMIT_WINDOW' => '60',
    'ALLOWED_ORIGINS' => '',
];

assert_storage(
    'production directory blocked is 503 JSend error',
    env_file($baseLimits + ['APP_ENV' => 'production']),
    'GET',
    true,
    'could not create the rate-limit directory.'
);
assert_storage(
    'production POST ping directory blocked is 503',
    env_file($baseLimits + ['APP_ENV' => 'production']),
    'POST',
    true,
    'could not create the rate-limit directory.'
);
assert_storage(
    'unset APP_ENV directory blocked is 503',
    env_file($baseLimits),
    'GET',
    true,
    'could not create the rate-limit directory.'
);
assert_storage(
    'local directory blocked is allowed and logged',
    env_file($baseLimits + ['APP_ENV' => 'local']),
    'GET',
    false,
    'could not create the rate-limit directory.'
);
assert_storage(
    'development directory blocked is allowed and logged',
    env_file($baseLimits + ['APP_ENV' => 'development']),
    'GET',
    false,
    'could not create the rate-limit directory.'
);
assert_storage(
    'empty APP_ENV directory blocked is allowed and logged',
    env_file($baseLimits + ['APP_ENV' => '']),
    'GET',
    false,
    'could not create the rate-limit directory.'
);

$openRoot = make_project(env_file($baseLimits + ['APP_ENV' => 'production']), static function (string $root): void {
    block_rate_file($root, '203.0.113.10');
});
try {
    $openRes = http_call($openRoot, server());
    expect_true(
        $openRes['code'] === 503
            && ($openRes['json']['status'] ?? '') === 'error'
            && header_value($openRes['headers'], 'Retry-After') === '60'
            && str_contains($openRes['log'], 'could not open a rate-limit file.')
            && !str_contains($openRes['body'], 'rate-limit'),
        'production unopenable rate-limit file is 503 and logged',
        detail_http($openRes)
    );
} finally {
    rm_tree($openRoot);
}

$openLocal = make_project(env_file($baseLimits + ['APP_ENV' => 'local']), static function (string $root): void {
    block_rate_file($root, '203.0.113.10');
});
try {
    $openLocalRes = http_call($openLocal, server());
    expect_true(
        $openLocalRes['code'] === 200
            && ($openLocalRes['json']['status'] ?? '') === 'success'
            && str_contains($openLocalRes['log'], 'could not open a rate-limit file.'),
        'local unopenable rate-limit file is allowed and logged',
        detail_http($openLocalRes)
    );
} finally {
    rm_tree($openLocal);
}

$disabled = make_project(env_file([
    'APP_ENV' => 'production',
    'RATE_LIMIT_MAX' => '0',
    'RATE_LIMIT_WINDOW' => '60',
]), 'block_rate_dir');
try {
    $disabledRes = http_call($disabled, server());
    expect_true(
        $disabledRes['code'] === 200 && ($disabledRes['json']['data']['pong'] ?? false) === true,
        'RATE_LIMIT_MAX=0 does not consult storage',
        detail_http($disabledRes)
    );
} finally {
    rm_tree($disabled);
}

$limitRoot = make_project(env_file([
    'APP_ENV' => 'production',
    'RATE_LIMIT_MAX' => '2',
    'RATE_LIMIT_WINDOW' => '30',
]));
try {
    $codes = [];
    $last = null;
    foreach (['198.51.100.1', '198.51.100.2', '198.51.100.3'] as $spoof) {
        $last = http_call($limitRoot, server([
            'REMOTE_ADDR' => '203.0.113.50',
            'HTTP_X_FORWARDED_FOR' => $spoof,
        ]));
        $codes[] = $last['code'];
    }
    $files = rate_files($limitRoot);
    $expectedFile = hash('sha256', '203.0.113.50|ping') . '.json';
    expect_true(
        $codes === [200, 200, 429]
            && $last !== null
            && ($last['json']['status'] ?? '') === 'fail'
            && ($last['json']['message'] ?? '') === 'Too many requests.'
            && header_value($last['headers'], 'Retry-After') === '30'
            && $files === [$expectedFile]
            && !str_contains($last['log'], '198.51.100.3'),
        'limit hit stays 429 and ignores rotating X-Forwarded-For',
        'codes=' . implode(',', $codes) . ' files=' . implode(',', $files) . ' ' . ($last === null ? '' : detail_http($last))
    );
} finally {
    rm_tree($limitRoot);
}

$normRoot = make_project(env_file([
    'APP_ENV' => 'production',
    'RATE_LIMIT_MAX' => '1',
    'RATE_LIMIT_WINDOW' => '60',
    'TRUSTED_PROXIES' => '10.0.0.1',
]));
try {
    $first = http_call($normRoot, server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '2001:0db8:0002:0000:0000:0000:0000:0008',
    ]));
    $second = http_call($normRoot, server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '2001:db8:2::8',
    ]));
    $client = norm('2001:db8:2::8');
    $files = rate_files($normRoot);
    expect_true(
        $first['code'] === 200
            && $second['code'] === 429
            && ($second['json']['status'] ?? '') === 'fail'
            && $files === [hash('sha256', $client . '|ping') . '.json'],
        'IPv6 spellings share one rate-limit key behind a trusted proxy',
        'files=' . implode(',', $files) . ' second=' . detail_http($second)
    );
} finally {
    rm_tree($normRoot);
}

$hopRoot = make_project(env_file([
    'APP_ENV' => 'local',
    'RATE_LIMIT_MAX' => '5',
    'RATE_LIMIT_WINDOW' => '60',
    'TRUSTED_PROXIES' => '10.0.0.1,10.0.0.2',
]));
try {
    $hit = http_call($hopRoot, server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '9.9.9.9, 198.51.100.7, 10.0.0.2',
    ]));
    $files = rate_files($hopRoot);
    expect_true(
        $hit['code'] === 200
            && $files === [hash('sha256', '198.51.100.7|ping') . '.json'],
        'rightmost untrusted hop is the limiter key and a spoofed left entry is ignored',
        'files=' . implode(',', $files) . ' ' . detail_http($hit)
    );
} finally {
    rm_tree($hopRoot);
}

$proxyEnv = env_file($baseLimits + [
    'APP_ENV' => 'production',
    'TRUSTED_PROXIES' => '10.0.0.1',
]);
assert_ip(
    'spoofed X-Forwarded-For without an allowlist stays REMOTE_ADDR',
    env_file($baseLimits + ['APP_ENV' => 'production']),
    server(['HTTP_X_FORWARDED_FOR' => '198.51.100.20']),
    '203.0.113.10',
    null,
    ['198.51.100.20']
);
assert_ip(
    'X-Forwarded-For behind a trusted proxy is the client',
    $proxyEnv,
    server(['REMOTE_ADDR' => '10.0.0.1', 'HTTP_X_FORWARDED_FOR' => '198.51.100.20']),
    '198.51.100.20'
);
assert_ip(
    'several trusted proxies keep the rightmost untrusted hop',
    env_file($baseLimits + ['TRUSTED_PROXIES' => '10.0.0.1,10.0.0.2,10.1.0.0/16']),
    server([
        'REMOTE_ADDR' => '10.1.4.8',
        'HTTP_X_FORWARDED_FOR' => '9.9.9.9, 198.51.100.7, 10.0.0.2, 10.0.0.1',
    ]),
    '198.51.100.7'
);
assert_ip(
    'IPv6 REMOTE_ADDR is normalised',
    env_file($baseLimits),
    server(['REMOTE_ADDR' => '2001:0db8:0000:0000:0000:0000:0000:0005', 'HTTP_X_FORWARDED_FOR' => '198.51.100.1']),
    norm('2001:db8::5')
);
assert_ip(
    'IPv6 CIDR allowlist trusts the peer and reads IPv6 from X-Forwarded-For',
    env_file($baseLimits + ['TRUSTED_PROXIES' => '2001:db8:1::/48']),
    server([
        'REMOTE_ADDR' => '2001:0db8:0001:0002::10',
        'HTTP_X_FORWARDED_FOR' => '2001:0db8:0002::20',
    ]),
    norm('2001:db8:2::20')
);
assert_ip(
    'IPv4 allowlist does not trust an IPv6 REMOTE_ADDR',
    env_file($baseLimits + ['TRUSTED_PROXIES' => '10.0.0.0/8']),
    server(['REMOTE_ADDR' => '2001:db8::1', 'HTTP_X_FORWARDED_FOR' => '198.51.100.5']),
    norm('2001:db8::1'),
    null,
    ['198.51.100.5']
);
assert_ip(
    'all trusted hops use the leftmost address',
    env_file($baseLimits + ['TRUSTED_PROXIES' => '10.8.8.0/24']),
    server([
        'REMOTE_ADDR' => '10.8.8.9',
        'HTTP_X_FORWARDED_FOR' => '10.8.8.1, 10.8.8.2',
    ]),
    '10.8.8.1'
);
assert_ip(
    'X-Forwarded-For v4 port is normalised',
    $proxyEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '203.0.113.5:5443, 10.0.0.1',
    ]),
    '203.0.113.5'
);
assert_ip(
    'quoted X-Forwarded-For hop is normalised',
    $proxyEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '"203.0.113.6", 10.0.0.1',
    ]),
    '203.0.113.6'
);

$forwardedEnv = env_file($baseLimits + [
    'TRUSTED_PROXIES' => '10.0.0.1',
    'TRUSTED_PROXY_HEADER' => 'forwarded',
]);
assert_ip(
    'Forwarded mode reads for= and ignores X-Forwarded-For',
    $forwardedEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '198.51.100.9',
        'HTTP_FORWARDED' => 'for=203.0.113.15;proto=https, for=10.0.0.1',
    ]),
    '203.0.113.15',
    null,
    ['198.51.100.9']
);
assert_ip(
    'Forwarded IPv6 with a port is the client',
    $forwardedEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_FORWARDED' => 'for="[2001:db8:2::8]:443", for="10.0.0.1"',
    ]),
    norm('2001:db8:2::8')
);
assert_ip(
    'Forwarded v4 port form is the client',
    $forwardedEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_FORWARDED' => 'for="192.0.2.10:5443"',
    ]),
    '192.0.2.10'
);
assert_ip(
    'invalid Forwarded hop falls back to REMOTE_ADDR without echoing the header',
    $forwardedEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_FORWARDED' => 'for=203.0.113.66, for=_secretZZ9, for=10.0.0.1',
    ]),
    '10.0.0.1',
    'invalid proxy hop; using REMOTE_ADDR.',
    ['_secretZZ9', '203.0.113.66']
);
assert_ip(
    'Forwarded unknown value falls back to REMOTE_ADDR',
    $forwardedEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_FORWARDED' => 'for=unknown',
    ]),
    '10.0.0.1',
    'invalid proxy hop; using REMOTE_ADDR.',
    ['unknown']
);
assert_ip(
    'unbalanced Forwarded quotes fall back to REMOTE_ADDR',
    $forwardedEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_FORWARDED' => 'for="203.0.113.77',
    ]),
    '10.0.0.1',
    'invalid proxy hop; using REMOTE_ADDR.',
    ['203.0.113.77']
);
assert_ip(
    'invalid X-Forwarded-For hop falls back once and does not log the header',
    $proxyEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '203.0.113.5, not-a-hop, 10.0.0.1',
    ]),
    '10.0.0.1',
    'invalid proxy hop; using REMOTE_ADDR.',
    ['not-a-hop', '203.0.113.5']
);
assert_ip(
    'garbage X-Forwarded-For is ignored when the peer is not trusted',
    env_file($baseLimits),
    server(['HTTP_X_FORWARDED_FOR' => 'not-a-hop, 198.51.100.20']),
    '203.0.113.10',
    null,
    ['invalid proxy hop', 'not-a-hop', '198.51.100.20']
);
assert_ip(
    'missing Forwarded header keeps REMOTE_ADDR without an invalid-hop log',
    $forwardedEnv,
    server([
        'REMOTE_ADDR' => '10.0.0.1',
        'HTTP_X_FORWARDED_FOR' => '198.51.100.9',
    ]),
    '10.0.0.1',
    null,
    ['invalid proxy hop', '198.51.100.9']
);
assert_ip(
    'invalid allowlist entries are ignored and a valid proxy still counts',
    env_file($baseLimits + ['TRUSTED_PROXIES' => 'not_a_proxy,10.0.0.8']),
    server(['REMOTE_ADDR' => '10.0.0.8', 'HTTP_X_FORWARDED_FOR' => '203.0.113.70']),
    '203.0.113.70',
    'ignoring invalid trusted proxy entry: not_a_proxy'
);
assert_ip(
    'unknown TRUSTED_PROXY_HEADER keeps REMOTE_ADDR',
    env_file($baseLimits + [
        'TRUSTED_PROXIES' => '10.0.0.8',
        'TRUSTED_PROXY_HEADER' => 'x-real-ip',
    ]),
    server(['REMOTE_ADDR' => '10.0.0.8', 'HTTP_X_FORWARDED_FOR' => '203.0.113.70']),
    '10.0.0.8',
    'unknown TRUSTED_PROXY_HEADER; using REMOTE_ADDR.',
    ['203.0.113.70']
);

$marker = 'MARKHEADER999';
$long = $marker . str_repeat(',1.1.1.1', 1200);
assert_ip(
    'overlong X-Forwarded-For falls back without logging the header',
    $proxyEnv,
    server(['REMOTE_ADDR' => '10.0.0.1', 'HTTP_X_FORWARDED_FOR' => $long]),
    '10.0.0.1',
    'invalid proxy hop; using REMOTE_ADDR.',
    [$marker]
);

$many = [];
for ($i = 0; $i < 33; $i++) {
    $many[] = '203.0.113.' . ($i % 200 + 1);
}
assert_ip(
    'more than 32 hops fall back to REMOTE_ADDR',
    $proxyEnv,
    server(['REMOTE_ADDR' => '10.0.0.1', 'HTTP_X_FORWARDED_FOR' => implode(',', $many)]),
    '10.0.0.1',
    'invalid proxy hop; using REMOTE_ADDR.'
);

$configRoot = make_project(env_file($baseLimits + ['APP_ENV' => 'production']), static function (string $root): void {
    file_put_contents($root . '/.php/config.php', <<<'PHP'
<?php
declare(strict_types=1);
if (!defined('STAGEPASS_PHP_ENTRY')) {
    http_response_code(404);
    exit;
}
return [
    'trusted_proxies' => ['10.4.4.4'],
    'trusted_proxy_header' => 'x-forwarded-for',
];
PHP);
});
try {
    $cfg = ip_call($configRoot, server([
        'REMOTE_ADDR' => '10.4.4.4',
        'HTTP_X_FORWARDED_FOR' => '198.51.100.40',
    ]));
    expect_true(
        $cfg['ip'] === '198.51.100.40',
        'php config trusted_proxies is used when the env list is empty',
        'ip=' . $cfg['ip'] . ' log=' . trim($cfg['log'])
    );
} finally {
    rm_tree($configRoot);
}

$happy = make_project(env_file($baseLimits + ['APP_ENV' => 'production']));
try {
    $happyRes = http_call($happy, server());
    expect_true(
        $happyRes['code'] === 200
            && ($happyRes['json']['status'] ?? '') === 'success'
            && ($happyRes['json']['data']['pong'] ?? false) === true,
        'production ping with a writable limiter is 200',
        detail_http($happyRes)
    );
} finally {
    rm_tree($happy);
}

echo 'php-security: ' . ($failures === 0 ? 'ok' : 'failed') . " pass={$passes} fail={$failures}\n";
exit($failures === 0 ? 0 : 1);
