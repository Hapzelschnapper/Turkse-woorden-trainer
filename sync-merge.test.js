'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

function load() {
  return loadFunctions(['mergeProgress'], {}, 'app.js');
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

console.log('sync-merge.test.js');

// Regressietest voor de sync-bug: "ik had het net goed, en toch zakte het niveau" -- veroorzaakt door
// syncPullNow() die voorheen de VOLLEDIGE lokale progress verving door wat er op afstand stond, ongeacht
// welke kant daadwerkelijk verder gevorderd/recenter was.

test('mergeProgress: een woord dat alleen op afstand bekend is, wordt gewoon overgenomen', () => {
  const { mergeProgress } = load();
  const local = {};
  const remote = { city: { level: 3, lastReviewAt: 1000 } };
  const merged = mergeProgress(local, remote);
  assert.deepStrictEqual(merged.city, { level: 3, lastReviewAt: 1000 });
});

test('mergeProgress: een woord dat alleen lokaal bekend is, blijft ongewijzigd staan', () => {
  const { mergeProgress } = load();
  const local = { city: { level: 9, lastReviewAt: 5000 } };
  const merged = mergeProgress(local, {});
  assert.deepStrictEqual(merged.city, { level: 9, lastReviewAt: 5000 });
});

test('mergeProgress: bij een conflict wint de kant met de meest recente lastReviewAt (het gemelde scenario)', () => {
  const { mergeProgress } = load();
  // Lokaal: net op DIT apparaat goed beantwoord (hoger niveau, recentere lastReviewAt).
  const local = { city: { level: 9, lastReviewAt: 5000 } };
  // Op afstand: een oudere, minder ver gevorderde stand vanaf een ander apparaat dat nog niet gepulld had.
  const remote = { city: { level: 6, lastReviewAt: 1000 } };
  const merged = mergeProgress(local, remote);
  assert.strictEqual(merged.city.level, 9); // de recentere, lokale stand overleeft -- niet teruggezet naar 6
});

test('mergeProgress: een daadwerkelijk recentere remote-stand wordt wél overgenomen', () => {
  const { mergeProgress } = load();
  const local = { city: { level: 6, lastReviewAt: 1000 } };
  const remote = { city: { level: 9, lastReviewAt: 5000 } }; // op een ander apparaat, later, goed beantwoord
  const merged = mergeProgress(local, remote);
  assert.strictEqual(merged.city.level, 9);
});

test('mergeProgress: een nog niet gemigreerd lokaal record (geen lastReviewAt) verliest altijd van een FSRS-natieve remote-stand', () => {
  const { mergeProgress } = load();
  const local = { city: { level: 7, ease: 2.1 } }; // pre-FSRS, geen lastReviewAt
  const remote = { city: { level: 9, lastReviewAt: 1000 } };
  const merged = mergeProgress(local, remote);
  assert.strictEqual(merged.city.level, 9);
});

test('mergeProgress: twee nog niet gemigreerde records (allebei geen lastReviewAt) -> lokaal blijft staan (geen ongefundeerde overschrijving)', () => {
  const { mergeProgress } = load();
  const local = { city: { level: 7 } };
  const remote = { city: { level: 3 } };
  const merged = mergeProgress(local, remote);
  assert.strictEqual(merged.city.level, 7);
});

test('mergeProgress: andere, niet-overlappende woorden blijven allebei gewoon staan', () => {
  const { mergeProgress } = load();
  const local = { city: { level: 9, lastReviewAt: 5000 } };
  const remote = { mother: { level: 4, lastReviewAt: 2000 } };
  const merged = mergeProgress(local, remote);
  assert.strictEqual(merged.city.level, 9);
  assert.strictEqual(merged.mother.level, 4);
});

console.log(`${passed} test(s) geslaagd\n`);
