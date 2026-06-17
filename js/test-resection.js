/*
 * Nodtest för resection.js — projicera flaggor FRÅN en känd kamerapose,
 * kör resektionen, verifiera att den återvinner posen. Kör: node js/test-resection.js
 */
var R = require('./resection.js');
var DEG = Math.PI / 180;

var focalPx = 600, cx = 320, W = 0.50;   // 50 cm flaggor, bildmitt 320

/* Framåtprojektion: kamerapose + flaggvärldsläge → vad detektorn skulle se */
function project(C, thetaDeg, P) {
  var wb = Math.atan2(P.x - C.x, -(P.z - C.z)) / DEG;   // världsbäring kamera→flagga
  var b = wb - thetaDeg;                                  // kamerarymds-bäring
  while (b > 180) b -= 360; while (b < -180) b += 360;
  var r = Math.hypot(P.x - C.x, P.z - C.z);
  return { x: P.x, z: P.z,
           centroidX: cx + focalPx * Math.tan(b * DEG),
           pixelWidth: W * focalPx / r, realWidth: W };
}

var pass = 0, fail = 0;
function approx(label, got, exp, tol) {
  var ok = Math.abs(got - exp) <= tol;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got.toFixed(3) + ' exp=' + exp.toFixed(3));
  ok ? pass++ : fail++;
}

/* ── Test 1: kamera i origo, blickande norr, två flaggor framför ── */
(function () {
  var C = { x: 0, z: 0 }, th = 0;
  var PA = { x: -5, z: -20 }, PB = { x: 5, z: -20 };
  var flags = [project(C, th, PA), project(C, th, PB)];
  var s = R.solve2plus(flags, focalPx, cx);
  console.log('\n[Test 1] origo, norr, 2 flaggor — spread=' + s.spread.toFixed(4));
  approx('pos.x', s.pos.x, 0, 0.05);
  approx('pos.z', s.pos.z, 0, 0.05);
  approx('heading', s.heading, 0, 0.5);
})();

/* ── Test 2: kamera söder om klustret, blickande norrut, tre flaggor framför ──
   (realistisk Sommargatan-geometri: alla flaggor i synfältet, |b|<20°) ── */
(function () {
  var C = { x: 1, z: -2 }, th = 8;
  var PA = { x: 0, z: -8.04 }, PB = { x: 3.5, z: -15.7 }, PC = { x: 1.1, z: -33 };
  var flags = [project(C, th, PA), project(C, th, PB), project(C, th, PC)];
  var s = R.solve2plus(flags, focalPx, cx);
  console.log('\n[Test 2] C=(1,-2) th=8, 3 flaggor framför — spread=' + s.spread.toFixed(4));
  approx('pos.x', s.pos.x, 1, 0.1);
  approx('pos.z', s.pos.z, -2, 0.1);
  approx('heading', s.heading, 8, 0.5);
})();

/* ── Test 3: 1-flagga med given gyro-heading ── */
(function () {
  var C = { x: 2, z: -12 }, th = 20;
  var P = { x: 1.1, z: -30 };
  var f = project(C, th, P);
  var s = R.solve1(f, focalPx, cx, th);   // gyro ger rätt heading
  console.log('\n[Test 3] 1 flagga, gyro-heading=20');
  approx('pos.x', s.pos.x, 2, 0.05);
  approx('pos.z', s.pos.z, -12, 0.05);
})();

/* ── Test 4: brännvidds-kalibrering ── */
(function () {
  var f = R.calibrateFocal(300, 1.0, 0.5);   // 300px bred, 1 m bort, 0.5 m verklig
  console.log('\n[Test 4] calibrateFocal');
  approx('focalPx', f, 600, 0.001);
})();

console.log('\n=== ' + pass + ' PASS, ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
