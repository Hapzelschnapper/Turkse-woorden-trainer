// Haalt een of meer met naam opgegeven top-level functies/const's rechtstreeks uit een bronbestand en
// levert ze terug als aanroepbare JS-waarden (via een sandbox).
//
// WAAROM zo, en niet gewoon een losse kopie van de logica in de tests zetten: een losse kopie raakt
// vroeg of laat uit sync met de echte implementatie (precies het soort stille regressie die dit
// test-harnas moet voorkomen). Door de brontekst zelf uit het echte bestand te trekken, test je altijd
// de daadwerkelijk actieve code.
//
// SINDS DE MODULE-OPSPLITSING (stap 3): logica die al in een eigen ES-module staat (utils.js, typo.js,
// srs.js) kun je beter gewoon rechtstreeks importeren (zie srs.test.js/typo.test.js/mixing.test.js) --
// simpeler en robuuster dan deze regex-extractie. Dit bestand blijft nuttig voor logica die nog in het
// grote, niet-gemodulariseerde app.js zit (bv. hintPenaltySeverity, closestTrMatch) en waarvoor een
// volledige `import` te veel ongerelateerde code/afhankelijkheden zou meeslepen.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_SOURCE_PATH = path.join(__dirname, '..', 'app.js');

function readSourceFile(relativePath) {
  const p = relativePath ? path.join(__dirname, '..', relativePath) : DEFAULT_SOURCE_PATH;
  return fs.readFileSync(p, 'utf8');
}

// Vindt de brontekst van "function naam(...) { ... }" (of "async function naam(...) { ... }", of
// "export function naam(...) { ... }") door vanaf de eerste { na de signature de accolade-diepte bij
// te houden tot 'ie weer op 0 staat. Simpele maar betrouwbare aanpak zolang er geen ongebalanceerde {
// of } in een string/comment binnen de functie voorkomt (in de praktijk niet het geval hier).
function extractFunctionSource(src, name) {
  const sigRe = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const sigMatch = sigRe.exec(src);
  if (!sigMatch) return null;
  const start = sigMatch.index;
  // Eerst de PARAMETERLIJST doorlopen (op haakjes-diepte), want die kan zelf destructuring-accolades
  // bevatten (bv. "function f({a, b}) {...}") -- een kale indexOf('{', ...) zou dan de accolade van de
  // parameterlijst pakken i.p.v. de opening van de functiebody.
  const parenStart = src.indexOf('(', sigMatch.index);
  let parenDepth = 0;
  let j = parenStart;
  for (; j < src.length; j++) {
    if (src[j] === '(') parenDepth++;
    else if (src[j] === ')') {
      parenDepth--;
      if (parenDepth === 0) { j++; break; }
    }
  }
  const braceStart = src.indexOf('{', j);
  if (braceStart === -1) throw new Error(`Geen openende { gevonden voor functie "${name}"`);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  // "export " strippen: dat is geen geldige syntax voor een gewoon (niet-module) vm-script hieronder.
  return src.slice(start, i).replace(/^export\s+/, '');
}

// Zelfde soort extractie, maar dan voor een top-level "const NAME = ..." / "let NAME = ..." (nodig voor
// module-scope state waar een functie van afhangt). Scant tot het afsluitende ";" op haakjes-diepte 0,
// zodat een meerregelige array/object-literal ook meegepakt wordt.
function extractVariableSource(src, name) {
  const sigRe = new RegExp(`(?:export\\s+)?(?:const|let)\\s+${name}\\s*=`);
  const sigMatch = sigRe.exec(src);
  if (!sigMatch) return null;
  const start = sigMatch.index;
  let depth = 0;
  let i = sigMatch.index;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth === 0) { i++; break; }
  }
  return src.slice(start, i).replace(/^export\s+/, '');
}

// Bouwt een sandbox met de gevraagde functies/const's (uit `sourcePath` geëxtraheerd, standaard
// app.js) plus eventuele extra stubs/waarden (bv. een neppe `settings`-object, of een stub voor een
// functie waar de geteste code intern van afhangt maar die zelf niet getest wordt).
function loadFunctions(names, extraContext, sourcePath) {
  const src = readSourceFile(sourcePath);
  const sources = names.map(n => {
    const fnSrc = extractFunctionSource(src, n);
    if (fnSrc !== null) return fnSrc;
    const varSrc = extractVariableSource(src, n);
    if (varSrc !== null) return varSrc;
    throw new Error(`"${n}" niet gevonden in ${sourcePath || 'app.js'} (geen functie en geen top-level const/let)`);
  }).join('\n\n');
  const context = Object.assign({ console, module: { exports: {} } }, extraContext || {});
  vm.createContext(context);
  vm.runInContext(sources + '\n;module.exports = { ' + names.join(', ') + ' };', context);
  return context.module.exports;
}

module.exports = { readSourceFile, extractFunctionSource, extractVariableSource, loadFunctions };
