/*
 * Resection — kameraposition + riktning ur kända flaggpositioner.
 *
 * Koordinatkonvention (matchar surveyOffset i övriga filer):
 *   +X = öst, −Z = norr, +Y = upp.  heading θ = grader CW från norr.
 *   dir(θ) = enhetsvektor i XZ:  { x: sin θ,  z: −cos θ }
 *     θ=0 → (0,−1) norr;  θ=90 → (1,0) öst.
 *
 * En flagga i bilden ger:
 *   - pixel-bäring  b = atan2(centroidX − cx, focalPx)   (rad, + = höger i bild)
 *   - avstånd       r = realWidth · focalPx / pixelWidth  (skenbar storlek)
 * Flaggans världsläge P och kameran C relaterar via:
 *   P = C + r · dir(θ + b)   ⇒   C = P − r · dir(θ + b)
 *
 * ≥2 flaggor: för en hypotetisk θ ger varje flagga en kameraposition C_i(θ).
 * Rätt θ är den som gör alla C_i sammanfallande → minimera spridningen.
 * Heading faller alltså ut ur geometrin — ingen kompass behövs.
 *
 * Flagg-objekt in:  { x, z, centroidX, pixelWidth, realWidth }
 * Params:           focalPx, cx (bildmittens x-pixel)
 */
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;

  function norm360(d) { return ((d % 360) + 360) % 360; }

  /* Kamera→flagga-vektor för heading θ (grader): C_i = P − r·dir(θ+b) */
  function camPosFor(flag, thetaDeg, focalPx) {
    var bDeg = Math.atan2(flag.centroidX - flag.cx, focalPx) / DEG;
    var a = (thetaDeg + bDeg) * DEG;
    var r = flag.realWidth * focalPx / flag.pixelWidth;
    return { x: flag.x - r * Math.sin(a), z: flag.z + r * Math.cos(a) };
  }

  function meanAndSpread(points) {
    var n = points.length, mx = 0, mz = 0, i;
    for (i = 0; i < n; i++) { mx += points[i].x; mz += points[i].z; }
    mx /= n; mz /= n;
    var spread = 0;
    for (i = 0; i < n; i++) {
      var dx = points[i].x - mx, dz = points[i].z - mz;
      spread += dx * dx + dz * dz;
    }
    return { pos: { x: mx, z: mz }, spread: Math.sqrt(spread / n) };
  }

  var Resection = {

    /* Brännvidd ur en känd markör (clown-scan): bredd-px på känt avstånd. */
    calibrateFocal: function (pixelWidth, distanceM, realWidthM) {
      return pixelWidth * distanceM / realWidthM;
    },

    /*
     * ≥2 flaggor → { pos:{x,z}, heading, spread, n }.
     * spread = RMS-avstånd mellan flaggornas positions-estimat (m); litet = bra fix.
     * Outlier-policy: mjuk — medelvärde över alla (beslutat med användaren).
     */
    solve2plus: function (flags, focalPx, cx) {
      flags = flags.map(function (f) {
        return { x: f.x, z: f.z, centroidX: f.centroidX, cx: cx,
                 pixelWidth: f.pixelWidth, realWidth: f.realWidth };
      });

      function spreadAt(theta) {
        var pts = flags.map(function (f) { return camPosFor(f, theta, focalPx); });
        return meanAndSpread(pts).spread;
      }

      /* Grov svep 0–359°, sedan förfining ±1° i 0.05°-steg */
      var best = 0, bestS = Infinity, t;
      for (t = 0; t < 360; t += 1) {
        var s = spreadAt(t);
        if (s < bestS) { bestS = s; best = t; }
      }
      for (t = best - 1; t <= best + 1; t += 0.05) {
        var s2 = spreadAt(t);
        if (s2 < bestS) { bestS = s2; best = t; }
      }

      var pts = flags.map(function (f) { return camPosFor(f, best, focalPx); });
      var ms = meanAndSpread(pts);
      return { pos: ms.pos, heading: norm360(best), spread: ms.spread, n: flags.length };
    },

    /*
     * 1 flagga → { pos } med heading från gyro (riktning kan ej lösas geometriskt).
     * Position robust mot flaggsvaj (använder centroid + storlek, ej orientering).
     */
    solve1: function (flag, focalPx, cx, headingGyroDeg) {
      var f = { x: flag.x, z: flag.z, centroidX: flag.centroidX, cx: cx,
                pixelWidth: flag.pixelWidth, realWidth: flag.realWidth };
      return { pos: camPosFor(f, headingGyroDeg, focalPx), heading: norm360(headingGyroDeg) };
    }
  };

  root.Resection = Resection;
  if (typeof module !== 'undefined' && module.exports) module.exports = Resection;

})(typeof window !== 'undefined' ? window : globalThis);
