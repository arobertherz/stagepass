var Stagepass = (() => {
  // src/index.ts
  (function() {
    const K = "stagepass_domain";
    const P = "stagepass";
    const p = new URLSearchParams(window.location.search);
    const svCheck = localStorage.getItem(K);
    if (!svCheck && !p.has(P)) {
      const noop = () => {
      };
      console.log = noop;
      console.warn = noop;
      console.error = noop;
      console.info = noop;
      console.debug = noop;
    }
    function log(level, ...args) {
      var _a;
      const v = localStorage.getItem(K);
      if (!v || v !== "debug" && !v) return;
      const t = (/* @__PURE__ */ new Date()).toTimeString().split(" ")[0];
      let c = "unknown";
      try {
        const s = (_a = new Error().stack) == null ? void 0 : _a.split("\n");
        if (s) {
          const l = s.find((x, i) => i > 2 && !x.includes("log"));
          if (l) {
            const m = l.match(/(\/?([^\/\?:]+))(\?[^\s)]*)?:([0-9]+):[0-9]+/);
            if (m) c = `${m[2]}:${m[4]}`;
          }
        }
      } catch (e) {
      }
      const pre = `[\u{1F3AB} ${t} \u{1F4CD} ${c}]`;
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
    function clean(d) {
      return d ? d.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
    }
    function isValidDomain(d) {
      return d === "debug" || d.endsWith(".sp") || d === "localhost" || d.startsWith("localhost:");
    }
    let paramProcessed = false;
    if (p.has(P)) {
      const v = p.get(P);
      if (v === "off" || v === "0" || v === "false") {
        localStorage.removeItem(K);
        splog("\u{1F50C} Stagepass disconnected.");
      } else if (v) {
        const c = v === "debug" ? "debug" : clean(v);
        if (c && isValidDomain(c)) {
          localStorage.setItem(K, c);
          splog(c === "debug" ? "\u{1F50D} Stagepass debug mode enabled." : `\u{1F50C} Stagepass connected to: ${c}`);
          paramProcessed = true;
        } else if (c && !isValidDomain(c)) {
          spwarn(`Invalid domain: ${c}. Only .sp domains are allowed.`);
        }
      }
      p.delete(P);
      const s = p.toString();
      window.history.replaceState({}, "", window.location.pathname + (s ? `?${s}` : "") + window.location.hash);
    }
    let sv = localStorage.getItem(K);
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
    function swapEl(sel, pathAttr, srcAttr, type, skipAttrs) {
      const els = document.querySelectorAll(`${sel}:not([data-stagepass-processed])`);
      els.forEach((el) => {
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
        let url = "";
        if (swap && lp && dom) {
          const cp = lp.startsWith("/") ? lp.substring(1) : lp;
          url = `https://${dom}/${cp}`;
        } else if (ps) {
          url = ps;
        }
        if (url) {
          const n = document.createElement(type);
          if (type === "script") {
            n.src = url;
            Array.from(el.attributes).forEach((a) => {
              const attr = a;
              if (!skipAttrs.includes(attr.name)) n.setAttribute(attr.name, attr.value);
            });
            if (!el.hasAttribute("async") && !el.hasAttribute("defer")) {
              n.setAttribute("defer", "");
            }
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
        }
      });
    }
    function process() {
      swapEl("script[data-stagepass]", "data-stagepass-path", "data-src", "script", ["data-src", "data-stagepass", "data-stagepass-path"]);
      swapEl('link[rel="stylesheet"][data-stagepass]', "data-stagepass-path", "data-href", "link", ["href", "data-href", "data-stagepass", "data-stagepass-path"]);
    }
    process();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", process);
    }
    function flag() {
      if (!dev) return;
      const f = document.createElement("div");
      f.id = "stagepass-flag";
      f.textContent = sv === "debug" ? "STAGEPASS DEBUG" : "STAGEPASS ACTIVE";
      f.style.cssText = `font-size: 12px; line-height: 1; font-weight: bold; color: #fff; background-color: #D92662; padding: 4px 6px; z-index: 9999999999; position: fixed; top: 0; right: 0; cursor: pointer; border-radius: 0 0 0 4px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; user-select: none;`;
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
