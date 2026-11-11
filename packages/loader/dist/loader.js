var Stagepass = (() => {
  // src/domain.ts
  function isValidDomain(d) {
    if (typeof d !== "string" || !d) return false;
    if (d === "debug" || d === "localhost") return true;
    if (d.startsWith("localhost:")) {
      d = d.slice(10);
      return /^[1-9]\d{0,4}$/.test(d) && +d < 65536;
    }
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.sp$/i.test(d);
  }
  function cleanDomain(d) {
    if (!d) return null;
    return d.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }

  // src/session.ts
  var SESSION_KEY = "stagepass_domain";
  var DEFAULT_SESSION_HOURS = 12;
  function parseSession(raw, now = Date.now()) {
    if (!raw) return null;
    if (!raw.startsWith("{")) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.domain !== "string" || typeof parsed.expires !== "number" || !Number.isFinite(parsed.expires)) {
        return null;
      }
      if (!isValidDomain(parsed.domain)) return null;
      if (parsed.expires <= now) return null;
      return { domain: parsed.domain, expires: parsed.expires };
    } catch {
      return null;
    }
  }
  function createSession(domain, hours = DEFAULT_SESSION_HOURS, now = Date.now()) {
    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_HOURS;
    return {
      domain,
      expires: now + safeHours * 60 * 60 * 1e3
    };
  }
  function serializeSession(record) {
    return JSON.stringify(record);
  }
  function parseSessionHours(value) {
    if (value == null || value === "") return DEFAULT_SESSION_HOURS;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SESSION_HOURS;
    return n;
  }

  // src/url.ts
  function appendQueryParam(url, key, value) {
    if (!url || typeof url !== "string") return url;
    const encoded = encodeURIComponent(value);
    const hashIdx = url.indexOf("#");
    const hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
    const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${encodeURIComponent(key)}=${encoded}${hash}`;
  }
  function buildLocalAssetUrl(domain, relativePath, cacheBust) {
    const clean = relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
    return `https://${domain}/${clean}?_cb=${encodeURIComponent(String(cacheBust))}`;
  }

  // src/lna.ts
  async function queryLoopbackPermission() {
    const perms = typeof navigator !== "undefined" ? navigator.permissions : void 0;
    if (!perms || typeof perms.query !== "function") {
      return "unknown";
    }
    const names = ["loopback-network", "local-network-access"];
    for (const name of names) {
      try {
        const status = await perms.query({ name });
        const state = status && status.state;
        if (state === "granted" || state === "prompt" || state === "denied") {
          return state;
        }
      } catch {
      }
    }
    return "unknown";
  }
  function lnaHintMessage(state) {
    if (state === "prompt") {
      return "Local network access is required. Allow local/loopback network access when Chrome prompts, then reload.";
    }
    if (state === "denied") {
      return "Local network access is blocked. Enable loopback/local network access for this site in Chrome settings, then reload.";
    }
    return null;
  }

  // src/script-attrs.ts
  function applyScriptLoadOrder(script, source) {
    const hadAsync = source.hasAttribute("async");
    const hadDefer = source.hasAttribute("defer");
    if (hadAsync) {
      script.async = true;
    } else {
      script.async = false;
      if (!hadDefer) {
        script.defer = true;
      }
    }
  }
  var NOCACHE_ATTR = "data-stagepass-nocache";
  function isNoCacheEnabled(el) {
    if (!el.hasAttribute(NOCACHE_ATTR)) return false;
    return el.getAttribute(NOCACHE_ATTR) !== "false";
  }

  // src/env.ts
  function parseStagingHosts(value) {
    if (!value || typeof value !== "string") return [];
    return value.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  }
  function detectRuntimeEnv(hostname, swapDomain, stagingHosts = []) {
    if (swapDomain && swapDomain.endsWith(".sp")) return "local";
    const host = (hostname || "").toLowerCase();
    if (host.endsWith(".webflow.io")) return "staging";
    if (stagingHosts.some((h) => h === host)) return "staging";
    return "production";
  }

  // src/alias.ts
  function isValidJsIdentifier(name) {
    if (!name || typeof name !== "string") return false;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  }
  function isGlobalFree(target, name) {
    try {
      return typeof target[name] === "undefined";
    } catch (_) {
      return false;
    }
  }

  // src/client.ts
  var BROWSERS = [
    ["edge", /Edg\/(\d+)/],
    ["opera", /OPR\/(\d+)/],
    ["firefox", /Firefox\/(\d+)/],
    ["chrome", /Chrome\/(\d+)/],
    ["safari", /Version\/(\d+).+Safari\//]
  ];
  var OSES = [
    ["android", /Android/i],
    ["ios", /iPhone|iPad|iPod/i],
    ["macos", /Mac OS X|Macintosh/i],
    ["windows", /Windows NT/i],
    ["linux", /Linux/i]
  ];
  function getBrowserInfo(ua) {
    for (const [family, re] of BROWSERS) {
      const m = ua.match(re);
      if (m) return { family, major: Number(m[1]), userAgent: ua };
    }
    return { family: "unknown", major: null, userAgent: ua };
  }
  function getOsInfo(ua) {
    const hit = OSES.find(([, re]) => re.test(ua));
    return { family: hit ? hit[0] : "unknown" };
  }
  function getDeviceInfo(ua) {
    const touch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
    let type = "desktop";
    if (/iPad|Tablet/i.test(ua)) type = "tablet";
    else if (/Mobi|Android.+Mobile|iPhone/i.test(ua)) type = "mobile";
    else if (/Android/i.test(ua) && touch) type = "tablet";
    return { type, touch };
  }
  function getThemeInfo() {
    let v = null;
    try {
      const mq = (scheme) => matchMedia(`(prefers-color-scheme: ${scheme})`).matches;
      v = mq("dark") ? "dark" : mq("light") ? "light" : null;
    } catch (_) {
    }
    return { preferred: v || "no-preference", current: v || "unknown" };
  }
  function hasStorage(type) {
    try {
      const storage = window[type];
      const key = "__stagepass_test__";
      storage.setItem(key, "1");
      storage.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }
  function hasServiceWorker() {
    try {
      return typeof navigator !== "undefined" && "serviceWorker" in navigator;
    } catch (_) {
      return false;
    }
  }
  function getClientInfo() {
    const ua = navigator.userAgent || "";
    let timezone = null;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (_) {
    }
    return {
      theme: getThemeInfo(),
      browser: getBrowserInfo(ua),
      os: getOsInfo(ua),
      device: getDeviceInfo(ua),
      viewport: {
        width: window.innerWidth || 0,
        height: window.innerHeight || 0,
        dpr: window.devicePixelRatio || 1
      },
      locale: {
        language: navigator.language || "unknown",
        timezone
      },
      capabilities: {
        cookiesEnabled: navigator.cookieEnabled === true,
        localStorage: hasStorage("localStorage"),
        sessionStorage: hasStorage("sessionStorage")
      }
    };
  }
  function canCapability(client, capability) {
    const caps = client.capabilities;
    switch (capability) {
      case "localStorage":
        return caps.localStorage === true;
      case "sessionStorage":
        return caps.sessionStorage === true;
      case "cookies":
        return caps.cookiesEnabled === true;
      case "serviceWorker":
        return hasServiceWorker();
      default:
        return false;
    }
  }

  // src/registry.ts
  function majorFromVersion(version) {
    if (!version || typeof version !== "string") return null;
    const m = version.trim().match(/^(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  function createModuleRegistry(loaderVersion, warn) {
    const loaderMajor = majorFromVersion(loaderVersion);
    const registered = /* @__PURE__ */ new Map();
    function use(name, version, factory, api) {
      if (!name || typeof name !== "string") {
        warn("stagepass.use: invalid module name");
        return false;
      }
      const modMajor = majorFromVersion(version);
      if (loaderMajor == null || modMajor == null) {
        warn(`stagepass.use: cannot parse version for module "${name}"`);
        return false;
      }
      if (modMajor !== loaderMajor) {
        warn(
          `Module "${name}" major ${modMajor} does not match loader major ${loaderMajor}. Skipping.`
        );
        return false;
      }
      try {
        factory(api);
        registered.set(name, version);
        return true;
      } catch (err) {
        warn(`Module "${name}" failed to register:`, err);
        return false;
      }
    }
    return { use, registered };
  }

  // src/index.ts
  (function() {
    const K = SESSION_KEY;
    const P = "stagepass";
    const W = window;
    const d = document;
    const loc = location;
    const PKG_VERSION = true ? "2.4.0" : "0.0.0";
    const LOADER_RE = /loader(?:\.min)?\.js/i;
    function flagBase(v, file) {
      if (typeof v !== "string" || !(v = v.trim())) return null;
      try {
        const u = new URL(v, d.baseURI);
        if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
        u.search = u.hash = "";
        return file ? new URL("./", u).href : u.href.replace(/\/?$/, "/");
      } catch (_) {
        return null;
      }
    }
    function getLoaderScript() {
      try {
        if (d.currentScript instanceof HTMLScriptElement) return d.currentScript;
      } catch (_) {
      }
      try {
        const scripts = d.querySelectorAll('script[src*="loader"]');
        for (let i = scripts.length - 1; i >= 0; i--) {
          if (LOADER_RE.test(scripts[i].src || "")) return scripts[i];
        }
      } catch (_) {
      }
      return null;
    }
    const loaderScript = getLoaderScript();
    const attr = (name) => loaderScript ? loaderScript.getAttribute("data-stagepass-" + name) : null;
    const muteConsole = attr("mute-console") === "true";
    const sessionHours = parseSessionHours(attr("session-hours"));
    const loaderVersionAttr = attr("version");
    const stagingHosts = parseStagingHosts(attr("staging-hosts"));
    const aliasName = attr("alias");
    const liveSrc = attr("live-src") === "true";
    const p = new URLSearchParams(loc.search);
    let hasActiveSession = false;
    const flagState = { n: [0, 0], m: [], f: [], swapped: 0, v: PKG_VERSION, vd: isValidDomain };
    let renderFlag = null;
    const draw = () => renderFlag && renderFlag();
    const time = () => (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8);
    const fileOf = (u) => (u || "").split(/[?#]/)[0].split("/").pop() || "";
    const cut = (t, n) => t.length > n ? t.slice(0, n) + "\u2026" : t;
    const str = (a, depth = 0) => {
      try {
        if (typeof a === "string") return depth ? JSON.stringify(a) : a;
        if (a instanceof Error) return a.name + ": " + a.message;
        if (!a || typeof a !== "object") return String(a);
        if (a instanceof Node) return "<" + a.nodeName.toLowerCase() + ">";
        const arr = Array.isArray(a);
        if (depth > 2) return arr ? "[\u2026]" : "{\u2026}";
        const keys = Object.keys(a);
        const out = keys.slice(0, 20).map((k) => (arr ? "" : k + ": ") + str(a[k], depth + 1));
        if (keys.length > 20) out.push("\u2026");
        return cut(arr ? "[" + out.join(", ") + "]" : "{" + out.join(", ") + "}", 1e3);
      } catch (_) {
        return "[unserializable]";
      }
    };
    const frame = (stack, skip = 0) => {
      const lines = (stack || "").split("\n");
      for (let i = skip; i < lines.length; i++) {
        const m = lines[i].match(/([a-z][\w+.-]*:\/\/[^\s()]+?):(\d+):(\d+)/i);
        if (m && !LOADER_RE.test(fileOf(m[1]))) return [m[1], m[2], m[3]];
      }
      return null;
    };
    let dom = null;
    const srcOf = (u) => !u ? "external" : dom && !u.indexOf(`https://${dom}/`) ? "local" : "live";
    const note = (i, text, url = "", line = "", col = "", stack = "", src) => {
      flagState.n[i]++;
      const m = flagState.m;
      const x = {
        type: i ? "error" : "warn",
        time: time(),
        src: src || (url ? srcOf(url) : ""),
        file: fileOf(url),
        url: url.split(/[?#]/)[0],
        line: line ? String(line) : "",
        col: col ? String(col) : "",
        text: cut(text, 500),
        stack: cut(stack, 2e3),
        c: 1
      };
      const k = (y) => y.type + y.text + y.url + y.line + y.col;
      for (let j = m.length - 1; j >= 0; j--)
        if (k(m[j]) === k(x)) {
          x.c = m[j].c + 1;
          m.splice(j, 1);
          break;
        }
      m.push(x);
      if (m.length > 50) m.shift();
      draw();
    };
    const noteErr = (i, prefix, args, at) => {
      const er = args.find((a) => a instanceof Error);
      const st = er && er.stack || "";
      const f = frame(st) || at;
      note(i, prefix + args.map((a) => str(a)).join(" "), f ? f[0] : "", f ? f[1] : "", f ? f[2] : "", st);
    };
    let busy = false;
    const print = (fn) => {
      busy = true;
      try {
        fn();
      } catch (_) {
      }
      busy = false;
    };
    function log(level, ...args) {
      if (!hasActiveSession) return;
      const at = frame(new Error().stack || "", 3);
      if (level === "warn" || level === "error") noteErr(level === "warn" ? 0 : 1, "", args, at);
      print(() => {
        const pre = `[\u{1F3AB} ${time()}${at ? " | " + fileOf(at[0]) + ":" + at[1] : ""}]`;
        const c = console;
        if (level === "error") c.log(`%c${pre}`, "color:red;font-weight:bold", ...args);
        else if (c[level]) c[level](pre, ...args);
        else c.log(pre, level, ...args);
      });
    }
    function spLog(...args) {
      const level = args[0] === "warn" || args[0] === "error" ? args.shift() : "log";
      log(level, ...args);
    }
    const spWarn = (...args) => log("warn", ...args);
    const spError = (...args) => log("error", ...args);
    const logOnce = (level, msg) => {
      const prev = hasActiveSession;
      hasActiveSession = true;
      log(level, msg);
      hasActiveSession = prev;
    };
    function readSessionDomain() {
      try {
        const raw = localStorage.getItem(K);
        const record = parseSession(raw);
        if (!record && raw) localStorage.removeItem(K);
        return record ? record.domain : null;
      } catch (_) {
        return null;
      }
    }
    function clearSession() {
      try {
        localStorage.removeItem(K);
      } catch (_) {
      }
    }
    let paramProcessed = false;
    let sv = readSessionDomain();
    if (p.has(P)) {
      const v = p.get(P);
      if (v === "off" || v === "0" || v === "false") {
        clearSession();
        sv = null;
        logOnce("log", "\u{1F50C} Stagepass disconnected.");
      } else if (v) {
        const c = v === "debug" ? "debug" : cleanDomain(v);
        if (c && isValidDomain(c)) {
          try {
            localStorage.setItem(K, serializeSession(createSession(c, sessionHours)));
          } catch (_) {
          }
          sv = c;
          paramProcessed = true;
          logOnce(
            "log",
            c === "debug" ? "\u{1F50D} Stagepass debug mode enabled." : `\u{1F50C} Stagepass connected to: ${c}`
          );
        } else if (c) {
          logOnce("warn", `Invalid domain: ${c}. Only .sp domains are allowed.`);
        }
      }
      try {
        p.delete(P);
        const s = p.toString();
        history.replaceState({}, "", loc.pathname + (s ? `?${s}` : "") + loc.hash);
      } catch (_) {
      }
    }
    if (sv && !isValidDomain(sv)) {
      clearSession();
      sv = null;
    }
    const debug = sv === "debug";
    hasActiveSession = !!sv;
    if (sv && !paramProcessed && !debug) log("log", `\u{1F50C} Stagepass connected to: ${sv}`);
    const dev = !!sv;
    const swap = dev && !debug;
    dom = swap ? cleanDomain(sv) : null;
    const now = swap ? Date.now() : 0;
    const hostname = loc.hostname;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("localhost:") || hostname.startsWith("127.0.0.1:");
    const isLocal = swap || isLocalhost;
    const env = isLocal ? "local" : hostname.endsWith(".webflow.io") || stagingHosts.includes(hostname.toLowerCase()) ? "staging" : "production";
    if (muteConsole && env === "production" && !hasActiveSession) {
      try {
        const noop = () => {
        };
        console.log = console.warn = console.error = console.info = console.debug = noop;
      } catch (_) {
      }
    }
    const listeners = {
      theme: /* @__PURE__ */ new Set(),
      session: /* @__PURE__ */ new Set()
    };
    const emit = (event, payload) => listeners[event].forEach((fn) => {
      try {
        fn(payload);
      } catch (_) {
      }
    });
    const clientInfo = getClientInfo();
    try {
      const updateTheme = () => emit("theme", { ...Object.assign(clientInfo.theme, getThemeInfo()) });
      ["dark", "light"].forEach((scheme) => {
        const m = matchMedia(`(prefers-color-scheme: ${scheme})`);
        if (m.addEventListener) m.addEventListener("change", updateTheme);
        else if (m.addListener) m.addListener(updateTheme);
      });
    } catch (_) {
    }
    W.addEventListener("resize", () => {
      const v = clientInfo.viewport;
      v.width = W.innerWidth || 0;
      v.height = W.innerHeight || 0;
      v.dpr = W.devicePixelRatio || 1;
    });
    const stagepassObj = W.stagepass || {};
    const registry = createModuleRegistry(PKG_VERSION, spWarn);
    const varsFrozen = Object.freeze({
      isLocal,
      env,
      domain: dom || hostname,
      timestamp: now,
      version: PKG_VERSION,
      client: clientInfo
    });
    stagepassObj.vars = varsFrozen;
    stagepassObj.log = spLog;
    stagepassObj.warn = spWarn;
    stagepassObj.error = spError;
    stagepassObj.resolveLocalUrl = (relativePath) => swap && dom && relativePath ? buildLocalAssetUrl(dom, relativePath, varsFrozen.timestamp || Date.now()) : "";
    stagepassObj.env = () => detectRuntimeEnv(hostname, dom, stagingHosts);
    stagepassObj.is = (name) => stagepassObj.env() === name;
    stagepassObj.can = (capability) => canCapability(clientInfo, capability);
    stagepassObj.client = (key) => key == null || key === "" ? clientInfo : clientInfo[key];
    stagepassObj.on = (event, fn) => {
      const set = listeners[event];
      if (!set || event !== "theme" && event !== "session") return () => {
      };
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    };
    stagepassObj.use = (name, version, factory) => registry.use(name, version, factory, stagepassObj);
    W.stagepass = W.sp = stagepassObj;
    globalThis.stagepass = globalThis.sp = stagepassObj;
    if (aliasName && isValidJsIdentifier(aliasName) && aliasName !== "sp" && aliasName !== "stagepass") {
      [W, globalThis].forEach((g) => {
        if (isGlobalFree(g, aliasName)) g[aliasName] = stagepassObj;
      });
    }
    if (dev) {
      try {
        const FLAG = /* @__PURE__ */ Symbol.for("stagepass.flag.v2");
        const opt = attr("flag-base") ?? W.stagepassFlagBase;
        let base = flagBase(opt, false);
        if (opt != null && !base) spWarn("Ignored flag base (http(s) or relative only): " + cut(String(opt), 99));
        base = base || flagBase(loaderScript && loaderScript.src || "", true);
        if (!base) {
          base = `https://cdn.jsdelivr.net/npm/@stagepass/loader@${PKG_VERSION}/dist/`;
          if (debug) spWarn("Loader URL unknown, flag loads from " + base + ". Set data-stagepass-flag-base");
        }
        Object.assign(flagState, {
          debug,
          domain: dom,
          card: base + "flag-card.min.js",
          // End session is the only flag action that disconnects
          end: () => {
            clearSession();
            hasActiveSession = true;
            log("log", "\u{1F50C} Stagepass disconnected.");
            emit("session", { active: false, domain: null, swap: false, debug: false });
            loc.reload();
          }
        });
        Object.defineProperty(stagepassObj, FLAG, {
          configurable: true,
          value: (create) => {
            delete stagepassObj[FLAG];
            try {
              renderFlag = create(flagState);
            } catch (_) {
            }
          }
        });
        W.addEventListener(
          "error",
          (e) => {
            const t = e.target;
            const u = t && t !== W && (t.src || t.href);
            if (typeof u === "string") {
              if (!mine.has(t)) note(1, "Failed to load " + u.split(/[?#]/)[0], u);
            } else if (/^Script error\.?$/.test(e.message || "") && !e.filename)
              note(1, "Error in a cross-origin script (details only in DevTools console)", "", "", "", "", "external");
            else
              note(1, e.message || "Script error", e.filename || "", e.lineno, e.colno, e.error && e.error.stack || "");
          },
          true
        );
        W.addEventListener("unhandledrejection", (e) => noteErr(1, "Unhandled rejection: ", [e.reason], null));
        const c = console;
        ["warn", "error"].forEach((k, i) => {
          const o = c[k];
          if (typeof o !== "function") return;
          c[k] = function(...args) {
            if (!busy) {
              busy = true;
              try {
                noteErr(i, "", args, frame(new Error().stack || "", 2));
              } catch (_) {
              }
              busy = false;
            }
            return o.apply(this, args);
          };
        });
        const s = d.createElement("script");
        s.src = base + "flag.min.js";
        s.async = true;
        s.onerror = () => spWarn("Stagepass flag could not be loaded: " + s.src);
        (d.head || d.documentElement).appendChild(s);
      } catch (_) {
      }
    }
    emit("session", { active: hasActiveSession, domain: sv, swap, debug });
    function resolveAssetUrl(el, productionSrc, localPath) {
      if (swap && localPath && dom) return buildLocalAssetUrl(dom, localPath, now);
      const version = el.getAttribute("data-stagepass-v") || loaderVersionAttr;
      let url = version ? appendQueryParam(productionSrc, "v", version) : productionSrc;
      if (isNoCacheEnabled(el)) url = appendQueryParam(url, "_cb", String(Date.now()));
      return url;
    }
    function extractLocalFilename(ps) {
      try {
        const parts = new URL(ps).pathname.split("/");
        return parts[parts.length - 1] || parts[parts.length - 2] || null;
      } catch (e) {
        const m = ps.match(/\/([^\/\?#]+)(?:\?|#|$)/);
        return m ? m[1] : null;
      }
    }
    const mine = /* @__PURE__ */ new WeakSet();
    let lnaState = "";
    function track(n, live, local, isScript, retry, explicit) {
      const f = { live, local, type: isScript ? "js" : "css", st: "" };
      if (explicit) f.x = true;
      const name = fileOf(local);
      mine.add(n);
      flagState.f.push(f);
      n.addEventListener("load", () => {
        f.st = "ok";
        flagState.swapped++;
        draw();
      });
      n.addEventListener("error", () => {
        const fail = (st, i, text) => {
          f.st = st;
          note(i, text, local);
        };
        const F = W.fetch;
        if (typeof F !== "function") return fail("failed", 1, `Failed to load ${name}`);
        F(local, { method: "HEAD", cache: "no-store" }).then(
          (r) => fail(r.ok ? "failed" : String(r.status), 1, r.ok ? `Failed to load ${name}` : `Local file not found (${r.status}): ${name}`),
          () => F(local, { method: "HEAD", mode: "no-cors", cache: "no-store" }).then(
            () => {
              if (!retry) return fail("failed", 1, `Failed to load ${name}`);
              flagState.f.splice(flagState.f.indexOf(f), 1);
              n.replaceWith(retry(false));
              note(0, `Local server sends no CORS header for ${name}. Loaded without crossorigin, error details are limited`, local);
            },
            () => fail("failed", 1, `Local server not reachable: ${name}. Run stagepass doctor` + (lnaHintMessage(lnaState) ? ". " + lnaHintMessage(lnaState) : ""))
          )
        );
      });
    }
    const SKIP = [
      "data-stagepass",
      "data-stagepass-path",
      "data-stagepass-cachebust",
      "data-stagepass-v",
      NOCACHE_ATTR
    ];
    const LS = 'script[data-stagepass][src]:not([data-src]):not([data-stagepass-processed]),link[rel="stylesheet" i][data-stagepass][href]:not([data-href]):not([data-stagepass-processed])';
    const ff = "onbeforescriptexecute" in d;
    function rewriteLive(el) {
      try {
        const js = el.tagName === "SCRIPT";
        if (js && (ff || d.currentScript === el)) return;
        const k = js ? "src" : "href";
        const ps = el.getAttribute(k);
        if (!ps) return;
        el.setAttribute("data-stagepass-processed", "true");
        const x = el.getAttribute("data-stagepass-path");
        const lp = x || extractLocalFilename(ps);
        if (!lp) return;
        const url = buildLocalAssetUrl(dom, lp, now);
        el.removeAttribute("integrity");
        if (!el.hasAttribute("crossorigin")) el.setAttribute("crossorigin", "anonymous");
        el[k] = url;
        track(el, ps, url, js, null, !!x);
      } catch (_) {
      }
    }
    const scanLive = (r) => {
      try {
        if (r.matches && r.matches(LS)) rewriteLive(r);
        r.querySelectorAll(LS).forEach(rewriteLive);
      } catch (_) {
      }
    };
    function swapEl(sel, srcAttr, type) {
      d.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el) => {
        try {
          let lp = el.getAttribute("data-stagepass-path");
          const hadExplicitPath = !!lp;
          const ps = el.getAttribute(srcAttr);
          if (!ps) return;
          el.setAttribute("data-stagepass-processed", "true");
          if (!lp && swap && dom) lp = extractLocalFilename(ps);
          const url = resolveAssetUrl(el, ps, lp);
          if (!url) return;
          const local = swap && lp && dom;
          const isScript = type === "script";
          const make = (cors) => {
            const n2 = d.createElement(type);
            if (cors) n2.crossOrigin = "anonymous";
            if (isScript) n2.src = url;
            else {
              n2.rel = "stylesheet";
              n2.href = url;
            }
            for (const a of Array.from(el.attributes)) {
              if (a.name !== srcAttr && !SKIP.includes(a.name) && a.name !== (isScript ? "src" : "href"))
                n2.setAttribute(a.name, a.value);
            }
            if (local) n2.removeAttribute("integrity");
            if (isScript) applyScriptLoadOrder(n2, el);
            if (local) track(n2, ps, url, isScript, cors ? make : null, hadExplicitPath);
            return n2;
          };
          const n = make(!!local && !el.hasAttribute("crossorigin"));
          if (el.parentNode) {
            el.parentNode.insertBefore(n, el);
            el.remove();
          } else {
            spError(`${type} injection failed: No parent node`);
          }
        } catch (_) {
        }
      });
    }
    if (swap && liveSrc) {
      try {
        new MutationObserver((ms) => {
          for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) scanLive(n);
        }).observe(d.documentElement, { childList: true, subtree: true });
        if (ff)
          d.addEventListener(
            "beforescriptexecute",
            (e) => {
              const el = e.target;
              if (!el || !el.matches || !el.matches(LS)) return;
              const ps = el.getAttribute("src");
              if (!ps || ps.indexOf("https://" + dom + "/") === 0) return;
              e.preventDefault();
              el.setAttribute("data-src", ps);
              el.removeAttribute("src");
              swapEl("script[data-stagepass]", "data-src", "script");
            },
            true
          );
        scanLive(d);
      } catch (_) {
      }
    }
    const process = () => {
      try {
        swapEl("script[data-stagepass]", "data-src", "script");
        swapEl('link[rel="stylesheet"][data-stagepass]', "data-href", "link");
        if (swap && liveSrc) scanLive(d);
        if (renderFlag) renderFlag();
      } catch (_) {
      }
    };
    let lnaCheck = null;
    const checkLna = () => lnaCheck = lnaCheck || (swap ? queryLoopbackPermission().then((state) => {
      lnaState = state;
    }).catch(() => {
    }) : Promise.resolve());
    const run = () => {
      void checkLna().then(process);
    };
    run();
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", run);
  })();
})();
