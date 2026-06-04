/*
 * PD — PictogramDetector
 *
 * Detekterar Sommargatans skyltar (magenta piktogram på ljusgul kvadrat,
 * 50x50 cm) i en kamerabild och identifierar VILKEN skylt det är genom
 * mallmatchning mot PNG-filerna i assets/markers/.
 *
 * Återanvänder js-aruco2:s CV-modul (konturer, polygonapproximation,
 * perspektiv-warp) men ersätter ArUco-avkodningen med:
 *   1. Färgmask: gul ∪ magenta = skyltytan → solid fyrkantsblob
 *   2. Fyrkantskandidater via CV.findContours + approxPolyDP
 *   3. Warpa magenta-kanalen ur kandidaten → jämför mot mallarna (4 rotationer)
 *
 * Kräver att cv.js och aruco.js är laddade först (CV- och AR-namespacen).
 *
 * API:
 *   PD.load(defs, onReady)   defs = [{name:'Bild_11.png', url:'assets/...'}]
 *   PD.detect(imageData)     → [{name, corners, score, rotation}]
 *     corners är i bildkoordinater, ordnade så corners[0] = skyltens
 *     övre vänstra hörn (samma orientering som mallen).
 */
var PD = (function () {

  var GRID       = 32;     /* mall-/warpupplösning (celler per sida) */
  var MATCH_MIN  = 0.78;   /* minsta andel matchande celler för träff */
  var MARGIN_MIN = 0.04;   /* krav på marginal till näst bästa mall */

  var templates = [];      /* {name, rots: [4 x Uint8Array(GRID*GRID)]} */
  var helper    = null;    /* AR.Detector-instans för prototypmetoderna */
  var maskImg   = null;    /* CV.Image: skyltmask (0/255) */
  var magImg    = null;    /* CV.Image: magenta-kanal (0/255) */
  var warped    = null;    /* CV.Image: warpad kandidat */
  var binary    = [];      /* återanvänd buffert för findContours */

  /* ── Färgklassificering (belysningstolerant via kanalrelationer) ──
     Gul  RGB(249,225,128): B lägst, R≈G höga.
     Magenta RGB(179,58,132): G lägst, R högst. */
  function isMagenta(r, g, b) {
    return (r - g) > 35 && (b - g) > 16;
  }
  function isYellow(r, g, b) {
    /* Mjuka trösklar: flaggorna hänger ofta i motljus mot himlen
       (urtvättade färger). Mallmatchningen skyddar mot falska träffar. */
    return (r - b) > 28 && (g - b) > 16 && Math.abs(r - g) < 70;
  }

  function ensureBuffers(w, h) {
    var n = w * h;
    if (!maskImg) {
      maskImg = new CV.Image(w, h, new Uint8ClampedArray(n));
      magImg  = new CV.Image(w, h, new Uint8ClampedArray(n));
      warped  = new CV.Image();
    } else if (maskImg.width !== w || maskImg.height !== h) {
      maskImg.width = w; maskImg.height = h; maskImg.data = new Uint8ClampedArray(n);
      magImg.width  = w; magImg.height  = h; magImg.data  = new Uint8ClampedArray(n);
    }
  }

  /* Bygger båda kanalerna i ett svep över pixeldatat */
  function buildChannels(imageData) {
    var src = imageData.data;
    var n   = imageData.width * imageData.height;
    var m   = maskImg.data, q = magImg.data;
    for (var i = 0; i < n; i++) {
      var r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
      var mag = isMagenta(r, g, b);
      m[i] = (mag || isYellow(r, g, b)) ? 255 : 0;
      q[i] = mag ? 255 : 0;
    }
  }

  /* 90° medurs rotation av flat GRID×GRID-bitarray */
  function rotate90(bits) {
    var out = new Uint8Array(GRID * GRID);
    for (var y = 0; y < GRID; y++)
      for (var x = 0; x < GRID; x++)
        out[x * GRID + (GRID - 1 - y)] = bits[y * GRID + x];
    return out;
  }

  function matchScore(a, b) {
    var same = 0, n = GRID * GRID;
    for (var i = 0; i < n; i++) if (a[i] === b[i]) same++;
    return same / n;
  }

  function buildTemplate(img, name) {
    var c = document.createElement('canvas');
    c.width = GRID; c.height = GRID;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, GRID, GRID);
    var d = ctx.getImageData(0, 0, GRID, GRID).data;
    var bits = new Uint8Array(GRID * GRID);
    for (var i = 0; i < GRID * GRID; i++) {
      bits[i] = isMagenta(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) ? 1 : 0;
    }
    var rots = [bits];
    for (var r = 1; r < 4; r++) rots.push(rotate90(rots[r - 1]));
    templates.push({ name: name, rots: rots });
  }

  return {

    /* Ladda mallbilder. onReady(err) anropas när alla är klara. */
    load: function (defs, onReady) {
      helper = new AR.Detector({ dictionaryName: 'ARUCO' }); /* enbart för prototypmetoderna */
      templates = [];
      var pending = defs.length, failed = null;
      defs.forEach(function (def) {
        var img = new Image();
        img.onload = function () {
          buildTemplate(img, def.name);
          if (--pending === 0) onReady(failed);
        };
        img.onerror = function () {
          failed = def.url + ' kunde inte laddas';
          if (--pending === 0) onReady(failed);
        };
        img.src = def.url;
      });
    },

    isReady: function () { return helper !== null && templates.length > 0; },

    /*
     * Detektera skyltar i en kamerabild (ImageData).
     * Returnerar lista av träffar sorterade på score (bäst först).
     */
    detect: function (imageData) {
      if (!helper || templates.length === 0) return [];
      var w = imageData.width, h = imageData.height;
      ensureBuffers(w, h);
      buildChannels(imageData);

      var contours   = CV.findContours(maskImg, binary);
      var candidates = helper.findCandidates(contours, w * 0.10, 0.05, 8);
      candidates     = helper.clockwiseCorners(candidates);
      candidates     = helper.notTooNear(candidates, 10);

      var results = [];
      for (var i = 0; i < candidates.length; i++) {
        var cand = candidates[i];
        CV.warp(magImg, warped, cand, GRID);

        /* Binarisera den warpade magenta-kanalen */
        var bits = new Uint8Array(GRID * GRID);
        for (var p = 0; p < GRID * GRID; p++) bits[p] = warped.data[p] > 127 ? 1 : 0;

        /* Jämför mot alla mallar × 4 rotationer (rotera detekterade bitarna) */
        var best = null, second = 0;
        var rotBits = [bits];
        for (var r = 1; r < 4; r++) rotBits.push(rotate90(rotBits[r - 1]));

        for (var t = 0; t < templates.length; t++) {
          for (var rr = 0; rr < 4; rr++) {
            var s = matchScore(rotBits[rr], templates[t].rots[0]);
            if (!best || s > best.score) {
              if (best) second = Math.max(second, best.score);
              best = { name: templates[t].name, score: s, rotation: rr };
            } else if (s > second) {
              second = s;
            }
          }
        }

        if (best && best.score >= MATCH_MIN && (best.score - second) >= MARGIN_MIN) {
          /* Rotera hörnordningen så corners[0] = mallens övre vänstra hörn */
          var aligned = helper.rotate2(cand, (4 - best.rotation) % 4);
          results.push({
            name: best.name, corners: aligned,
            score: best.score, rotation: best.rotation
          });
        }
      }

      results.sort(function (a, b) { return b.score - a.score; });
      return results;
    }
  };

})();
