#!/usr/bin/env bash
# Scaffold a project with the Stagepass CLI, then serve the PHP boilerplate
# through the Caddy site block the CLI renders plus real php-fpm.
# Skips (exit 0) when Docker is not available. Not part of the vitest suite.
#
# Usage: scripts/php-fpm-integration.sh [8.2|8.4|all]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSIONS="${1:-all}"
case "$VERSIONS" in
  all) VERSIONS="8.2 8.4" ;;
  8.2|8.4) ;;
  *) echo "usage: $0 [8.2|8.4|all]" >&2; exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "php-fpm integration: skipped (docker unavailable)"
  exit 0
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sp-php-it.XXXXXX")"
cleanup() {
  docker rm -f sp-php-it-fpm sp-php-it-caddy >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "scaffolding with the CLI inside node:22"
docker run --rm \
  -e STAGEPASS_SKIP_PLATFORM_CHECK=1 \
  -e CI=true \
  -v "$ROOT":/src:ro \
  -v "$WORK":/out \
  -v sp-npm-cache-22:/root/.npm \
  node:22 bash -c '
    set -euo pipefail
    mkdir -p /w
    tar --exclude=./node_modules --exclude="./packages/*/node_modules" --exclude=./.git -C /src -cf - . | tar -xf - -C /w
    cd /w
    npm ci --no-audit --no-fund
    node packages/cli/bin/index.js new php-it \
      --yes --no-git --no-install --php \
      --lang js --styles css --site-modules none \
      --dir /out/php-it
    node --input-type=module -e "
      import { writeFileSync } from \"node:fs\";
      import { renderSiteBlock } from \"/w/packages/cli/src/lib/caddyfile.js\";
      for (const [name, allowAllOrigins] of [[\"allowlist\", false], [\"allowall\", true]]) {
        const block = renderSiteBlock(\"php-it.sp\", \"/srv\", { php: true, allowAllOrigins, origins: [] });
        writeFileSync(\"/out/Caddyfile.\" + name, block + \"\\n\");
      }
    "
  '

PROJ="$WORK/php-it"
test -f "$PROJ/api/action.php"
test -f "$PROJ/.php/config.php"
chmod -R a+rX "$PROJ"
mkdir -p "$PROJ/.php"
chmod 777 "$PROJ/.php"
cat > "$PROJ/.env" <<'EOF'
APP_ENV=production
ALLOWED_ORIGINS=https://php-it.sp
EOF
printf 'SECRET_API_ENV\n' > "$PROJ/api/.env"
printf 'opcache.enable=0\n' > "$WORK/nocache.ini"

hdr_count() {
  local name="$1"
  local n
  n="$(grep -ic "^${name}:" "$WORK/hdr.txt" || true)"
  printf '%s' "$n"
}

expect_hdr() {
  local name="$1"
  local want="$2"
  local n
  n="$(hdr_count "$name")"
  if [[ "$n" != "$want" ]]; then
    echo "header ${name}: expected ${want} line(s), got ${n}" >&2
    echo "---- headers ----" >&2
    cat "$WORK/hdr.txt" >&2 || true
    exit 1
  fi
}

expect_no_dupes() {
  local name
  for name in vary access-control-allow-methods access-control-allow-headers access-control-allow-credentials; do
    local n
    n="$(hdr_count "$name")"
    if [[ "$n" -gt 1 ]]; then
      echo "duplicate ${name}: ${n}" >&2
      cat "$WORK/hdr.txt" >&2 || true
      exit 1
    fi
  done
}

acao_value() {
  { grep -i '^access-control-allow-origin:' "$WORK/hdr.txt" || true; } | head -n 1 | cut -d' ' -f2- | tr -d '\r'
}

expect_one_acao() {
  local want="$1"
  expect_hdr 'access-control-allow-origin' 1
  local got
  got="$(acao_value)"
  if [[ "$got" != "$want" ]]; then
    echo "ACAO value: expected [${want}], got [${got}]" >&2
    cat "$WORK/hdr.txt" >&2 || true
    exit 1
  fi
  if [[ "$got" == *,* ]]; then
    echo "ACAO value lists more than one origin: ${got}" >&2
    exit 1
  fi
}

curl_req() {
  local port="$1"
  shift
  curl -sk -D "$WORK/hdr.txt" -o "$WORK/body.txt" -w '%{http_code}' \
    --resolve "php-it.sp:${port}:127.0.0.1" "$@" || true
}

run_version() {
  local ver="$1"
  local image="php:${ver}-fpm"
  echo
  echo "======== php-fpm ${ver} ========"
  docker rm -f sp-php-it-fpm sp-php-it-caddy >/dev/null 2>&1 || true
  docker run -d --name sp-php-it-fpm \
    -p 127.0.0.1::443 \
    -v "$PROJ":/srv \
    -v "$WORK/nocache.ini":/usr/local/etc/php/conf.d/zz-nocache.ini:ro \
    "$image" >/dev/null

  local port
  port="$(docker port sp-php-it-fpm 443/tcp | head -n 1 | awk -F: '{print $NF}')"
  if [[ -z "$port" ]]; then
    echo "could not read published port" >&2
    docker logs sp-php-it-fpm >&2 || true
    exit 1
  fi
  local base="https://php-it.sp:${port}"
  echo "caddy https port ${port}"

  local mode
  for mode in allowlist allowall; do
    cp "$WORK/Caddyfile.${mode}" "$WORK/Caddyfile"
    docker rm -f sp-php-it-caddy >/dev/null 2>&1 || true
    docker run -d --name sp-php-it-caddy \
      --network container:sp-php-it-fpm \
      -v "$WORK/Caddyfile":/etc/caddy/Caddyfile:ro \
      -v "$PROJ":/srv:ro \
      caddy:2 >/dev/null

    local want_acao="https://php-it.sp"
    if [[ "$mode" == "allowall" ]]; then
      want_acao="*"
    fi

    local ready=0 body="" code=""
    for _ in $(seq 1 40); do
      code="$(curl_req "$port" "${base}/api/action.php?action=ping")"
      body="$(cat "$WORK/body.txt" 2>/dev/null || true)"
      if [[ "$code" == "200" ]] && grep -q '"pong":true' "$WORK/body.txt"; then
        ready=1
        break
      fi
      sleep 0.5
    done
    if [[ "$ready" != "1" ]]; then
      echo "${mode} ping did not become ready (HTTP ${code})" >&2
      echo "body: ${body}" >&2
      docker logs sp-php-it-caddy >&2 || true
      docker logs sp-php-it-fpm >&2 || true
      exit 1
    fi

    code="$(curl_req "$port" -H 'Origin: https://php-it.sp' "${base}/api/action.php?action=ping")"
    body="$(cat "$WORK/body.txt")"
    echo "${mode} GET ping HTTP ${code} acao=$(hdr_count access-control-allow-origin) value=$(acao_value) vary=$(hdr_count vary) methods=$(hdr_count access-control-allow-methods) allow_headers=$(hdr_count access-control-allow-headers)"
    if [[ "$code" != "200" || "$body" != '{"status":"success","data":{"pong":true},"message":null}' ]]; then
      echo "unexpected ping" >&2
      echo "body: ${body}" >&2
      exit 1
    fi
    expect_one_acao "$want_acao"
    expect_no_dupes

    code="$(curl_req "$port" -X OPTIONS \
      -H 'Origin: https://php-it.sp' \
      -H 'Access-Control-Request-Method: POST' \
      -H 'Access-Control-Request-Headers: content-type' \
      "${base}/api/action.php")"
    echo "${mode} OPTIONS preflight HTTP ${code} acao=$(hdr_count access-control-allow-origin) value=$(acao_value) vary=$(hdr_count vary) methods=$(hdr_count access-control-allow-methods) allow_headers=$(hdr_count access-control-allow-headers) private_network=$(hdr_count access-control-allow-private-network)"
    if [[ "$code" != "204" && "$code" != "200" ]]; then
      echo "preflight status ${code} is not a browser success" >&2
      cat "$WORK/hdr.txt" >&2 || true
      exit 1
    fi
    expect_one_acao "$want_acao"
    expect_hdr 'access-control-allow-methods' 1
    expect_hdr 'access-control-allow-headers' 1
    expect_hdr 'access-control-allow-private-network' 1
    expect_no_dupes
    if ! grep -qi '^access-control-allow-methods:.*POST' "$WORK/hdr.txt"; then
      echo "preflight does not allow POST" >&2
      exit 1
    fi
    if ! grep -qi '^access-control-allow-headers:.*content-type' "$WORK/hdr.txt"; then
      echo "preflight does not allow content-type" >&2
      exit 1
    fi

    code="$(curl_req "$port" -H 'Origin: https://php-it.sp' -H 'Content-Type: application/json' \
      -d '{"action":"contact","name":"Ada","email":"ada@example.com","message":"Hello","website":""}' \
      "${base}/api/action.php")"
    body="$(cat "$WORK/body.txt")"
    echo "${mode} POST contact HTTP ${code} acao=$(hdr_count access-control-allow-origin) value=$(acao_value) vary=$(hdr_count vary) body=${body}"
    if [[ "$code" != "200" || "$body" != '{"status":"success","data":{"received":true,"name":"Ada"},"message":null}' ]]; then
      echo "unexpected contact response" >&2
      exit 1
    fi
    expect_one_acao "$want_acao"
    expect_no_dupes

    code="$(curl_req "$port" -H 'Origin: https://not-allowed.example' -H 'Content-Type: application/json' \
      -d '{"action":"contact","name":"Ada","email":"ada@example.com","message":"Hello","website":""}' \
      "${base}/api/action.php")"
    body="$(cat "$WORK/body.txt")"
    echo "${mode} POST disallowed HTTP ${code} acao=$(hdr_count access-control-allow-origin) vary=$(hdr_count vary) body=${body}"
    if [[ "$code" != "403" || "$body" != '{"status":"fail","data":{"origin":"Origin is not allowed."},"message":"Origin is not allowed."}' ]]; then
      echo "unexpected disallowed response" >&2
      exit 1
    fi
    expect_hdr 'access-control-allow-origin' 0
    expect_no_dupes
    if grep -qi 'not-allowed.example' "$WORK/hdr.txt"; then
      echo "disallowed origin was reflected" >&2
      exit 1
    fi

    code="$(curl_req "$port" -H 'Origin: https://php-it.sp' "${base}/api/README.md")"
    echo "${mode} GET static HTTP ${code} acao=$(hdr_count access-control-allow-origin) value=$(acao_value) vary=$(hdr_count vary)"
    if [[ "$code" != "200" ]]; then
      echo "static file was not served" >&2
      exit 1
    fi
    expect_one_acao "$want_acao"
    expect_no_dupes
  done

  hidden() {
    local path="$1"
    local status
    status="$(curl -sk -o "$WORK/hidden.txt" -w '%{http_code}' --resolve "php-it.sp:${port}:127.0.0.1" \
      "${base}${path}" || true)"
    echo "${path} HTTP ${status}"
    if [[ "$status" != "404" ]]; then
      echo "expected 404 for ${path}" >&2
      cat "$WORK/hidden.txt" >&2 || true
      exit 1
    fi
    if grep -q 'SECRET_API_ENV' "$WORK/hidden.txt" || grep -q 'allowed_origins' "$WORK/hidden.txt"; then
      echo "hidden path ${path} leaked file contents" >&2
      exit 1
    fi
  }
  hidden '/.php/config.php'
  hidden '/.env'
  hidden '/api/.env'

  perl -0pi -e "s/'pong' => true/'pong' => false/" "$PROJ/api/actions/ping.php"
  local edited
  edited="$(curl -sk --resolve "php-it.sp:${port}:127.0.0.1" \
    "${base}/api/action.php?action=ping")"
  echo "edited ping: ${edited}"
  if [[ "$edited" != '{"status":"success","data":{"pong":false},"message":null}' ]]; then
    echo "PHP edit was not visible without a restart" >&2
    exit 1
  fi
  perl -0pi -e "s/'pong' => false/'pong' => true/" "$PROJ/api/actions/ping.php"
  echo "======== php-fpm ${ver} ok ========"
  docker rm -f sp-php-it-fpm sp-php-it-caddy >/dev/null
}

for ver in $VERSIONS; do
  run_version "$ver"
done

echo "php-fpm integration ok"
