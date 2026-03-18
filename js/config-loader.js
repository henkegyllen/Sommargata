/**
 * config-loader.js
 * Hämtar config.json och skickar ut ett custom event när det är klart.
 * scene-builder.js lyssnar på 'ar-config-loaded'.
 */
(function () {
  async function loadConfig() {
    try {
      const response = await fetch('config.json');
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' – kunde inte hämta config.json');
      }
      const config = await response.json();
      window.arConfig = config;
      document.dispatchEvent(new CustomEvent('ar-config-loaded', { detail: config }));
    } catch (err) {
      document.dispatchEvent(new CustomEvent('ar-config-error', { detail: err.message }));
    }
  }

  loadConfig();
})();
