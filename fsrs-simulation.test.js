'use strict';
const assert = require('assert');

// Simuleert veel opeenvolgende oefenbeurten op één woord, met de gebruiker die STEEDS PRECIES op het
// geplande moment terugkomt (de ideale spaced-repetition-gebruiker) -- dit is geen bewijs dat FSRS
// "correct" is (dat valt sowieso niet uit een simulatie te bewijzen), maar een stevigere controle dan
// alleen de formules op zichzelf: gedraagt het systeem zich onder GEVARIEERD, VOLGEHOUDEN gebruik nog
// steeds redelijk (een makkelijk woord wordt echt "mastered", een moeilijk woord blijft laag, niets
// ontspoort naar NaN/oneindig/buiten de grenzen)?
async function main() {
  const {
    scheduleReview, GRADE_AGAIN, GRADE_GOOD,
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

  console.log('fsrs-simulation.test.js');

  // Simpele, seeded pseudo-random generator -- reproduceerbaar (geen flaky tests door echte Math.random()).
  function seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  // Simuleert `rounds` beurten met kans `successRate` op een goed antwoord, telkens precies op het
  // geplande moment (p.due) beoordeeld -- dus het interval zelf bepaalt hoeveel tijd er "verstrijkt".
  function simulate(successRate, rounds, seed) {
    const rand = seededRandom(seed);
    const p = {};
    let now = Date.now();
    const history = [];
    for (let i = 0; i < rounds; i++) {
      const grade = rand() < successRate ? GRADE_GOOD : GRADE_AGAIN;
      scheduleReview(p, grade, now);
      history.push({ stability: p.stability, level: p.level, due: p.due, grade });
      now = p.due;
    }
    return { p, history };
  }

  test('een woord dat vrijwel altijd goed gaat (95%) bereikt binnen 30 beurten niveau 8+', () => {
    const { p } = simulate(0.95, 30, 1);
    assert.ok(p.level >= 8, `verwacht niveau 8+, was ${p.level} (stability ${p.stability.toFixed(2)}d)`);
  });

  test('een woord dat vaak fout gaat (30% goed) blijft na 30 beurten laag -- nooit "mastered"', () => {
    const { p } = simulate(0.3, 30, 2);
    assert.ok(p.level < 6, `verwacht een laag niveau, was ${p.level}`);
  });

  test('een consistent gemiddeld woord (70% goed) eindigt ergens tussen de twee uitersten in, niet bij een van de extremen', () => {
    const { p } = simulate(0.7, 40, 3);
    assert.ok(p.level > 2 && p.level < 10, `verwacht een tussenliggend niveau, was ${p.level}`);
  });

  test('stability/level/due blijven altijd binnen geldige grenzen, over honderden gemengde beurten en meerdere seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { history } = simulate(0.5, 100, seed * 97 + 3);
      for (const h of history) {
        assert.ok(Number.isFinite(h.stability), `stability moet een eindig getal zijn, was ${h.stability}`);
        assert.ok(
          h.stability >= FSRS_MIN_STABILITY_DAYS - 1e-9 && h.stability <= FSRS_MAX_STABILITY_DAYS + 1e-9,
          `stability (${h.stability}) buiten de geldige grenzen [${FSRS_MIN_STABILITY_DAYS}, ${FSRS_MAX_STABILITY_DAYS}]`
        );
        assert.ok(h.level >= 0 && h.level <= 10, `level (${h.level}) buiten het geldige bereik 0-10`);
        assert.ok(Number.isFinite(h.due) && h.due > 0, `due moet een geldig, positief tijdstip zijn, was ${h.due}`);
      }
    }
  });

  test('een woord dat na een lange goede reeks plotseling telkens fout gaat (geheugenverval-scenario), zakt merkbaar in niveau', () => {
    const p = {};
    let now = Date.now();
    for (let i = 0; i < 15; i++) { scheduleReview(p, GRADE_GOOD, now); now = p.due; }
    const levelBeforeDecline = p.level;
    for (let i = 0; i < 5; i++) { scheduleReview(p, GRADE_AGAIN, now); now = p.due; }
    assert.ok(p.level < levelBeforeDecline, `verwacht een merkbare daling: was ${levelBeforeDecline}, is nu ${p.level}`);
  });

  test('het aantal beurten tot niveau 8+ bij consistent goed is niet onredelijk traag', () => {
    // GEEN ondergrens op "te snel": bij een woord dat een gebruiker aantoonbaar ELKE keer, precies op
    // het geplande moment, foutloos beantwoordt, is snel oplopende stability het GEWENSTE gedrag van
    // FSRS (dat is precies waarom het bestaat) -- een handmatige berekening tegen de FSRS-4.5-
    // standaardgewichten bevestigt dat stability bij 100% score ongeveer 2,2-2,8x per beurt groeit, dus
    // niveau 8+ (~45 dagen) al na een handvol beurten is verwacht, geen teken van een te soepel systeem.
    const p = {};
    let now = Date.now();
    let roundsToMastery = null;
    for (let i = 1; i <= 60; i++) {
      scheduleReview(p, GRADE_GOOD, now);
      now = p.due;
      if (p.level >= 8 && roundsToMastery === null) roundsToMastery = i;
    }
    assert.ok(roundsToMastery !== null, 'niveau 8+ werd binnen 60 beurten helemaal niet bereikt');
    assert.ok(roundsToMastery <= 45, `te traag "mastered" (pas na ${roundsToMastery} beurten) -- voelt eindeloos voor de gebruiker`);
  });

  test('stability is (bij een ideale, op tijd terugkerende gebruiker) niet-dalend zolang elke beurt goed gaat', () => {
    const { history } = simulate(1.0, 25, 4); // 100% goed
    for (let i = 1; i < history.length; i++) {
      assert.ok(history[i].stability >= history[i - 1].stability - 1e-9,
        `stability daalde bij beurt ${i}: ${history[i - 1].stability} -> ${history[i].stability}, terwijl elke beurt goed ging`);
    }
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
