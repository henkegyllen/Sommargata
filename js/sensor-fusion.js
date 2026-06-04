/*
 * SensorFusion — dead reckoning + kompass/gyroskop-fusion för 6DOF AR
 *
 * Publik API:
 *   SensorFusion.init(opts)
 *   SensorFusion.onCompass(alphaDeg)         — anropas från deviceorientationabsolute
 *   SensorFusion.onGyro(alphaRateDegPerSec, dt)  — anropas från devicemotion
 *   SensorFusion.onStep()                    — anropas från stegdetektorn
 *   SensorFusion.applyArUcoFix(markerWorldPos, bestTranslation_mm, camRotMat3x3)
 *   SensorFusion.getPos()   → {x, z}  (meter, world space)
 *   SensorFusion.getHeading() → grader CW från north (0–360)
 *   SensorFusion.getStepLen() → aktuell steglängd i meter
 *   SensorFusion.getLastFix() → {pos, heading, time} | null
 */
var SensorFusion = (function () {

  /* ── Konfiguration ── */
  var DECL           = -4.4;   /* kompasskorrektion, grader (default – sätts via init; negativt enligt fälttest) */
  var ALPHA          = 0.98;   /* complementary filter — gyroskopvikt */
  var DEFAULT_STEP   = 0.72;   /* m, genomsnittlig steglängd */
  var LERP_DURATION  = 500;    /* ms, tid för mjuk positions-lerp vid ArUco-fix */
  var MIN_FIX_DIST   = 5;      /* m — minsta sträcka mellan fixes för auto-kalibrering */

  /* ── State ── */
  var pos     = { x: 0, z: 0 };   /* dead-reckoning position, meter */
  var heading = 0;                  /* smoothed heading, grader CW från north */
  var stepLen = DEFAULT_STEP;
  var hasCompass = false;

  var lastFix  = null;   /* {pos:{x,z}, heading, time, markerNamn} */
  var prevFix  = null;   /* fix-1 för auto-kalibrering */

  /* Lerp-state */
  var lerp = null;   /* {fromPos, toPos, startTime, duration} | null */

  /* Gyro-tidsstämpel */
  var lastGyroTime = null;

  /* ── Interna helpers ── */
  function deg2rad(d) { return d * Math.PI / 180; }

  function angleDiff(a, b) {
    /* kortaste vinkeldifferens a→b, −180..+180 */
    var d = ((b - a) % 360 + 360) % 360;
    return d > 180 ? d - 360 : d;
  }

  function normalize360(a) { return ((a % 360) + 360) % 360; }

  /* Applicerar pågående lerp och returnerar aktuell interpolerad position */
  function lerpedPos() {
    if (!lerp) return pos;
    var now = Date.now();
    var t = Math.min(1, (now - lerp.startTime) / lerp.duration);
    /* ease-out: t² */
    var te = 1 - (1 - t) * (1 - t);
    var cur = {
      x: lerp.fromPos.x + (lerp.toPos.x - lerp.fromPos.x) * te,
      z: lerp.fromPos.z + (lerp.toPos.z - lerp.fromPos.z) * te
    };
    if (t >= 1) {
      pos = lerp.toPos;
      lerp = null;
    }
    return cur;
  }

  /* ── Publik API ── */
  return {

    init: function (opts) {
      opts = opts || {};
      if (opts.declination !== undefined) DECL = opts.declination;
      if (opts.stepLen     !== undefined) stepLen = opts.stepLen;
      if (opts.alpha       !== undefined) ALPHA = opts.alpha;
      if (opts.lerpMs      !== undefined) LERP_DURATION = opts.lerpMs;
    },

    /*
     * Anropas av deviceorientationabsolute-lyssnaren.
     * alpha = magnetisk heading CW från north (INTE korrigerad för deklination).
     */
    onCompass: function (alpha) {
      if (!hasCompass) {
        heading    = normalize360(alpha - DECL);
        hasCompass = true;
      } else {
        /* Complementary filter: gyroskopet dominerar, kompassen korrigerar drift */
        var compassTruth = normalize360(alpha - DECL);
        var diff         = angleDiff(heading, compassTruth);
        heading          = normalize360(heading + (1 - ALPHA) * diff);
      }
    },

    /*
     * Anropas från devicemotion.rotationRate (grader/s, alpha = yaw).
     * dt = tid sedan förra anropet i sekunder.
     */
    onGyro: function (yawRateDegPerSec, dt) {
      if (!hasCompass) return;
      /* Gyroskop integreras och blendas med kompassen i onCompass.
         Här justerar vi heading direkt med gyrots bidrag (filtreras ner i onCompass). */
      heading = normalize360(heading + yawRateDegPerSec * dt);
    },

    /*
     * Anropas en gång per detekterat steg.
     * Uppdaterar dead-reckoning-positionen i heading-riktningen.
     */
    onStep: function () {
      var rad = deg2rad(heading);
      pos.x  += stepLen * Math.sin(rad);
      pos.z  -= stepLen * Math.cos(rad);   /* −Z = north i A-Frame */
    },

    /*
     * Applicerar en full 3D-positionsfix från en detekterad ArUco-markör.
     *
     * markerWorldPos  = {x, y, z} survey-offset från anchor (meter)
     * bestTrans_mm    = [tx, ty, tz] Posit bestTranslation (millimeter, kamerarymden)
     * camRotMat       = 3×3 rotationsmatris [[r00,r01,r02],[r10,r11,r12],[r20,r21,r22]]
     *                   som roterar från kamerarymden till världsrymden
     *                   (byggs från aktuell heading).
     * markerNamn      = sträng för loggning/kalibrering
     *
     * Returnerar {fixPos, rotY} för att HTML-sidan ska kunna uppdatera scene-root.
     */
    applyArUcoFix: function (markerWorldPos, bestTrans_mm, camRotMat, markerNamn) {
      /* Omvandla Posit-translation mm → meter i kamerarymden */
      var tcx = bestTrans_mm[0] / 1000;
      var tcy = bestTrans_mm[1] / 1000;
      var tcz = bestTrans_mm[2] / 1000;

      /* Rotera till världsrymden: t_world = R_cam2world * t_cam */
      var R   = camRotMat;
      var twx = R[0][0]*tcx + R[0][1]*tcy + R[0][2]*tcz;
      var twz = R[2][0]*tcx + R[2][1]*tcy + R[2][2]*tcz;

      /* Kameraposition = markörens världsposition − roterad Posit-vektor */
      var fixPos = {
        x: markerWorldPos.x - twx,
        z: markerWorldPos.z - twz
      };

      /* Auto-kalibrering av steglängd */
      if (lastFix) {
        var drDist = Math.sqrt(
          Math.pow(pos.x - lastFix.pos.x, 2) +
          Math.pow(pos.z - lastFix.pos.z, 2)
        );
        var realDist = Math.sqrt(
          Math.pow(fixPos.x - lastFix.pos.x, 2) +
          Math.pow(fixPos.z - lastFix.pos.z, 2)
        );
        if (drDist > MIN_FIX_DIST && realDist > MIN_FIX_DIST) {
          var newStepLen = stepLen * (realDist / drDist);
          /* Begränsa förändringen till ±30 % per kalibrering */
          newStepLen = Math.max(stepLen * 0.7, Math.min(stepLen * 1.3, newStepLen));
          console.log('[SensorFusion] Auto-kalibrering steglängd:',
            stepLen.toFixed(3), '→', newStepLen.toFixed(3),
            'm (DR', drDist.toFixed(1), 'm, real', realDist.toFixed(1), 'm)');
          stepLen = newStepLen;
        }
      }

      /* Mjuk lerp till ny position */
      lerp = {
        fromPos:   { x: pos.x, z: pos.z },
        toPos:     fixPos,
        startTime: Date.now(),
        duration:  LERP_DURATION
      };

      prevFix  = lastFix;
      lastFix  = { pos: { x: fixPos.x, z: fixPos.z }, heading: heading,
                   time: Date.now(), namn: markerNamn || '?' };

      console.log('[SensorFusion] ArUco-fix', markerNamn,
        'fixPos (', fixPos.x.toFixed(2), fixPos.z.toFixed(2), ')',
        'DR-pos (', pos.x.toFixed(2), pos.z.toFixed(2), ')');

      return { fixPos: fixPos };
    },

    /* Returnerar aktuell interpolerad position */
    getPos: function () { return lerpedPos(); },

    /* Returnerar smoothad heading (grader CW från north, 0–360) */
    getHeading: function () { return heading; },

    getStepLen:  function () { return stepLen; },
    getLastFix:  function () { return lastFix; },
    hasHeading:  function () { return hasCompass; },

    /* Bygg en enkel kamera-till-världsrotationsmatris från heading (Y-rotation) */
    buildCamRotMat: function (headingDeg) {
      var r = deg2rad(headingDeg);
      var c = Math.cos(r), s = Math.sin(r);
      /* Rotation kring Y-axeln: (world) = R_y(heading) * (cam) */
      return [
        [ c, 0, s],
        [ 0, 1, 0],
        [-s, 0, c]
      ];
    }
  };

})();
