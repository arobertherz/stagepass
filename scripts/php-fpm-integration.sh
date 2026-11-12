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
      const block = renderSiteBlock(\"php-it.sp\", \"/srv\", { php: true, allowAllOrigins: false, origins: [] });
      writeFileSync(\"/out/Caddyfile\", block + \"\\n\");
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
  docker run -d --name sp-php-it-caddy \
    --network container:sp-php-it-fpm \
    -v "$WORK/Caddyfile":/etc/caddy/Caddyfile:ro \
    -v "$PROJ":/srv:ro \
    caddy:2 >/dev/null

  local port
  port="$(docker port sp-php-it-fpm 443/tcp | head -n 1 | awk -F: '{print $NF}')"
  if [[ -z "$port" ]]; then
    echo "could not read published port" >&2
    docker logs sp-php-it-caddy >&2 || true
    exit 1
  fi
  local base="https://php-it.sp:${port}"
  echo "caddy https port ${port}"

  local ready=0 body="" code=""
  for _ in $(seq 1 40); do
    code="$(curl -sk -o "$WORK/body.txt" -w '%{http_code}' --resolve "php-it.sp:${port}:127.0.0.1" \
      "${base}/api/action.php?action=ping" || true)"
    body="$(cat "$WORK/body.txt" 2>/dev/null || true)"
    if [[ "$code" == "200" ]] && grep -q '"pong":true' "$WORK/body.txt"; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [[ "$ready" != "1" ]]; then
    echo "ping did not become ready (HTTP ${code})" >&2
    echo "body: ${body}" >&2
    docker logs sp-php-it-caddy >&2 || true
    docker logs sp-php-it-fpm >&2 || true
    exit 1
  fi
  echo "ping HTTP ${code}"
  echo "body: ${body}"
  if [[ "$body" != '{"status":"success","data":{"pong":true},"message":null}' ]]; then
    echo "unexpected ping body" >&2
    exit 1
  fi

  local cors
  cors="$(curl -sk -D - -o /dev/null --resolve "php-it.sp:${port}:127.0.0.1" \
    -H 'Origin: https://php-it.sp' \
    "${base}/api/action.php?action=ping" || true)"
  echo "$cors" | head -n 20
  echo "$cors" | grep -qi 'access-control-allow-origin: https://php-it.sp' \
    || { echo "missing CORS for https://php-it.sp" >&2; exit 1; }

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
