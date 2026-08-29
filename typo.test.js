'use strict';
const assert = require('assert');

// Sinds de module-opsplitsing (stap 3) staat deze logica in ../typo.js en ../utils.js als echte
// ES-module-exports -- rechtstreeks importeren i.p.v. via regex uit index.html extraheren.
async function main() {
  const { levenshteinDistance, typoTolerance, isTypoOf } = await import('../typo.js');
  const { foldTurkishDiacritics } = await import('../utils.js');

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

  console.log('typo.test.js');

  test('QWERTY-buurletter (i/o) kost minder dan een willekeurige vervanging', () => {
    const adjacent = levenshteinDistance('kim', 'kom');
    const random = levenshteinDistance('kim', 'kzm');
    assert.ok(adjacent < random, `verwacht adjacent(${adjacent}) < random(${random})`);
    assert.strictEqual(adjacent, 0.5);
    assert.strictEqual(random, 1);
  });

  test('typoTolerance schaalt met woordlengte', () => {
    assert.strictEqual(typoTolerance(3), 0);
    assert.strictEqual(typoTolerance(4), 1);
    assert.strictEqual(typoTolerance(6), 1);
    assert.strictEqual(typoTolerance(7), 2);
    assert.strictEqual(typoTolerance(11), 2);
    assert.strictEqual(typoTolerance(12), 3);
  });

  test('isTypoOf accepteert een buurletter-tikfout binnen budget', () => {
    assert.strictEqual(isTypoOf('golir', 'gelir'), true);
  });

  test('isTypoOf verwerpt een niet-naastgelegen-letter-fout buiten budget', () => {
    assert.strictEqual(isTypoOf('gowir', 'gelir'), false);
  });

  test('isTypoOf: exact gelijke woorden zijn geen typo (zijn gewoon al correct)', () => {
    assert.strictEqual(isTypoOf('kitap', 'kitap'), false);
  });

  test('foldTurkishDiacritics vouwt Turkse letters plat naar hun Latijnse basisvorm', () => {
    assert.strictEqual(foldTurkishDiacritics('ışş'), 'iss');
    assert.strictEqual(foldTurkishDiacritics('çğüöş'), 'cguos');
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
