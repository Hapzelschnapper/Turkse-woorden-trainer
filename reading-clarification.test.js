'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

function makeStubs(overrides) {
  return Object.assign({
    hasKeyFor: () => true,
    preferredModelFor: () => 'deepseek',
    parseAIJson: (raw) => JSON.parse(raw),
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

  console.log('reading-clarification.test.js');

  const readingItem = { tr: 'Ali dün markete gitti ve elma aldı.' };
  const question = { q: 'What did Ali buy?', answerHint: 'Apples' };

  await test('eerste ronde: AI vraagt om verduidelijking -> geen oordeel, wel de vervolgvraag', async () => {
    const { gradeReadingAnswer } = loadFunctions(['gradeReadingAnswer'], makeStubs({
      callAI: async () => JSON.stringify({ needsClarification: true, clarifyingQuestion: 'Do you mean the fruit?', correct: false, feedback: '' }),
    }), 'ai.js');
    const result = await gradeReadingAnswer(readingItem, question, 'elma');
    assert.strictEqual(result.needsClarification, true);
    assert.strictEqual(result.clarifyingQuestion, 'Do you mean the fruit?');
  });

  await test('tweede ronde (met clarification-context): AI geeft een definitief oordeel, needsClarification wordt genegeerd zelfs als de AI het per ongeluk toch true zet', async () => {
    const { gradeReadingAnswer } = loadFunctions(['gradeReadingAnswer'], makeStubs({
      // Zelfs als de AI zich niet aan de instructie houdt en toch needsClarification:true teruggeeft,
      // moet de functie dat NEGEREN tijdens een vervolgvraag-ronde (isFollowUp) -- geen oneindige lus.
      callAI: async () => JSON.stringify({ needsClarification: true, clarifyingQuestion: 'nog een vraag?', correct: true, feedback: 'Yes, apples is correct!' }),
    }), 'ai.js');
    const clarification = { previousAnswer: 'elma', clarifyingQuestion: 'Do you mean the fruit?' };
    const result = await gradeReadingAnswer(readingItem, question, 'Yes, the fruit apples', clarification);
    assert.strictEqual(result.needsClarification, false);
    assert.strictEqual(result.correct, true);
    assert.strictEqual(result.feedback, 'Yes, apples is correct!');
  });

  await test('de systeemprompt bevat de expliciete oorzaak/gevolg-instructie', async () => {
    let capturedSys = null;
    const { gradeReadingAnswer } = loadFunctions(['gradeReadingAnswer'], makeStubs({
      callAI: async (category, sys) => { capturedSys = sys; return JSON.stringify({ needsClarification: false, correct: true, feedback: '' }); },
    }), 'ai.js');
    await gradeReadingAnswer(readingItem, question, 'iets');
    assert.ok(/oorzaak/i.test(capturedSys) && /gevolg/i.test(capturedSys), 'systeemprompt mist de oorzaak/gevolg-instructie');
    assert.ok(/consequence/i.test(capturedSys), 'systeemprompt mist het concrete voorbeeldantwoord over een gevolg i.p.v. een reden');
  });

  await test('de systeemprompt tijdens een vervolgvraag-ronde instrueert expliciet om NIET nogmaals door te vragen', async () => {
    let capturedSys = null;
    const { gradeReadingAnswer } = loadFunctions(['gradeReadingAnswer'], makeStubs({
      callAI: async (category, sys) => { capturedSys = sys; return JSON.stringify({ needsClarification: false, correct: true, feedback: '' }); },
    }), 'ai.js');
    await gradeReadingAnswer(readingItem, question, 'antwoord', { previousAnswer: 'x', clarifyingQuestion: 'y' });
    assert.ok(/VERVOLGVRAAG-RONDE/.test(capturedSys), 'systeemprompt herkent een vervolgvraag-ronde niet expliciet');
    assert.ok(/DEFINITIEF/.test(capturedSys), 'systeemprompt eist geen definitief oordeel tijdens een vervolgvraag-ronde');
  });

  await test('een leeg antwoord vraagt nooit om verduidelijking (geen onnodige AI-call)', async () => {
    const { gradeReadingAnswer } = loadFunctions(['gradeReadingAnswer'], makeStubs({
      callAI: async () => { throw new Error('mag niet aangeroepen worden bij een leeg antwoord'); },
    }), 'ai.js');
    const result = await gradeReadingAnswer(readingItem, question, '');
    assert.strictEqual(result.correct, false);
    assert.strictEqual(result.needsClarification, false);
  });

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
