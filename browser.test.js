'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// Minimale statische bestandsserver -- geen extra dependency nodig (python3/http-server), puur Node's
// eigen http-module. Dient rechtstreeks uit de repo-root, zodat de test tegen de ECHTE app.js/index.html/
// databestanden draait, niet tegen een kopie die kan verouderen.
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (req.url === '/' || req.url === '') filePath = path.join(ROOT, 'index.html');
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.log('browser.test.js');
    console.log('  overgeslagen -- puppeteer is niet geïnstalleerd (run `npm install` om deze test mee te draaien)\n');
    return; // GEEN process.exitCode=1: dit is geen falende test, puur een ontbrekende optionele dependency
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

  console.log('browser.test.js');

  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const page = await browser.newPage();
    const jsErrors = [];
    // Favicon/manifest-iconbestanden zijn losse statische assets, geen onderdeel van de appcode zelf --
    // een 404 daarop zegt niets over of de app werkt.
    const ACCEPTABLE_MISSING_ASSETS = /favicon|icon-192|icon-512|apple-touch-icon/i;
    page.on('pageerror', (e) => jsErrors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // De generieke "Failed to load resource"-regel wordt al preciezer (mét URL) via het response-event
      // hieronder afgehandeld -- hier zou 'm meenemen enkel tot dubbele, minder informatieve meldingen leiden.
      if (/failed to load resource/i.test(text)) return;
      if (ACCEPTABLE_MISSING_ASSETS.test(text)) return;
      jsErrors.push(text);
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && !ACCEPTABLE_MISSING_ASSETS.test(res.url())) {
        jsErrors.push(`HTTP ${res.status()} voor ${res.url()}`);
      }
    });

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2000)); // app-initialisatie (data laden) even de tijd geven

    test('de app initialiseert zonder JS-fouten en verbergt het laadscherm', () => {
      assert.strictEqual(jsErrors.length, 0, `onverwachte fouten tijdens het laden: ${jsErrors.join(' | ')}`);
    });

    const loadingHidden = await page.evaluate(() => document.getElementById('loading-overlay')?.classList.contains('hidden'));
    test('het laadscherm is verdwenen (data succesvol geladen)', () => {
      assert.strictEqual(loadingHidden, true);
    });

    const practiceState = await page.evaluate(() => ({
      word: document.getElementById('tr-word')?.textContent,
      practiceVisible: !document.getElementById('screen-practice')?.classList.contains('hidden'),
    }));
    test('het Practice-scherm toont meteen een woord', () => {
      assert.strictEqual(practiceState.practiceVisible, true);
      assert.ok(practiceState.word && practiceState.word !== '…', `verwacht een echt woord, kreeg "${practiceState.word}"`);
    });

    await page.click('#btn-check');
    await new Promise((r) => setTimeout(r, 500));
    const feedback = await page.evaluate(() => document.getElementById('feedback-box')?.textContent);
    test('op Check klikken met een leeg antwoord geeft directe feedback (geen AI-call nodig)', () => {
      assert.ok(feedback && feedback.length > 0, 'verwacht niet-lege feedback na het klikken op Check');
    });

    // Doorloop van de overige hoofdtabbladen -- elk moet zonder JS-fouten renderen.
    const tabs = ['words', 'stats', 'suffixes', 'settings', 'course', 'practice'];
    for (const tab of tabs) {
      await page.click(`[data-tab="${tab}"]`);
      await new Promise((r) => setTimeout(r, 700));
    }
    test(`alle hoofdtabbladen (${tabs.join(', ')}) doorlopen zonder nieuwe fouten`, () => {
      assert.strictEqual(jsErrors.length, 0, `onverwachte fouten tijdens het doorlopen van de tabbladen: ${jsErrors.join(' | ')}`);
    });

    const statsNumbers = await page.evaluate(() => ({
      total: document.getElementById('kpi-total')?.textContent,
    }));
    test('Stats toont een plausibel totaal-woordenaantal (geen lege/NaN-waarde)', () => {
      const n = parseInt(statsNumbers.total, 10);
      assert.ok(Number.isFinite(n) && n > 1000, `verwacht een groot getal (duizenden woorden), kreeg "${statsNumbers.total}"`);
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`${passed} test(s) geslaagd\n`);
}

main();
