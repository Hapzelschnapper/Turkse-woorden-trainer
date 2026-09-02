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

## v3.82 — "Add anyway"/dispuut op een tr-en-kaart onthoudt voortaan écht iets
- **Bug**: een geaccepteerd dispuut of "Add anyway" op een tr-en-oefening (Turks getoond, Engels getypt)
  herstelde alleen de score van DIE ene beurt (`scheduleReview(p, GRADE_EASY)`), maar sloeg het
  geaccepteerde Engelse antwoord zelf nergens op. `promptAddTranslation()` — de enige plek die zoiets
  blijvend bewaart — werd alleen aangeroepen bij `direction === "en-tr"`, en slaat sowieso alleen Turkse
  antwoorden op. Gevolg: exact dezelfde tr-en-kaart kwam de eerstvolgende keer gewoon weer fout uit,
  ondanks een net geaccepteerd dispuut.
- Nieuwe, eigen opslag `customEn` (`{ [trProgressKey]: {en:[...]} }`, key = de "trword:..."-progressKey
  uit `TR_WORDS_DATA`, niet het Engelse trefwoord zelf — meerdere, los gecureerde tr-en-kaarten kunnen
  hetzelfde Engelse trefwoord delen) + nieuwe `promptAddEnglishAnswer()`, aangeroepen op exact dezelfde
  twee plekken als `promptAddTranslation()` (geaccepteerd AI-dispuut, en de "Add anyway"-knop), nu voor
  BEIDE richtingen i.p.v. alleen en-tr.
- `checkStaticMatch()`'s tr-en-tak raadpleegt `customEn` nu ook — inclusief bij een woord met een
  disambiguatie-hint (`item.note`), want een dispuut is al eens expliciet tegen die ene betekenis
  beoordeeld.
- `customEn` volledig meegenomen in de gist-sync (push/pull), net als `custom`.
- 2 nieuwe tests in `static-match.test.js` — totaal nu 115 tests over 13 bestanden.

## v3.81 — "Ask AI"-chat: minder betuttelend, altijd de vraag beantwoorden
- Naar aanleiding van een gemeld voorbeeld waarbij de chat een terechte, gerelateerde vraag (over
  "kabı" tijdens het oefenen van "ayak") herhaaldelijk afwimpelde als "niet relevant" — om vervolgens
  alsnog de relatie te erkennen (ayak + kap = ayakkabı = shoe) nadat de gebruiker had aangedrongen.
- **Bevinding**: de bestaande systeemprompt bevatte geen enkele instructie die dit gedrag zou moeten
  veroorzaken — puur emergent modelgedrag, dus opgelost door het expliciet tegen te spreken.
- `askDeepSeekFree`'s systeemprompt instrueert nu expliciet: altijd de vraag volledig en rechtstreeks
  beantwoorden, nooit voortijdig "niet relevant" afwijzen, eerst grondig nadenken over een mogelijke
  relatie met het geoefende woord (samengesteld woord, gedeelde stam, klankgelijkenis) vóórdat je
  concludeert dat iets ongerelateerd is, en geen betuttelende toon of herhaalde aansporingen om terug
  te keren naar de oefening.
- 4 nieuwe tests (`ask-ai-chat.test.js`) die bevestigen dat deze instructies daadwerkelijk in de
  systeemprompt terechtkomen. Totaal nu 109 tests over 13 bestanden.

## v3.80 — Turkse tekens inwisselbaar met hun gewone equivalent (matchesTrList)
- Alsnog doorgevoerd: eerder voorgesteld en impliciet blijven liggen na een zijspoor naar andere
  onderwerpen. `matchesTrList` (de kernvergelijking binnen `checkStaticMatch`, gebruikt door zowel de
  eerste poging als de herkansing) maakt Turkse diacritische tekens nu plat naar hun gewone Latijnse
  equivalent vóór de vergelijking: "kus" matcht nu met "kuş", "sehir" met "şehir", "agac" met "ağaç",
  etc. — in beide richtingen (antwoord én de bekende vertaling).
- Bewust GEEN typo-tolerantie: een echt andere spelling (letterverwisseling, ontbrekende letters)
  blijft gewoon fout — expliciet getest dat dit onderscheid standhoudt.
- Geldt automatisch voor zowel de eerste poging als een herkansing, aangezien `checkStaticMatch` door
  beide gebruikt wordt — geen aparte wijziging nodig voor de herkansing zelf.
- 5 nieuwe tests, plus de bestaande `foldTurkishDiacritics`-stub in de testsuite vervangen door een
  echte, functionele implementatie (was eerder ontbrekend, brak de bestaande tests bij het draaien).
  Totaal nu 105 tests over 12 bestanden.

## v3.79 — Kale woordtransformatie voor ci_eki/ce_eki, i.p.v. zinnen
- Naar aanleiding van een te complexe zin bij "Manner/Opinion Suffix -ce/-ca" (25+ woorden, terwijl het
  eigen framework al "Keep it SHORT (2-5 words)" eiste): op verzoek teruggebracht naar de kale
  woordtransformatie die je eigenlijk wilde (bv. iş → işçi, boer → çiftçi, Türk → Türkçe) — geen zin,
  ook geen korte frase, puur het woordpaar.
- Nieuwe `generateBareSuffixDrillForTopic` (`ai.js`), specifiek voor twee onderwerpen:
  - **ci_eki** (agent/beroep, bv. işçi): hergebruikt dezelfde beheerste-naamwoorden-pool als de
    bestaande Special-tab-suffix-trainer, maar toetst het specifieke onderwerp dat de les kiest.
  - **ce_eki** (manner/opinion): de "gorus"-variant (bence/sence/bizce/sizce) gebruikt zelfs **geen
    AI-call meer** — een vaste, kleine set, dus gratis en deterministisch. De "zarf"-variant
    (hızlı → hızlıca) vraagt de AI om alleen het kale woordpaar, geen zin.
- Nieuwe gedeelde routeerfunctie `generateGrammarDrillForTopic` (`app.js`): stuurt deze twee
  onderwerpen naar de nieuwe kale-woord-generator, alle overige grammatica-onderwerpen ongewijzigd
  naar de bestaande, zin-gerichte `generateGrammarDrill` — gebruikt door zowel de Knowledge
  Check als lesgebonden Skill Practice.
- 8 nieuwe tests (`bare-suffix-drill.test.js`) — onderweg zelf een flaky test gevonden en gecorrigeerd
  (een aanname die alleen bij een bepaalde willekeurige richting klopte). Totaal nu 100 tests over
  12 bestanden.

## v3.78 — Niveausprong bij oude woorden: migratie herberekent nu direct, niet pas bij de volgende beurt
- Naar aanleiding van een gemeld, onverwacht grote niveausprong (niveau 7 → 9 bij een gewoon goed
  antwoord, zonder dispuut) bleek de oorzaak te zitten in `migrateLegacyProgress` (fsrs.js): bij een
  woord van vóór de FSRS-omschakeling werd `stability`/`difficulty` wél meteen gebootstrapt vanuit het
  oude, opgeslagen interval, maar het WEERGEGEVEN `level`-getal bleef het oude (mogelijk niet meer
  kloppende) getal tot de eerstvolgende beurt dat toevallig overschreef — waardoor die eerstvolgende
  beurt een sprong kon tonen die grotendeels de eenmalige systeemovergang zelf was, niet de uitkomst
  van die ene beurt.
- Fix: `p.level`/`p.ease` worden nu DIRECT bij de migratie zelf herberekend vanuit de nieuw
  gebootstrapte `stability`/`difficulty`, i.p.v. te wachten op de volgende `scheduleReview()`-aanroep.
- Raakt alleen woorden die sinds de FSRS-omschakeling nog niet opnieuw geoefend zijn (een klein,
  krimpend groepje) — elk woord dat al minstens één keer sindsdien beoordeeld is, was al lang
  gemigreerd en blijft ongewijzigd.
- 2 nieuwe tests in `fsrs.test.js`, en apart geverifieerd met de exacte, door de gebruiker gemelde
  situatie nagebouwd (niveau 7 weergegeven, 2 dagen daadwerkelijk interval) tegen de echte,
  ongemockte code: levert nu direct niveau 5 op (de eerlijke positie) i.p.v. de verouderde 7 te laten
  staan — totaal nu 92 tests.

## v3.77 — Ingediend antwoord blijft zichtbaar, ook bij een herhaalde herkansing
- **Bug**: bij een fout antwoord op een los woord werd het invoerveld geleegd (bedoeld voor het
  opnieuw intypen van het juiste antwoord), maar daardoor toonde een volgende foute herkansing géén
  enkele aanwijzing meer van wat je net had getypt ("Not quite yet — type X to continue", zonder je
  eigen antwoord erbij). Bovendien stuurde "I disagree" na zo'n herkansing een LEEG antwoord mee naar
  de AI, omdat het simpelweg de (inmiddels lege) live veldwaarde uitlas.
- Nieuwe `lastSubmittedAnswer`-status onthoudt wat er daadwerkelijk werd ingediend, onafhankelijk van
  het invoerveld. Elke herkansing-melding toont nu "wrong answer: <je antwoord>" (consistent met hoe
  de allereerste foute poging dat al deed), en `disputeAnswer()` gebruikt voor woord-oefeningen dit
  onthouden antwoord i.p.v. het live veld.
- Geverifieerd met een echte browsertest: bevestigd dat zowel de eerste fout, een herhaalde
  herkansing-fout, én het dispuut daarna stuk voor stuk het juiste, daadwerkelijk getypte antwoord
  tonen/gebruiken — niet alleen aangenomen.

## v3.76 — Voorlezen van de hele leestekst, met pauzeren en automatisch stoppen bij tabwissel
- Nieuwe voorleesknoppen (🔊/🐢/🐌) boven de tekst op het Reading-scherm: leest de VOLLEDIGE tekst
  hardop voor op de gekozen snelheid, zelfde onderliggende patroon als de bestaande knoppen elders.
- Nieuwe ⏸️/▶️-knop, alleen zichtbaar zolang er daadwerkelijk wordt voorgelezen — pauzeert/hervat via
  de browser-eigen `speechSynthesis.pause()`/`.resume()`.
- **Elke tabwissel breekt lopend voorlezen nu af** (`speechSynthesis.cancel()`, in `switchTab()`),
  ongeacht van/naar welk tabblad — de knop-zichtbaarheid wordt daarbij ook los, expliciet gereset,
  onafhankelijk van of de browser's `onend`/`onerror`-events zich overal identiek gedragen na een
  handmatige cancel().
- Geverifieerd met een volledig gecontroleerde speechSynthesis-simulatie (headless Chrome heeft vaak
  geen echte TTS-stemmen): bevestigd dat spreken/pauzeren/hervatten/tabwissel-annuleren en de juiste
  snelheid per knop allemaal exact overeenkomen met het bedoelde gedrag. Onderweg twee eigen
  testfouten gevonden en gecorrigeerd (een read-only `window.speechSynthesis`-eigenschap die een platte
  toewijzing stilzwijgend negeerde, en een onvolledige mock die `addEventListener` miste).

## v3.75 — Extra-slow-uitspraakknop (🐌)
- Nieuwe knop naast de bestaande "slow" (🐢, snelheid 0,5) op zowel het hoofdscherm als het
  dictee-scherm: 🐌, snelheid 0,3 — merkbaar trager dan de bestaande langzame stand, maar niet zo
  extreem laag dat de meeste browsers' spraaksynthese er glitchy van wordt.
- Verschijnt/verdwijnt gelijk met de andere uitspraakknoppen (zelfde toon-logica).
- Geverifieerd met een echte browsertest: bevestigd dat de knop op beide schermen daadwerkelijk
  snelheid 0,3 doorgeeft aan de spraaksynthese (niet alleen zichtbaar, ook functioneel correct).

## v3.74 — Markdown-opmaak echt laten renderen (i.p.v. onderdrukken, correctie op v3.73)
- **Terechte correctie op v3.73**: opmaak (vet/cursief/koppen/opsommingen) is juist nuttig — het
  probleem was nooit dat de AI opmaak gebruikte, maar dat de app 'm niet weergaf (platte tekst, dus
  sterretjes bleven letterlijk zichtbaar). `PLAIN_TEXT_GUARD` (die opmaak verbood) is vervangen door
  `FORMATTING_GUARD`, die opmaak juist aanmoedigt waar het de leesbaarheid helpt, maar wel licht houdt
  (korte feedbackfragmenten, geen volle documentopmaak).
- Nieuwe `renderMarkdownLite()` (`utils.js`): zet **vet**, *cursief*, #koppen (als vet weergegeven),
  opsommingslijsten en genummerde lijsten om naar echte HTML — ALTIJD eerst volledig ge-escaped
  (veilig tegen HTML-injectie vanuit AI-tekst), pas daarna de eigen beperkte, veilige tagset toegepast.
- Toegepast op alle plekken waar AI-tekst getoond wordt: hoofdscherm-dispuutnotitie, leesbegrip-
  feedback/verduidelijkingsvragen/referentieantwoorden, het uitleg-paneel (woord + checkup), en
  AI-chatberichten.
- 11 nieuwe tests (`markdown-lite.test.js`), inclusief een expliciete XSS-veiligheidstest (een
  `<script>`/`<img onerror=...>`-injectiepoging via AI-tekst blijft gegarandeerd onschadelijke platte
  tekst) — totaal nu 90 tests over 11 bestanden.

## v3.73 — Geen markdown-opmaak meer in AI-antwoorden (asterisks e.d.) *(ingetrokken, zie v3.74)*
- Nieuwe centrale waarborg `PLAIN_TEXT_GUARD`, naar exact hetzelfde patroon als de bestaande
  `ENGLISH_OUTPUT_GUARD`: automatisch aan ELKE systeemprompt toegevoegd via `callAI`, dus overal in de
  app tegelijk actief zonder losse aanpassingen per prompt. Verbiedt expliciet `**vet**`, `*cursief*`,
  `#`-koppen, opsommingstekens met `-`/`*`, genummerde lijsten, en backtick-codeblokken — de app toont
  AI-tekst als platte tekst, dus zulke tekens bleven voorheen letterlijk zichtbaar staan i.p.v. als
  opmaak weergegeven te worden.
- Geverifieerd door `callAI` zelf rechtstreeks aan te roepen (met alleen `callClaude`/`callDeepSeek`
  gestubd) en te bevestigen dat de daadwerkelijk verstuurde systeemprompt beide waarborgen bevat.

## v3.72 — CEFR-streepjes: definitief gefixt (absolute positionering i.p.v. vertical-align)
- Ondanks v3.71 (grotere spreiding) stond het hoge streepje nog steeds te laag. **Werkelijke
  rootcause**: `vertical-align` hangt af van de baseline/cap-hoogte-metrics van het daadwerkelijk
  gerenderde lettertype -- en mijn eigen "verificatie tegen het echte lettertype" in v3.71 was zelf
  ook gebrekkig, want mijn testomgeving heeft vermoedelijk geen Apple/Segoe UI/Roboto geïnstalleerd en
  viel dus ook terug op een vervangend lettertype, niet het lettertype dat een gebruiker daadwerkelijk
  ziet. Elke `vertical-align`-kalibratie op basis van geschatte font-metrics was daarmee inherent
  onbetrouwbaar, ongeacht welke em-waarden ik koos.
- **Definitieve fix**: volledig overgestapt van `vertical-align` naar absolute positionering
  (`position:absolute` met `top`/`bottom`/`margin-top` t.o.v. de badge zelf). Dit hangt niet af van
  font-baseline-berekeningen, dus geen giswerk meer: start = onderkant van de badge, end = bovenkant,
  mid = wiskundig exact het midden via de bewezen CSS-centreertruc (`top:50%` + `margin-top` gelijk
  aan de halve eigen hoogte) — werkt identiek ongeacht welk lettertype gerenderd wordt.
- Geverifieerd met pixel-metingen in de echte app-context: alle drie de posities kwamen exact (0,000
  afwijking) overeen met de bedoelde badge-randen, en de symmetrie tussen start↔mid en mid↔end is nu
  exact gelijk (5,000px vs 5,000px, geen enkele afronding meer).

## v3.71 — CEFR-streepjes: hoge markering stond te laag (echte lettertype-mismatch)
- Het hoge (rode) streepje stond na v3.69 nog steeds maar halverwege de letterhoogte i.p.v. erboven.
  **Rootcause**: mijn eerdere waarden (0/0,35/0,7em) waren gekalibreerd tegen een generieke
  `sans-serif`-testomgeving, terwijl de app het systeemlettertype gebruikt (`-apple-system`/Segoe
  UI/Roboto) -- dat heeft een andere cap-hoogte-verhouding, dus dezelfde em-waarden landden ergens
  anders.
- Fix: spreiding fors vergroot naar ronde getallen (start 0em / mid 0,5em / end 1em) — mid blijft
  wiskundig exact het midden (bevestigd: symmetrie-afwijking <0,02px, binnen afrondingsruis), maar de
  totale spreiding is nu groot genoeg om ook bij een afwijkende cap-hoogte-verhouding duidelijk
  laag/midden/hoog te tonen, i.p.v. precies op de grens van "net niet hoog genoeg" te balanceren.
- Geverifieerd met canvas-tekstmetingen tegen het ECHTE lettertype van de app (niet meer generieke
  sans-serif): het hoge streepje reikt nu ruim (~6,5px) boven de top van de hoofdletters uit.

## v3.70 — Leesbegrip-beoordeling: warmere toon, oorzaak/gevolg-onderscheid, verduidelijkingsvraag
- Naar aanleiding van een terecht bevonden beoordelingsfout ("waarom deed Elif X" beantwoord met "de
  tekst noemt geen reden, alleen een gevolg" werd onterecht fout gerekend): `gradeReadingAnswer`
  onderscheidt nu expliciet een genoemde OORZAAK van een genoemd GEVOLG — "de tekst vermeldt geen
  reden" telt voortaan terecht als correct wanneer dat feitelijk klopt.
- Warmere, geduldigere docenttoon in de beoordelingsprompt (bemoedigend, ook bij een fout antwoord).
- **Nieuw**: bij een écht onduidelijk/dubbelzinnig antwoord (niet zomaar fout, maar te vaag om
  te kunnen beoordelen) stelt de AI eerst een korte verduidelijkingsvraag i.p.v. meteen een oordeel te
  vellen — de vraag telt dan nog niet als "gesteld". Bij het antwoord daarop volgt altijd een
  definitief oordeel (met een ingebouwde bescherming tegen een oneindige verduidelijkingslus, ook als
  de AI zich niet aan de instructie houdt).
- 5 nieuwe tests (`reading-clarification.test.js`) — totaal nu 79 tests over 10 bestanden.

## v3.69 — CEFR-streepjes: symmetrie gefixt (echte CSS-bug)
- De start/mid/end-streepjes uit v3.68 stonden niet symmetrisch rond het midden, en het mid-streepje
  stond ook niet op de halve letterhoogte -- **rootcause**: `.cefr-badge` gebruikte
  `display:inline-flex`, en `vertical-align` heeft simpelweg GEEN effect op flex-items (flexbox
  gebruikt zijn eigen uitlijningsmechanisme). Alle drie de streepjes stonden daardoor onopgemerkt op
  exact dezelfde positie.
- Fix: `.cefr-badge` terug naar een gewone inline-weergave, zodat `vertical-align` op de
  streepjes weer normaal werkt. De onderliggende waarden (start 0em / mid 0,35em / end 0,7em) waren al
  correct opgezet om wiskundig symmetrisch te zijn (mid = precies het midden tussen start en end) --
  dat kwam alleen niet tot uiting door de flex-bug.
- Geverifieerd met een pixel-nauwkeurige meting in een geïsoleerde testpagina én in de echte
  app-context: afstand start→mid en mid→end zijn nu exact gelijk.

## v3.68 — Ingesteld moeilijkheidsbereik zichtbaar op het Practice-scherm
- Nieuwe indicator naast de bestaande badge boven het oefenscherm: toont het ingestelde CEFR-bereik
  (bv. "A2 – B1") met een klein, gekleurd streepje ná elk hoofdniveau dat het sub-niveau
  (start/mid/end) toont via kleur ÉN verticale positie — laag+groen=start, midden+oranje=mid,
  hoog+rood=end. Bewust met CSS opgebouwd i.p.v. specifieke Unicode-tekens, voor consistente weergave
  op elk toestel/lettertype.
  Werkt live mee: verandert het bereik via het Settings-schuifje, of automatisch via "Adaptive
  difficulty", dan werkt de weergave vanzelf mee (bij adaptive: bij de eerstvolgende beurt).
- Onderweg een bug gevonden en gefixt: `CEFR_SUB` (uit `utils.js`) was niet geïmporteerd in `app.js` —
  ontdekt via de eigen browsertest, vóór oplevering.

## v3.67 — Modelkeuze verborgen bij Wikipedia-bron
- Op verzoek: kies je "🌐 From the internet (Wikipedia)" als bron, dan verdwijnt de
  Cheap/Best-quality-modelkeuze uit beeld. `settings.readingModel` blijft gewoon actief op de
  achtergrond (bepaalt in die modus alleen de niveau-inschatting en de begripsvragen, niet de tekst
  zelf) — alleen de knop ervoor wordt niet meer getoond. Terug naar "AI-generated" laat 'm weer zien.

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
