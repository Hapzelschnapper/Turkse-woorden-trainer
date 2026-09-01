'use strict';
const assert = require('assert');

async function main() {
  const {
    retrievability, initStability, initDifficulty, nextStability, nextIntervalDays,
    scheduleReview, migrateLegacyProgress, difficultyToDisplayEase, gradeFromResult, stabilityToLevel,
    GRADE_AGAIN, GRADE_HARD, GRADE_GOOD, GRADE_EASY,
    FSRS_MIN_STABILITY_DAYS, FSRS_MAX_STABILITY_DAYS,
  } = await import('./fsrs.js');

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

  console.log('fsrs.test.js');

  // Kerneigenschap van de FSRS-macht-vergetelijkheidscurve: per DEFINITIE van stability moet de
  // retrievability op t=S exact 90% zijn.
  test('retrievability(t=S, S) is per definitie 0.9', () => {
    for (const S of [0.5, 1, 5, 30, 100]) {
      const r = retrievability(S, S);
      assert.ok(Math.abs(r - 0.9) < 1e-9, `retrievability(${S},${S}) = ${r}, verwacht 0.9`);
    }
  });

  test('retrievability daalt monotoon naarmate er meer tijd verstreken is', () => {
    const S = 10;
    const r1 = retrievability(1, S);
    const r5 = retrievability(5, S);
    const r20 = retrievability(20, S);
    assert.ok(r1 > r5 && r5 > r20, `verwacht r1(${r1}) > r5(${r5}) > r20(${r20})`);
  });

  test('retrievability(0, S) is 1.0 (net geoefend = zekere herinnering)', () => {
    assert.ok(Math.abs(retrievability(0, 10) - 1.0) < 1e-9);
  });

  test('Good geeft een grotere initiële stability dan Hard, Easy groter dan Good', () => {
    const sHard = initStability(GRADE_HARD);
    const sGood = initStability(GRADE_GOOD);
    const sEasy = initStability(GRADE_EASY);
    assert.ok(sHard < sGood, `Hard(${sHard}) had kleiner dan Good(${sGood}) moeten zijn`);
    assert.ok(sGood < sEasy, `Good(${sGood}) had kleiner dan Easy(${sEasy}) moeten zijn`);
  });

  test('Again geeft de kleinste (of gelijke) initiële stability van de vier grades', () => {
    const sAgain = initStability(GRADE_AGAIN);
    const sHard = initStability(GRADE_HARD);
    assert.ok(sAgain <= sHard, `Again(${sAgain}) had niet groter dan Hard(${sHard}) moeten zijn`);
  });

  test('een Again-beurt op een volwassen woord verkleint de stability fors (geen 45-dagen-naar-13,5-dagen-bug)', () => {
    const D = initDifficulty(GRADE_GOOD);
    const S = 45; // 45 dagen stability, analoog aan de oude "volwassen woord"-regressietest
    const R = retrievability(45, S); // net op tijd geoefend -> R rond 0.9
    const sAfter = nextStability(D, S, R, GRADE_AGAIN);
    assert.ok(sAfter < S, `stability had moeten dalen: was ${S}, is nu ${sAfter}`);
    // FSRS reset niet naar (bijna) nul, maar het nieuwe interval moet ruim onder het oude liggen --
    // concreet: het volgende interval moet minder dan de helft van het oude zijn.
    const nextDays = nextIntervalDays(sAfter);
    assert.ok(nextDays < S / 2, `volgend interval (${nextDays}d) had ver onder het oude (${S}d) moeten liggen`);
  });

  test('een Good-beurt op een woord waarvan de retrievability al laag was (lang geleden geoefend) geeft een grotere stability-sprong dan een Good-beurt op een vers woord', () => {
    const D = initDifficulty(GRADE_GOOD);
    const S = 10;
    const rLow = retrievability(60, S); // lang geleden geoefend -> lage retrievability -> "verrassend" goed
    const rHigh = retrievability(1, S); // net geoefend -> hoge retrievability -> "verwacht" goed
    const growthLow = nextStability(D, S, rLow, GRADE_GOOD) - S;
    const growthHigh = nextStability(D, S, rHigh, GRADE_GOOD) - S;
    assert.ok(growthLow > growthHigh, `verwacht een grotere sprong bij lage R (${growthLow}) dan bij hoge R (${growthHigh})`);
  });

  test('stability blijft altijd binnen de MIN/MAX-grenzen', () => {
    const p = {};
    for (let i = 0; i < 50; i++) {
      scheduleReview(p, GRADE_AGAIN, Date.now() + i * 1000);
    }
    assert.ok(p.stability >= FSRS_MIN_STABILITY_DAYS, `stability (${p.stability}) onder de ondergrens`);
    assert.ok(p.stability <= FSRS_MAX_STABILITY_DAYS, `stability (${p.stability}) boven de bovengrens`);
  });

  // ---------- scheduleReview / level-ease UI-compatibiliteitslaag ----------
  test('scheduleReview zet p.level en p.ease (voor de bestaande UI) naast p.stability/p.difficulty', () => {
    const p = {};
    scheduleReview(p, GRADE_GOOD, Date.now());
    assert.strictEqual(typeof p.level, 'number');
    assert.strictEqual(typeof p.ease, 'number');
    assert.ok(p.level >= 0 && p.level <= 10);
  });

  test('herhaalde Good-beurten laten het (afgeleide) level oplopen', () => {
    const p = {};
    let now = Date.now();
    const levels = [];
    for (let i = 0; i < 8; i++) {
      scheduleReview(p, GRADE_GOOD, now);
      levels.push(p.level);
      now = p.due; // steeds precies op het geplande moment weer oefenen
    }
    // niet per se STRIKT stijgend elke stap, maar de laatste waarde moet flink hoger zijn dan de eerste
    assert.ok(levels[levels.length - 1] > levels[0], `verwacht dat level stijgt over de tijd: ${levels}`);
  });

  test('gradeFromResult: correct -> Good, fout zonder severity -> Again, fout met severity<1 -> Hard', () => {
    assert.strictEqual(gradeFromResult(true, undefined), GRADE_GOOD);
    assert.strictEqual(gradeFromResult(false, undefined), GRADE_AGAIN);
    assert.strictEqual(gradeFromResult(false, 0.5), GRADE_HARD);
    assert.strictEqual(gradeFromResult(false, 1), GRADE_AGAIN); // severity=1 (volledige terugval) blijft Again
  });

  // ---------- migratie ----------
  test('migrateLegacyProgress laat een al-gemigreerde entry ongemoeid', () => {
    const p = { stability: 5, difficulty: 3, reps: 2 };
    const before = { ...p };
    migrateLegacyProgress(p);
    assert.deepStrictEqual(p, before);
  });

  test('migrateLegacyProgress raakt een nooit-geoefende entry (reps=0) niet aan', () => {
    const p = { level: 0, reps: 0, due: Date.now() };
    migrateLegacyProgress(p);
    assert.strictEqual(p.stability, undefined);
  });

  test('migrateLegacyProgress zet stability/difficulty op basis van de oude intervalMin/ease', () => {
    const p = { level: 5, reps: 10, ease: 2.3, intervalMin: 60 * 24 * 10, due: Date.now() }; // 10 dagen interval
    migrateLegacyProgress(p);
    assert.strictEqual(typeof p.stability, 'number');
    assert.strictEqual(typeof p.difficulty, 'number');
    assert.ok(Math.abs(p.stability - 10) < 0.01, `stability (${p.stability}) had rond de 10 dagen moeten liggen`);
  });

  test('migrateLegacyProgress werkt p.level/p.ease DIRECT bij naar de nieuw gebootstrapte FSRS-positie (voorkomt een schijnbaar grote sprong bij de eerstvolgende beurt)', () => {
    // Een oud, pre-FSRS woord met een STALE weergegeven niveau (7) dat niet meer overeenkomt met het
    // daadwerkelijk opgeslagen interval (hier: slechts 2 dagen, wat op de nieuwe FSRS-schaal een veel
    // lager niveau is) -- precies het scenario dat de "river"/"kadın"-melding verklaarde.
    const p = { level: 7, reps: 20, ease: 2.0, intervalMin: 60 * 24 * 2, due: Date.now() }; // 2 dagen interval
    migrateLegacyProgress(p);
    // Het oude, stale niveau (7) mag NIET blijven staan -- moet meteen herrekend zijn op basis van de
    // nieuw gebootstrapte stability, niet pas bij de volgende scheduleReview()-aanroep.
    assert.notStrictEqual(p.level, 7, 'p.level had direct herberekend moeten zijn, niet het oude getal laten staan');
    assert.strictEqual(typeof p.level, 'number');
    assert.ok(p.level >= 0 && p.level <= 10, `p.level (${p.level}) moet binnen 0-10 vallen`);
    assert.strictEqual(typeof p.ease, 'number');
  });

  test('migrateLegacyProgress: het direct herberekende niveau komt overeen met stabilityToLevel van de gebootstrapte stability (geen losse, inconsistente formule)', () => {
    const p = { level: 3, reps: 5, ease: 2.5, intervalMin: 60 * 24 * 30, due: Date.now() }; // 30 dagen interval
    migrateLegacyProgress(p);
    assert.strictEqual(p.level, stabilityToLevel(p.stability), 'p.level moet exact overeenkomen met stabilityToLevel(p.stability), geen aparte/verouderde berekening');
  });

  test('difficultyToDisplayEase: lagere difficulty (makkelijker) geeft een hogere ease-waarde (net als voorheen)', () => {
    assert.ok(difficultyToDisplayEase(1) > difficultyToDisplayEase(10));
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
