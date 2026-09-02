'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

function makeStubs(overrides) {
  return Object.assign({
    baseEnOf: (en) => en,
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

  console.log('ask-ai-chat.test.js');

  await test('systeemprompt instrueert expliciet om nooit voortijdig "niet relevant" af te wijzen', async () => {
    let capturedSys = null;
    const { askDeepSeekFree } = loadFunctions(['askDeepSeekFree'], makeStubs({
      callAI: async (category, sys) => { capturedSys = sys; return 'antwoord'; },
    }), 'ai.js');
    const item = { type: 'word', tr: 'ayak', en: 'foot', direction: 'tr-en' };
    await askDeepSeekFree(item, 'What is kabı?', []);
    assert.ok(/nooit voortijdig af/i.test(capturedSys), 'systeemprompt mist de "nooit voortijdig afwijzen"-instructie');
    assert.ok(/geen betuttelende toon/i.test(capturedSys), 'systeemprompt mist de expliciete anti-betuttel-instructie');
    assert.ok(/altijd volledig en rechtstreeks/i.test(capturedSys), 'systeemprompt mist de "altijd volledig beantwoorden"-instructie');
  });

  await test('systeemprompt instrueert om eerst na te denken over een mogelijke relatie vóór afwijzing', async () => {
    let capturedSys = null;
    const { askDeepSeekFree } = loadFunctions(['askDeepSeekFree'], makeStubs({
      callAI: async (category, sys) => { capturedSys = sys; return 'antwoord'; },
    }), 'ai.js');
    const item = { type: 'word', tr: 'ayak', en: 'foot', direction: 'tr-en' };
    await askDeepSeekFree(item, 'Ayak - kabı', []);
    assert.ok(/denk eerst grondig na/i.test(capturedSys), 'systeemprompt mist de instructie om eerst na te denken over een relatie');
    assert.ok(/samengesteld woord/i.test(capturedSys), 'systeemprompt noemt geen concreet voorbeeld van een mogelijke relatie (samengesteld woord)');
  });

  await test('context-regel bevat nog steeds het geoefende woord en de richting (bestaand gedrag blijft werken)', async () => {
    let capturedSys = null;
    const { askDeepSeekFree } = loadFunctions(['askDeepSeekFree'], makeStubs({
      callAI: async (category, sys) => { capturedSys = sys; return 'antwoord'; },
    }), 'ai.js');
    const item = { type: 'word', tr: 'ayak', en: 'foot', direction: 'tr-en' };
    await askDeepSeekFree(item, 'test', []);
    assert.ok(capturedSys.includes('ayak'), 'systeemprompt moet het geoefende Turkse woord bevatten');
    assert.ok(capturedSys.includes('foot'), 'systeemprompt moet de Engelse betekenis bevatten');
  });

  await test('geeft de eerdere chatgeschiedenis correct door als messages, met de nieuwe vraag erachteraan', async () => {
    let capturedMessages = null;
    const { askDeepSeekFree } = loadFunctions(['askDeepSeekFree'], makeStubs({
      callAI: async (category, sys, messages) => { capturedMessages = messages; return 'antwoord'; },
    }), 'ai.js');
    const item = { type: 'word', tr: 'ayak', en: 'foot', direction: 'tr-en' };
    const history = [{ role: 'user', content: 'eerdere vraag' }, { role: 'assistant', content: 'eerder antwoord' }];
    await askDeepSeekFree(item, 'nieuwe vraag', history);
    assert.strictEqual(capturedMessages.length, 3);
    assert.strictEqual(capturedMessages[2].content, 'nieuwe vraag');
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
