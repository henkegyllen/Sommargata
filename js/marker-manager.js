/**
 * marker-manager.js
 * Lyssnar på AR.js markerFound/markerLost-händelser för varje station
 * och meddelar UIController om vad som är synligt.
 */
var MarkerManager = (function () {
  var _activeMarkers = new Set();

  /**
   * Kopplar händelselyssnare till alla station-markörelement.
   * Anropas av scene-builder.js efter att DOM-elementen skapats.
   */
  function init(stations) {
    stations.forEach(function (station) {
      var el = document.getElementById(station.id);
      if (!el) return;

      el.addEventListener('markerFound', function () {
        _activeMarkers.add(station.id);
        UIController.showStation(station);
      });

      el.addEventListener('markerLost', function () {
        _activeMarkers.delete(station.id);
        // Om inga markörer längre är synliga, återgå till neutralt läge
        if (_activeMarkers.size === 0) {
          UIController.hideStation();
        }
      });
    });
  }

  return { init: init };
})();
