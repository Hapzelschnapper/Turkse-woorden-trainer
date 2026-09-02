'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

function makeStubs(overrides) {
  return Object.assign({
    hasKeyFor: () => true,
    preferredModelFor: () => 'deepseek',
    parseAIJson: (raw) => JSON.parse(raw),
    pickSuffixDrillNoun: () => ({ en: 'work (job)' }),
    getOrFetchTranslation: async () => ['iş'],
    baseEnOf: (en) => en.split(' (')[0],
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

  console.log('bare-suffix-drill.test.js');

  await test('ce_eki/gorus: geen AI-call nodig (vaste set bence/sence/bizce/sizce)', async () => {
    let calls = 0;
    const { generateBareSuffixDrillForTopic } = loadFunctions(
      ['generateBareSuffixDrillForTopic', 'CE_EKI_GORUS_FORMS'],
      makeStubs({ callAI: async () => { calls++; return '{}'; } }),
      'ai.js'
    );
    const result = await generateBareSuffixDrillForTopic({ key: 'ce_eki::gorus' });
    assert.strictEqual(calls, 0);
    assert.strictEqual(typeof result.direction, 'string');
    assert.strictEqual(typeof result.prompt, 'string');
    assert.strictEqual(typeof result.correct, 'string');
  });

  await test('ce_eki/gorus: de Turkse kant is altijd een kaal, los woord (nooit een zin)', async () => {
    const { generateBareSuffixDrillForTopic } = loadFunctions(
      ['generateBareSuffixDrillForTopic', 'CE_EKI_GORUS_FORMS'],
      makeStubs({ callAI: async () => '{}' }),
      'ai.js'
    );
    for (let i = 0; i < 20; i++) {
      const result = await generateBareSuffixDrillForTopic({ key: 'ce_eki::gorus' });
      const trSide = result.direction === 'tr-en' ? result.prompt : result.correct;
      assert.strictEqual(trSide.trim().split(/\s+/).length, 1, `Turkse kant "${trSide}" moet één kaal woord zijn`);
      assert.ok(['bence', 'sence', 'bizce', 'sizce'].includes(trSide), `onverwachte Turkse vorm: "${trSide}"`);
    }
  });

  await test('ce_eki/zarf: geeft het door de AI teruggegeven kale -ce/-ca-woordpaar door', async () => {
    const { generateBareSuffixDrillForTopic } = loadFunctions(
      ['generateBareSuffixDrillForTopic', 'CE_EKI_GORUS_FORMS'],
      makeStubs({ callAI: async () => JSON.stringify({ prompt: 'quickly', correct: 'hızlıca' }) }),
      'ai.js'
    );
    const result = await generateBareSuffixDrillForTopic({ key: 'ce_eki::zarf' });
    assert.ok(result.prompt === 'hızlıca' || result.correct === 'hızlıca', 'de -ce/-ca-vorm moet ergens in het resultaat staan');
    assert.ok(result.prompt === 'quickly' || result.correct === 'quickly', 'de Engelse cue moet ergens in het resultaat staan');
  });

  await test('ci_eki: hergebruikt pickSuffixDrillNoun en geeft het kale -ci/-çi-woordpaar door', async () => {
    const { generateBareSuffixDrillForTopic } = loadFunctions(
      ['generateBareSuffixDrillForTopic', 'CE_EKI_GORUS_FORMS'],
      makeStubs({ callAI: async () => JSON.stringify({ prompt: 'worker', correct: 'işçi' }) }),
      'ai.js'
    );
    const result = await generateBareSuffixDrillForTopic({ key: 'ci_eki' });
    assert.ok(result.prompt === 'işçi' || result.correct === 'işçi', 'de -ci/-çi-vorm moet ergens in het resultaat staan');
  });

  await test('ci_eki: gooit een duidelijke fout als er geen beheerst zelfstandig naamwoord beschikbaar is (geen crash)', async () => {
    const { generateBareSuffixDrillForTopic } = loadFunctions(
      ['generateBareSuffixDrillForTopic', 'CE_EKI_GORUS_FORMS'],
      makeStubs({ pickSuffixDrillNoun: () => null, callAI: async () => '{}' }),
      'ai.js'
    );
    await assert.rejects(() => generateBareSuffixDrillForTopic({ key: 'ci_eki' }), /No mastered noun/);
  });

  await test('onbekend onderwerp: nette foutmelding i.p.v. crash', async () => {
    const { generateBareSuffixDrillForTopic } = loadFunctions(
      ['generateBareSuffixDrillForTopic', 'CE_EKI_GORUS_FORMS'],
      makeStubs({ callAI: async () => '{}' }),
      'ai.js'
    );
    await assert.rejects(() => generateBareSuffixDrillForTopic({ key: 'iets_onbekends' }), /no bare-word drill logic/);
  });

  await test('BARE_SUFFIX_DRILL_TOPICS bevat precies ce_eki en ci_eki, niets anders', async () => {
    const { BARE_SUFFIX_DRILL_TOPICS } = loadFunctions(['BARE_SUFFIX_DRILL_TOPICS'], {}, 'ai.js');
    assert.ok(BARE_SUFFIX_DRILL_TOPICS.has('ce_eki'));
    assert.ok(BARE_SUFFIX_DRILL_TOPICS.has('ci_eki'));
    assert.strictEqual(BARE_SUFFIX_DRILL_TOPICS.size, 2);
  });

  await test('generateGrammarDrillForTopic (app.js): routeert ce_eki/ci_eki naar de kale-woord-generator, andere onderwerpen naar de bestaande generateGrammarDrill', async () => {
    let bareCalled = false, sentenceCalled = false;
    const { generateGrammarDrillForTopic } = loadFunctions(['generateGrammarDrillForTopic'], {
      BARE_SUFFIX_DRILL_TOPICS: new Set(['ce_eki', 'ci_eki']),
      generateBareSuffixDrillForTopic: async () => { bareCalled = true; return { direction: 'en-tr', prompt: 'worker', correct: 'işçi' }; },
      generateGrammarDrill: async () => { sentenceCalled = true; return { direction: 'en-tr', prompt: 'on the table', correct: 'masanın üstünde' }; },
    });
    const r1 = await generateGrammarDrillForTopic({ key: 'ci_eki' });
    assert.strictEqual(bareCalled, true);
    assert.strictEqual(sentenceCalled, false);
    assert.strictEqual(r1.correct, 'işçi');

    bareCalled = false;
    const r2 = await generateGrammarDrillForTopic({ key: 'dative_case' });
    assert.strictEqual(bareCalled, false);
    assert.strictEqual(sentenceCalled, true);
    assert.strictEqual(r2.correct, 'masanın üstünde');
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
