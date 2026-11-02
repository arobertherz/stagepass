var Stagepass = (() => {
  // src/domain.ts
  function isValidDomain(d) {
    if (typeof d !== "string" || !d) return false;
    if (d === "debug" || d === "localhost") return true;
    if (d.startsWith("localhost:")) {
      const port = d.slice("localhost:".length);
      return /^[0-9]{1,5}$/.test(port) && Number(port) <= 65535;
    }
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.sp$/i.test(
      d
    );
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
    const PKG_VERSION = true ? "2.3.0-beta.1" : "0.0.0";
    const LOADER_RE = /loader(?:\.min)?\.js/i;
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
    const p = new URLSearchParams(loc.search);
    function getCallerLocation() {
      try {
        const stack = (new Error().stack || "").split("\n");
        for (let i = 3; i < stack.length; i++) {
          const m = stack[i].match(/([^/]+\.(?:js|ts))(?:[?#][^:]*)?:(\d+)/);
          if (m && !LOADER_RE.test(m[1])) return ` ${m[1]}:${m[2]}`;
        }
      } catch (_) {
      }
      return "";
    }
    let hasActiveSession = false;
    const flagState = { n: [0, 0], tip: "" };
    let renderFlag = null;
    const bump = (i) => {
      flagState.n[i]++;
      if (renderFlag) renderFlag();
    };
    function log(level, ...args) {
      if (!hasActiveSession) return;
      if (level === "warn" || level === "error") bump(level === "warn" ? 0 : 1);
      try {
        const where = getCallerLocation();
        const pre = `[\u{1F3AB} ${(/* @__PURE__ */ new Date()).toTimeString().split(" ")[0]}${where ? " |" + where : ""}]`;
        const c = console;
        if (level === "error") c.log(`%c${pre}`, "color:red;font-weight:bold", ...args);
        else if (c[level]) c[level](pre, ...args);
        else c.log(pre, level, ...args);
      } catch (_) {
      }
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
    const dom = swap ? cleanDomain(sv) : null;
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
    stagepassObj.vars = Object.freeze({
      isLocal,
      env,
      domain: dom || hostname,
      timestamp: now,
      version: PKG_VERSION,
      client: clientInfo
    });
    stagepassObj.log = spLog;
    stagepassObj.warn = spWarn;
    stagepassObj.error = spError;
    stagepassObj.resolveLocalUrl = (relativePath) => swap && dom && relativePath ? buildLocalAssetUrl(dom, relativePath, stagepassObj.vars.timestamp || Date.now()) : "";
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
        const FLAG = /* @__PURE__ */ Symbol.for("stagepass.flag");
        Object.defineProperty(stagepassObj, FLAG, {
          configurable: true,
          value: (create) => {
            delete stagepassObj[FLAG];
            try {
              renderFlag = create(debug ? "DEBUG" : "LOCAL", dom, flagState, () => {
                clearSession();
                hasActiveSession = true;
                log("log", "\u{1F50C} Stagepass disconnected.");
                emit("session", { active: false, domain: null, swap: false, debug: false });
                loc.reload();
              });
            } catch (_) {
            }
          }
        });
        W.addEventListener("error", () => bump(1), true);
        W.addEventListener("unhandledrejection", () => bump(1));
        const src = loaderScript && loaderScript.src || "";
        const s = d.createElement("script");
        s.src = /\/loader(?:\.min)?\.js$/i.test(src.split(/[?#]/)[0]) ? new URL("flag.min.js", src).href : `https://cdn.jsdelivr.net/npm/@stagepass/loader@${PKG_VERSION}/dist/flag.min.js`;
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
      return version ? appendQueryParam(productionSrc, "v", version) : productionSrc;
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
    const SKIP = [
      "data-stagepass",
      "data-stagepass-path",
      "data-stagepass-cachebust",
      "data-stagepass-v"
    ];
    function swapEl(sel, srcAttr, type, seen) {
      d.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el) => {
        try {
          el.setAttribute("data-stagepass-processed", "true");
          let lp = el.getAttribute("data-stagepass-path");
          const hadExplicitPath = !!lp;
          const ps = el.getAttribute(srcAttr);
          if (!ps) return;
          if (!lp && swap && dom) lp = extractLocalFilename(ps);
          if (swap && lp && !hadExplicitPath && hasActiveSession) {
            const count = (seen.get(lp) || 0) + 1;
            seen.set(lp, count);
            if (count === 2) {
              spWarn(
                `Multiple assets resolve to local file "${lp}" without data-stagepass-path. Set unique paths to avoid collisions.`
              );
            }
          }
          const url = resolveAssetUrl(el, ps, lp);
          if (!url) return;
          const n = d.createElement(type);
          const isScript = type === "script";
          if (isScript) n.src = url;
          else {
            n.rel = "stylesheet";
            n.href = url;
          }
          for (const a of Array.from(el.attributes)) {
            if (a.name !== srcAttr && !SKIP.includes(a.name) && (isScript || a.name !== "href")) {
              n.setAttribute(a.name, a.value);
            }
          }
          if (isScript) applyScriptLoadOrder(n, el);
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
    const process = () => {
      try {
        const seen = /* @__PURE__ */ new Map();
        swapEl("script[data-stagepass]", "data-src", "script", seen);
        swapEl('link[rel="stylesheet"][data-stagepass]', "data-href", "link", seen);
      } catch (_) {
      }
    };
    let lnaCheck = null;
    const checkLna = () => lnaCheck = lnaCheck || (swap ? queryLoopbackPermission().then((state) => {
      const hint = lnaHintMessage(state);
      if (hint) {
        flagState.tip = hint;
        spWarn(hint);
      }
    }).catch(() => {
    }) : Promise.resolve());
    const run = () => {
      void checkLna().then(process);
    };
    run();
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", run);
  })();
})();
