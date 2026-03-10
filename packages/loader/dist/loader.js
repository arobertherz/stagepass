var Stagepass = (() => {
  // src/index.ts
  (function() {
    const K = "stagepass_domain";
    const P = "stagepass";
    const isValidDomain = (d) => d === "debug" || d.endsWith(".sp") || d === "localhost" || d.startsWith("localhost:");
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
    function log(level, ...args) {
      const v = localStorage.getItem(K);
      if (!v) return;
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
    }
    const splog = (...args) => log("log", ...args);
    const spwarn = (...args) => log("warn", ...args);
    const sperror = (...args) => log("error", ...args);
    window.splog = splog;
    window.spwarn = spwarn;
    window.sperror = sperror;
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
    const clean = (d) => d ? d.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
    let paramProcessed = false;
    let sv = localStorage.getItem(K);
    if (p.has(P)) {
      const v = p.get(P);
      if (v === "off" || v === "0" || v === "false") {
        localStorage.removeItem(K);
        sv = null;
        splog("\u{1F50C} Stagepass disconnected.");
      } else if (v) {
        const c = v === "debug" ? "debug" : clean(v);
        if (c && isValidDomain(c)) {
          localStorage.setItem(K, c);
          sv = c;
          splog(c === "debug" ? "\u{1F50D} Stagepass debug mode enabled." : `\u{1F50C} Stagepass connected to: ${c}`);
          paramProcessed = true;
        } else if (c) {
          spwarn(`Invalid domain: ${c}. Only .sp domains are allowed.`);
        }
      }
      p.delete(P);
      const s = p.toString();
      window.history.replaceState({}, "", window.location.pathname + (s ? `?${s}` : "") + window.location.hash);
    }
    if (sv && !isValidDomain(sv)) {
      localStorage.removeItem(K);
      sv = null;
    }
    if (sv && !paramProcessed && sv !== "debug") {
      splog(`\u{1F50C} Stagepass connected to: ${sv}`);
    }
    const dev = !!sv;
    const swap = !!sv && sv !== "debug";
    const dom = swap ? clean(sv) : null;
    const now = swap ? Date.now() : 0;
    const cacheBust = now;
    const sessionStartTime = now;
    const hostname = window.location.hostname;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("localhost:") || hostname.startsWith("127.0.0.1:");
    const isLocal = swap || isLocalhost;
    const env = isLocal ? "local" : hostname.endsWith(".webflow.io") ? "staging" : "production";
    const hasValidSession = sv && isValidDomain(sv);
    const shouldSuppress = !hasValidSession && !p.has(P);
    if (shouldSuppress && env === "production") {
      const noop = () => {
      };
      console.log = console.warn = console.error = console.info = console.debug = noop;
    }
    const stagepassObj = window.stagepass || {};
    stagepassObj.vars = Object.freeze({
      isLocal,
      env,
      domain: dom || hostname,
      timestamp: sessionStartTime,
      version: "1.1.4"
    });
    stagepassObj.log = spLog;
    stagepassObj.warn = spWarn;
    stagepassObj.error = spError;
    stagepassObj.resolveLocalUrl = (relativePath) => {
      const v = stagepassObj.vars;
      if (!v.isLocal || !v.domain) return "";
      const clean2 = relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
      return clean2 ? `https://${v.domain}/${clean2}?_cb=${v.timestamp}` : "";
    };
    window.stagepass = stagepassObj;
    globalThis.stagepass = stagepassObj;
    window.sp = stagepassObj;
    globalThis.sp = stagepassObj;
    function swapEl(sel, pathAttr, srcAttr, type, skipAttrs) {
      document.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el) => {
        el.setAttribute("data-stagepass-processed", "true");
        let lp = el.getAttribute(pathAttr);
        const ps = el.getAttribute(srcAttr);
        if (!ps) return;
        if (!lp && ps && swap && dom) {
          try {
            const urlObj = new URL(ps);
            const pathParts = urlObj.pathname.split("/");
            lp = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
          } catch (e) {
            const match = ps.match(/\/([^\/\?#]+)(?:\?|#|$)/);
            if (match) lp = match[1];
          }
        }
        let url;
        if (swap && lp && dom) {
          url = `https://${dom}/${lp.startsWith("/") ? lp.substring(1) : lp}?_cb=${cacheBust}`;
        } else if (el.getAttribute("data-stagepass-cachebust") === "true") {
          url = ps + (ps.includes("?") ? "&" : "?") + "_cb=" + Date.now();
        } else {
          url = ps;
        }
        if (!url) return;
        const n = document.createElement(type);
        if (type === "script") {
          n.src = url;
          Array.from(el.attributes).forEach((a) => {
            const attr = a;
            if (!skipAttrs.includes(attr.name)) n.setAttribute(attr.name, attr.value);
          });
          if (!el.hasAttribute("async") && !el.hasAttribute("defer")) n.setAttribute("defer", "");
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
          sperror(`${type} injection failed: No parent node`);
        }
      });
    }
    const process = () => {
      swapEl("script[data-stagepass]", "data-stagepass-path", "data-src", "script", ["data-src", "data-stagepass", "data-stagepass-path", "data-stagepass-cachebust"]);
      swapEl('link[rel="stylesheet"][data-stagepass]', "data-stagepass-path", "data-href", "link", ["href", "data-href", "data-stagepass", "data-stagepass-path", "data-stagepass-cachebust"]);
    };
    process();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", process);
    }
    function flag() {
      if (!dev) return;
      const f = document.createElement("div");
      f.id = "stagepass-flag";
      f.textContent = sv === "debug" ? "STAGEPASS DEBUG" : "STAGEPASS ACTIVE";
      f.style.cssText = 'font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-weight:bold;color:#fff;background:#D92662;padding:4px 6px;z-index:9999999999;position:fixed;top:0;right:0;cursor:pointer;border-radius:0 0 0 4px;user-select:none;';
      f.addEventListener("click", () => {
        localStorage.removeItem(K);
        splog("\u{1F50C} Stagepass disconnected.");
        window.location.reload();
      });
      if (document.body) {
        document.body.appendChild(f);
      } else {
        document.addEventListener("DOMContentLoaded", () => {
          if (document.body) document.body.appendChild(f);
        });
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", flag);
    } else {
      flag();
    }
  })();
})();
