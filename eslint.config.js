'use strict';
// Bewust een KLEIN, gericht setje harde regels -- geen volle stijl-ruleset (geen quotes/semicolons/
// indentatie-regels), want dat verzuipt in ruis voor een codebase die nog nooit gelint is en levert geen
// echte correctheidswinst op. Elke regel hieronder is gekozen omdat 'ie een categorie fouten vangt die
// dit project al eens daadwerkelijk heeft laten struikelen (of makkelijk had kunnen laten struikelen):
//   - no-undef        : een typefout in een naam, of een vergeten import/declaratie (zie de
//                       `settings`-volgordefout uit stap 5 -- dat was een temporal-dead-zone-bug die
//                       no-undef weliswaar niet had gevangen, maar wel exact het SOORT fout is waar
//                       deze regel wél tegen beschermt: een naam die simpelweg niet bestaat).
//   - no-unused-vars  : achtergebleven rommel na een refactor (zie de losse `mastered8`/`due`-variabelen
//                       die na eerdere wijzigingen dood kwamen te liggen -- die zijn toen met de hand
//                       gevonden; deze regel vangt dat voortaan automatisch).
//   - require-await   : een `async function` die nergens `await` gebruikt is vaak een vergissing (een
//                       vergeten `await` op een aanroep verderop, of een functie die niet async hoeft
//                       te zijn) -- beide zijn het soort stille bug die pas bij gebruik opvalt.
//   - de rest         : klassieke, zeer lage-vals-positief-categorie correctheidsfouten (dubbele
//                       object-sleutels/parameters, onbereikbare code, `=` i.p.v. `==`/`===` in een
//                       conditie, een switch zonder break die doorvalt, een `while(true)`-achtige
//                       constante conditie buiten een loop).
const globals = require('globals');

const CORE_RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'require-await': 'warn',
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-fallthrough': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-async-promise-executor': 'error',
};

module.exports = [
  { ignores: ['node_modules/**', '**/*.json', 'styles.css'] },
  {
    // De app zelf: ES-modules, draait in de browser.
    files: ['app.js', 'ai.js', 'utils.js', 'typo.js', 'srs.js', 'fsrs.js', 'grammar-topics.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // GRAMMAR_TOPICS wordt gezet door grammar-topics.js, een KLASSIEK <script> dat in index.html
        // vóór app.js (dat als <script type="module"> automatisch uitgesteld wordt) laadt en dus als
        // gewone browser-global beschikbaar is tegen de tijd dat app.js draait -- geen import nodig
        // (en ook niet mogelijk, want grammar-topics.js is bewust geen module).
        GRAMMAR_TOPICS: 'readonly',
      },
    },
    rules: CORE_RULES,
  },
  {
    // De testsuite: gewone Node-scripts (CommonJS, require()) -- staan plat in dezelfde map als de
    // app zelf, herkenbaar aan hun bestandsnaam (*.test.js, plus de twee hulpbestanden).
    files: ['*.test.js', 'extract.js', 'run-all.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...CORE_RULES,
      // Testbestanden bootsen bewust async API's (callAI, askDeepSeekJudge, ...) na met stub-functies
      // die zelf niets hoeven te awaiten -- dat is hier een legitiem, herhaald patroon (de stub moet
      // een Promise teruggeven, geen bug), niet iets om op te lossen.
      'require-await': 'off',
    },
  },
  {
    // browser.test.js is zelf een Node-script, maar de page.evaluate()-callbacks erin worden door
    // Puppeteer geserialiseerd en in de BROWSER uitgevoerd -- die verwijzen dus legitiem naar
    // document/window e.d., vandaar hier zowel node- als browser-globals.
    files: ['browser.test.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { ...CORE_RULES, 'require-await': 'off' },
  },
];
