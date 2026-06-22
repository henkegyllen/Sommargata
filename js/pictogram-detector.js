/*
 * PD — PictogramDetector
 *
 * Detekterar Sommargatans skyltar (magenta piktogram på ljusgul kvadrat,
 * 50x50 cm) i en kamerabild och identifierar VILKEN skylt det är genom
 * mallmatchning mot PNG-filerna i assets/markers/.
 *
 * DETEKTIONSSTRATEGI (omskriven 2026-06-22, "alt 2" / magenta-först):
 *   Fältfynd: att bygga skyltkvadraten ur en GUL färgmask fallerar — flaggans
 *   gula bakgrund smälter ihop med de omgivande GULA vimplarna → ingen ren
 *   fyrkant → igenkänning misslyckas även för stora, närliggande flaggor.
 *
 *   Lösning: detektera MAGENTA-piktogrammet direkt. Magenta är unikt i scenen
 *   (inget annat är rosa) → smälter aldrig ihop med vimplarna, och identifierar
 *   flaggan på köpet (varje piktogram unikt).
 *     1. Magenta-mask (magImg) → CV.findContours → magenta-blobbar (piktogram).
 *     2. För varje blob: warpa bbox till GRID×GRID och mallmatcha mot
 *        Bild_11–18 (mallarna är beskurna till sin magenta-bbox → samma
 *        normalisering). Magenta-formen räcker för identitet.
 *     3. NOGGRANN storlek/hörn (avstånd): sök en YT-kvadrat (gul∪magenta∪blek)
 *        som tätt omsluter bloben och är ungefär kvadratisk. Hittas en ren
 *        sådan → använd den (bunting-merge förkastas eftersom sammansmälta
 *        ytor blir för stora/avlånga). Annars: skala upp magenta-bredden via
 *        mallens magenta-andel (grövre avstånd, flaggas coarse:true).
 *
 * Kräver att cv.js och aruco.js är laddade först (CV- och AR-namespacen).
 *
 * API:
 *   PD.load(defs, onReady)   defs = [{name:'Bild_11.png', url:'assets/...'}]
 *   PD.detect(imageData)     → [{name, corners, centroid, size, score, rotation, coarse}]
 *     corners är fyra punkter i bildkoordinater (klockvis, axelinriktad bbox);
 *     centroid = piktogrammets mittpunkt; size = den (uppskattade) 50 cm-
 *     kvadratens pixelbredd; coarse=true när storleken är magenta-uppskattad.
 */
var PD = (function () {

  var GRID       = 32;     /* mall-/warpupplösning (celler per sida) */
  var MATCH_MIN  = 0.78;   /* minsta andel matchande celler för träff */
  var MARGIN_MIN = 0.04;   /* krav på marginal till näst bästa mall */
  var FRAC_TOL   = 0.22;   /* tillåten avvikelse i magenta-andel mot mall */

  var templates = [];      /* {name, rots:[4 x bits], magFrac, magLinFrac} */
  var helper    = null;    /* AR.Detector-instans (endast isReady-gating) */
  var maskImg   = null;    /* CV.Image: skyltyta (gul∪magenta∪blek, 0/255) */
  var magImg    = null;    /* CV.Image: enbart magenta (0/255) */
  var warped    = null;    /* CV.Image: warpad kandidat */
  var binMag    = [];      /* findContours-buffert (magenta) */
  var binSurf   = [];      /* findContours-buffert (yta) */

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
     ytor räknas därför också som flaggyta (endast för YT-kvadratförfining). */
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
      /* Inom tolerans → klassa via närmaste referens (ljustålig). UTANFÖR
         tolerans faller vi igenom till heuristiken i st.f. att kasta pixeln —
         kalibreringen ska ADDERA känslighet, aldrig BLINDA detektorn. Fältfynd
         2026-06-22: en sned clown-scan kunde annars få en tydligt magenta flagga
         att klassas som bakgrund → COAST trots synlig flagga. */
      if (Math.min(dM, dY) <= calibTol2) return dM < dY ? 1 : 2;
    }
    if (isMagenta(r, g, b)) return 1;
    if (isYellow(r, g, b) || isPale(r, g, b)) return 2;
    return 0;
  }

  /* Bygger båda kanalerna i ett svep över pixeldatat.
     maskImg = hela skyltytan (för YT-kvadratförfining), magImg = enbart magenta
     (detektionens primärkälla — smälter ej med gula vimplar). */
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

  /* Axelinriktad bounding-box för en kontur (lista av {x,y}) */
  function bboxOfContour(ct) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < ct.length; i++) {
      var p = ct[i];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  /* Yttre konturers bbox:ar (för YT-kvadratförfining) */
  function outerBoxes(contours) {
    var out = [];
    for (var i = 0; i < contours.length; i++) {
      if (contours[i].hole) continue;
      if (contours[i].length < 8) continue;
      out.push(bboxOfContour(contours[i]));
    }
    return out;
  }

  /* Bygg en mall: hitta magenta-bbox i bilden, beskär TILL den och nedskala
     till GRID×GRID. Då fyller piktogrammet hela rutan — samma normalisering
     som detektionens blob-bbox-warp. magLinFrac = piktogrammets linjära andel
     av hela skylten (geometriskt medel av bredd/höjd) → används för att skala
     upp magenta-bredden till hela 50 cm-kvadraten vid avståndsmätning. */
  function buildTemplate(img, name) {
    var TW = 96, TH = 96;
    var wc = document.createElement('canvas'); wc.width = TW; wc.height = TH;
    var wx = wc.getContext('2d'); wx.drawImage(img, 0, 0, TW, TH);
    var wd = wx.getImageData(0, 0, TW, TH).data;
    var minX = TW, minY = TH, maxX = -1, maxY = -1;
    for (var y = 0; y < TH; y++) {
      for (var x = 0; x < TW; x++) {
        var i = (y * TW + x) * 4;
        if (isMagenta(wd[i], wd[i + 1], wd[i + 2])) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    var magLinFrac;
    if (maxX < 0) { minX = 0; minY = 0; maxX = TW - 1; maxY = TH - 1; magLinFrac = 1; }
    else { magLinFrac = Math.sqrt(((maxX - minX + 1) / TW) * ((maxY - minY + 1) / TH)); }

    /* Beskär källbilden till magenta-bbox och nedskala till GRID×GRID */
    var sx = minX / TW * img.width, sy = minY / TH * img.height;
    var sw = (maxX - minX + 1) / TW * img.width, sh = (maxY - minY + 1) / TH * img.height;
    var c = document.createElement('canvas'); c.width = GRID; c.height = GRID;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, GRID, GRID);
    var d = ctx.getImageData(0, 0, GRID, GRID).data;
    var bits = new Uint8Array(GRID * GRID), magCount = 0;
    for (var p = 0; p < GRID * GRID; p++) {
      bits[p] = isMagenta(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) ? 1 : 0;
      magCount += bits[p];
    }
    var rots = [bits];
    for (var r = 1; r < 4; r++) rots.push(rotate90(rots[r - 1]));
    templates.push({ name: name, rots: rots,
      magFrac: magCount / (GRID * GRID), magLinFrac: magLinFrac });
  }

  /* Bestäm hela 50 cm-kvadratens pixelstorlek + hörn för en magenta-blob.
     Föredrar en ren YT-kvadrat lokalt runt bloben; faller annars tillbaka på
     en magenta-andelsbaserad uppskattning (grövre, coarse:true). */
  function refineSquare(surfBoxes, cx, cy, bw, bh, magLinFrac) {
    var estPx = Math.sqrt(bw * bh) / (magLinFrac || 1);
    var half = estPx / 2;
    var fallback = {
      corners: [ { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
                 { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half } ],
      size: estPx, coarse: true
    };
    var maxBlob = Math.max(bw, bh), bestB = null, bestArea = Infinity;
    for (var i = 0; i < surfBoxes.length; i++) {
      var b = surfBoxes[i];
      if (cx < b.minX || cx > b.maxX || cy < b.minY || cy > b.maxY) continue; /* måste omsluta */
      var sw = b.maxX - b.minX + 1, sh = b.maxY - b.minY + 1;
      var asp = sw / sh; if (asp < 0.6 || asp > 1.6) continue;          /* ~kvadrat */
      if (sw > maxBlob * 2.6 || sh > maxBlob * 2.6) continue;           /* för stor → sammansmält */
      if (sw < maxBlob * 0.9 || sh < maxBlob * 0.9) continue;          /* mindre än piktogram → orimligt */
      var area = sw * sh; if (area < bestArea) { bestArea = area; bestB = b; }
    }
    if (!bestB) return fallback;
    var sw2 = bestB.maxX - bestB.minX + 1, sh2 = bestB.maxY - bestB.minY + 1;
    return {
      corners: [ { x: bestB.minX, y: bestB.minY }, { x: bestB.maxX, y: bestB.minY },
                 { x: bestB.maxX, y: bestB.maxY }, { x: bestB.minX, y: bestB.maxY } ],
      size: (sw2 + sh2) / 2, coarse: false
    };
  }

  return {

    /* Ladda mallbilder. onReady(err) anropas när alla är klara. */
    load: function (defs, onReady) {
      helper = new AR.Detector({ dictionaryName: 'ARUCO' }); /* endast isReady-gating */
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
     * Detektera skyltar i en kamerabild (ImageData) via magenta-blobbar.
     * Returnerar lista av träffar sorterade på score (bäst först).
     */
    detect: function (imageData) {
      if (!helper || templates.length === 0) return [];
      var w = imageData.width, h = imageData.height;
      ensureBuffers(w, h);
      buildChannels(imageData);

      /* Magenta-blobbar = piktogrammen (smälter ej med gula vimplar). */
      var magContours = CV.findContours(magImg, binMag);
      /* Yt-konturer (gul∪magenta∪blek) — endast för exakt kvadratförfining. */
      var surfBoxes = outerBoxes(CV.findContours(maskImg, binSurf));

      var minDim = w * 0.025;   /* minsta blob-sida i px (avlägsna piktogram små) */
      var results = [];

      for (var ci = 0; ci < magContours.length; ci++) {
        var ct = magContours[ci];
        if (ct.hole) continue;
        var bb = bboxOfContour(ct);
        var bw = bb.maxX - bb.minX + 1, bh = bb.maxY - bb.minY + 1;
        if (bw < minDim || bh < minDim) continue;
        var aspect = bw / bh; if (aspect < 0.25 || aspect > 4) continue; /* förkasta avlånga */

        /* Warpa magenta-blobens bbox → GRID, binarisera magenta-kanalen */
        var corners = [ { x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY },
                        { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY } ];
        CV.warp(magImg, warped, corners, GRID);
        var bits = new Uint8Array(GRID * GRID), magCount = 0;
        for (var p = 0; p < GRID * GRID; p++) {
          bits[p] = warped.data[p] > 127 ? 1 : 0; magCount += bits[p];
        }
        var detFrac = magCount / (GRID * GRID);

        /* Matcha mot alla mallar × 4 rotationer (rotera de detekterade bitarna).
           Marginalen mäts mot bästa ANNAN mall — INTE mot andra rotationer av
           samma mall: vissa piktogram (t.ex. Bild_18) är nära rotations-
           symmetriska i magenta-masken → en 180°-rotation av sig själv matchar
           nästan lika bra. Det är fortfarande KORREKT identitet och får inte
           sänka marginalen; bara förväxling med en annan skylt ska göra det. */
        var rotBits = [bits];
        for (var r = 1; r < 4; r++) rotBits.push(rotate90(rotBits[r - 1]));
        var best = null, secondDiff = 0;
        for (var t = 0; t < templates.length; t++) {
          if (Math.abs(detFrac - templates[t].magFrac) > FRAC_TOL) continue;
          var sBest = 0, sRot = 0;            /* bästa score över 4 rot. för denna mall */
          for (var rr = 0; rr < 4; rr++) {
            var s = matchScore(rotBits[rr], templates[t].rots[0]);
            if (s > sBest) { sBest = s; sRot = rr; }
          }
          if (!best || sBest > best.score) {
            if (best) secondDiff = Math.max(secondDiff, best.score); /* förra bästa = annan mall */
            best = { name: templates[t].name, score: sBest, rotation: sRot, magLinFrac: templates[t].magLinFrac };
          } else {
            secondDiff = Math.max(secondDiff, sBest);
          }
        }
        if (!(best && best.score >= MATCH_MIN && (best.score - secondDiff) >= MARGIN_MIN)) continue;

        var cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
        var info = refineSquare(surfBoxes, cx, cy, bw, bh, best.magLinFrac);
        results.push({
          name: best.name, corners: info.corners,
          centroid: { x: cx, y: cy }, size: info.size,
          score: best.score, rotation: best.rotation, coarse: info.coarse
        });
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
