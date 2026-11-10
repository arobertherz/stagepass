# macOS manual checklist (CLI operations)

Use this after installing a local build of `@stagepass/cli` on macOS with Homebrew.

## Prerequisites

- Node 20.17+ on PATH (22 or 24 recommended)
- Homebrew installed
- A throwaway project folder (example: `~/Sites/my-project`)

```bash
npm install -g .   # from repo packages/cli, or use npx against the workspace build
stagepass setup
stagepass link my-project --origin my-project.webflow.io
stagepass start
```

## doctor

- [ ] `stagepass doctor` prints ok/warn/fail lines and a summary
- [ ] Exit code is `0` when there are no fails; `1` when any fail
- [ ] `stagepass doctor --json` prints valid JSON with `checks` and `summary`
- [ ] Missing Homebrew / Caddy / PHP / dnsmasq surfaces as fail (temporarily rename binaries to verify)
- [ ] Missing `/etc/resolver/sp` surfaces as fail
- [ ] Port 443 section reports the listener (or warns if empty / permission denied). Doctor must never ask for sudo
- [ ] Linked project whose folder was deleted surfaces as fail
- [ ] Chrome Local Network Access hint is printed
- [ ] CDN check reports recommended snippets use `@2` (not `@latest` / `@1` / bare)
- [ ] With a project `README.md` containing `@stagepass/loader@latest` (or `@1` / bare), doctor warns on `cdn.project`

## certs

- [ ] `stagepass certs check` reports root path under `~/Library/Application Support/Caddy/pki/authorities/local/root.crt`
- [ ] Warns when root expires in under 90 days (use a lab machine or mock if needed)
- [ ] Reports System keychain trust status for "Caddy Local Authority"
- [ ] Orphaned old Caddy roots are listed with SHA-1 and SHA-256 (not deleted by `check`)
- [ ] Optional TLS handshake lines appear for each linked `.sp` domain while Caddy is running
- [ ] `stagepass certs check --json` works
- [ ] `stagepass certs trust` asks for confirmation; declining does nothing
- [ ] `stagepass certs trust --yes` runs `caddy trust`
- [ ] After trust, Safari / Chrome / Firefox show a valid certificate for `https://my-project.sp`
- [ ] `stagepass certs renew` with a failing site cert deletes only `certificates/local/<domain>` after confirmation, then reloads Caddy
- [ ] `stagepass certs renew --root` asks twice (or needs `--yes --i-understand-root-renewal`); CA folder is moved to a `.backup.*` path, not deleted; prints hint to run `certs trust`
- [ ] `stagepass certs renew --remove-orphans` confirms per SHA-1 (or `--yes`) and runs `security delete-certificate -Z <sha1>` (never by CN)

## start / stop / port conflict

- [ ] `stagepass start` prints certificate findings; interactive TTY can offer trust/renew
- [ ] Non-interactive `start` prints findings + hint and does not repair
- [ ] Port 443 conflict shows **process name and PID** and requires confirmation before any signal
- [ ] Confirmed conflict uses SIGTERM first; SIGKILL only after a second confirmation (or process already gone)
- [ ] Own-user listeners are signalled without sudo first; `sudo kill` only after unprivileged failure (EPERM / other uid)
- [ ] nginx conflicts try `valet stop` (then `brew services stop nginx`) before any sudo
- [ ] `start` never calls standby `sudo -v`
- [ ] With autostart enabled, `start` uses `launchctl kickstart` and prints that fact
- [ ] With autostart enabled, `stop` uses `launchctl bootout` and says services return at next login; `autostart off` removes permanently

## Permissions (do not conflate)

- [ ] **CA trust** checked via `certs check` / `certs trust` (System keychain); separate from TCC
- [ ] **Browser Local Network Access** granted in the browser if the live site loads `*.sp`; separate from Node
- [ ] If macOS prompts **Node** for **Desktop** (or another folder) access because the project/test pack lives there, grant that folder only, not Full Disk Access
- [ ] Prefer a stable `npm install -g @stagepass/cli` path for acceptance; temporary Desktop test packs are fine for a one-off check but refresh autostart before deleting them

## autostart / daemon

- [ ] `stagepass autostart status` shows label `io.github.arobertherz.stagepass`
- [ ] `stagepass autostart on` writes `~/Library/LaunchAgents/io.github.arobertherz.stagepass.plist` with absolute node + CLI paths and an `EnvironmentVariables` `PATH` that includes Homebrew `bin`/`sbin` from `brew --prefix` (Cellar symlink for `caddy` is OK)
- [ ] With a sparse launchd-like PATH, `daemon` still finds `caddy` via the plist PATH
- [ ] Plist has `RunAtLoad` and `KeepAlive` / `SuccessfulExit` false
- [ ] Logs appear under `~/.stagepass/logs/`
- [ ] `stagepass start` does **not** prompt for sudo when port 443 is free / only caddy listens; with a foreign listener it asks before SIGTERM and again before SIGKILL
- [ ] With autostart on: bootstrap if needed, kickstart via `start`; `stop` bootouts (until next login) then stops Caddy/PHP; `autostart off` / `on` retained
- [ ] After moving Node/CLI or leaving a Desktop test path, `autostart off` then `on` with the stable CLI (upgrade alone does not migrate ProgramArguments)
- [ ] After logout/login (or `launchctl bootstrap`), daemon starts Caddy via `caddy run`
- [ ] Daemon ensures PHP-FPM without sudo
- [ ] Daemon shows a macOS notification on cert trust failure / PHP-FPM failure / permanent bind failure (notification must not block or crash the daemon)
- [ ] `stagepass autostart off` boots out the agent and removes the plist
- [ ] If port 443 cannot be bound, daemon logs a clear message and exits `0` (no KeepAlive restart-loop; not a silent success)
- [ ] Cold-start daemon logs cert root/trust only (no TLS handshake attempts before `caddy run`)

## Regression (must stay unchanged)

- [ ] `stagepass link` / `unlink` / `reload` / `setup` behave as before
- [ ] Loader CDN `@2` behaviour is untouched by this CLI work
