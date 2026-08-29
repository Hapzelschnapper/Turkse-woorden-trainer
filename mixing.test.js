'use strict';
const assert = require('assert');

// resolveWordMixSlot/pickBestPracticeType staan sinds de module-opsplitsing (stap 3) in ../srs.js.
async function main() {
  const { resolveWordMixSlot, pickBestPracticeType } = await import('../srs.js');

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

  console.log('mixing.test.js');

  test('kwotering geeft bij newWordsPer5=2 precies 2 van de 5 beurten "nieuw"', () => {
    const base = { hasWordsInRange: true, alwaysNew: false, dueCount: 10, newCount: 10, reviewCount: 10, mixNewWords: true, newWordsPer5: 2 };
    const slots = [0, 1, 2, 3, 4].map(counter => resolveWordMixSlot({ ...base, wordMixCounter: counter }));
    assert.deepStrictEqual(slots, ['quotaNew', 'quotaNew', 'quotaReview', 'quotaReview', 'quotaReview']);
  });

  test('alwaysNew (5/5) kiest altijd "new", ongeacht hoeveel er due is', () => {
    const r = resolveWordMixSlot({ hasWordsInRange: true, alwaysNew: true, dueCount: 500, newCount: 3, reviewCount: 500, mixNewWords: true, newWordsPer5: 5, wordMixCounter: 0 });
    assert.strictEqual(r, 'new');
  });

  test('geen nieuwe woorden meer, wel due -> "review" (nooit vastlopen)', () => {
    const r = resolveWordMixSlot({ hasWordsInRange: true, alwaysNew: false, dueCount: 20, newCount: 0, reviewCount: 20, mixNewWords: true, newWordsPer5: 2, wordMixCounter: 0 });
    assert.strictEqual(r, 'review');
  });

  test('niets due en niets nieuws -> "empty"', () => {
    const r = resolveWordMixSlot({ hasWordsInRange: true, alwaysNew: false, dueCount: 0, newCount: 0, reviewCount: 0, mixNewWords: true, newWordsPer5: 2, wordMixCounter: 0 });
    assert.strictEqual(r, 'empty');
  });

  test('mixNewWords uit -> altijd "reviewOrNew" (nooit expliciet nieuw mixen)', () => {
    const r = resolveWordMixSlot({ hasWordsInRange: true, alwaysNew: false, dueCount: 5, newCount: 5, reviewCount: 5, mixNewWords: false, newWordsPer5: 2, wordMixCounter: 3 });
    assert.strictEqual(r, 'reviewOrNew');
  });

  test('een type op 0% streefaandeel wordt nooit gekozen', () => {
    const history = [];
    const type = pickBestPracticeType(history, 80, 20, 0);
    assert.notStrictEqual(type, 'question');
  });

  test('geen 2 keer op rij hetzelfde type bij een klein streefaandeel (15%)', () => {
    const history = ['word', 'word', 'word', 'word', 'word', 'word', 'word', 'word', 'word', 'sentence'];
    const type = pickBestPracticeType(history, 85, 15, 0);
    assert.notStrictEqual(type, 'sentence');
  });

  test('een type mag wél herhalen als het andere type ECHT ver achterloopt', () => {
    const history = new Array(10).fill('word');
    const type = pickBestPracticeType(history, 50, 50, 0);
    assert.strictEqual(type, 'sentence');
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
