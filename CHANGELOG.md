# Changelog — Türkçe Öğren

Alle noemenswaardige wijzigingen aan de app, per build-versienummer (zie `build-stamp` in
`index.html`). Voor de technische kant van opslagformaat-migraties, zie het
`SCHEMA_MIGRATIONS`-logboek bovenaan `app.js`.

## Richtlijnen voor toekomstige wijzigingen

1. **Elke wijziging krijgt hier een regel**, kort en gebruikersgericht (wat verandert er voor wie de
   app gebruikt, niet de implementatiedetails — die staan als commentaar in de code zelf).
2. **Versienummer altijd ophogen** (`+0.01` per wijziging) in `index.html` (drie plekken:
   `#loading-version`, `#build-stamp`, `#build-stamp-settings`).
3. **Wijzigt een wijziging het localStorage-opslagformaat** (betekenis of vorm van een bestaand veld,
   niet: een nieuw optioneel veld erbij) → voeg een regel toe aan `SCHEMA_MIGRATIONS` in `app.js` én
   verhoog `CURRENT_SCHEMA_VERSION`. Data-reads blijven altijd achterwaarts-compatibel (een
   ontbrekend/verouderd veld krijgt een zinnig fallback, nooit een aanname dat het al in het nieuwe
   formaat staat) — zie `loadJSON`'s default-parameter-patroon en `migrateLegacyProgress` in `fsrs.js`
   als voorbeeld. Oude velden worden nooit stilzwijgend verwijderd, puur voor rollback-veiligheid.
4. **Test vóór het opleveren**: `node tests/run-all.js` moet groen zijn. Nieuwe, geïsoleerde/pure
   logica krijgt een eigen testbestand in `tests/` (zie `tests/extract.js` voor hoe je een functie
   rechtstreeks uit `app.js`/een module test, zonder de hele app te hoeven laden).

---

---

## v3.66 — Leesoefening: echte tekst van Wikipedia als alternatief voor AI-generatie
- Nieuwe bronkeuze op het Reading-scherm zelf: **🤖 AI-generated** (bestaand) naast **🌐 From the
  internet (Wikipedia)** (nieuw) — beide beschikbaar, jij kiest per sessie.
- Wikipedia-modus: haalt een echt, willekeurig Turks Wikipedia-artikel op (publieke, CORS-vriendelijke
  MediaWiki-API, CC BY-SA-gelicenseerd, met zichtbare bronvermelding + link onder de tekst). De AI
  genereert hier NIETS aan de tekst zelf — schat alleen het CEFR-niveau in (een beoordelingstaak) en
  bedenkt de begripsvragen erover, exact zoals bij de AI-gegenereerde variant.
- Max. 5 pogingen om een artikel te vinden dat **exact** op het gevraagde niveau uitkomt (geen
  "dichtstbijzijnde"-fallback). Lukt dat niet, dan wordt **expliciet gevraagd** ("Could not find a
  Wikipedia article matching level X after 5 attempts. Generate an AI text instead?") vóórdat er
  alsnog op AI-generatie wordt teruggevallen — nooit stilzwijgend.
- Nieuwe functies in `ai.js`: `estimateTextLevel`, `findWikipediaReadingText`.
- Opgeslagen teksten tonen nu hun bron (🌐/🤖) in de "Saved texts"-lijst.
- **Eerlijke kanttekening**: de daadwerkelijke Wikipedia-aanroep kon niet end-to-end getest worden
  vanuit de ontwikkelomgeving (netwerktoegang tot wikipedia.org stond daar niet open) — wel volledig
  getest: de UI-doorloop, de bronkeuze-knoppen, de "geen API-key"-afhandeling, en de JSON-structuur
  van de MediaWiki-API-aanroep (een stabiel, goed gedocumenteerd, veelgebruikt publiek endpoint).

## v3.65 — Testbestanden plat getrokken (geen tests/-submap meer)
- Op verzoek: alle testbestanden (en `extract.js`/`run-all.js`) staan nu plat in de hoofdmap, samen
  met de rest van de app, i.p.v. in een aparte `tests/`-submap — past bij de bestaande, simpele
  "alles in de hoofdmap"-uploadwerkwijze.
- Enige onvermijdelijke uitzondering: `.github/workflows/tests.yml` moet op dat exacte pad blijven
  staan — een harde eis van GitHub zelf voor het herkennen van een CI-workflow, geen keuze.
- Interne padverwijzingen aangepast (`extract.js`, `browser.test.js`) en `package.json`/
  `eslint.config.js`/de CI-workflow bijgewerkt naar de platte bestandsnamen. Getest door de volledige
  testsuite, de browsertest én ESLint opnieuw te draaien tegen de nieuwe, platte structuur — allemaal
  nog steeds groen, exact dezelfde 9 (niet-gerelateerde) pre-existing lint-bevindingen als voorheen.

## v3.64 — Leesoefening: tekst + begripsvragen (nieuwe tab "Reading")
- Nieuwe tab: AI-gegenereerde Turkse leestekst (150-220 woorden) op instelbaar CEFR-niveau (A2-C1),
  met begripsvragen erover (inhoud, niet losse woordbetekenissen).
- **Model direct instelbaar op het scherm zelf** (🐢 Cheap/DeepSeek vs. 🎯 Best quality/Claude), met
  een live bijgewerkte, op de eigen `MODEL_PRICING` gebaseerde kosteninschatting per tekst — bewust
  zichtbaar op het scherm i.p.v. verstopt in Settings, op uitdrukkelijk verzoek.
- **Teksten en hun vragen worden blijvend opgeslagen** (`LS_READING_TEXTS`, syncet mee naar de cloud):
  elke vraag heeft een eigen `asked`-vlag, zodat een tekst later hergebruikt kan worden zonder dat een
  vraag ooit twee keer gesteld wordt. Zijn alle vragen bij een tekst al gesteld, dan kunnen er nieuwe
  vragen bij die tekst gegenereerd worden (AI krijgt de bestaande vragen expliciet te zien, om
  overlap te vermijden) i.p.v. een hele nieuwe tekst nodig te hebben.
- "Skip" markeert een vraag bewust NIET als gesteld (blijft dus gewoon beschikbaar voor een volgend
  bezoek aan die tekst) — alleen een daadwerkelijk beoordeeld antwoord telt als "gesteld".
- Nieuwe functies in `ai.js`: `generateReadingText`, `generateMoreReadingQuestions`,
  `gradeReadingAnswer`. `preferredModelFor` uitgebreid met de "reading"-categorie.
- Onderweg een pre-existing, ongebruikte `grammar`-import in `ai.js` opgeruimd (kwam los van deze
  wijziging aan het licht via ESLint).

## v3.63 — Verdere modulesplitsing: ai.js (stap 11)
- Nieuw `ai.js`: de volledige AI/beoordelingslaag (alle prompt-opbouw, generatie- en
  beoordelingslogica voor woorden, zinnen, vragen, suffix-drills en het dictee, plus de kern-API-
  aanroepen zelf) losgetrokken uit `app.js` — 68 functies/constanten, vooraf stuk voor stuk
  gecontroleerd op géén DOM-aanraking en géén volledige herroeping van de gedeelde state.
- Gedeelde state (settings/progress/overrides/EN_WORDS_DATA/...) blijft eigendom van `app.js`
  (daar staan ook de "reset"/"clear cache"-knoppen) — `ai.js` importeert die als live bindings.
  Dit resulteert in een bewuste, geverifieerd werkende circulaire import (`app.js` ↔ `ai.js`).
- **Eerlijk over het proces**: de eerste versie van deze opsplitsing miste ~38 afhankelijkheden
  (functies/constanten die verplaatste code nog nodig had) — dat kwam pas aan het licht via een
  systematische, geautomatiseerde her-scan én de echte browsertest, niet meteen bij de eerste
  poging. Elke kandidaat is stuk voor stuk nagelopen (comment-only-referentie vs. echte
  afhankelijkheid) voordat de app weer volledig werkte. Zie ook de toelichting bovenaan `ai.js`.
- `tests/static-match.test.js`, `tests/grading.test.js`, `tests/explanation-cache.test.js`
  bijgewerkt: extraheren nu uit `ai.js` i.p.v. `app.js`, waar de geteste functies naartoe zijn
  verhuisd.

## v3.62 — Tests voor checkStaticMatch, FSRS-simulatie, permanente browsertest (stap 12, 14, 15)
- **Stap 12**: 15 nieuwe tests voor `checkStaticMatch` (en zijn helpers `matchesTrList`/
  `stripTrClarifier`) — de meest complexe, tot dan toe volledig ongeteste beoordelingsfunctie van de
  app. Dekt beide richtingen, de disambiguatie-hint-vertakking, en de "ambigu Turks woord"-matching
  (bv. "ay" = month/moon).
- **Stap 14**: nieuwe simulatie-tests (`fsrs-simulation.test.js`) die honderden opeenvolgende
  oefenbeurten nabootsen i.p.v. losse eenheidstests — een makkelijk woord moet echt "mastered" raken,
  een moeilijk woord moet laag blijven, niets mag ontsporen naar NaN/oneindig/buiten de grenzen.
  Onderweg een reële, bevestigde FSRS-eigenschap ontdekt: bij consistent goed (100%) groeit stability
  ~2,2-2,8x per beurt, dus niveau 8+ al na ~4 beurten — bevestigd met een handmatige berekening tegen
  de FSRS-formules, geen bug.
- **Stap 15**: de eerdere ad-hoc, handmatige Puppeteer-browsertests van dit hele verbetertraject zijn
  omgezet naar een vaste, herhaalbare test (`tests/browser.test.js`): laadt de echte app in een
  headless Chrome, doorloopt alle hoofdtabbladen, controleert op JS-fouten. Draait automatisch mee in
  `node tests/run-all.js` en de CI — en slaat netjes (geen harde fout) over als `puppeteer` nog niet
  geïnstalleerd is, zodat de rest van de testsuite altijd zonder `npm install` blijft werken.
- Totaal nu: 80 tests over 9 testbestanden.

## v3.61 — ESLint (stap 13)
- `package.json`/`eslint.config.js` toegevoegd: een klein, gericht setje harde regels (`no-undef`,
  `no-unused-vars`, `require-await`, en een handvol andere lage-vals-positief-correctheidsregels) —
  bewust geen brede stijl-ruleset. Draait nu ook automatisch mee in de GitHub Action.
- Twee vestigiale `deviation`-variabelen opgeruimd (onbedoeld ongebruikt geworden na de stap-5-
  samenvoeging). Tien overige, pre-existing dode-code-bevindingen (functies/variabelen die al langer
  nergens meer aangeroepen worden) zijn gerapporteerd maar bewust niet zelf verwijderd.

## v3.60 — Changelog + schema-versie-boekhouding (stap 10)
- Dit bestand (`CHANGELOG.md`) toegevoegd.
- `app.js` kreeg een centraal, uitbreidbaar `SCHEMA_MIGRATIONS`-logboek — puur boekhouding (geen
  nieuwe migratielogica), zodat een toekomstige wijziging aan het opslagformaat een duidelijke plek
  heeft om zich te registreren.

## v3.59 — Uitleg-cache (stap 7)
- `explainWordContent` (het "Explanation"-paneel bij een woord) en `lookupWrongAnswerMeaning` (de
  korte "Wrong: X means Y"-regel) hergebruiken nu een eerder gegenereerde uitleg voor dezelfde
  combinatie van woord/richting/(evt.) fout antwoord, i.p.v. 'm bij elke SRS-herhaling opnieuw te
  genereren. Nieuwe instelling: "Clear cached explanations".
- Zin-uitleg (`explainSentenceContent`) blijft bewust ongecacht: zinnen zijn vrijwel altijd uniek
  gegenereerd, en de uitleg hangt af van je actuele grammatica-beheersingsniveau.

## v3.58 — AI-fouten fail-safe i.p.v. fail-closed (stap 6)
- `callAI` herkanst nu automatisch 2x (bij een infrastructuurfout, niet bij een ontbrekende API-key)
  vóór het als mislukt geldt.
- Een AI-call die na herkansen alsnog mislukt, kost niet langer SRS-terugval: de vraag blijft
  gewoon open staan, geen enkele score-mutatie, gewoon opnieuw proberen. Gold voorheen als "fout,
  je kan het disputen" op het hoofdscherm, het checkup/skill-practice-scherm, de suffix-trainer en de
  plaatsingstoets.

## v3.57 — Beoordelingslogica samengevoegd (stap 5, deel 2)
- De kern-woordbeoordeling die `submitCheckupAnswer` en `submitSkillPracticeAnswer` elk als eigen,
  bijna-identieke kopie hadden, is samengevoegd tot één functie (`gradeCheckupWordAnswer`).

## v3.56 — Correctie-opslag samengevoegd (stap 5, deel 1)
- De twee gescheiden correctiesystemen voor en-tr (`overrides`) en tr-en (`trOverrides`) zijn
  samengevoegd tot één gedeelde opslag, met één edit-modal-functie i.p.v. twee. Bestaande correcties
  worden automatisch eenmalig gemigreerd.

## v3.55 — FSRS i.p.v. handgerolde SM-2-variant (stap 4)
- Nieuw `fsrs.js`: volledige FSRS-4.5-implementatie (stability/difficulty/retrievability), met de
  gepubliceerde standaardgewichten. Vervangt de eerdere, steeds bijgeschaafde ease/interval-logica
  voor zowel woord- als grammatica-voortgang.
- Bestaande voortgang wordt automatisch en transparant gemigreerd zodra een woord voor het eerst
  weer aangeraakt wordt. `p.level`/`p.ease` blijven bestaan (nu afgeleid van stability/difficulty)
  voor UI-compatibiliteit.

## v3.54 — Bestand opgesplitst in modules (stap 3)
- Alle JavaScript uit `index.html` verplaatst naar losse ES-modules: `utils.js`, `typo.js`, `srs.js`,
  `app.js`. `index.html` laadt nu `<script type="module" src="app.js">`.

## v3.53 — Testharnas (stap 1)
- Nieuwe `tests/`-map: `node tests/run-all.js` draait de volledige testsuite. Eerste tests dekken de
  typo-tolerantie, SRS-scoring en de mix/type-keuzelogica (na een kleine, gedrag-behoudende refactor
  van `pickNextItem` om die logica los-aanroepbaar te maken).
- `.github/workflows/tests.yml`: draait de testsuite automatisch bij elke push (zichtbaar onder het
  "Actions"-tabblad van de repo).

## v3.52 — "Due exercises" i.p.v. "words to review"
- Het label op de oefenpagina duidelijker gemaakt: dit telt losse oefen-items (en-tr en tr-en apart),
  geen unieke woorden — dat is een ander, eveneens getoond getal in Stats.

## v3.51 — "Ready to practise now" als unie-telling
- Stats-teller telt nu unieke woorden die in minstens één richting (en-tr of tr-en) due zijn,
  gededupliceerd, i.p.v. alleen en-tr.

## v3.50 — Exacte woordtelling bij het dictee
- De AI-prompt voor "type what you hear" eist nu een exact aantal woorden bij de lagere niveaus
  (1-3 woorden), met een automatische herpoging als het toch niet klopt.

## v3.49 — Soepele matching voor ambigue Turkse woorden in het dictee
- Een woord met meerdere geldige Engelse vertalingen (bv. "sonra" = "then"/"after") wordt niet meer
  onterecht fout gerekend als de gebruiker de andere, even geldige betekenis intypt.

## v3.48 — tr-en-woorden corrigeerbaar
- De "✏️ Fix"-knop (Words-tab en het live oefenscherm) werkt nu ook voor tr-en-woorden, niet meer
  alleen en-tr.

## v3.47 — "Level 8+"-teller als echte unie
- Vervangt het eerdere gemiddelde (zie v3.46) door een gedededupliceerde telling: elk woord dat in
  minstens één richting niveau 8+ heeft, telt precies 1x mee.

## v3.46 — "Level 8+"-teller als gemiddelde *(later vervangen, zie v3.47)*

## v3.45 — Dictee gebruikt bij voorkeur niveau 8+ woorden
- Plus een nieuwe "level 8+ (mastered)"-teller in Stats.

## v3.44 — "Type what you hear"-dictee-oefening
- Nieuwe oefening onder de tab "Special" (voorheen alleen "Suffixes"): speelt een Turks woord/zin af,
  te vertalen naar het Engels. 7 instelbare lengte-niveaus, van 1 los woord tot 12+ woorden.

## v3.43 — Ondertitel bleef hangen tijdens het genereren van een zin
- De laadstatus ("AI is generating a sentence…") maakte niet alle relevante velden leeg.

---

*Versies vóór v3.43 zijn niet in dit changelog opgenomen (dit bestand is toegevoegd in v3.59/stap 10)
— zie de commit-geschiedenis van de repo voor de volledige, langere ontwikkelgeschiedenis
(SRS-fixes, disambiguaties, TTS, geluidseffecten, transitief/intransitief-splitsingen, en meer).*
