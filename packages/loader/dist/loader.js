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
  function getBrowserInfo(ua) {
    let family = "unknown";
    let major = null;
    let m = null;
    if (/Edg\/(\d+)/.test(ua)) {
      family = "edge";
      m = ua.match(/Edg\/(\d+)/);
    } else if (/OPR\/(\d+)/.test(ua)) {
      family = "opera";
      m = ua.match(/OPR\/(\d+)/);
    } else if (/Firefox\/(\d+)/.test(ua)) {
      family = "firefox";
      m = ua.match(/Firefox\/(\d+)/);
    } else if (/Chrome\/(\d+)/.test(ua)) {
      family = "chrome";
      m = ua.match(/Chrome\/(\d+)/);
    } else if (/Version\/(\d+).+Safari\//.test(ua)) {
      family = "safari";
      m = ua.match(/Version\/(\d+)/);
    }
    if (m && m[1]) major = Number(m[1]);
    return { family, major: Number.isFinite(major) ? major : null, userAgent: ua };
  }
  function getOsInfo(ua) {
    if (/Android/i.test(ua)) return { family: "android" };
    if (/iPhone|iPad|iPod/i.test(ua)) return { family: "ios" };
    if (/Mac OS X|Macintosh/i.test(ua)) return { family: "macos" };
    if (/Windows NT/i.test(ua)) return { family: "windows" };
    if (/Linux/i.test(ua)) return { family: "linux" };
    return { family: "unknown" };
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
    let preferred = "no-preference";
    let current = "unknown";
    try {
      if (window.matchMedia) {
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
          preferred = "dark";
          current = "dark";
        } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
          preferred = "light";
          current = "light";
        }
      }
    } catch (_) {
    }
    return { preferred, current };
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
    const PKG_VERSION = true ? "2.2.0" : "0.0.0";
    function getLoaderScript() {
      try {
        if (document.currentScript instanceof HTMLScriptElement) {
          return document.currentScript;
        }
      } catch (_) {
      }
      try {
        const scripts = document.querySelectorAll('script[src*="loader"]');
        for (let i = scripts.length - 1; i >= 0; i--) {
          const s = scripts[i];
          if (/loader(?:\.min)?\.js/i.test(s.src || "")) return s;
        }
      } catch (_) {
      }
      return null;
    }
    const loaderScript = getLoaderScript();
    const muteConsole = (loaderScript == null ? void 0 : loaderScript.getAttribute("data-stagepass-mute-console")) === "true";
    const sessionHours = parseSessionHours(
      loaderScript == null ? void 0 : loaderScript.getAttribute("data-stagepass-session-hours")
    );
    const loaderVersionAttr = loaderScript == null ? void 0 : loaderScript.getAttribute("data-stagepass-version");
    const stagingHosts = parseStagingHosts(
      loaderScript == null ? void 0 : loaderScript.getAttribute("data-stagepass-staging-hosts")
    );
    const aliasName = loaderScript == null ? void 0 : loaderScript.getAttribute("data-stagepass-alias");
    const p = new URLSearchParams(window.location.search);
    function getCallerLocation() {
      var _a;
      try {
        const stack = (_a = new Error().stack) == null ? void 0 : _a.split("\n");
        if (!stack) return "";
        const loaderPattern = /loader(?:\.min)?\.js/i;
        for (let i = 3; i < stack.length; i++) {
          const line = stack[i];
          const match = line.match(/([^/]+\.(?:js|ts))(?:[?#][^:]*)?:(\d+)/);
          if (match) {
            const file = match[1];
            if (!loaderPattern.test(file)) return ` ${file}:${match[2]}`;
          }
        }
      } catch (_) {
      }
      return "";
    }
    let hasActiveSession = false;
    function log(level, ...args) {
      if (!hasActiveSession) return;
      try {
        const t = (/* @__PURE__ */ new Date()).toTimeString().split(" ")[0];
        const loc = getCallerLocation();
        const pre = `[\u{1F3AB} ${t}${loc ? " |" + loc : ""}]`;
        if (level === "error") {
          console.log(`%c${pre}`, "color: red; font-weight: bold;", ...args);
        } else if (console[level]) {
          console[level](pre, ...args);
        } else {
          console.log(pre, level, ...args);
        }
      } catch (_) {
      }
    }
    function spLog(...args) {
      let level = "log";
      if (args.length > 0 && (args[0] === "warn" || args[0] === "error")) {
        level = args[0];
        args = args.slice(1);
      }
      log(level, ...args);
    }
    const spWarn = (...args) => log("warn", ...args);
    const spError = (...args) => log("error", ...args);
    function readSessionDomain() {
      try {
        const raw = localStorage.getItem(K);
        const record = parseSession(raw);
        if (!record) {
          if (raw) localStorage.removeItem(K);
          return null;
        }
        return record.domain;
      } catch (_) {
        return null;
      }
    }
    function writeSession(domain) {
      try {
        const record = createSession(domain, sessionHours);
        localStorage.setItem(K, serializeSession(record));
      } catch (_) {
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
        hasActiveSession = true;
        log("log", "\u{1F50C} Stagepass disconnected.");
        hasActiveSession = false;
      } else if (v) {
        const c = v === "debug" ? "debug" : cleanDomain(v);
        if (c && isValidDomain(c)) {
          writeSession(c);
          sv = c;
          hasActiveSession = true;
          log(
            "log",
            c === "debug" ? "\u{1F50D} Stagepass debug mode enabled." : `\u{1F50C} Stagepass connected to: ${c}`
          );
          paramProcessed = true;
        } else if (c) {
          hasActiveSession = true;
          spWarn(`Invalid domain: ${c}. Only .sp domains are allowed.`);
          hasActiveSession = false;
        }
      }
      try {
        p.delete(P);
        const s = p.toString();
        window.history.replaceState(
          {},
          "",
          window.location.pathname + (s ? `?${s}` : "") + window.location.hash
        );
      } catch (_) {
      }
    }
    if (sv && !isValidDomain(sv)) {
      clearSession();
      sv = null;
    }
    hasActiveSession = !!(sv && isValidDomain(sv));
    if (sv && !paramProcessed && sv !== "debug" && hasActiveSession) {
      log("log", `\u{1F50C} Stagepass connected to: ${sv}`);
    }
    const dev = !!sv;
    const swap = !!sv && sv !== "debug";
    const dom = swap ? cleanDomain(sv) : null;
    const now = swap ? Date.now() : 0;
    const cacheBust = now;
    const sessionStartTime = now;
    const hostname = window.location.hostname;
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
    function emit(event, payload) {
      listeners[event].forEach((fn) => {
        try {
          fn(payload);
        } catch (_) {
        }
      });
    }
    let clientInfo = getClientInfo();
    function ensureClient() {
      return clientInfo;
    }
    try {
      if (window.matchMedia) {
        const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
        const lightMq = window.matchMedia("(prefers-color-scheme: light)");
        const updateTheme = () => {
          const c = clientInfo;
          if (!(c == null ? void 0 : c.theme)) return;
          if (darkMq.matches) {
            c.theme.current = "dark";
            c.theme.preferred = "dark";
          } else if (lightMq.matches) {
            c.theme.current = "light";
            c.theme.preferred = "light";
          } else {
            c.theme.current = "unknown";
            c.theme.preferred = "no-preference";
          }
          emit("theme", { ...c.theme });
        };
        if (typeof darkMq.addEventListener === "function") {
          darkMq.addEventListener("change", updateTheme);
          lightMq.addEventListener("change", updateTheme);
        } else if (typeof darkMq.addListener === "function") {
          darkMq.addListener(updateTheme);
          lightMq.addListener(updateTheme);
        }
      }
    } catch (_) {
    }
    const updateViewport = () => {
      const c = clientInfo;
      if (!(c == null ? void 0 : c.viewport)) return;
      c.viewport.width = window.innerWidth || 0;
      c.viewport.height = window.innerHeight || 0;
      c.viewport.dpr = window.devicePixelRatio || 1;
    };
    window.addEventListener("resize", updateViewport);
    const stagepassObj = window.stagepass || {};
    const registry = createModuleRegistry(PKG_VERSION, spWarn);
    stagepassObj.vars = Object.freeze({
      isLocal,
      env,
      domain: dom || hostname,
      timestamp: sessionStartTime,
      version: PKG_VERSION,
      client: clientInfo
    });
    stagepassObj.log = spLog;
    stagepassObj.warn = spWarn;
    stagepassObj.error = spError;
    stagepassObj.resolveLocalUrl = (relativePath) => {
      const v = stagepassObj.vars;
      if (!swap || !dom || !relativePath) return "";
      return buildLocalAssetUrl(dom, relativePath, v.timestamp || Date.now());
    };
    stagepassObj.env = () => detectRuntimeEnv(hostname, dom, stagingHosts);
    stagepassObj.is = (name) => stagepassObj.env() === name;
    stagepassObj.can = (capability) => canCapability(ensureClient(), capability);
    stagepassObj.client = (key) => {
      const c = ensureClient();
      if (key == null || key === "") return c;
      return c[key];
    };
    stagepassObj.on = (event, fn) => {
      if (event !== "theme" && event !== "session") {
        return () => {
        };
      }
      const set = listeners[event];
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    };
    stagepassObj.use = (name, version, factory) => registry.use(name, version, factory, stagepassObj);
    window.stagepass = stagepassObj;
    globalThis.stagepass = stagepassObj;
    window.sp = stagepassObj;
    globalThis.sp = stagepassObj;
    if (aliasName && isValidJsIdentifier(aliasName) && aliasName !== "sp" && aliasName !== "stagepass") {
      if (isGlobalFree(window, aliasName)) {
        window[aliasName] = stagepassObj;
      }
      if (isGlobalFree(globalThis, aliasName)) {
        globalThis[aliasName] = stagepassObj;
      }
    }
    emit("session", {
      active: hasActiveSession,
      domain: sv,
      swap,
      debug: sv === "debug"
    });
    let lnaState = "unknown";
    let lnaHint = null;
    function resolveAssetUrl(el, productionSrc, localPath) {
      if (swap && localPath && dom) {
        return buildLocalAssetUrl(dom, localPath, cacheBust);
      }
      const perAssetVersion = el.getAttribute("data-stagepass-v");
      const version = perAssetVersion || loaderVersionAttr;
      if (version) {
        return appendQueryParam(productionSrc, "v", version);
      }
      return productionSrc;
    }
    function extractLocalFilename(ps) {
      try {
        const urlObj = new URL(ps);
        const pathParts = urlObj.pathname.split("/");
        return pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || null;
      } catch (e) {
        const match = ps.match(/\/([^\/\?#]+)(?:\?|#|$)/);
        return match ? match[1] : null;
      }
    }
    function swapEl(sel, pathAttr, srcAttr, type, skipAttrs, seenLocalNames) {
      document.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el) => {
        try {
          el.setAttribute("data-stagepass-processed", "true");
          let lp = el.getAttribute(pathAttr);
          const hadExplicitPath = !!lp;
          const ps = el.getAttribute(srcAttr);
          if (!ps) return;
          if (!lp && ps && swap && dom) {
            lp = extractLocalFilename(ps);
          }
          if (swap && lp && !hadExplicitPath && hasActiveSession) {
            const key = lp;
            const count = (seenLocalNames.get(key) || 0) + 1;
            seenLocalNames.set(key, count);
            if (count === 2) {
              spWarn(
                `Multiple assets resolve to local file "${key}" without data-stagepass-path. Set unique paths to avoid collisions.`
              );
            }
          }
          const url = resolveAssetUrl(el, ps, lp);
          if (!url) return;
          const n = document.createElement(type);
          if (type === "script") {
            n.src = url;
            Array.from(el.attributes).forEach((a) => {
              const attr = a;
              if (!skipAttrs.includes(attr.name)) n.setAttribute(attr.name, attr.value);
            });
            applyScriptLoadOrder(n, el);
          } else {
            n.rel = "stylesheet";
            n.href = url;
            Array.from(el.attributes).forEach((a) => {
              const attr = a;
              if (!skipAttrs.includes(attr.name)) n.setAttribute(attr.name, attr.value);
            });
          }
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
        const seenLocalNames = /* @__PURE__ */ new Map();
        swapEl(
          "script[data-stagepass]",
          "data-stagepass-path",
          "data-src",
          "script",
          [
            "data-src",
            "data-stagepass",
            "data-stagepass-path",
            "data-stagepass-cachebust",
            "data-stagepass-v"
          ],
          seenLocalNames
        );
        swapEl(
          'link[rel="stylesheet"][data-stagepass]',
          "data-stagepass-path",
          "data-href",
          "link",
          [
            "href",
            "data-href",
            "data-stagepass",
            "data-stagepass-path",
            "data-stagepass-cachebust",
            "data-stagepass-v"
          ],
          seenLocalNames
        );
      } catch (_) {
      }
    };
    function updateFlagText(flag2) {
      let text = sv === "debug" ? "STAGEPASS DEBUG" : "STAGEPASS ACTIVE";
      if (lnaHint) {
        text = sv === "debug" ? "STAGEPASS DEBUG \xB7 LNA" : "STAGEPASS \xB7 ALLOW LOCAL NETWORK";
      }
      flag2.textContent = text;
      if (lnaHint) {
        flag2.title = lnaHint;
      }
    }
    function flag() {
      if (!dev) return;
      try {
        const f = document.createElement("div");
        f.id = "stagepass-flag";
        updateFlagText(f);
        f.style.cssText = 'font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-weight:bold;color:#fff;background:#D92662;padding:4px 6px;z-index:9999999999;position:fixed;top:0;right:0;cursor:pointer;border-radius:0 0 0 4px;user-select:none;';
        f.addEventListener("click", () => {
          clearSession();
          hasActiveSession = true;
          log("log", "\u{1F50C} Stagepass disconnected.");
          emit("session", { active: false, domain: null, swap: false, debug: false });
          window.location.reload();
        });
        const mount = () => {
          if (document.body) document.body.appendChild(f);
        };
        if (document.body) mount();
        else document.addEventListener("DOMContentLoaded", mount);
        stagepassObj.__flagEl = f;
      } catch (_) {
      }
    }
    async function maybeCheckLnaAndProcess() {
      if (swap) {
        try {
          lnaState = await queryLoopbackPermission();
          lnaHint = lnaHintMessage(lnaState);
          if (lnaHint) {
            spWarn(lnaHint);
            const flagEl = stagepassObj.__flagEl;
            if (flagEl) updateFlagText(flagEl);
          }
        } catch (_) {
          lnaState = "unknown";
          lnaHint = null;
        }
      }
      process();
    }
    void maybeCheckLnaAndProcess();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        void maybeCheckLnaAndProcess();
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", flag);
    } else {
      flag();
    }
  })();
})();
