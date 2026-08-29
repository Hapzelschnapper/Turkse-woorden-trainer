'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

function makeStubs(overrides) {
  return Object.assign({
    normalize: (s) => (s || "").toLowerCase().trim(),
    baseEnOf: (en) => en,
    cachedTranslation: () => null,
    hasKeyFor: () => true,
    parseAIJson: (raw) => JSON.parse(raw),
    LS_EXPLANATION_CACHE: "turks_explanation_cache_v1",
  }, overrides || {});
}

async function main() {
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

  console.log('explanation-cache.test.js');

  await test('explainWordContent: tweede aanroep met dezelfde input slaat de AI-call over (cache-hit)', async () => {
    let callCount = 0;
    let explanationCache = {};
    const saved = [];
    const { explainWordContent } = loadFunctions(['explainWordContent'], makeStubs({
      explanationCache,
      callAI: async () => { callCount++; return JSON.stringify({ uitleg: "De betekenis van kitap is 'book'." }); },
      saveJSON: (key, val) => { saved.push(key); Object.assign(explanationCache, val); },
    }));
    const item = { direction: "tr-en", tr: "kitap", en: "book" };
    const first = await explainWordContent(item, "");
    const second = await explainWordContent(item, "");
    assert.strictEqual(callCount, 1, `callAI had maar 1x aangeroepen moeten worden, was ${callCount}x`);
    assert.strictEqual(first, second);
    assert.ok(first.includes("kitap"));
  });

  await test('explainWordContent: een ANDER woord triggert wél een nieuwe AI-call (geen cache-collision)', async () => {
    let callCount = 0;
    const { explainWordContent } = loadFunctions(['explainWordContent'], makeStubs({
      explanationCache: {},
      callAI: async () => { callCount++; return JSON.stringify({ uitleg: `uitleg #${callCount}` }); },
      saveJSON: () => {},
    }));
    const itemA = { direction: "tr-en", tr: "kitap", en: "book" };
    const itemB = { direction: "tr-en", tr: "kalem", en: "pen" };
    await explainWordContent(itemA, "");
    await explainWordContent(itemB, "");
    assert.strictEqual(callCount, 2, `callAI had voor 2 verschillende woorden 2x aangeroepen moeten worden, was ${callCount}x`);
  });

  await test('explainWordContent: hetzelfde woord maar een ANDER gegeven fout antwoord triggert wél een nieuwe AI-call', async () => {
    let callCount = 0;
    const { explainWordContent } = loadFunctions(['explainWordContent'], makeStubs({
      explanationCache: {},
      callAI: async () => { callCount++; return JSON.stringify({ uitleg: `uitleg #${callCount}` }); },
      saveJSON: () => {},
    }));
    const item = { direction: "tr-en", tr: "kitap", en: "book" };
    await explainWordContent(item, "");
    await explainWordContent(item, "kalem"); // ander fout antwoord -> punt 5 in de prompt verschilt -> geen cache-hit
    assert.strictEqual(callCount, 2, `callAI had 2x aangeroepen moeten worden (verschillend fout antwoord), was ${callCount}x`);
  });

  await test('explainWordContent: een mislukte generatie (lege uitleg) wordt NIET gecacht -- volgende poging probeert opnieuw', async () => {
    let callCount = 0;
    const { explainWordContent } = loadFunctions(['explainWordContent'], makeStubs({
      explanationCache: {},
      callAI: async () => { callCount++; return JSON.stringify({ uitleg: "" }); },
      saveJSON: () => {},
    }));
    const item = { direction: "tr-en", tr: "kitap", en: "book" };
    await explainWordContent(item, "");
    await explainWordContent(item, "");
    assert.strictEqual(callCount, 2, `een lege uitleg had NIET gecacht mogen worden (dus 2 pogingen), was ${callCount}`);
  });

  await test('lookupWrongAnswerMeaning: tweede aanroep met dezelfde tekst slaat de AI-call over', async () => {
    let callCount = 0;
    const { lookupWrongAnswerMeaning } = loadFunctions(['lookupWrongAnswerMeaning'], makeStubs({
      explanationCache: {},
      callAI: async () => { callCount++; return JSON.stringify({ betekenis: "boek" }); },
      saveJSON: () => {},
    }));
    const item = { direction: "en-tr" };
    const first = await lookupWrongAnswerMeaning(item, "book");
    const second = await lookupWrongAnswerMeaning(item, "book");
    assert.strictEqual(callCount, 1);
    assert.strictEqual(first, second);
  });

  await test('lookupWrongAnswerMeaning: een lege ("geen bestaand woord") uitkomst wordt OOK gecacht', async () => {
    let callCount = 0;
    const { lookupWrongAnswerMeaning } = loadFunctions(['lookupWrongAnswerMeaning'], makeStubs({
      explanationCache: {},
      callAI: async () => { callCount++; return JSON.stringify({ betekenis: "" }); },
      saveJSON: () => {},
    }));
    const item = { direction: "en-tr" };
    await lookupWrongAnswerMeaning(item, "xyzzy123");
    await lookupWrongAnswerMeaning(item, "xyzzy123");
    assert.strictEqual(callCount, 1, `een lege ("onzin") uitkomst had ook gecacht moeten worden, was ${callCount} calls`);
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
