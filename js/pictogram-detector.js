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

  /* Referensrelativ färgkalibrering (Metod F): sätts från clown-scan / tap /
     löpande omsampling. När satt klassas pixlar via avstånd till referens-
     färgerna (ljustålig) istället för absoluta RGB-heuristiker. */
  var refMag = null, refYel = null, calibTol2 = 0;
  function sq(v) { return v * v; }

  /* ── Färgklassificering (belysningstolerant via kanalrelationer) ──
     Gul  RGB(249,225,128): B lägst, R≈G höga.
     Magenta RGB(179,58,132): G lägst, R högst. */
  function isMagenta(r, g, b) {
    return (r - g) > 35 && (b - g) > 16;
  }
  function isYellow(r, g, b) {
    return (r - b) > 28 && (g - b) > 16 && Math.abs(r - g) < 70;
  }
  /* Fälttest 2026-06-04: flaggornas ljusgula bakgrund blir nästan VIT
     i dagsljus/motljus — kanalskillnaderna försvinner. Ljusa lågmättade
     ytor räknas därför också som flaggyta. Falska fyrkanter (väggar,
     skyltar) stoppas av magenta-andelsvakten i matchningen. */
  function isPale(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mn > 110 && (mx - mn) < 55;
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

  /* Live-klassificering: 0=bakgrund, 1=magenta, 2=gul/yta.
     Kalibrerad → närmaste-referens inom tolerans (ljustålig). Annars heuristik. */
  function classifyLive(r, g, b) {
    if (refMag) {
      var dM = sq(r - refMag.r) + sq(g - refMag.g) + sq(b - refMag.b);
      var dY = sq(r - refYel.r) + sq(g - refYel.g) + sq(b - refYel.b);
      if (Math.min(dM, dY) > calibTol2) return 0;
      return dM < dY ? 1 : 2;
    }
    if (isMagenta(r, g, b)) return 1;
    if (isYellow(r, g, b) || isPale(r, g, b)) return 2;
    return 0;
  }

  /* Bygger båda kanalerna i ett svep över pixeldatat */
  function buildChannels(imageData) {
    var src = imageData.data;
    var n   = imageData.width * imageData.height;
    var m   = maskImg.data, q = magImg.data;
    for (var i = 0; i < n; i++) {
      var c = classifyLive(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
      m[i] = c !== 0 ? 255 : 0;
      q[i] = c === 1 ? 255 : 0;
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
    var magCount = 0;
    for (var i = 0; i < GRID * GRID; i++) {
      bits[i] = isMagenta(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) ? 1 : 0;
      magCount += bits[i];
    }
    var rots = [bits];
    for (var r = 1; r < 4; r++) rots.push(rotate90(rots[r - 1]));
    templates.push({ name: name, rots: rots, magFrac: magCount / (GRID * GRID) });
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
        var magCount = 0;
        for (var p = 0; p < GRID * GRID; p++) {
          bits[p] = warped.data[p] > 127 ? 1 : 0;
          magCount += bits[p];
        }
        var detFrac = magCount / (GRID * GRID);

        /* Jämför mot alla mallar × 4 rotationer (rotera detekterade bitarna) */
        var best = null, second = 0;
        var rotBits = [bits];
        for (var r = 1; r < 4; r++) rotBits.push(rotate90(rotBits[r - 1]));

        for (var t = 0; t < templates.length; t++) {
          /* Magenta-andelsvakt: en vit fyrkant utan piktogram kan annars
             nå hög "agreement" mot en gles mall. Andelen magenta måste
             ligga nära mallens. */
          if (Math.abs(detFrac - templates[t].magFrac) > 0.18) continue;
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
          /* Centroid + skenbar storlek (medel-kantlängd px) för resektion */
          var cxp = 0, cyp = 0, k;
          for (k = 0; k < 4; k++) { cxp += aligned[k].x; cyp += aligned[k].y; }
          cxp /= 4; cyp /= 4;
          var edge = 0;
          for (k = 0; k < 4; k++) {
            var p1 = aligned[k], p2 = aligned[(k + 1) % 4];
            edge += Math.sqrt(sq(p2.x - p1.x) + sq(p2.y - p1.y));
          }
          results.push({
            name: best.name, corners: aligned,
            centroid: { x: cxp, y: cyp }, size: edge / 4,
            score: best.score, rotation: best.rotation
          });
        }
      }

      results.sort(function (a, b) { return b.score - a.score; });
      return results;
    },

    /*
     * Sampla färgerna i en region (px-mitt + radie) ur en ImageData.
     * Bucketar pixlarna i magenta vs gul/yta (via nuvarande klassificering)
     * och returnerar medelfärgerna. Används av clown-scan, tap-to-sample och
     * löpande omsampling. → { ok, magenta:{r,g,b}, yellow:{r,g,b} }
     */
    sampleRegion: function (imageData, px, py, radius) {
      var w = imageData.width, h = imageData.height, src = imageData.data;
      var x0 = Math.max(0, (px - radius) | 0), x1 = Math.min(w - 1, (px + radius) | 0);
      var y0 = Math.max(0, (py - radius) | 0), y1 = Math.min(h - 1, (py + radius) | 0);
      var mR = 0, mG = 0, mB = 0, mN = 0, yR = 0, yG = 0, yB = 0, yN = 0;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var i = (y * w + x) * 4, r = src[i], g = src[i + 1], b = src[i + 2];
          var c = classifyLive(r, g, b);
          if (c === 1) { mR += r; mG += g; mB += b; mN++; }
          else if (c === 2) { yR += r; yG += g; yB += b; yN++; }
        }
      }
      if (mN < 8 || yN < 8) return { ok: false };
      return { ok: true,
        magenta: { r: mR / mN, g: mG / mN, b: mB / mN },
        yellow:  { r: yR / yN, g: yG / yN, b: yB / yN } };
    },

    /* Lås referensfärger (från sampleRegion-resultat). Toleransen sätts till
       60 % av avståndet mellan referenserna → pixlar nära endera = flaggyta. */
    calibrate: function (sample) {
      if (!sample || !sample.ok) return false;
      refMag = sample.magenta; refYel = sample.yellow;
      var d2 = sq(refMag.r - refYel.r) + sq(refMag.g - refYel.g) + sq(refMag.b - refYel.b);
      calibTol2 = sq(0.6) * d2;
      return true;
    },

    isCalibrated: function () { return refMag !== null; },
    getCalibration: function () { return refMag ? { magenta: refMag, yellow: refYel } : null; }
  };

})();
