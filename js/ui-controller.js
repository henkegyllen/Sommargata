/**
 * ui-controller.js
 * Hanterar alla UI-tillstånd i AR-vyn:
 *  - Laddningsstatus
 *  - Stationsvisning (markerFound)
 *  - Neutralt läge (markerLost)
 *  - Nudge (ingen markör hittad på 15 sek)
 *  - Felvisning (kamera nekad, config-fel)
 */
var UIController = (function () {
  var _noMarkerTimer = null;
  var _config = null;
  var NUDGE_DELAY_MS = 15000;

  // Initiera med event-konfiguration
  document.addEventListener('ar-config-loaded', function (e) {
    _config = e.detail;
    var statusEl = document.getElementById('status-text');
    if (statusEl && _config.event) {
      statusEl.textContent = _config.event.instructionsText || 'Peka kameran mot markören...';
    }
    _startNoMarkerTimer();
  });

  function showStation(station) {
    _clearNoMarkerTimer();
    var nameEl = document.getElementById('station-name');
    var statusEl = document.getElementById('status-text');
    var info = document.getElementById('station-info');

    if (nameEl) nameEl.textContent = station.name;
    if (statusEl) statusEl.textContent = station.name;
    if (info) info.classList.remove('hidden');
  }

  function hideStation() {
    var info = document.getElementById('station-info');
    var statusEl = document.getElementById('status-text');

    if (info) info.classList.add('hidden');
    if (statusEl && _config && _config.event) {
      statusEl.textContent = _config.event.noMarkerText || 'Peka kameran mot markörbilden...';
    }
    _startNoMarkerTimer();
  }

  function showError(message) {
    var overlay = document.getElementById('error-overlay');
    var msg = document.getElementById('error-message');

    // Lägg till plattformsspecifik kamera-hjälptext
    var fullMessage = message;
    if (message.toLowerCase().includes('kamera') || message.toLowerCase().includes('camera')) {
      var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIOS) {
        fullMessage += '\n\niOS: Inställningar → Safari → Kamera → Tillåt';
      } else {
        fullMessage += '\n\nAndroid: Tryck på lås-ikonen i adressfältet och tillåt kamera.';
      }
    }

    if (msg) msg.textContent = fullMessage;
    if (overlay) overlay.classList.remove('hidden');
  }

  function _startNoMarkerTimer() {
    _clearNoMarkerTimer();
    _noMarkerTimer = setTimeout(function () {
      var nudge = document.getElementById('nudge-overlay');
      if (nudge) nudge.classList.remove('hidden');
    }, NUDGE_DELAY_MS);
  }

  function _clearNoMarkerTimer() {
    if (_noMarkerTimer) {
      clearTimeout(_noMarkerTimer);
      _noMarkerTimer = null;
    }
    var nudge = document.getElementById('nudge-overlay');
    if (nudge) nudge.classList.add('hidden');
  }

  return {
    showStation: showStation,
    hideStation: hideStation,
    showError: showError
  };
})();
