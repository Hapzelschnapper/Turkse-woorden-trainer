'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

// gradeCheckupWordAnswer hangt van veel andere app.js-functies af (normalize, checkStaticMatch,
// cachedTranslation, baseEnOf, askDeepSeekJudge, ...) -- die worden hier als stubs meegegeven i.p.v.
// ook uit app.js geëxtraheerd, zodat dit een zuivere, deterministische test van ALLEEN de
// vertakkingslogica zelf is (geen echte AI-calls, geen DOM).
function makeStubs(overrides) {
  return Object.assign({
    normalize: (s) => (s || "").toLowerCase().trim(),
    checkStaticMatch: () => false,
    correctEnglishDisplayFor: (cur) => cur.en,
    cachedTranslation: () => null,
    baseEnOf: (en) => en,
    closestTrMatch: () => null,
    getOrFetchTranslation: async () => ["fallback-tr"],
    gradeGrammarDrillAnswer: async () => ({ correct: false, uitleg: "" }),
    askDeepSeekJudge: async () => ({ correct: false, afwijking: "", uitleg: "" }),
  }, overrides || {});
}

// gradeCheckupWordAnswer staat sinds stap 11 (modulesplitsing) in ai.js, niet meer in app.js.
function loadGrading(overrides) {
  return loadFunctions(['gradeCheckupWordAnswer'], makeStubs(overrides), 'ai.js');
}

async function main() {
  const { gradeCheckupWordAnswer } = loadGrading();

  let passed = 0;
  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ok  - ${name}`);
    } catch (e) {
      console.error(`FAIL  - ${name}\n        ${e.message}`);
      process.exitCode = 1;
    }
  }

  console.log('grading.test.js');

  await test('sentence-drill: exacte match is meteen correct, geen AI-call nodig', async () => {
    const cur = { sentenceDrill: { correct: "Merhaba" } };
    const { correct, correctAnswerTxt } = await gradeCheckupWordAnswer(cur, "merhaba");
    assert.strictEqual(correct, true);
    assert.strictEqual(correctAnswerTxt, "Merhaba");
  });

  await test('wordSource:"tr" (rechtstreeks tr-en-item): checkStaticMatch geeft direct correct terug', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      checkStaticMatch: () => true,
      correctEnglishDisplayFor: () => "book",
    });
    const cur = { wordSource: "tr", en: "book", tr: "kitap" };
    const { correct, correctAnswerTxt } = await gradeCheckupWordAnswer(cur, "book");
    assert.strictEqual(correct, true);
    assert.strictEqual(correctAnswerTxt, "book");
  });

  await test('wordSource:"tr", gepiept: alleen een LETTERLIJKE match telt (geen checkStaticMatch-fallback)', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      checkStaticMatch: () => { throw new Error('mag niet aangeroepen worden als cur.peeked'); },
      correctEnglishDisplayFor: () => "book",
    });
    const cur = { wordSource: "tr", en: "book", tr: "kitap", peeked: true };
    const { correct } = await gradeCheckupWordAnswer(cur, "book");
    assert.strictEqual(correct, true);
  });

  await test('wordSource:"tr", geen match: valt terug op askDeepSeekJudge', async () => {
    let judgeCalled = false;
    const { gradeCheckupWordAnswer } = loadGrading({
      checkStaticMatch: () => false,
      correctEnglishDisplayFor: () => "book",
      askDeepSeekJudge: async (item) => { judgeCalled = true; assert.strictEqual(item.direction, "tr-en"); return { correct: true, afwijking: "", uitleg: "goed zo" }; },
    });
    const cur = { wordSource: "tr", en: "book", tr: "kitap" };
    const { correct, uitleg } = await gradeCheckupWordAnswer(cur, "een boek");
    assert.strictEqual(judgeCalled, true);
    assert.strictEqual(correct, true);
    assert.strictEqual(uitleg, "goed zo");
  });

  await test('en-tr, exacte match: correct zonder AI-call', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      askDeepSeekJudge: async () => { throw new Error('mag niet aangeroepen worden bij een exacte match'); },
    });
    const cur = { direction: "en-tr", en: "book", tr: "kitap" };
    const { correct, correctAnswerTxt } = await gradeCheckupWordAnswer(cur, "kitap");
    assert.strictEqual(correct, true);
    assert.strictEqual(correctAnswerTxt, "kitap");
  });

  await test('en-tr, gepiept: alleen een letterlijke match telt (geen AI-fallback)', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      askDeepSeekJudge: async () => { throw new Error('mag niet aangeroepen worden als cur.peeked'); },
    });
    const cur = { direction: "en-tr", en: "book", tr: "kitap", peeked: true };
    const wrongCase = await gradeCheckupWordAnswer(cur, "kitaap");
    assert.strictEqual(wrongCase.correct, false);
    const rightCase = await gradeCheckupWordAnswer(cur, "kitap");
    assert.strictEqual(rightCase.correct, true);
  });

  await test('en-tr, ontbrekende cur.tr: haalt de vertaling alsnog op via getOrFetchTranslation', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      getOrFetchTranslation: async () => ["opgehaald-woord"],
    });
    const cur = { direction: "en-tr", en: "book", tr: null };
    const { correctAnswerTxt } = await gradeCheckupWordAnswer(cur, "iets anders");
    assert.strictEqual(correctAnswerTxt, "opgehaald-woord");
    assert.strictEqual(cur.tr, "opgehaald-woord"); // cur zelf wordt ook bijgewerkt, voor latere weergave
  });

  await test('en-tr, AI keurt een tikfout goed: spokenTr wordt de dichtstbijzijnde bekende vorm, niet de tikfout zelf', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      askDeepSeekJudge: async () => ({ correct: true, afwijking: "typo", uitleg: "" }),
      closestTrMatch: () => "kitap",
    });
    const cur = { direction: "en-tr", en: "book", tr: "kitap" };
    const { spokenTr } = await gradeCheckupWordAnswer(cur, "kitab");
    assert.strictEqual(spokenTr, "kitap");
  });

  await test('en-tr, AI keurt een ECHT synoniem goed (geen tikfout): spokenTr is het getypte antwoord zelf', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      askDeepSeekJudge: async () => ({ correct: true, afwijking: "", uitleg: "" }),
    });
    const cur = { direction: "en-tr", en: "book", tr: "kitap" };
    const { spokenTr } = await gradeCheckupWordAnswer(cur, "kitabı");
    assert.strictEqual(spokenTr, "kitabı");
  });

  await test('leeg antwoord: altijd fout, geen enkele AI-call', async () => {
    const { gradeCheckupWordAnswer } = loadGrading({
      askDeepSeekJudge: async () => { throw new Error('mag niet aangeroepen worden bij een leeg antwoord'); },
      gradeGrammarDrillAnswer: async () => { throw new Error('mag niet aangeroepen worden bij een leeg antwoord'); },
    });
    const cur = { direction: "en-tr", en: "book", tr: "kitap" };
    const { correct } = await gradeCheckupWordAnswer(cur, "");
    assert.strictEqual(correct, false);
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
