'use strict';
// Draait alle *.test.js in deze map als losse subprocessen (zodat een crash in het ene testbestand de
// andere niet meesleept), en geeft een niet-nul exitcode als er ook maar één test faalt -- geschikt om
// later aan een CI-stap te hangen. Gebruik: `node run-all.js`
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();

let anyFailed = false;
for (const file of files) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, file)], { encoding: 'utf8' });
    process.stdout.write(out);
  } catch (e) {
    anyFailed = true;
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
  }
}

if (anyFailed) {
  console.error('=== Eén of meer tests zijn gefaald ===');
  process.exit(1);
} else {
  console.log(`=== Alle testbestanden geslaagd (${files.length} bestanden) ===`);
}
