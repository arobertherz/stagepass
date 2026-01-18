// Stagepass Client Loader
// Logic: Checks for ?stagepass= param, saves to SessionStorage, and swaps scripts.

(function () {
  const SESSION_KEY = 'stagepass_domain';
  const QUERY_PARAM = 'stagepass';
  
  // 1. URL Parameter prüfen (Aktivieren/Deaktivieren)
  const params = new URLSearchParams(window.location.search);
  if (params.has(QUERY_PARAM)) {
    const val = params.get(QUERY_PARAM);
    if (val === 'off' || val === '0' || val === 'false') {
      sessionStorage.removeItem(SESSION_KEY);
      console.log('🔌 Stagepass disconnected.');
    } else if (val) {
      sessionStorage.setItem(SESSION_KEY, val);
      console.log(`🔌 Stagepass connected to: ${val}`);
    }
  }

  // 2. Aktiven Modus prüfen
  const localDomain = sessionStorage.getItem(SESSION_KEY);
  const isDev = !!localDomain;

  // 3. Alle Stagepass-Skripte finden
  // Wir suchen nach Scripts, die das Attribut 'data-stagepass' haben
  const scripts = document.querySelectorAll('script[data-stagepass]');

  scripts.forEach((script) => {
    const localPath = script.getAttribute('data-stagepass-path');
    const productionSrc = script.getAttribute('data-src');

    // Sicherheitscheck
    if (!localPath && !productionSrc) return;

    let finalSrc = '';

    if (isDev && localPath) {
      // DEV MODE: Baue lokale URL (https://mein-projekt.sp/js/app.js)
      // Wir entfernen führende Slashes, um doppelte zu vermeiden
      const cleanPath = localPath.startsWith('/') ? localPath.substring(1) : localPath;
      finalSrc = `https://${localDomain}/${cleanPath}`;
      
      console.groupCollapsed('🚀 Stagepass Active');
      console.log('Source:', finalSrc);
      console.log('Production (skipped):', productionSrc);
      console.groupEnd();
    } else if (productionSrc) {
      // PROD MODE: Nutze das normale CDN
      finalSrc = productionSrc;
    }

    // 4. Skript injizieren
    if (finalSrc) {
      const newScript = document.createElement('script');
      newScript.src = finalSrc;
      newScript.async = true; // Oder false, je nach Bedarf
      
      // Attribute kopieren (z.B. type="module" oder defer)
      Array.from(script.attributes).forEach(attr => {
        if (!['data-src', 'data-stagepass', 'data-stagepass-path'].includes(attr.name)) {
          newScript.setAttribute(attr.name, attr.value);
        }
      });

      // Altes Script ersetzen oder anhängen
      script.parentNode?.insertBefore(newScript, script);
      // Optional: Das alte Platzhalter-Script entfernen, um DOM sauber zu halten
      // script.remove(); 
    }
  });
})();