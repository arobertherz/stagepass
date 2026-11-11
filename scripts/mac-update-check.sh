#!/bin/sh
# Compare a global @stagepass/cli update on macOS.
# Reads certificates and projects only. Never deletes them.
# Restarts the LaunchAgent (`stagepass autostart on`) only when the running
# daemon version differs from the CLI after install.
#
# Usage: scripts/mac-update-check.sh [version|latest] [outfile.md]
set -eu

TARGET="${1:-latest}"
OUTFILE="${2:-}"

case "$TARGET" in
  latest) ;;
  *[!0-9A-Za-z.+-]*)
    printf 'invalid version: %s\n' "$TARGET" >&2
    exit 2
    ;;
esac

LABEL="io.github.arobertherz.stagepass"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_N="$(id -u)"
STATE="${HOME}/.stagepass/daemon.json"
if [ -n "${XDG_DATA_HOME:-}" ]; then
  CADDY_DATA="${XDG_DATA_HOME}/caddy"
else
  CADDY_DATA="${HOME}/Library/Application Support/Caddy"
fi
ROOT_CERT="${CADDY_DATA}/pki/authorities/local/root.crt"
SITE_DIR="${CADDY_DATA}/certificates/local"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sp-mac-update.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/before" "$WORK/after"

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  else
    openssl dgst -sha256 "$1"
  fi
}

cert_hashes() {
  if [ -f "$ROOT_CERT" ]; then
    hash_file "$ROOT_CERT"
  else
    printf 'MISSING %s\n' "$ROOT_CERT"
  fi
  if [ -d "$SITE_DIR" ]; then
    find "$SITE_DIR" -type f | LC_ALL=C sort | while IFS= read -r f; do
      hash_file "$f"
    done
  else
    printf 'MISSING %s\n' "$SITE_DIR"
  fi
}

daemon_version() {
  if [ ! -f "$STATE" ]; then
    return 0
  fi
  ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE" | head -n 1)"
  pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$STATE" | head -n 1)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf '%s' "$ver"
  fi
  return 0
}

strip_ansi() {
  if command -v perl >/dev/null 2>&1; then
    perl -pe 's/\e\[[0-9;]*[A-Za-z]//g'
  else
    cat
  fi
}

one_line() {
  printf '%s' "$1" | tr '\n' ' ' | sed 's/|/\\|/g; s/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//'
}

read_trim() {
  if [ -f "$1" ]; then
    head -n 1 "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
  fi
}

collect() {
  dest="$1"
  stagepass --version >"$dest/version" 2>"$dest/version.err" || true
  npm ls -g @stagepass/cli --depth=0 >"$dest/npm-ls" 2>&1 || true
  launchctl print "gui/${UID_N}/${LABEL}" >"$dest/print" 2>&1 || true
  launchctl list >"$dest/list" 2>&1 || true
  if [ -f "$PLIST" ]; then
    /usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$PLIST" >"$dest/arg0" 2>/dev/null || printf 'MISSING\n' >"$dest/arg0"
    /usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$PLIST" >"$dest/arg1" 2>/dev/null || printf 'MISSING\n' >"$dest/arg1"
    /usr/libexec/PlistBuddy -c 'Print :ProgramArguments:2' "$PLIST" >"$dest/arg2" 2>/dev/null || printf 'MISSING\n' >"$dest/arg2"
  else
    printf 'MISSING\n' >"$dest/arg0"
    printf 'MISSING\n' >"$dest/arg1"
    printf 'MISSING\n' >"$dest/arg2"
  fi
  cert_hashes >"$dest/certs" || true
  stagepass doctor >"$dest/doctor" 2>&1 || true
  daemon_version >"$dest/daemon-version" || true
}

field() {
  if [ -f "$1" ]; then
    cat "$1"
  fi
}

summary_line() {
  strip_ansi <"$1" | sed -n 's/.*Summary: //p' | tail -n 1
}

pid_line() {
  pid="$(sed -n 's/^[[:space:]]*pid = //p' "$1/print" | head -n 1)"
  state="$(sed -n 's/^[[:space:]]*state = //p' "$1/print" | head -n 1)"
  list="$(grep -F "$LABEL" "$1/list" | head -n 1 || true)"
  printf '%s' "$(one_line "${pid:-none} ${state:-} ${list:-}")"
}

args_line() {
  printf '%s' "$(one_line "$(field "$1/arg0") ; $(field "$1/arg1") ; $(field "$1/arg2")")"
}

if ! command -v stagepass >/dev/null 2>&1; then
  printf 'stagepass is not on PATH\n' >&2
  exit 2
fi

collect "$WORK/before"

INSTALL_OK=0
WANT=""
if [ "$TARGET" = "latest" ]; then
  npm view @stagepass/cli version >"$WORK/npm-view" 2>&1 || true
  WANT="$(head -n 1 "$WORK/npm-view" | tr -d '[:space:]')"
  case "$WANT" in
    [0-9]*) ;;
    *) WANT="" ;;
  esac
  if [ -n "$WANT" ] && npm i -g @stagepass/cli@latest >"$WORK/npm-install" 2>&1; then
    INSTALL_OK=1
  fi
else
  WANT="$TARGET"
  if npm i -g "@stagepass/cli@${TARGET}" >"$WORK/npm-install" 2>&1; then
    INSTALL_OK=1
  fi
fi

collect "$WORK/after"

RESTARTED=no
cli_after="$(read_trim "$WORK/after/version")"
dver="$(field "$WORK/after/daemon-version")"
if [ "$dver" != "$cli_after" ]; then
  RESTARTED=yes
  printf 'daemon version (%s) differs from CLI %s; running stagepass autostart on\n' "${dver:-none}" "$cli_after"
  stagepass autostart on >"$WORK/autostart" 2>&1 || true
  i=0
  while [ "$i" -lt 10 ]; do
    daemon_version >"$WORK/after/daemon-version" || true
    dver="$(field "$WORK/after/daemon-version")"
    if [ -n "$dver" ] && [ "$dver" = "$cli_after" ]; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
  collect "$WORK/after"
fi

before_v="$(read_trim "$WORK/before/version")"
after_v="$(read_trim "$WORK/after/version")"
dver="$(field "$WORK/after/daemon-version")"
node_path="$(read_trim "$WORK/after/arg0")"
after_summary="$(summary_line "$WORK/after/doctor")"
fails="$(printf '%s\n' "$after_summary" | sed -n 's/.*[[:space:]]\([0-9][0-9]*\) fail.*/\1/p' | head -n 1)"

: >"$WORK/results"
pass() { printf -- '- PASS: %s\n' "$1" >>"$WORK/results"; }
fail() { printf -- '- FAIL: %s\n' "$1" >>"$WORK/results"; }

if [ "$INSTALL_OK" = 1 ] && [ "$after_v" = "$WANT" ] && [ "$before_v" != "$after_v" ]; then
  pass "version changed to ${WANT}"
else
  fail "version changed to ${WANT} (before ${before_v:-none}, after ${after_v:-none})"
fi

if cmp -s "$WORK/before/certs" "$WORK/after/certs"; then
  pass "certs sha256 identical"
else
  fail "certs sha256 identical"
fi

if [ "$fails" = "0" ]; then
  pass "doctor 0 fail"
else
  fail "doctor 0 fail (${after_summary:-no summary})"
fi

if [ -n "$dver" ] && [ "$dver" = "$after_v" ]; then
  pass "daemon version == CLI version"
else
  fail "daemon version == CLI version (daemon ${dver:-none}, CLI ${after_v:-none})"
fi

case "$node_path" in
  '' | MISSING)
    fail "plist node path not under Cellar (missing)"
    ;;
  */Cellar/node*/*/bin/node)
    fail "plist node path not under Cellar (${node_path})"
    ;;
  *)
    pass "plist node path not under Cellar"
    ;;
esac

{
  printf '# macOS update check (@stagepass/cli)\n\n'
  printf 'Target: `%s` (`%s`). Autostart restarted: %s.\n\n' "$TARGET" "$WANT" "$RESTARTED"
  printf 'Certificates and projects were not deleted.\n\n'
  printf '| Item | Before | After |\n| --- | --- | --- |\n'
  printf '| stagepass --version | %s | %s |\n' "$(one_line "$before_v")" "$(one_line "$after_v")"
  printf '| npm ls -g @stagepass/cli | %s | %s |\n' \
    "$(one_line "$(field "$WORK/before/npm-ls")")" \
    "$(one_line "$(field "$WORK/after/npm-ls")")"
  printf '| LaunchAgent | %s | %s |\n' "$(pid_line "$WORK/before")" "$(pid_line "$WORK/after")"
  printf '| ProgramArguments | %s | %s |\n' "$(args_line "$WORK/before")" "$(args_line "$WORK/after")"
  printf '| doctor | %s | %s |\n' \
    "$(one_line "$(summary_line "$WORK/before/doctor")")" \
    "$(one_line "$after_summary")"
  printf '| daemon version | %s | %s |\n\n' \
    "$(one_line "$(field "$WORK/before/daemon-version")")" \
    "$(one_line "$dver")"
  printf '## Certificates\n\n### Before\n\n```\n'
  field "$WORK/before/certs"
  printf '\n```\n\n### After\n\n```\n'
  field "$WORK/after/certs"
  printf '\n```\n\n## Results\n\n'
  cat "$WORK/results"
  printf '\n'
} >"$WORK/protocol.md"

if [ -n "$OUTFILE" ]; then
  cat "$WORK/protocol.md" >"$OUTFILE"
fi
cat "$WORK/protocol.md"

if grep -q '^- FAIL' "$WORK/results"; then
  exit 1
fi
exit 0
