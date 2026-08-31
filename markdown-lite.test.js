'use strict';
const assert = require('assert');
const { loadFunctions } = require('./extract');

const documentStub = {
  createElement: () => {
    let content = '';
    return {
      set textContent(v) { content = String(v); },
      get textContent() { return content; },
      get innerHTML() {
        return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    };
  },
};

const { renderMarkdownLite } = loadFunctions(['renderMarkdownLite', 'escapeHtml'], { document: documentStub }, 'utils.js');

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

console.log('markdown-lite.test.js');

test('vet: **tekst** wordt <strong>tekst</strong>', () => {
  assert.strictEqual(renderMarkdownLite('Dit is **belangrijk**.'), 'Dit is <strong>belangrijk</strong>.');
});

test('cursief: *tekst* wordt <em>tekst</em>', () => {
  assert.strictEqual(renderMarkdownLite('Dit is *nuance*.'), 'Dit is <em>nuance</em>.');
});

test('vet en cursief door elkaar in dezelfde zin', () => {
  assert.strictEqual(
    renderMarkdownLite('**Let op**: dit is *subtiel* anders.'),
    '<strong>Let op</strong>: dit is <em>subtiel</em> anders.'
  );
});

test('kop wordt vetgedrukt', () => {
  assert.strictEqual(renderMarkdownLite('# Belangrijk'), '<strong>Belangrijk</strong>');
  assert.strictEqual(renderMarkdownLite('### Kleinere kop'), '<strong>Kleinere kop</strong>');
});

test('opsommingslijst met - wordt een <ul>', () => {
  const out = renderMarkdownLite('Twee punten:\n- eerste punt\n- tweede punt');
  assert.ok(out.includes('<ul'), 'verwacht een <ul>-element');
  assert.ok(out.includes('<li>eerste punt</li>'));
  assert.ok(out.includes('<li>tweede punt</li>'));
});

test('genummerde lijst wordt een <ol>', () => {
  const out = renderMarkdownLite('Stappen:\n1. eerst dit\n2. dan dat');
  assert.ok(out.includes('<ol'), 'verwacht een <ol>-element');
  assert.ok(out.includes('<li>eerst dit</li>'));
  assert.ok(out.includes('<li>dan dat</li>'));
});

test('losse regeleindes worden <br>', () => {
  assert.strictEqual(renderMarkdownLite('regel een\nregel twee'), 'regel een<br>regel twee');
});

test('lege/undefined input geeft een lege string, geen fout', () => {
  assert.strictEqual(renderMarkdownLite(''), '');
  assert.strictEqual(renderMarkdownLite(undefined), '');
  assert.strictEqual(renderMarkdownLite(null), '');
});

test('platte tekst zonder enige markdown blijft ongewijzigd (op regeleindes na)', () => {
  assert.strictEqual(renderMarkdownLite('Gewoon een zin zonder opmaak.'), 'Gewoon een zin zonder opmaak.');
});

// ---------- KRITIEK: XSS-veiligheid ----------
test('een poging tot HTML-injectie in de AI-tekst wordt ALTIJD geëscaped, ook na de markdown-omzetting', () => {
  const malicious = '**Let op:** <script>alert(1)</script> en <img src=x onerror=alert(2)>';
  const out = renderMarkdownLite(malicious);
  assert.ok(!out.includes('<script>'), 'een letterlijk <script>-element mag nooit doorkomen');
  assert.ok(!out.includes('<img '), 'een letterlijk <img>-element mag nooit doorkomen (zou onerror= anders daadwerkelijk als attribuut activeren)');
  assert.ok(out.includes('&lt;script&gt;'), 'de scripttag moet geëscaped zichtbaar blijven als platte tekst');
  assert.ok(out.includes('&lt;img'), 'de img-tag moet geëscaped zichtbaar blijven als platte tekst -- "onerror=" mag als INERTE tekst voorkomen, zolang de omringende </> geëscaped zijn en er dus geen echt element ontstaat');
  assert.ok(out.includes('<strong>Let op:</strong>'), 'de echte markdown (vet) moet wél gewoon werken');
});

test('een ampersand in AI-tekst wordt correct geëscaped', () => {
  const out = renderMarkdownLite('Tom & Jerry');
  assert.ok(out.includes('&amp;'), 'een kale & moet als &amp; geëscaped worden');
});

console.log(`${passed} test(s) geslaagd\n`);
