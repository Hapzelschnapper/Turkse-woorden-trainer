'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

// Eenvoudige, voorspelbare normalize-stub (kleine letters + trim) -- precies genoeg voor deze tests,
// de echte normalize (uit utils.js) wordt al apart getest in typo.test.js.
function makeStubs(overrides) {
  return Object.assign({
    normalize: (s) => (s || '').toLowerCase().trim(),
    baseEnOf: (en) => en,
    cachedTranslation: () => null,
    EN_WORDS_DATA: [],
    REVERSE_TR_INDEX: {},
  }, overrides || {});
}

function load(overrides) {
  return loadFunctions(['stripTrClarifier', 'matchesTrList', 'checkStaticMatch'], makeStubs(overrides), 'ai.js');
}

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

console.log('static-match.test.js');

// ---------- stripTrClarifier ----------
test('stripTrClarifier haalt een tussen-haakjes-verduidelijking aan het einde weg', () => {
  const { stripTrClarifier } = load();
  assert.strictEqual(stripTrClarifier('araba (car)'), 'araba');
  assert.strictEqual(stripTrClarifier('kitap'), 'kitap');
  assert.strictEqual(stripTrClarifier(''), '');
});

// ---------- matchesTrList ----------
test('matchesTrList: exacte match in de lijst', () => {
  const { matchesTrList } = load();
  assert.strictEqual(matchesTrList('kitap', ['kitap', 'kitabı']), true);
});

test('matchesTrList: match na het strippen van een verduidelijking', () => {
  const { matchesTrList } = load();
  assert.strictEqual(matchesTrList('araba', ['araba (car, not "otomobil")']), true);
});

test('matchesTrList: geen match geeft false, ook bij een lege/ontbrekende lijst', () => {
  const { matchesTrList } = load();
  assert.strictEqual(matchesTrList('kitap', ['kalem']), false);
  assert.strictEqual(matchesTrList('kitap', []), false);
  assert.strictEqual(matchesTrList('kitap', null), false);
});

// ================= checkStaticMatch: tr-en richting =================

test('tr-en: een leeg antwoord is altijd fout', () => {
  const { checkStaticMatch } = load();
  const item = { direction: 'tr-en', en: 'book', tr: 'kitap' };
  assert.strictEqual(checkStaticMatch(item, ''), false);
  assert.strictEqual(checkStaticMatch(item, '   '), false);
});

test('tr-en: exacte match met het bekende Engelse trefwoord', () => {
  const { checkStaticMatch } = load();
  const item = { direction: 'tr-en', en: 'book', tr: 'kitap' };
  assert.strictEqual(checkStaticMatch(item, 'book'), true);
});

test('tr-en: met een disambiguatie-hint (item.note) telt ALLEEN het exacte trefwoord, geen soepele fallback', () => {
  const { checkStaticMatch } = load(({
    EN_WORDS_DATA: [{ en: 'moon' }],
    REVERSE_TR_INDEX: { moon: [{ tr: 'ay' }] },
  }));
  const item = { direction: 'tr-en', en: 'month', tr: 'ay', note: 'not "moon"' };
  assert.strictEqual(checkStaticMatch(item, 'month'), true); // het exacte trefwoord blijft goed
  assert.strictEqual(checkStaticMatch(item, 'moon'), false); // GEEN fallback zodra er een hint is
});

test('tr-en: zonder hint accepteert de andere, even geldige betekenis van een ambigu Turks woord ("ay" = month/moon)', () => {
  const { checkStaticMatch } = load({
    EN_WORDS_DATA: [{ en: 'moon' }],
    REVERSE_TR_INDEX: { moon: [{ tr: 'ay' }] },
  });
  const item = { direction: 'tr-en', en: 'month', tr: 'ay' }; // GEEN item.note
  assert.strictEqual(checkStaticMatch(item, 'moon'), true);
});

test('tr-en: een ander Engels woord waarvan de vertaling NIET overlapt met het getoonde Turkse woord is fout', () => {
  const { checkStaticMatch } = load({
    EN_WORDS_DATA: [{ en: 'pencil' }],
    REVERSE_TR_INDEX: { pencil: [{ tr: 'kalem' }] },
  });
  const item = { direction: 'tr-en', en: 'month', tr: 'ay' };
  assert.strictEqual(checkStaticMatch(item, 'pencil'), false);
});

test('tr-en: een antwoord dat geen bekend Engels woord is, is fout (geen crash op een onbekend woord)', () => {
  const { checkStaticMatch } = load({ EN_WORDS_DATA: [], REVERSE_TR_INDEX: {} });
  const item = { direction: 'tr-en', en: 'month', tr: 'ay' };
  assert.strictEqual(checkStaticMatch(item, 'zzznietbestaand'), false);
});

test('tr-en: de ambigue-woord-check raadpleegt uitsluitend REVERSE_TR_INDEX, nooit de en-tr-vertaalcache', () => {
  // Regressietest voor een expliciet genoemde fix in de code zelf: de twee richtingen mogen elkaars
  // brondata niet raadplegen. cachedTranslation() hieronder geeft weliswaar een overlap terug, maar
  // dat mag hier GEEN rol spelen -- alleen REVERSE_TR_INDEX (hier leeg) telt voor tr-en.
  const { checkStaticMatch } = load({
    EN_WORDS_DATA: [{ en: 'moon' }],
    REVERSE_TR_INDEX: {}, // bewust leeg, ook al "weet" cachedTranslation hieronder beter
    cachedTranslation: (en) => (en === 'moon' ? ['ay'] : null),
  });
  const item = { direction: 'tr-en', en: 'month', tr: 'ay' };
  assert.strictEqual(checkStaticMatch(item, 'moon'), false);
});

// ================= checkStaticMatch: en-tr richting =================

test('en-tr: zonder senseTr/note valt terug op de brede cachedTranslation-lijst', () => {
  const { checkStaticMatch } = load({ cachedTranslation: () => ['kitap', 'kitabı'] });
  const item = { direction: 'en-tr', en: 'book' };
  assert.strictEqual(checkStaticMatch(item, 'kitabı'), true);
  assert.strictEqual(checkStaticMatch(item, 'kalem'), false);
});

test('en-tr: MET senseTr+note wordt alleen tegen die ene, specifieke betekenis beoordeeld', () => {
  const { checkStaticMatch } = load({ cachedTranslation: () => ['ay', 'ayrıca-vertaling-die-niet-hoort-bij-deze-sense'] });
  const item = { direction: 'en-tr', en: 'moon', senseTr: ['ay'], note: 'not "month"' };
  assert.strictEqual(checkStaticMatch(item, 'ay'), true);
  // een andere, bij een ANDERE betekenis van "moon" horende vertaling (hier gesimuleerd) telt niet mee
  assert.strictEqual(checkStaticMatch(item, 'ayrıca-vertaling-die-niet-hoort-bij-deze-sense'), false);
});

test('en-tr: senseTr zonder note (nog niet bekeken hint) valt terug op de brede lijst, niet op senseTr alleen', () => {
  // item.note ontbreekt hier bewust -- de code eist BEIDE (senseTr && note) om strikt te worden.
  const { checkStaticMatch } = load({ cachedTranslation: () => ['ay', 'bredere-vertaling'] });
  const item = { direction: 'en-tr', en: 'moon', senseTr: ['ay'] };
  assert.strictEqual(checkStaticMatch(item, 'bredere-vertaling'), true);
});

test('en-tr: matcht ook met een komma/haakjes-verduidelijking gestript', () => {
  const { checkStaticMatch } = load({ cachedTranslation: () => ['araba (car, not "otomobil")'] });
  const item = { direction: 'en-tr', en: 'car' };
  assert.strictEqual(checkStaticMatch(item, 'araba'), true);
});

console.log(`${passed} test(s) geslaagd\n`);
