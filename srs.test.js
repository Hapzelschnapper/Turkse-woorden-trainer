'use strict';
const assert = require('assert');

// Sinds de module-opsplitsing (stap 3) staat deze logica in ../srs.js als echte ES-module-export --
// rechtstreeks importeren i.p.v. via regex uit index.html extraheren (zoals dit bestand vóór de
// opsplitsing deed). Dit testbestand draait via dynamic import() omdat het zelf nog CommonJS is
// (require van 'assert'); dat is prima, Node ondersteunt het mixen hiervan.
async function main() {
  const {
    MIN_MIN, MAX_MIN,
    EASE_START, EASE_MIN, EASE_MAX, EASE_STEP_DOWN,
    WRONG_INTERVAL_FACTOR, WRONG_INTERVAL_CAP_MIN,
    intervalMinutes, nextWordIntervalMinutes,
  } = await import('./srs.js');

  let passed = 0;
  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  ok  - ${name}`);
    } catch (e) {
      console.error(`FAIL  - ${name}\n        ${e.message}`);
      process.exitCode = 1;
    }
  }

  console.log('srs.test.js');

  test('intervalMinutes(0) is de MIN_MIN-bodem, intervalMinutes(10) is de MAX_MIN-top', () => {
    assert.strictEqual(intervalMinutes(0), MIN_MIN);
    assert.strictEqual(intervalMinutes(10), MAX_MIN);
  });

  test('een goed antwoord verhoogt de ease en het interval', () => {
    const p = { level: 5, intervalMin: 1000, ease: EASE_START };
    const before = { ...p };
    nextWordIntervalMinutes(p, 'correct');
    assert.ok(p.ease > before.ease, 'ease had moeten stijgen');
    assert.ok(p.intervalMin > before.intervalMin, 'interval had moeten groeien');
  });

  test('ease-plafond wordt nooit overschreden, ook niet na veel goede antwoorden op rij', () => {
    const p = { level: 5, intervalMin: 100, ease: EASE_START };
    for (let i = 0; i < 100; i++) nextWordIntervalMinutes(p, 'correct');
    assert.ok(p.ease <= EASE_MAX, `ease (${p.ease}) mag nooit boven EASE_MAX (${EASE_MAX}) uitkomen`);
  });

  test('ease-bodem wordt nooit onderschreden, ook niet na veel foute antwoorden op rij', () => {
    const p = { level: 5, intervalMin: 100000, ease: EASE_START };
    for (let i = 0; i < 100; i++) nextWordIntervalMinutes(p, 'wrong', 1);
    assert.ok(p.ease >= EASE_MIN, `ease (${p.ease}) mag nooit onder EASE_MIN (${EASE_MIN}) zakken`);
  });

  test('fout antwoord op een volwassen woord komt nooit verder weg dan de 1-dag-cap', () => {
    const p = { level: 9, intervalMin: 60 * 24 * 45, ease: EASE_START };
    nextWordIntervalMinutes(p, 'wrong', 1);
    assert.ok(p.intervalMin <= WRONG_INTERVAL_CAP_MIN, `interval (${p.intervalMin} min) had onder de cap (${WRONG_INTERVAL_CAP_MIN} min) moeten blijven`);
  });

  test('een lagere severity (hint met weinig onthuld) geeft een zachtere terugval dan severity=1', () => {
    const start = { level: 5, intervalMin: 10000, ease: EASE_START };
    const half = { ...start };
    const full = { ...start };
    nextWordIntervalMinutes(half, 'wrong', 0.5);
    nextWordIntervalMinutes(full, 'wrong', 1);
    assert.ok(half.intervalMin > full.intervalMin, 'severity=0.5 had een groter (zachter afgebouwd) interval moeten geven dan severity=1');
    assert.ok(half.ease > full.ease, 'severity=0.5 had een minder verlaagde ease moeten geven dan severity=1');
  });

  test('severity=1 (fout, standaard) geeft exact hetzelfde resultaat als vóór de severity-parameter bestond', () => {
    const p = { level: 5, intervalMin: 10000, ease: EASE_START };
    const current = p.intervalMin;
    const expectedEase = Math.max(EASE_MIN, EASE_START - EASE_STEP_DOWN);
    const expectedTarget = Math.min(current * WRONG_INTERVAL_FACTOR, WRONG_INTERVAL_CAP_MIN);
    nextWordIntervalMinutes(p, 'wrong', 1);
    assert.strictEqual(p.ease, expectedEase);
    assert.ok(Math.abs(p.intervalMin - expectedTarget) < 1e-9, `interval (${p.intervalMin}) moet gelijk zijn aan het volle-terugval-doel (${expectedTarget})`);
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
