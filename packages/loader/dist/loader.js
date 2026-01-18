var Stagepass = (() => {
  // src/index.ts
  (function() {
    const SESSION_KEY = "stagepass_domain";
    const QUERY_PARAM = "stagepass";
    const params = new URLSearchParams(window.location.search);
    if (params.has(QUERY_PARAM)) {
      const val = params.get(QUERY_PARAM);
      if (val === "off" || val === "0" || val === "false") {
        sessionStorage.removeItem(SESSION_KEY);
        console.log("\u{1F50C} Stagepass disconnected.");
      } else if (val) {
        sessionStorage.setItem(SESSION_KEY, val);
        console.log(`\u{1F50C} Stagepass connected to: ${val}`);
      }
    }
    const localDomain = sessionStorage.getItem(SESSION_KEY);
    const isDev = !!localDomain;
    const scripts = document.querySelectorAll("script[data-stagepass]");
    scripts.forEach((script) => {
      var _a;
      const localPath = script.getAttribute("data-stagepass-path");
      const productionSrc = script.getAttribute("data-src");
      if (!localPath && !productionSrc) return;
      let finalSrc = "";
      if (isDev && localPath) {
        const cleanPath = localPath.startsWith("/") ? localPath.substring(1) : localPath;
        finalSrc = `https://${localDomain}/${cleanPath}`;
        console.groupCollapsed("\u{1F680} Stagepass Active");
        console.log("Source:", finalSrc);
        console.log("Production (skipped):", productionSrc);
        console.groupEnd();
      } else if (productionSrc) {
        finalSrc = productionSrc;
      }
      if (finalSrc) {
        const newScript = document.createElement("script");
        newScript.src = finalSrc;
        newScript.async = true;
        Array.from(script.attributes).forEach((attr) => {
          if (!["data-src", "data-stagepass", "data-stagepass-path"].includes(attr.name)) {
            newScript.setAttribute(attr.name, attr.value);
          }
        });
        (_a = script.parentNode) == null ? void 0 : _a.insertBefore(newScript, script);
      }
    });
  })();
})();
