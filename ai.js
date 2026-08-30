// ===================== ai.js =====================
// AI/beoordelingslaag: alle prompt-opbouw, generatie- en beoordelingslogica voor woorden, zinnen,
// vragen, suffix-drills en het dictee -- plus de kern-API-aanroepen zelf (callClaude/callDeepSeek/
// callAI) en de kale, niet-UI-gebonden data-helpers waar deze functies op leunen (cachedTranslation,
// getProgress, checkStaticMatch, ...). Stap 11 van het verbeterplan (verdere modulesplitsing).
//
// Bewust in ÉÉN keer als coherent geheel verplaatst, niet functie voor functie: alle ~65 stukken hier
// zijn vooraf gecontroleerd op GEEN enkele DOM-aanraking (geen el()/document.) en GEEN enkele volledige
// herroeping van de gedeelde state (settings/progress/overrides/... -- alleen eigenschap-mutaties),
// wat deze extractie in zijn geheel aanzienlijk veiliger maakt dan het zou zijn bij een los-functie-per-
// keer-aanpak met impliciete onderlinge afhankelijkheden.
//
// GEDEELDE STATE (settings/progress/overrides/... ) blijft EIGENDOM van app.js (daar staan ook de
// "reset"/"clear cache"-knoppen die 'm volledig herroepen, bv. `progress = {}`) -- dit bestand
// importeert ze als "live bindings" en muteert uitsluitend EIGENSCHAPPEN ervan, nooit de hele
// binding zelf (dat zou ES modules sowieso niet toestaan vanuit een importerende module). Dit
// resulteert in een bewuste CIRCULAIRE import (app.js <-> ai.js): app.js roept de hieronder
// geëxporteerde generatie/beoordelingsfuncties aan, terwijl dit bestand teruggrijpt op app.js voor de
// gedeelde state. Dat werkt betrouwbaar zolang niets daarvan op het TOP-NIVEAU van een van beide
// modules (dus buiten een functie-body) gebruikt wordt vóórdat beide modules volledig geladen zijn --
// hier uitsluitend het geval, alles gebeurt pas ná gebruikersinteractie/de DOMContentLoaded-handler.

import { normalize, foldTurkishDiacritics, vocabCefrBand, cefrLabel, CEFR_MAJOR, CEFR_SUB } from './utils.js';
import { levenshteinDistance, typoTolerance } from './typo.js';
import { EASE_START } from './srs.js';
import { migrateLegacyProgress } from './fsrs.js';

import {
  settings, progress, overrides, explanationCache, trCache, curatedTr, newWords, custom,
  EN_WORDS_DATA, REVERSE_TR_INDEX, saveJSON, sleep,
  LS_TRCACHE, LS_EXPLANATION_CACHE, LS_NEWWORDS, ENGLISH_OUTPUT_GUARD,
  CEFR_LEVEL_GUIDANCE, CEFR_SUB_NOTE, DICTATION_LEVELS, GRAMMAR_TOPIC_FRAMEWORK,
  SUFFIX_DRILL_PREFERRED_VERB_LEVEL, SUFFIX_DRILL_VERB_FRAMEWORKS, SUFFIX_DRILL_NOUN_FRAMEWORKS,
  displayTrEntryGloss, displayEnglishWord, looksLikeEnglishWord, turkishWordLikelyInSentence,
  variantProgressKey, effectiveTopicForVariant, proxyConfigured, cefrOfEn, pickLessonGrammarTopic,
  pickWellKnownWord, pickTurkishTargetForSentence, pickWellKnownGrammarTopic, fetchWithTimeout,
  recordUsage, getTopicVariants, getGrammarProgress, looksLikeQuestion,
} from './app.js';

// Privé caches voor wordPosOf/wordTransitivityOf/baseEnOf hieronder -- puur lokale implementatiedetails,
// door niets anders gebruikt (vandaar hier gedeclareerd i.p.v. geëxporteerd vanuit app.js).
let _wordPosMap = null;
let _wordTransitivityMap = null;
let _baseEnMap = null;

export async function callAI(category, systemPrompt, userContentOrMessages, maxTokens, temperature, schema){
  const model = preferredModelFor(category);
  const sysWithLanguageGuard = (systemPrompt || "") + ENGLISH_OUTPUT_GUARD;
  const call = () => model === "claude"
    ? callClaude(sysWithLanguageGuard, userContentOrMessages, maxTokens, temperature, 0, schema)
    : callDeepSeek(sysWithLanguageGuard, userContentOrMessages, maxTokens, temperature, 0, schema);
  const RETRY_DELAYS_MS = [600, 1500];
  let lastError = null;
  for(let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++){
    try{
      return await call();
    }catch(e){
      lastError = e;
      if(/No (DeepSeek|Anthropic) API key set/.test(e.message)) throw e; // configuratieprobleem, niet retryen
      if(attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError; // alle pogingen (1 origineel + 2 herkansingen) faalden -- aanroeper behandelt dit als "AI onbereikbaar", zie gradeCheckupWordAnswer e.a.
}

export async function generateSuffixDrill(){
  const verbOk = canOfferVerbSuffixDrill();
  const nounOk = canOfferNounSuffixDrill();
  if(!verbOk && !nounOk) throw new Error("No exposed word + exposed matching grammar topic combination available yet.");
  const useNoun = verbOk && nounOk ? Math.random() < 0.5 : nounOk;
  return useNoun ? generateNounSuffixDrill() : generateVerbSuffixDrill();
}

export async function generateVerbSuffixDrill(){
  const verbs = masteredVerbsForSuffixDrill();
  const topics = masteredTopicsForSuffixDrillVerb();
  if(!verbs.length || !topics.length) throw new Error("No exposed verb + exposed verb-grammar topic combination available yet.");
  const verb = pickSuffixDrillVerb();
  const topic = topics[Math.floor(Math.random()*topics.length)];
  const verbTr = (await getOrFetchTranslation(verb.en))[0];
  const verbBaseEn = baseEnOf(verb.en);

  const sys = `Je maakt een "suffix"-oefening: de gebruiker moet ÉÉN Turks woord vormen door het werkwoord "${verbTr}" (Engels: "${verbBaseEn}") toe te passen op het grammaticale patroon "${topic.label}".
Patroonomschrijving: ${topic.hint}
Geef een kort, ondubbelzinnig Engels zinnetje dat PRECIES deze ene vervoegde vorm oproept (bv. "he will run", "I couldn't come", "if you read", "while eating") -- geen volledige zin met andere woorden erbij, puur de vervoeging van dit ene werkwoord in dit patroon.
KRITIEK: sommige Turkse tijden/patronen klinken in kaal Engels bijna identiek aan een ANDER Turks patroon, met name de present continuous (-iyor) versus de aorist/brede tegenwoordige tijd (-ir/-er, gewoonte/algemeen). "Do you drink?" is bijvoorbeeld ECHT dubbelzinnig: het is de natuurlijke Engelse vertaling van zowel "İçer misin?" (aorist, aanbod/gewoonte) als "İçiyor musun?" (present continuous, dit moment) -- zoiets NOOIT als prompt gebruiken. Als het patroon dat je moet oproepen present continuous is, voeg dan ALTIJD een expliciete tijdsaanduiding toe die dat ondubbelzinnig maakt ("right now", "at this moment", "currently", bv. "Are you drinking right now?"). Als het patroon aorist/gewoonte is, voeg dan juist een gewoonte-aanduiding toe ("usually", "in general", "as a rule", bv. "Do you usually drink coffee?"). Pas dezelfde voorzichtigheid toe op elk ander tijden-paar dat in kaal Engels door elkaar zou kunnen lopen (bv. -di vs -miş verleden tijd: voeg toe of het zelf gezien is dan wel gehoord/afgeleid).
Geef de correcte Turkse vervoeging (normaal gesproken één woord; alleen als het patroon dat grammaticaal vereist -- bv. bij "değil" of een hulpwerkwoord-constructie -- een vaste, korte woordgroep).
Geef ook een STAP-VOOR-STAP MORFEEM-OPBOUW ("breakdown"): een array van de KALE werkwoordstam (zonder -mek/-mak, bv. "gel" niet "gelmek") tot en met de volledige vervoegde vorm, waarbij ELKE volgende stap EXACT ÉÉN achtervoegsel/morfeem meer bevat dan de vorige. Elke stap krijgt "form" (de Turkse vorm tot en met dat achtervoegsel) en "meaning" (de Engelse betekenis van de vorm OP DIE STAP, zodat de betekenisverandering door dat ene toegevoegde achtervoegsel duidelijk wordt). De eerste stap is altijd de kale stam, maar toon in "form" ERACHTER tussen haakjes het infinitiefachtervoegsel voor de volledigheid (bv. "oyna(mak)", "gel(mek)") -- dat achtervoegsel telt niet mee als een aparte opbouwstap, het is puur ter herkenning van het woordenboek-lemma; "meaning" van die eerste stap is de kale/infinitiefbetekenis (bv. "play"/"to play"). De laatste stap is EXACT gelijk aan "correct" (zonder haakjes-toevoeging). Gebruik zoveel stappen als het patroon daadwerkelijk vereist (meestal 2-4) -- verzin geen kunstmatige tussenstap die geen echte taalkundige eenheid is.
KRITIEK VOOR DE "meaning" VAN ELKE TIJD/ASPECT-STAP: een Turks tijd-achtervoegsel (met name -dı/-di/-tı/-ti "getuige/zekere verleden tijd" en -mış/-miş "gehoorde/afgeleide verleden tijd", maar ook -ır/-er aorist, -ecek/-acak toekomst, -iyor present continuous) drukt ZELF alleen tijd/aspect uit, NOOIT een grammaticaal persoon -- de persoonsuitgang (ik/jij/hij-zij-het/wij/jullie/zij) is in het Turks een APART, los achtervoegsel dat er eventueel PAS DAARNA bovenop komt (en bij de 3e persoon enkelvoud vaak zelfs helemaal ontbreekt, "onmarked"). Schrijf de "meaning" van een stap die zo'n tijd/aspect-achtervoegsel toevoegt dus NOOIT alsof dat achtervoegsel zelf een persoon aanduidt (fout voorbeeld: "oynadı" -> "he/she played", wat suggereert dat -dı "hij/zij" betekent) -- benoem in plaats daarvan expliciet de tijd/het aspect, bv. "oynadı" -> "played (witnessed past; no personal suffix yet, so this reads as 3rd person by default)". Pas als een LATERE stap er daadwerkelijk een eigen persoonsachtervoegsel aan toevoegt, benoem dat er dan expliciet bij, bv. "oynadım" -> "I played (witnessed past + 1st person singular -m)".
Antwoord in JSON.`;
  const schema = {
    name: "suffix_oefening",
    description: "Eén woord-vervoegingsoefening op basis van een beheerst werkwoord en een beheerst grammaticapatroon, met stap-voor-stap morfeem-opbouw.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {type:"string", description:"Kort, ONDUBBELZINNIG Engels zinnetje dat precies deze ene vervoegde vorm oproept -- bij tijden die in kaal Engels door elkaar kunnen lopen (m.n. present continuous vs. aorist/gewoonte) MOET een expliciete tijdsaanduiding ('right now'/'usually'/etc.) worden toegevoegd."},
        correct: {type:"string", description:"De correcte Turkse vervoegde vorm."},
        breakdown: {
          type: "array",
          description: "Stap-voor-stap morfeem-opbouw: van de kale werkwoordstam (met infinitief-achtervoegsel tussen haakjes, bv. 'oyna(mak)') tot de volledige vorm, elke stap precies 1 achtervoegsel meer dan de vorige. Laatste stap = 'correct'. Een tijd/aspect-achtervoegsel (-dı/-miş/-ır/-ecek/-iyor) is GEEN persoonsuitgang -- benoem in 'meaning' expliciet de tijd/het aspect, nooit een persoon, tenzij er ook daadwerkelijk een eigen persoonsachtervoegsel is toegevoegd.",
          items: {
            type: "object",
            properties: {
              form: {type:"string", description:"De Turkse vorm tot en met dit achtervoegsel (eerste stap: kale stam + infinitief tussen haakjes, bv. 'oyna(mak)')."},
              meaning: {type:"string", description:"De Engelse betekenis van de vorm op deze stap. Bij een tijd/aspect-achtervoegsel: noem expliciet de tijd/het aspect (bv. 'played (witnessed past)'), NOOIT alsof het achtervoegsel zelf een persoon aanduidt. Bij een persoonsachtervoegsel: benoem dat expliciet (bv. 'I played (witnessed past + 1st person singular -m)')."},
            },
            required: ["form","meaning"],
          },
        },
      },
      required: ["prompt","correct","breakdown"]
    }
  };
  const raw = await callAI("sentence", sys, `Werkwoord: ${verbBaseEn} (${verbTr}) | Patroon: ${topic.label}`, 700, 0.5, schema);
  let parsed = parseAIJson(raw);
  if(!parsed.prompt || !parsed.correct) throw new Error("AI did not return a valid suffix drill.");
  // BUGFIX: sommige patronen (met name de 2e-persoon-enkelvoud-imperatief) vallen in het Turks samen
  // met de KALE stam van het werkwoord (bv. "gel!" = gewoon de stam "gel"). Als het patroon dat getest
  // wordt NIET zelf de imperatief is, maar de AI toch zo'n kale, van de stam niet te onderscheiden vorm
  // teruggeeft, is de oefening onoplosbaar zonder context. Wordt zo'n dubbelzinnige kale vorm gedetecteerd,
  // dan wordt één keer opnieuw gevraagd met een expliciete correctienotitie.
  function looksAmbiguousBareForm(correct){
    const stem = verbTr.replace(/mek$|mak$/i, "").trim().toLowerCase();
    return correct.trim().toLowerCase() === stem;
  }
  if(looksAmbiguousBareForm(parsed.correct)){
    const retryUser = `Werkwoord: ${verbBaseEn} (${verbTr}) | Patroon: ${topic.label}\n\nNOTE: your previous attempt gave "${parsed.correct}" as "correct" -- that is EXACTLY equal to the bare stem of the verb itself, so without extra context a user cannot tell this is meant to test the pattern "${topic.label}" rather than just the bare stem. Give a form that is clearly distinguishable from the bare stem (add the required suffix(es)/particle(s) for this pattern, or if the pattern genuinely IS the bare-stem imperative, make that unambiguous in "prompt"), for both "correct" and the last breakdown step, and only then repeat.`;
    const raw2 = await callAI("sentence", sys, retryUser, 700, 0.5, schema);
    const parsed2 = parseAIJson(raw2);
    if(parsed2.prompt && parsed2.correct) parsed = parsed2;
  }
  // BUGFIX: "prompt" mag het antwoord niet verklappen (ondanks de instructie hierboven kwam het voor
  // dat de AI de Turkse vorm toch letterlijk of tussen haakjes in de Engelse aanwijzing zelf zette, of
  // er een extra instructiezin met een vervoeg-werkwoord als "conjugate"/"form"/"inflect" in stopte).
  // Detecteert dit via drie signalen en vraagt dan één keer opnieuw met een expliciete notitie.
  function promptLeaksAnswer(prompt, correct){
    const p = prompt.toLowerCase();
    const c = correct.trim().toLowerCase();
    if(c.length >= 3 && p.includes(c)) return true;
    if(/\bconjugate|\binflect|\bform the\b/i.test(prompt)) return true;
    if(prompt.length > 70) return true;
    return false;
  }
  if(promptLeaksAnswer(parsed.prompt, parsed.correct)){
    const retryUser2 = `Werkwoord: ${verbBaseEn} (${verbTr}) | Patroon: ${topic.label}\n\nNOTE: your previous attempt gave as "prompt": "${parsed.prompt}" -- this leaks the answer (contains the Turkish form itself, literally or in parentheses) and/or contains an extra instruction sentence (e.g. with a verb like "conjugate"/"form"/"inflect" in it). "prompt" must be ONLY the short English cue sentence itself -- nothing more, no parenthetical with the Turkish form, no extra instruction sentence after it. Only then repeat.`;
    const raw3 = await callAI("sentence", sys, retryUser2, 700, 0.5, schema);
    const parsed3 = parseAIJson(raw3);
    if(parsed3.prompt && parsed3.correct && !promptLeaksAnswer(parsed3.prompt, parsed3.correct)) parsed = parsed3;
  }
  const breakdown = (Array.isArray(parsed.breakdown) && parsed.breakdown.length)
    ? parsed.breakdown.filter(s => s && s.form && s.meaning)
    : [{form: parsed.correct, meaning: parsed.prompt}]; // veiligheidsnet: geen (bruikbare) breakdown terug -> toon tenminste de eindvorm

  // Richting willekeurig kiezen -- de AI levert altijd zowel de Engelse aanwijzing (parsed.prompt) als
  // de vervoegde Turkse vorm (parsed.correct), dus welke van de twee getoond wordt en welke als
  // antwoord verwacht wordt, is puur een kwestie van welke kant we omdraaien. Bij "tr-en" moet de
  // gebruiker de BETEKENIS van de al-getoonde Turkse vorm herkennen en in het Engels vertalen i.p.v.
  // 'm zelf te produceren -- dus een ander soort vaardigheid (begrip) dan bij "en-tr" (productie).
  const englishCue = parsed.prompt;
  const turkishForm = parsed.correct;
  const direction = Math.random() < 0.5 ? "tr-en" : "en-tr";
  const prompt = direction === "tr-en" ? turkishForm : englishCue;
  const correct = direction === "tr-en" ? englishCue : turkishForm;
  return {type:"suffix", pos:"verb", en: `suffix:${verb.en}:${topic.key}`, direction, prompt, correct, englishCue, turkishForm, verbEn: verb.en, verbTr, topicKey: topic.key, breakdown};
}

export async function generateNounSuffixDrill(){
  const nouns = masteredNounsForSuffixDrill();
  const topics = masteredTopicsForSuffixDrillNoun();
  if(!nouns.length || !topics.length) throw new Error("No exposed noun + exposed noun-grammar topic combination available yet.");
  const noun = pickSuffixDrillNoun();
  const topic = topics[Math.floor(Math.random()*topics.length)];
  const nounTr = (await getOrFetchTranslation(noun.en))[0];
  const nounBaseEn = baseEnOf(noun.en);

  const sys = `Je maakt een "suffix"-oefening: de gebruiker moet ÉÉN Turks woord vormen door het zelfstandig naamwoord "${nounTr}" (Engels: "${nounBaseEn}") toe te passen op het grammaticale patroon "${topic.label}".
Patroonomschrijving: ${topic.hint}
Geef een kort, ondubbelzinnig Engels zinnetje dat PRECIES deze ene gevormde woordvorm oproept (bv. "my book", "the apples", "to the house", "a little dog") -- puur de vorming van dit ene naamwoord in dit patroon, geen extra's.
Geef de correcte Turkse vorm ("targetWord"): meestal is dit het KALE, op zichzelf staande gevormde naamwoord (zonder verdere zin eromheen), bv. "kitabım", "elmalar", "eve", "köpekçik".
SOMMIGE patronen (met name copula/var-yok/aanwijs-achtige constructies) kunnen NIET als een kaal, geïsoleerd woord natuurlijk klinken -- die hebben een minimale zin nodig (bv. "Kitap var.", "Ev büyüktür.", "Bu bir araba."). ALLEEN in dat geval: vul ook "contextSentence" in met een kort, natuurlijk Turks zinnetje (2-4 woorden) waar "targetWord" letterlijk (exact dezelfde spelling) in voorkomt. Als een kaal woord wél volstaat, laat "contextSentence" dan leeg/weg.
Geef ook een STAP-VOOR-STAP MORFEEM-OPBOUW ("breakdown"): een array van de KALE naamwoordstam tot en met "targetWord", waarbij ELKE volgende stap EXACT ÉÉN achtervoegsel/morfeem meer bevat dan de vorige. Elke stap krijgt "form" (de Turkse vorm tot en met dat achtervoegsel) en "meaning" (de Engelse betekenis op die stap). De eerste stap is de kale naamwoordstam (bv. "kitap" -> "book"). De laatste stap is EXACT gelijk aan "targetWord". Gebruik zoveel stappen als het patroon vereist (meestal 1-3).
Antwoord in JSON.`;
  const schema = {
    name: "suffix_oefening_naamwoord",
    description: "Eén woordvormingsoefening op basis van een beheerst zelfstandig naamwoord en een beheerst grammaticapatroon, met stap-voor-stap morfeem-opbouw.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {type:"string", description:"Kort, ondubbelzinnig Engels zinnetje dat precies deze ene gevormde woordvorm oproept."},
        targetWord: {type:"string", description:"De correcte, KALE Turkse gevormde vorm van het naamwoord (zonder omringende zin)."},
        contextSentence: {type:"string", description:"ALLEEN invullen als 'targetWord' onmogelijk als geïsoleerd woord kan staan (copula/var-yok/aanwijs-constructies): een kort natuurlijk Turks zinnetje waar 'targetWord' letterlijk in voorkomt. Anders leeg laten."},
        breakdown: {
          type: "array",
          description: "Stap-voor-stap morfeem-opbouw van de kale naamwoordstam tot 'targetWord', elke stap precies 1 achtervoegsel meer dan de vorige.",
          items: {
            type: "object",
            properties: {
              form: {type:"string", description:"De Turkse vorm tot en met dit achtervoegsel."},
              meaning: {type:"string", description:"De Engelse betekenis van de vorm op deze stap."},
            },
            required: ["form","meaning"],
          },
        },
      },
      required: ["prompt","targetWord","breakdown"]
    }
  };
  const raw = await callAI("sentence", sys, `Naamwoord: ${nounBaseEn} (${nounTr}) | Patroon: ${topic.label}`, 700, 0.5, schema);
  let parsed = parseAIJson(raw);
  if(!parsed.prompt || !parsed.targetWord) throw new Error("AI did not return a valid suffix drill.");
  // Zelfde lek-detectie als bij de werkwoordvariant: het Engelse aanwijs-zinnetje mag de Turkse
  // doelvorm niet verklappen.
  function promptLeaksAnswer(prompt, correct){
    const p = prompt.toLowerCase();
    const c = correct.trim().toLowerCase();
    if(c.length >= 3 && p.includes(c)) return true;
    if(prompt.length > 70) return true;
    return false;
  }
  if(promptLeaksAnswer(parsed.prompt, parsed.targetWord)){
    const retryUser = `Naamwoord: ${nounBaseEn} (${nounTr}) | Patroon: ${topic.label}\n\nNOTE: your previous attempt gave as "prompt": "${parsed.prompt}" -- this leaks the answer (contains the Turkish form itself) and/or is too long. "prompt" must be ONLY the short English cue sentence itself. Only then repeat.`;
    const raw2 = await callAI("sentence", sys, retryUser, 700, 0.5, schema);
    const parsed2 = parseAIJson(raw2);
    if(parsed2.prompt && parsed2.targetWord && !promptLeaksAnswer(parsed2.prompt, parsed2.targetWord)) parsed = parsed2;
  }
  // Als er een contextSentence is opgegeven maar targetWord er (letterlijk) niet in voorkomt, kunnen we
  // 'm niet betrouwbaar onderstrepen -- val dan veilig terug op het kale woord zonder context.
  let contextSentence = (parsed.contextSentence || "").trim();
  if(contextSentence && !contextSentence.includes(parsed.targetWord)) contextSentence = "";
  const breakdown = (Array.isArray(parsed.breakdown) && parsed.breakdown.length)
    ? parsed.breakdown.filter(s => s && s.form && s.meaning)
    : [{form: parsed.targetWord, meaning: parsed.prompt}];

  const englishCue = parsed.prompt;
  const turkishForm = parsed.targetWord;
  const direction = Math.random() < 0.5 ? "tr-en" : "en-tr";
  // en-tr: gewoon het kale doelwoord produceren (net als bij werkwoorden), geen context nodig.
  // tr-en: als er een contextSentence is, die tonen (met targetWord onderstreept -- zie
  // renderSuffixPractice) zodat duidelijk is welk woord vertaald moet worden; het te vertalen antwoord
  // blijft wel ALLEEN de betekenis van targetWord zelf, niet van de hele zin.
  const prompt = direction === "tr-en" ? (contextSentence || turkishForm) : englishCue;
  const correct = direction === "tr-en" ? englishCue : turkishForm;
  return {type:"suffix", pos:"noun", en: `suffix:${noun.en}:${topic.key}`, direction, prompt, correct, englishCue, turkishForm, contextSentence, targetWordTr: turkishForm, nounEn: noun.en, nounTr, topicKey: topic.key, breakdown};
}

export async function gradeSuffixDrillAnswer(drill, answer){
  const isNoun = drill.pos === "noun";
  // Bij een naamwoord-oefening met contextSentence toont "drill.prompt" de HELE zin (voor onderstreping
  // in de UI), maar de gebruiker hoeft alleen het doelwoord "targetWordTr"/"turkishForm" te vertalen --
  // die specifieke vorm (niet de hele zin) hoort dus in de beoordelingsprompt, niet drill.prompt zelf.
  const turkishFormForGrading = isNoun ? (drill.targetWordTr || drill.turkishForm) : drill.prompt;
  const wordLabel = isNoun ? `het zelfstandig naamwoord "${drill.nounTr}"` : `het werkwoord "${drill.verbTr}"`;
  const sys = drill.direction === "tr-en"
    ? `Je beoordeelt of de Engelse vertaling van een gebruiker de betekenis correct weergeeft van de Turkse vorm "${turkishFormForGrading}" (${wordLabel} gevormd met het patroon "${drill.topicKey}"). Een voorbeeldvertaling is "${drill.correct}", maar andere bewoordingen die hetzelfde correct weergeven zijn OOK goed (bv. "he will come" en "he's going to come" zijn beide correct voor een toekomstige tijd).
BELANGRIJK: het voorbeeld "${drill.correct}" kan een expliciet verduidelijkend woordje bevatten zoals "usually"/"right now"/"in general" -- dat woordje stond er destijds ALLEEN bij om de Engelse aanwijzing zelf ondubbelzinnig te maken (zodat die niet zowel als present continuous als aorist gelezen kon worden). Bij het beoordelen van de vertaling van de gebruiker is zo'n woordje NOOIT verplicht: een kale eenvoudige tegenwoordige tijd ("I hear") is een volledig correcte vertaling van een aorist-vorm, een kale "is/are + -ing" is een volledig correcte vertaling van -iyor, enzovoort. Reken een antwoord dus NOOIT fout omdat het woordje als "usually" of "right now" ontbreekt, zolang de gekozen Engelse tijdsvorm zelf (simple present vs. present continuous vs. simple future, etc.) bij de Turkse vorm past.
Reken het antwoord alleen FOUT als het daadwerkelijk een ANDERE tijd/aspect/persoon weergeeft dan de Turkse vorm uitdrukt (bv. tegenwoordige tijd i.p.v. toekomstige tijd, of de verkeerde persoon) -- niet om ontbrekende nuance-woordjes of stilistische verschillen.
Als het antwoord daadwerkelijk FOUT is: leg in het Engels (max 2 zinnen, geen tegenstrijdige redenering), rechtstreeks tegen de gebruiker gericht ("you"), BEKNOPT uit wat er mis is met hun vertaling "${answer}" t.o.v. wat "${turkishFormForGrading}" daadwerkelijk betekent. Als het antwoord GOED is, laat "diff" leeg.
Antwoord in JSON.`
    : `Je beoordeelt of het Turkse antwoord van een gebruiker correct is voor de opdracht "${drill.prompt}" (gebruiker moest deze Engelse frase naar de correct vervoegde Turkse vorm vertalen). Het verwachte antwoord was "${drill.correct}", maar er kunnen legitieme alternatieve correcte vormen/synoniemen bestaan. BELANGRIJK: Turks is een pro-drop-taal — het onderwerp-voornaamwoord (ben/sen/o/biz/siz/onlar) mag vrijwel altijd weggelaten OF expliciet toegevoegd worden zonder dat het antwoord fout wordt. Reken dit soort verschil dus NOOIT fout. NEGEER Turkse diakritische tekens volledig (ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c zijn onderling uitwisselbaar) en reken kleine tikfouten met een ondubbelzinnige bedoeling goed.
LET OP OP EEN MOGELIJK DUBBELZINNIGE PROMPT: als het Engelse zinnetje "${drill.prompt}" zelf, in kaal Engels, EIGENLIJK op meer dan één Turkse tijd/patroon zou kunnen slaan (het klassieke geval: een Engelse zin zonder expliciete tijdsaanduiding kan zowel de present continuous ALS de aorist/gewoonte-lezing dekken, bv. "Do you drink?" kan zowel "İçer misin?" als "İçiyor musun?" betekenen) -- en het antwoord van de gebruiker is een grammaticaal correcte vervoeging van HETZELFDE werkwoord die bij die ANDERE, even legitieme lezing hoort, reken dat dan GOED, ook al wijkt het af van "${drill.correct}". Dit is de dubbelzinnigheid van de prompt, niet een fout van de gebruiker.
Als het antwoord daadwerkelijk FOUT is: leg in het Engels (max 2 zinnen), rechtstreeks tegen de gebruiker gericht ("you"), PRECIES uit wat het verschil is tussen hun antwoord "${answer}" en de correcte vorm "${drill.correct}" -- welk achtervoegsel ontbreekt, verkeerd is, in de verkeerde volgorde staat, of welke klinkerharmonie-/medeklinkerverzachtingsfout er is. Als het antwoord GOED is, laat "diff" leeg.
Antwoord in JSON.`;
  const schema = {
    name: "beoordeel_suffix_antwoord",
    description: "Beoordeling van een suffix-oefening: correct/fout plus, bij fout, een precieze uitleg van het verschil met het eigen antwoord.",
    input_schema: {
      type: "object",
      properties: {
        correct: {type:"boolean"},
        diff: {type:"string", description:"Bij een fout antwoord: korte, precieze uitleg van het verschil met de correcte vorm. Leeg bij een correct antwoord."},
      },
      required: ["correct","diff"]
    }
  };
  const raw = await callAI("sentence", sys, `Antwoord van gebruiker: "${answer}"`, 400, 0, schema);
  return parseAIJson(raw);
}

export async function gradeGrammarDrillAnswer(drill, answer){
  const isTrEn = drill.direction === "tr-en";
  const sys = `Je beoordeelt of het ${isTrEn ? "Engelse" : "Turkse"} antwoord van een gebruiker correct is voor de opdracht "${drill.prompt}" (${isTrEn ? "gebruiker moest de Turkse vorm naar het Engels vertalen" : "gebruiker moest de Engelse frase naar het Turks vertalen"}). Het verwachte antwoord was "${drill.correct}", maar er kunnen legitieme alternatieve correcte vormen/synoniemen bestaan. BELANGRIJK: Turks is een pro-drop-taal — het onderwerp-voornaamwoord (ben/sen/o/biz/siz/onlar) mag vrijwel altijd weggelaten OF expliciet toegevoegd worden zonder dat de zin fout wordt (bv. "et" en "O et" zijn beide correct voor "it is meat"). Reken dit soort verschil dus NOOIT fout. ${isTrEn ? "" : "NEGEER Turkse diakritische tekens volledig (ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c zijn onderling uitwisselbaar) en"} kleine tikfouten met een ondubbelzinnige bedoeling reken je goed. Geef ook een korte (max 2 zinnen) uitleg in het Engels, rechtstreeks tegen de gebruiker gericht (spreek de gebruiker aan met "you") — vooral nuttig als het antwoord fout is, om te laten zien waarom. Antwoord in JSON.`;
  const schema = {
    name: "beoordeel_antwoord",
    description: "Beoordeling van een grammatica-oefening.",
    input_schema: {
      type: "object",
      properties: {
        correct: {type:"boolean"},
        uitleg: {type:"string", description:"Korte uitleg in het Engels, rechtstreeks tegen de gebruiker gericht."},
      },
      required: ["correct","uitleg"]
    }
  };
  const raw = await callAI("sentence", sys, `Antwoord van gebruiker: "${answer}"`, 300, 0, schema);
  return parseAIJson(raw);
}

export async function gradeCheckupWordAnswer(cur, answer){
  let correct = false, correctAnswerTxt = "", deviation = "", uitleg = "", spokenTr = null, aiUnavailable = false;
  if(cur.sentenceDrill){
    correctAnswerTxt = cur.sentenceDrill.correct;
    if(answer && normalize(answer) === normalize(correctAnswerTxt)){
      correct = true;
    } else if(answer){
      try{ const v = await gradeGrammarDrillAnswer(cur.sentenceDrill, answer); correct = !!v.correct; uitleg = v.uitleg || ""; }catch(e){ aiUnavailable = true; }
    }
  } else if(cur.wordSource === "tr"){
    // Rechtstreeks tr-en-item -- zelfde beoordelingslogica als het hoofd-oefenscherm (checkStaticMatch/
    // askDeepSeekJudge), NIET de en-tr-specifieke tak hieronder (die neemt cur.en als brontaal aan,
    // terwijl hier cur.tr de brontaal is).
    correctAnswerTxt = correctEnglishDisplayFor(cur);
    if(cur.peeked){
      correct = !!(answer && normalize(answer) === normalize(correctAnswerTxt));
    } else if(answer && checkStaticMatch(cur, answer)){
      correct = true;
    } else if(answer){
      try{ const v = await askDeepSeekJudge({en:cur.en, tr:cur.tr, direction:"tr-en"}, answer, false); correct = !!v.correct; uitleg = v.uitleg || ""; deviation = v.afwijking || ""; }catch(e){ aiUnavailable = true; }
    }
  } else {
    correctAnswerTxt = cur.direction === "tr-en" ? baseEnOf(cur.en) : (cur.tr || (cachedTranslation(cur.en)||[]).join(", "));
    if(!correctAnswerTxt && cur.direction !== "tr-en"){
      // De vertaling kon bij het tonen van de vraag niet worden opgehaald (bv. een tijdelijke AI-hik) --
      // cur.tr bleef toen null en de feedback zou dus een lege "Correct answer:" tonen. Nu de gebruiker
      // toch al aan het antwoorden is, alsnog één keer proberen op te halen, zodat de vertaling niet
      // blijvend onzichtbaar blijft.
      try{ const tr = await getOrFetchTranslation(cur.en); correctAnswerTxt = tr[0]; cur.tr = tr[0]; cur.senseTr = tr; }catch(e){ /* nog steeds niks -- feedback toont dan geen vertaling, het antwoord wordt wel gewoon beoordeeld */ }
    }
    if(cur.peeked){
      // Dit woord is deze beurt al gepiept (zie peekCheckupWord) -- telt sowieso als fout voor de score
      // (zie scoreCorrect bij de aanroeper), maar de WEERGAVE mag gewoon "Correct!" tonen als het
      // getypte antwoord toch letterlijk klopt (bv. met behulp van de hint-letters).
      correct = !!(answer && normalize(answer) === normalize(correctAnswerTxt));
    } else if(answer && normalize(answer) === normalize(correctAnswerTxt)){
      correct = true;
    } else if(answer){
      try{
        const verdict = await askDeepSeekJudge({en:cur.en, tr:cur.tr, direction:cur.direction, senseTr:cur.senseTr, gloss:cur.gloss}, answer, false);
        correct = !!verdict.correct;
        deviation = verdict.afwijking || "";
        uitleg = verdict.uitleg || "";
        if(correct) spokenTr = /typo|tikfout/i.test(deviation) ? (closestTrMatch(cur, answer) || cur.tr) : answer;
      }catch(e){ aiUnavailable = true; }
    }
  }
  return {correct, correctAnswerTxt, deviation, uitleg, spokenTr, aiUnavailable};
}

export function pickWordSense(en, direction){
  if(overrides[en] && overrides[en].tr && overrides[en].tr.length){
    return {tr: overrides[en].tr, gloss: null, register: "neutral"};
  }
  // tr-en richting: gebruik de ECHTE tr-en-gebaseerde tegenhanger (reverse-lookup in de apart
  // gecureerde tr-en-lijst), NIET de en-tr-vertaalkolom "achterstevoren" gelezen -- de twee richtingen
  // zijn onafhankelijk gecureerd (elk met hun eigen disambiguatie/register) en moeten dat ook blijven.
  if(direction === "tr-en"){
    const trEnOptions = REVERSE_TR_INDEX[baseEnOf(en)];
    if(trEnOptions && trEnOptions.length){
      // Bij een op woordsoort gesplitst woord (bv. "fly__v" vs "fly__n") kan REVERSE_TR_INDEX onder
      // hetzelfde basiswoord meerdere, qua woordsoort VERSCHILLENDE opties bevatten (sinek=noun vs
      // uçmak=verb) -- dan moet de optie horend bij DEZE specifieke woordsoort gekozen worden, niet
      // zomaar de eerste. Als GEEN ENKELE optie de gevraagde woordsoort heeft (bv. "call" had ooit
      // alleen een noun-optie terwijl de verb-vorm getest werd), mag er NOOIT een optie van een
      // andere woordsoort als vervanging getoond worden -- dat toont dan een woord dat feitelijk niet
      // bij de geteste betekenis hoort. In dat geval geldt dit net als "geen tr-en-tegenhanger bekend"
      // (zie hieronder): null teruggeven, oefening valt terug op en-tr. Alleen als het woord ZELF geen
      // woordsoort-info heeft (niet gesplitst) is de eerste optie een redelijke standaardkeuze.
      const wantedPos = wordPosOf(en);
      const wantedTransitivity = wordTransitivityOf(en);
      if(wantedPos){
        const candidates = trEnOptions.filter(o => o.pos === wantedPos);
        // Als er meerdere kandidaten met dezelfde woordsoort zijn ÉN dit woord een transitivity-
        // onderscheid heeft, moet die ook matchen (bv. değiştirmek vs değişmek, allebei "verb").
        // Zonder zo'n onderscheid (verreweg de meeste woorden) is de eerste woordsoort-match voldoende.
        const posMatch = (wantedTransitivity && candidates.length > 1)
          ? candidates.find(o => o.transitivity === wantedTransitivity)
          : candidates[0];
        if(!posMatch) return null;
        return {tr: [posMatch.tr], gloss: posMatch.gloss || null, note: posMatch.note || null, register: posMatch.register || "neutral"};
      }
      const chosen = trEnOptions[0];
      return {tr: [chosen.tr], gloss: chosen.gloss || null, note: chosen.note || null, register: chosen.register || "neutral"};
    }
    // Geen echte tr-en-tegenhanger bekend voor dit woord -> BEWUST geen terugval meer op de en-tr-data:
    // de twee richtingen delen geen brondata. null teruggeven zodat de aanroeper (renderPractice) de
    // oefening voor dit woord gewoon als en-tr afhandelt in plaats van een tr-en-oefening te tonen die
    // stiekem toch uit de en-tr-lijst put.
    return null;
  }
  const curated = curatedTr[en];
  if(curated && Array.isArray(curated.senses) && curated.senses.length){
    const senses = curated.senses;
    // altijd de EERSTE (primaire) betekenis, geen willekeurige keuze -- voorkomt dat een vage, minder
    // gangbare betekenis als opgave voorgelegd wordt in plaats van de meest voor de hand liggende.
    const chosen = senses[0];
    // gloss/note alleen tonen als er ook daadwerkelijk iets te disambigueren valt (>1 zin). "note" is
    // een korte, ALTIJD zichtbare Engelse betekenis-hint (bv. "(approximately)" vs "(concerning)") --
    // in tegenstelling tot "gloss", dat alleen aan de AI-beoordelaar werd doorgegeven en de gebruiker
    // zelf dus nooit vooraf kon zien welke van de meerdere losstaande betekenissen bedoeld was.
    return {tr: chosen.tr, gloss: chosen.gloss || null, note: chosen.note || null, register: chosen.register || "neutral"};
  }
  const tr = cachedTranslation(en);
  return tr ? {tr, gloss: null, note: null, register: (curated && curated.register) || "neutral"} : null;
}

export async function gradeSingleTestItem(item, answer){
  if(!answer) return false;
  if(normalize(answer) === normalize(item.correct_en || "")) return true;
  const sys = `Je beoordeelt of het Engelse antwoord van een gebruiker een acceptabele vertaling is van het Turkse item "${item.tr}". De meest gangbare vertaling is "${item.correct_en}", maar legitieme synoniemen/kleine varianten mogen ook goed zijn. Antwoord in JSON.`;
  const schema = {
    name: "toets_antwoord",
    description: "Of een Engels antwoord een acceptabele vertaling is.",
    input_schema: {
      type: "object",
      properties: { correct: {type:"boolean"} },
      required: ["correct"]
    }
  };
  try{
    const raw = await callAI("sentence", sys, `Antwoord van gebruiker: "${answer}"`, 150, 0, schema);
    return !!(parseAIJson(raw).correct);
  }catch(e){ return false; }
}

export function pickKnownVocabSample(count, minLevel){
  const threshold = minLevel ?? 7;
  const allMastered = baseWordList().map(w=>w.en).filter(en => getProgress(en).level >= threshold);
  const mastered = allMastered.filter(inCefrRangeEn);
  const pool = mastered.length ? mastered : allMastered;
  const shuffled = [...pool];
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  return shuffled.slice(0, count);
}

export async function generateSentenceCandidate(targetWord, grammarTopic, _levelOverride, _correctionNote, _vocabLevelOverride){
  const level = _levelOverride ?? pickSentenceComplexityLevel();
  // Apart woordniveau-plafond, losgekoppeld van de zinscomplexiteit -- dit was voorheen impliciet
  // gelijk aan "level" (complexiteit), waardoor bv. complexiteit=max + woordniveau=min de check nooit
  // liet falen (elk woord ligt onder complexiteit-17). Nu expliciet uit de eigen sentenceVocab-slider.
  const vocabLevel = _vocabLevelOverride ?? pickLevelInRange(settings.cefrMin, settings.cefrMax); // zelfde bereik als de gewone woordoefening (samengevoegd)
  const knownSample = pickKnownVocabSample(35);
  // Systeeminstructie bevat GEEN enkele per-aanroep-variabele meer (geen niveau, geen woord, geen
  // willekeurige woordsteekproef) -- dat is precies wat prompt-caching effectief maakt: deze tekst is
  // bij ELKE aanroep van deze functie letterlijk identiek, dus na de allereerste keer draait vrijwel
  // elke volgende aanroep tegen het veel lagere cache-hit-tarief i.p.v. steeds als nieuwe input te tellen.
  const sys = `Je maakt korte, natuurlijke Turkse oefenzinnen voor een taalleerapp, afgestemd op een specifiek taalniveau dat per aanroep wordt meegegeven.
De zin moet vooral grammaticaal correct en natuurlijk klinken voor een moedertaalspreker — dat weegt zwaarder dan het geforceerd verwerken van het opgegeven doelwoord.
Vermijd zinnen die zichzelf tegenspreken of onlogisch klinken (bv. een vraag en het antwoord daarop in één zin proppen).
Let op naamval-consistentie: een kaal (naamvalloos) zelfstandig naamwoord vlak vóór het werkwoord wordt in het Turks standaard gelezen als ONDERWERP, niet als lijdend voorwerp. Is een naamwoord in de zin bedoeld als lijdend voorwerp van een overgankelijk werkwoord, geef het dan de juiste accusatief-uitgang (-ı/-i/-u/-ü of -yı/-yi/-yu/-yü) — anders verandert de betekenis van de zin ongemerkt (bv. "Kitaplar tanıyor" betekent "de boeken kennen [iets]", niet "hij/zij kent de boeken"; dat laatste vereist "Kitapları tanıyor").
Let ook op bezittelijkheid-consistentie: gebruik je een bezittelijk voornaamwoord (benim/senin/onun/bizim/sizin/onların) vóór een zelfstandig naamwoord, dan moet dat naamwoord ALTIJD ook zijn eigen bezittelijke uitgang dragen — het voornaamwoord alleen is in het Turks nooit voldoende, in tegenstelling tot het Engels waar "my house" zonder extra uitgang werkt (bv. "benim ev" is FOUT, het moet "benim evim" zijn: ev + -im; "Benim inek çok süt veriyor" is om dezelfde reden fout, het moet "Benim ineğim çok süt veriyor" zijn: inek + -im, met k→ğ verzachting).
Als een grammaticaal onderwerp is opgegeven: bouw de zin zodanig dat die daar duidelijk en natuurlijk gebruik van maakt — dat is het onderdeel waar de gebruiker extra oefening nodig heeft. Gebruik het onderwerp op een gevarieerde manier: wissel bijvoorbeeld af tussen het woord/de vorm los als onderwerp/lijdend voorwerp, vlak vóór een zelfstandig naamwoord, en (waar van toepassing) in een vraagzin — verzin niet steeds hetzelfde soort zin (bv. niet steeds een simpele "X is van mij"-bezitszin).
Varieer ook actief in zinsstructuur over aanroepen heen: wissel af tussen bevestigende zinnen, ontkennende zinnen, vragen (waar dat past bij het onderwerp), en verschillende werkwoorden/situaties — vermijd een vast sjabloon dat je telkens herhaalt.
BELANGRIJK: zinscomplexiteit (zinsbouw, lengte, aantal bijzinnen) en woordmoeilijkheid (welke woorden je gebruikt) zijn TWEE APARTE dingen die je per aanroep los te horen krijgt. Een complexe zinsbouw kan en moet met simpele woorden gebouwd worden als het opgegeven woordniveau laag is — een lang, formeel, ambtelijk-klinkend of literair register is dan GEEN excuus om toch moeilijke woorden te gebruiken. Bouw liever een langere zin met alleen eenvoudige woorden en veel herhaling/omschrijving dan een kortere zin met één moeilijk woord.
Als een lijst van bekende woorden is opgegeven: de gebruiker kent nog niet alle Turkse woorden op het gevraagde woordniveau. Dit is een HARDE eis, geen voorkeur: voor ELK woord in de zin buiten het doelwoord geldt dat het OF letterlijk uit die bekende-woordenlijst komt, OF een simpel functiewoord is (voornaamwoord, is/zijn, veelvoorkomend bijwoord), OF zelf niet zwaarder is dan het opgegeven WOORDNIVEAU (niet het zinscomplexiteitsniveau — die twee kunnen ver uit elkaar liggen). Verzin nooit een onnodig zelfstandig naamwoord/werkwoord/bijvoeglijk naamwoord van een hoger woordniveau dan gevraagd, ook niet als dat "natuurlijker" zou klinken of beter bij het formele register past -- eenvoud van woordkeuze weegt hier zwaarder dan een verfraaiing.
Geef ook een lijst van alle betekenisvolle woorden in de zin (zelfstandige naamwoorden, werkwoorden, bijvoeglijke naamwoorden, bijwoorden, telwoorden, voornaamwoorden — GEEN losse achtervoegsels), elk in hun woordenboek-basisvorm (bv. "yedim" -> "yemek", "elmayı" -> "elma"), met de meest gangbare Engelse vertaling (één woord/uitdrukking, geen lijst) van die basisvorm, en een schatting van het CEFR-niveau van dat basiswoord zelf op de schaal 0-17 (0-2=A1, 3-5=A2, 6-8=B1, 9-11=B2, 12-14=C1, 15-17=C2), ongeacht het niveau van de hele zin. Controleer deze lijst zelf nog eens tegen de zin voordat je antwoordt: ELK betekenisvol woord uit de zin moet er precies ÉÉN keer in staan — geen enkele overslaan, en geen woord dubbel opnemen ook al komt het meerdere keren in de zin voor.
Antwoord in JSON.`;
  const user = `Zinscomplexiteit: ${cefrLabel(level)}. ${cefrGuidance(level)}
Woordniveau-plafond (apart van de complexiteit hierboven): ${cefrLabel(vocabLevel)} — ELK woord in de zin (behalve het doelwoord en simpele functiewoorden) moet op of onder dit niveau liggen, ongeacht hoe complex de zinsbouw zelf moet zijn.
Doelwoord: "${targetWord}" (vervoegd/verbogen mag, ook in een complexere vorm als de zinscomplexiteit dat vraagt).
${grammarTopic ? `Grammaticaal onderwerp om te verwerken: "${grammarTopic.label}" (${grammarTopic.hint}).` : ""}
${knownSample.length ? `Bekende woorden van de gebruiker: ${knownSample.map(en=>`"${cachedTranslation(en)?.[0]||en}"`).join(", ")}` : ""}
${recentGeneratedTr.length ? `Vermijd een zin die qua opbouw/structuur sterk lijkt op deze recent gegenereerde zinnen (ander doelwoord is niet genoeg — verzin een andere zinsvorm/situatie): ${recentGeneratedTr.map(s=>`"${s}"`).join(" / ")}` : ""}
${_correctionNote || ""}`;
  const schema = {
    name: "zin_kandidaat",
    description: "Een Turkse oefenzin plus de betekenisvolle woorden erin.",
    input_schema: {
      type: "object",
      properties: {
        tr: {type:"string", description:"De Turkse zin."},
        words: {
          type:"array",
          items: {
            type:"object",
            properties: {
              tr: {type:"string", description:"Woordenboek-basisvorm."},
              en: {type:"string", description:"Meest gangbare Engelse vertaling."},
              cefr: {type:"integer", minimum:0, maximum:17},
            },
            required: ["tr","en","cefr"]
          }
        },
      },
      required: ["tr","words"]
    }
  };
  // Temperature was 0.3 -- samen met de vaste systeemprompt (bewust identiek voor prompt-caching, zie
  // hierboven) en een instructie die eenvoud boven alles stelde, duwde dat het model structureel naar
  // dezelfde "veiligste" zinsvorm. 0.6 geeft meer variatie zonder de striktere eisen (naamval, woordniveau)
  // los te laten -- die worden hierna nog steeds los gecontroleerd (checkSentenceNatural, vocab-check).
  const raw = await callAI("sentence", sys, user, 4000, 0.6, schema);
  let parsed = parseAIJson(raw);
  if(!parsed.tr){
    // Zelfde stille-herkansing-redenering als bij generateSingleTestItem/generateQuestionCandidate.
    const raw2 = await callAI("sentence", sys, user, 4000, 0.6, schema);
    parsed = parseAIJson(raw2);
  }
  if(!parsed.tr) throw new Error("AI did not return a sentence.");
  parsed.words = filterWordsActuallyInSentence(parsed.tr, parsed.words);
  parsed._level = level; // complexiteitsniveau -- nodig om dezelfde complexiteit aan te houden bij herkansing
  parsed._vocabLevel = vocabLevel; // woordniveau-plafond -- nodig voor de vocab-check in generateSentence()
  return parsed;
}

export async function generateSentence(){
  const {target, grammarTopic} = await pickSentenceFocus();
  if(grammarTopic && grammarTopic.recognitionStyle){
    // Stilistisch/pragmatisch onderwerp (devrik_cumle, ikileme): geen verplichte constructie, dus een
    // vertaal-/productieoefening test niet of de gebruiker 'm herkent. Route daarom altijd via de
    // herkennings-vraag-opzet (buildQuestionItem + de isRecognition-tak in generateQuestionCandidate),
    // ook al koos de planner toevallig "sentence" i.p.v. "question" als oefentype.
    return buildQuestionItem(target, grammarTopic);
  }
  const targetWord = target ? target.tr : "ev"; // veiligheidsnet, zou niet moeten voorkomen

  let parsed = await generateSentenceCandidate(targetWord, grammarTopic);
  try{
    const natural = await checkSentenceNatural(parsed.tr);
    if(!natural){
      parsed = await generateSentenceCandidate(targetWord, grammarTopic, parsed._level, undefined, parsed._vocabLevel); // één herkansing, zelfde niveaus, daarna gewoon accepteren
    }
  }catch(e){
    // controle mislukt: geen probleem, ga door met de eerste kandidaat
  }

  // Vocab-niveau-check: ondanks de (nu harde) instructie kan de AI alsnog een te zwaar woord verzinnen
  // voor iets anders dan het doelwoord (bv. "köylüler" in een A1-zin) -- dat repareert de instructie
  // zelf niet altijd, dus hier een code-level controle met één gerichte herkansing. Toetst tegen het
  // APARTE woordniveau-plafond (_vocabLevel), niet tegen de zinscomplexiteit (_level) -- die twee lagen
  // voorheen door elkaar, waardoor bv. complexiteit=max de check altijd liet slagen ongeacht woordniveau.
  if(Array.isArray(parsed.words)){
    const targetEnLower = target ? baseEnOf(target.en).toLowerCase() : null;
    const violations = parsed.words.filter(w =>
      w.en && w.en.toLowerCase() !== targetEnLower &&
      typeof w.cefr === "number" && w.cefr > parsed._vocabLevel
    );
    if(violations.length){
      const note = `LET OP: je vorige poging bevatte ${violations.length > 1 ? "woorden" : "een woord"} die te zwaar zijn voor het gevraagde WOORDNIVEAU (niet de zinscomplexiteit): ${violations.map(v=>`"${v.tr}" (${v.en}, niveau ${cefrLabel(v.cefr)})`).join(", ")}. De zin mag qua zinsbouw nog steeds complex zijn, maar vervang deze woorden door eenvoudiger alternatieven op het opgegeven woordniveau (of laat ze weg als het niet strikt nodig is voor de zin).`;
      const retried = await generateSentenceCandidate(targetWord, grammarTopic, parsed._level, note, parsed._vocabLevel);
      if(retried.tr) parsed = retried; // bij een tweede mislukking (geen tr): gewoon de eerste kandidaat behouden
    }
  }

  const wordList = Array.isArray(parsed.words) ? parsed.words : [];
  const items = [];
  for(const w of wordList){
    if(!w.tr || !w.en) continue;
    const en = w.en.toLowerCase().trim();
    const isOfficialWord = EN_WORDS_DATA.some(x=>baseEnOf(x.en)===en);
    // ensureWordExists() hier NIET meer aanroepen: de gebruiker wil geen groei van de woordenlijst
    // meer buiten de al-gecureerde ~4932 kernwoorden om. Een woord dat de AI binnen een zin gebruikt
    // maar niet in de kernlijst zit, krijgt hieronder nog wel een tijdelijke vertaling gecached zodat
    // het tap-to-peek-chipje in DEZE ene zin werkt, maar wordt niet blijvend aan newWords toegevoegd
    // (dus ook niet als losse oefening opnieuw geoefend later).
    if(!isOfficialWord && !cachedTranslation(en)){
      trCache[en] = {tr: [w.tr], fetchedAt: Date.now()};
      saveJSON(LS_TRCACHE, trCache);
    }
    items.push({en, tr: w.tr});
  }
  // zorg dat het doelwoord altijd meetelt, ook als de AI het om wat voor reden niet in "words" zette
  if(target && !items.some(it=>baseEnOf(it.en)===baseEnOf(target.en))) items.push({en: target.en, tr: target.tr});

  const seen = new Set();
  const words = items.filter(it=>{ if(seen.has(it.en)) return false; seen.add(it.en); return true; });

  noteRecentSentence(parsed.tr);
  return {tr: parsed.tr, type:"sentence", words, grammarTopic: grammarTopic.key};
}

export async function generateQuestionCandidate(targetWord, grammarTopic, _levelOverride, _correctionNote, _vocabLevelOverride){
  const level = _levelOverride ?? pickSentenceComplexityLevel();
  const vocabLevel = _vocabLevelOverride ?? pickLevelInRange(settings.cefrMin, settings.cefrMax); // zelfde bereik als de gewone woordoefening (samengevoegd)
  const knownSample = pickKnownVocabSample(35);
  const isRecognition = !!(grammarTopic && grammarTopic.recognitionStyle);
  // Herkennings-vorm: voor stilistische/pragmatische onderwerpen (devrik_cumle, ikileme) is er geen
  // "foute" neutrale zin -- die is ook gewoon correct Turks. Testen door de gebruiker de constructie te
  // laten PRODUCEREN test dus niet of hij/zij 'm HERKENT. Deze branch vraagt in plaats daarvan: welke
  // van twee voorbeeldzinnen gebruikt de constructie? Zelfde infrastructuur (Turkse vraag + Turks
  // antwoord, gradeQuestionAnswer), dus geen nieuwe UI/schema nodig -- alleen een ander soort vraag.
  const sys = isRecognition ? `Je maakt een HERKENNINGSVRAAG voor een taalleerapp, over het stilistische/pragmatische onderwerp "${grammarTopic.label}". Dit is GEEN verplichte constructie — het neutrale alternatief is ook gewoon correct Turks. Een gewone productie-/vertaaloefening test daarom niet of de gebruiker de constructie herkent; deze vraag doet dat wel.
Verzin TWEE korte, natuurlijke Turkse zinnen over eenzelfde soort situatie, gelabeld A en B:
- Precies ÉÉN van de twee (verdeel willekeurig over A/B, niet altijd dezelfde kant) gebruikt de opgegeven constructie duidelijk en correct: ${grammarTopic.hint}.
- De ANDERE zin is een gewoon, neutraal, even correct alternatief ZONDER die constructie — geen typefout, geen onzin, gewoon een andere natuurlijke manier om iets vergelijkbaars te zeggen.
Bouw daaromheen, in het Turks, een vraag die vraagt welke van de twee (A of B) de constructie gebruikt — bijvoorbeeld in de trant van: "A: [zin A] B: [zin B] Hangi cümlede [korte Turkse omschrijving van de constructie] var, A mı B mi?"
KRITIEK: het resultaat MOET eindigen op een vraagteken.
Probeer het doelwoord er waar natuurlijk in te verwerken, maar dit is ONDERGESCHIKT aan het duidelijk demonstreren van de constructie in precies één van de twee zinnen.
Geef ook een lijst van alle betekenisvolle woorden uit BEIDE voorbeeldzinnen samen (zelfstandige naamwoorden, werkwoorden, bijvoeglijke naamwoorden, bijwoorden, telwoorden, voornaamwoorden — geen losse achtervoegsels), in hun woordenboek-basisvorm, met de meest gangbare Engelse vertaling en een schatting van het CEFR-niveau (0-17). Controleer deze lijst zelf nog eens tegen de zinnen voordat je antwoordt: ELK betekenisvol woord moet er precies ÉÉN keer in staan — geen enkele overslaan, en geen woord dubbel opnemen ook al komt het in beide zinnen of meerdere keren voor.
Antwoord in JSON.` : `Je maakt korte Turkse vragen voor een taalleerapp, waarbij de gebruiker in het TURKS moet antwoorden (geen vertaling — dit traint direct begrijpen).
Maak ofwel een FEITELIJKE vraag met een min of meer eenduidig juist antwoord (bv. rekenen, geografie, een feit uit de zin zelf), ofwel een PERSOONLIJKE/OPEN vraag waarop elk contextueel passend Turks antwoord goed is (bv. "Bugün ne yaptın?").
KRITIEK: het resultaat MOET een echte vraag zijn, GEEN mededelende stelling. Eindig ALTIJD met een vraagteken, en gebruik een vraagwoord (ne, nasıl, kim, nerede, kaç, hangi, neden, niçin, ...) of het vraagpartikel (mi/mı/mu/mü). Een zin als "Hava soğuktu ama dışarı çıktık." is FOUT (dat is een stelling); "Hava soğuk olmasına rağmen neden dışarı çıktınız?" is GOED (dat is een echte vraag).
Als een grammaticaal onderwerp is opgegeven: bouw de vraag zodanig dat die daar duidelijk en natuurlijk gebruik van maakt — dat is het onderdeel waar de gebruiker extra oefening nodig heeft. Wissel af in hoe je dat onderwerp verwerkt (bv. als onderwerp, lijdend voorwerp, of vlak vóór een zelfstandig naamwoord) en in het soort vraag (feitelijk vs. persoonlijk/open) — verzin niet steeds hetzelfde vraagpatroon.
De vraag moet grammaticaal correct en natuurlijk klinken voor een moedertaalspreker.
Let op naamval-consistentie: een kaal (naamvalloos) zelfstandig naamwoord vlak vóór het werkwoord wordt in het Turks standaard gelezen als ONDERWERP, niet als lijdend voorwerp. Is een naamwoord bedoeld als lijdend voorwerp van een overgankelijk werkwoord, geef het dan de juiste accusatief-uitgang (-ı/-i/-u/-ü of -yı/-yi/-yu/-yü) — anders verandert de betekenis van de zin ongemerkt.
Let ook op bezittelijkheid-consistentie: gebruik je een bezittelijk voornaamwoord (benim/senin/onun/bizim/sizin/onların) vóór een zelfstandig naamwoord, dan moet dat naamwoord ALTIJD ook zijn eigen bezittelijke uitgang dragen (bv. "benim evim", nooit kaal "benim ev") — het voornaamwoord alleen is in het Turks nooit voldoende.
BELANGRIJK: zinscomplexiteit (zinsbouw, lengte, aantal bijzinnen) en woordmoeilijkheid (welke woorden je gebruikt) zijn TWEE APARTE dingen die je per aanroep los te horen krijgt. Een complexe zinsbouw kan en moet met simpele woorden gebouwd worden als het opgegeven woordniveau laag is — een lang, formeel of literair register is dan GEEN excuus om toch moeilijke woorden te gebruiken.
Als een lijst van bekende woorden is opgegeven: de gebruiker kent nog niet alle Turkse woorden op het gevraagde woordniveau. Dit is een HARDE eis, geen voorkeur: voor ELK woord in de vraag buiten het doelwoord geldt dat het OF letterlijk uit die bekende-woordenlijst komt, OF een simpel functiewoord is (voornaamwoord, is/zijn, veelvoorkomend bijwoord), OF zelf niet zwaarder is dan het opgegeven WOORDNIVEAU (niet het zinscomplexiteitsniveau). Verzin nooit een onnodig zelfstandig naamwoord/werkwoord/bijvoeglijk naamwoord van een hoger woordniveau dan gevraagd, ook niet als dat "natuurlijker" zou klinken -- eenvoud van woordkeuze weegt hier zwaarder dan een verfraaiing.
Geef ook een lijst van alle betekenisvolle woorden in de vraag (zelfstandige naamwoorden, werkwoorden, bijvoeglijke naamwoorden, bijwoorden, telwoorden, voornaamwoorden — GEEN losse achtervoegsels), elk in hun woordenboek-basisvorm, met de meest gangbare Engelse vertaling (één woord/uitdrukking, geen lijst) van die basisvorm, en een schatting van het CEFR-niveau van dat basiswoord zelf op de schaal 0-17 (0-2=A1, 3-5=A2, 6-8=B1, 9-11=B2, 12-14=C1, 15-17=C2), ongeacht het niveau van de hele vraag. Controleer deze lijst zelf nog eens tegen de vraag voordat je antwoordt: ELK betekenisvol woord moet er precies ÉÉN keer in staan — geen enkele overslaan, en geen woord dubbel opnemen ook al komt het meerdere keren in de vraag voor.
Antwoord in JSON.`;
  const user = isRecognition ? `Zinscomplexiteit: ${cefrLabel(level)}. ${cefrGuidance(level)}
Woordniveau-plafond: ${cefrLabel(vocabLevel)} — elk woord in beide voorbeeldzinnen (behalve het doelwoord en simpele functiewoorden) moet op of onder dit niveau liggen.
Doelwoord (ondergeschikt, zie hierboven): "${targetWord}".
Te herkennen constructie: "${grammarTopic.label}" (${grammarTopic.hint}).
${knownSample.length ? `Bekende woorden van de gebruiker: ${knownSample.map(en=>`"${cachedTranslation(en)?.[0]||en}"`).join(", ")}` : ""}
${recentGeneratedTr.length ? `Vermijd een opzet die qua voorbeeldzinnen sterk lijkt op deze recent gegenereerde zinnen/vragen: ${recentGeneratedTr.map(s=>`"${s}"`).join(" / ")}` : ""}
${_correctionNote || ""}` : `Zinscomplexiteit: ${cefrLabel(level)}. ${cefrGuidance(level)}
Woordniveau-plafond (apart van de complexiteit hierboven): ${cefrLabel(vocabLevel)} — ELK woord in de vraag (behalve het doelwoord en simpele functiewoorden) moet op of onder dit niveau liggen, ongeacht hoe complex de zinsbouw zelf moet zijn.
Doelwoord: "${targetWord}" (vervoegd/verbogen mag).
${grammarTopic ? `Grammaticaal onderwerp om te verwerken: "${grammarTopic.label}" (${grammarTopic.hint}).` : ""}
${knownSample.length ? `Bekende woorden van de gebruiker: ${knownSample.map(en=>`"${cachedTranslation(en)?.[0]||en}"`).join(", ")}` : ""}
${recentGeneratedTr.length ? `Vermijd een vraag die qua opbouw/structuur sterk lijkt op deze recent gegenereerde zinnen/vragen: ${recentGeneratedTr.map(s=>`"${s}"`).join(" / ")}` : ""}
${_correctionNote || ""}`;
  const schema = {
    name: "vraag_kandidaat",
    description: "Een Turkse oefenvraag plus de betekenisvolle woorden erin.",
    input_schema: {
      type: "object",
      properties: {
        tr: {type:"string", description:"De Turkse vraag (eindigt op een vraagteken)."},
        feitelijk: {type:"boolean", description:"Feitelijke vraag (true) of open/persoonlijke vraag (false)."},
        words: {
          type:"array",
          items: {
            type:"object",
            properties: {
              tr: {type:"string", description:"Woordenboek-basisvorm."},
              en: {type:"string", description:"Meest gangbare Engelse vertaling."},
              cefr: {type:"integer", minimum:0, maximum:17},
            },
            required: ["tr","en","cefr"]
          }
        },
      },
      required: ["tr","feitelijk","words"]
    }
  };
  const raw = await callAI("sentence", sys, user, 4000, 0.6, schema); // 0.4 -> 0.6, zelfde reden als generateSentenceCandidate
  let parsed = parseAIJson(raw);
  if(!parsed.tr){
    // Zelfde stille-herkansing-redenering als bij generateSingleTestItem/generateSentenceCandidate --
    // dit is precies de plek die eerder "AI did not return a question" liet zien zonder herkansing.
    const raw2 = await callAI("sentence", sys, user, 4000, 0.6, schema);
    parsed = parseAIJson(raw2);
  }
  if(!parsed.tr) throw new Error("AI did not return a question.");
  parsed.words = filterWordsActuallyInSentence(parsed.tr, parsed.words);
  parsed._level = level;
  parsed._vocabLevel = vocabLevel;
  return parsed;
}

export async function generateQuestion(){
  const {target, grammarTopic} = await pickSentenceFocus(); // zelfde gecombineerde vocab/grammatica-logica als bij zinnen
  return buildQuestionItem(target, grammarTopic);
}

export async function gradeQuestionAnswer(item, answer, isRecheck){
  const gTopic = item.grammarTopic ? grammarTopicByKey(item.grammarTopic) : null;
  const sys = `Je bent een taaldocent Turks. Je krijgt een Turkse vraag en het Turkstalige antwoord van de gebruiker (GEEN vertaling — de gebruiker moet in het Turks antwoorden).
Beoordeel of het antwoord een gepast, correct Turks antwoord op de vraag is:
- Bij een FEITELIJKE vraag: is het antwoord feitelijk juist en logisch een antwoord op de vraag?
- Bij een OPEN/PERSOONLIJKE vraag: is het antwoord contextueel passend en grammaticaal begrijpelijk Turks (de inhoud mag vrij zijn, elk zinnig antwoord telt)?
NEGEER Turkse diakritische tekens volledig bij de beoordeling: behandel ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c als volledig uitwisselbaar — een antwoord getypt zonder Turkse speciale tekens (bv. "tesekkur" i.p.v. "teşekkür") is qua spelling NOOIT fout.
BELANGRIJK OVER TYPEFOUTEN: duidelijke tikfouten (verwisselde letters e.d.) met een ondubbelzinnig duidelijke bedoeling reken je gewoon goed — dit is een taaltoets, geen typetoets.
Beoordeel ook voor ELK genummerd woord uit de vraag, ONAFHANKELIJK EN KRITISCH, of de gebruiker begrip daarvan toont in zijn antwoord.
BELANGRIJK ONDERSCHEID: "correct" gaat over of het antwoord een GEPAST ANTWOORD op de vraag is (vorm/pragmatiek); "words" gaat puur over WOORDBEGRIP. Die twee lopen NIET altijd gelijk op. Als "correct" false is omdat de gebruiker bijvoorbeeld reageert op de inhoud in plaats van de vraag direct te beantwoorden (maar wél overduidelijk laat zien dat hij/zij elk woord begrijpt, via een taalkundig kloppende en inhoudelijk relevante reactie), moeten de afzonderlijke woorden in "words" gewoon op true staan — bestraf woordbegrip niet voor een vorm-/pragmatiekfout.
CONSISTENTIE-EIS geldt alleen andersom: als "correct" false is SPECIFIEK doordat de gebruiker een woord verkeerd heeft opgevat (bijvoorbeeld verward met een ander Turks woord, of totaal genegeerd), moet dát woord in "words" op false staan.
Als een grammaticaal onderwerp is opgegeven waar de vraag bewust rond gebouwd is: beoordeel apart, in "grammar_correct", of de gebruiker specifiek dat grammaticale aspect correct begrijpt/gebruikt (in de vraag zelf herkend, en/of correct toegepast in het eigen antwoord) — los van of de rest verder klopt. Is er geen onderwerp opgegeven, zet "grammar_correct" dan op true.
Schrijf "uitleg" ALTIJD rechtstreeks tegen de gebruiker (spreek diegene aan met "je"), in het Engels. Structuur: begin met het oordeel, en bij fout kort en concreet wat er niet klopte.
Geef ook altijd een Engelse vertaling van de Turkse vraag, EN een Engelse vertaling van wat de gebruiker met zijn Turkse antwoord daadwerkelijk heeft gezegd (ook als dat inhoudelijk niet klopt — vertaal gewoon wat er staat, zodat de gebruiker kan zien wat hij eigenlijk zei).
Als vermeld staat dat de gebruiker het niet eens is met een eerder oordeel: kijk extra kritisch of het antwoord (of delen ervan) toch correct kunnen zijn.
Geef terug: correct (bool), uitleg (tekst), referentie (tekst), vraag_en (tekst), antwoord_en (tekst), grammar_correct (bool), en words — een platte lijst van exact ${item.words.length} true/false-waarden, in dezelfde volgorde als de genummerde woordenlijst. Antwoord in JSON.`;
  const user = `Turkse vraag: "${item.tr}"
Genummerde woorden in de vraag (basisvorm, ${item.words.length} in totaal): ${item.words.map((w,i)=>`${i+1}. ${w.tr} (${baseEnOf(w.en)})`).join(", ")}
Antwoord van gebruiker (in het Turks): "${answer}"
${gTopic ? `Deze vraag is bewust gebouwd rond het grammaticale onderwerp "${gTopic.label}" (${gTopic.hint}).` : ""}
${isRecheck ? "De gebruiker is het NIET eens met een eerder oordeel en vraagt om een extra kritische herbeoordeling." : ""}`;
  const schema = {
    name: "beoordeel_vraag",
    description: "Beoordeling van een Turks antwoord op een Turkse oefenvraag, inclusief per-woord score.",
    input_schema: {
      type: "object",
      properties: {
        correct: {type:"boolean", description:"Is het antwoord een gepast, correct Turks antwoord op de vraag?"},
        uitleg: {type:"string", description:"Korte uitleg in het Engels, rechtstreeks tegen de gebruiker gericht."},
        referentie: {type:"string", description:"Een voorbeeld van een goed Turks antwoord op deze vraag."},
        vraag_en: {type:"string", description:"Engelse vertaling van de Turkse vraag."},
        antwoord_en: {type:"string", description:"Engelse vertaling van wat de gebruiker letterlijk heeft geantwoord."},
        grammar_correct: {type:"boolean", description:"Of het specifiek opgegeven grammaticale aspect correct is toegepast (true als er geen onderwerp is opgegeven)."},
        words: {
          type:"array", items:{type:"boolean"},
          minItems: item.words.length, maxItems: item.words.length,
          description:"Per genummerd woord (zelfde volgorde als de lijst), of de gebruiker begrip daarvan toont.",
        },
      },
      required: ["correct","uitleg","referentie","vraag_en","antwoord_en","grammar_correct","words"]
    }
  };
  const raw = await callAI("sentence", sys, user, 3000, 0, schema);
  const parsed = parseAIJson(raw);
  if(!Array.isArray(parsed.words)) parsed.words = [];
  while(parsed.words.length < item.words.length) parsed.words.push(!!parsed.correct);
  parsed.words = parsed.words.slice(0, item.words.length).map(v=>{
    if(typeof v === "object" && v !== null) return !!v.correct;
    return !!v;
  });
  return parsed;
}

export async function gradeSentenceTranslation(item, answer, isRecheck){
  const wordContext = item.words.map((w, i)=> `${i+1}. ${w.tr} (${baseEnOf(w.en)})`).join("\n");
  const gTopic = item.grammarTopic ? grammarTopicByKey(item.grammarTopic) : null;
  const sys = `Je bent een taaldocent Turks. Je krijgt een Turkse zin, een GENUMMERDE lijst van alle betekenisvolle woorden uit die zin (in basisvorm, met hun Engelse vertaling), en de Engelse vertaling die de gebruiker van de HELE zin gaf.
Beoordeel of de vertaling van de HELE zin correct is, en beoordeel voor ELK genummerd woord apart, ONAFHANKELIJK EN KRITISCH, of de gebruiker dat specifieke woord (in welke vorm dan ook) correct heeft verwerkt — ga niet ervan uit dat een woord goed is enkel omdat de zin er ergens op lijkt.
CONSISTENTIE-EIS: als de vertaling als geheel fout is doordat de gebruiker een specifiek woord verkeerd heeft begrepen (bijvoorbeeld verward met een ander, vergelijkbaar klinkend Turks woord), MOET dat woord in "words" op false staan. Het mag nooit zo zijn dat "correct" false is vanwege woord X, terwijl woord X zelf in "words" op true staat — controleer dit zelf voordat je antwoordt.
Geef ook altijd een correcte Engelse referentievertaling van de hele zin.
Als een grammaticaal onderwerp is opgegeven waar de zin bewust rond gebouwd is: beoordeel apart, in "grammar_correct", of de gebruiker specifiek DAT grammaticale aspect correct heeft begrepen/verwerkt in zijn vertaling — los van of de rest van de zin verder klopt. Is er geen onderwerp opgegeven, zet "grammar_correct" dan op true.
BELANGRIJK OVER TYPEFOUTEN: als een woord duidelijk een tikfout is (bv. verwisselde letters zoals "eht" i.p.v. "het", een ontbrekende/dubbele letter) en de bedoelde vertaling ondubbelzinnig duidelijk is, reken dit dan GOED — dit is een taaltoets, geen typetoets. Vermeld de tikfout dan wel kort in "uitleg", zodat de gebruiker het weet, maar laat dit "correct" niet naar false zetten. Wees hierin coulanter dan bij een woord dat écht een andere/verkeerde vertaling is.
Schrijf "uitleg" ALTIJD rechtstreeks tegen de gebruiker (spreek diegene aan met "je", NOOIT in de derde persoon zoals "de student"). Structuur: begin met het oordeel (goed/fout), en bij fout kort en concreet wat er niet klopte — de correcte vertaling zelf hoeft niet in de uitleg herhaald te worden, die staat al apart in "referentie".
Als vermeld staat dat de gebruiker het niet eens is met een eerder oordeel: kijk extra kritisch of het antwoord (of delen ervan) toch correct kunnen zijn.
Geef terug: correct (bool), uitleg (tekst), referentie (tekst), grammar_correct (bool), en words — een platte lijst van exact ${item.words.length} true/false-waarden, in dezelfde volgorde als de genummerde woordenlijst. Antwoord in JSON.`;
  const user = `Turkse zin: "${item.tr}"
Genummerde woorden in de zin (basisvorm, ${item.words.length} in totaal):
${wordContext}
Vertaling van gebruiker: "${answer}"
${gTopic ? `Deze zin is bewust gebouwd rond het grammaticale onderwerp "${gTopic.label}" (${gTopic.hint}).` : ""}
${isRecheck ? "De gebruiker is het NIET eens met een eerder oordeel en vraagt om een extra kritische herbeoordeling." : ""}`;
  // Schema wordt via tool use aan Claude meegegeven (dwingt de structuur af, i.p.v. erop te vertrouwen
  // dat het model de tekstuele JSON-beschrijving hierboven exact volgt) -- scheelt zowel tokens
  // (de uitgeschreven voorbeeld-JSON die hier vroeger stond) als parse-fouten. Dit schema-object zelf
  // is GEEN onderdeel van de gecachte systeemprompt (het gaat via een apart "tools"-veld in de
  // aanroep), dus het per-aanroep-variabele item.words.length hierin breekt de prompt-cache niet.
  const schema = {
    name: "beoordeel_zin",
    description: "Beoordeling van de vertaling van een Turkse zin naar het Engels, inclusief per-woord score.",
    input_schema: {
      type: "object",
      properties: {
        correct: {type:"boolean", description:"Is de vertaling van de hele zin correct?"},
        uitleg: {type:"string", description:"Korte uitleg in het Engels, max 2 zinnen, rechtstreeks tegen de gebruiker gericht."},
        referentie: {type:"string", description:"Correcte Engelse referentievertaling van de hele zin."},
        grammar_correct: {type:"boolean", description:"Of het specifiek opgegeven grammaticale aspect correct is toegepast (true als er geen onderwerp is opgegeven)."},
        words: {
          type:"array", items:{type:"boolean"},
          minItems: item.words.length, maxItems: item.words.length,
          description:"Per genummerd woord (zelfde volgorde als de lijst), of de gebruiker dat woord correct heeft verwerkt."
        },
      },
      required: ["correct","uitleg","referentie","grammar_correct","words"]
    }
  };
  const raw = await callAI("sentence", sys, user, 3000, 0, schema);
  const parsed = parseAIJson(raw);
  // Verwacht: parsed.words = [true, false, ...] met exact item.words.length entries, op volgorde.
  // Bij Claude dwingt het schema dit al af; deze robuustheid blijft als vangnet voor DeepSeek (dat
  // alleen "geldige JSON" garandeert, geen exacte lengte/vorm) en voor eventuele toekomstige afwijkingen.
  if(!Array.isArray(parsed.words)) parsed.words = [];
  while(parsed.words.length < item.words.length) parsed.words.push(!!parsed.correct);
  parsed.words = parsed.words.slice(0, item.words.length).map(v=>{
    if(typeof v === "object" && v !== null) return !!v.correct; // vangnet als AI toch het oude object-formaat gebruikt
    return !!v;
  });
  return parsed;
}

export function stripTrClarifier(s){
  return String(s || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function findMatchedTr(item, answer){
  const norm = normalize(answer);
  if(!norm) return null;
  const tr = (item.senseTr && item.note) ? item.senseTr : (cachedTranslation(item.en) || []);
  for(const t of tr){
    if(normalize(t) === norm || normalize(stripTrClarifier(t)) === norm) return stripTrClarifier(t);
  }
  return null;
}

export function closestTrMatch(item, answer){
  const tr = (item.senseTr && item.note) ? item.senseTr : (cachedTranslation(item.en) || []);
  if(!tr.length) return null;
  const answerFolded = foldTurkishDiacritics(normalize(answer));
  let best = null, bestDist = Infinity;
  for(const raw of tr){
    const cleaned = stripTrClarifier(raw);
    const dist = levenshteinDistance(answerFolded, foldTurkishDiacritics(normalize(cleaned)));
    if(dist < bestDist){ bestDist = dist; best = cleaned; }
  }
  return best;
}

export function matchesTrList(norm, trList){
  if(!Array.isArray(trList) || !trList.length) return false;
  if(trList.map(normalize).includes(norm)) return true;
  return trList.map(t => normalize(stripTrClarifier(t))).includes(norm);
}

export function checkStaticMatch(item, answer){
  const norm = normalize(answer);
  if(!norm) return false;
  if(item.direction === "tr-en"){
    // Turks getoond, Engels gevraagd: het bekende Engelse trefwoord is de primaire juiste vorm...
    if(normalize(baseEnOf(item.en)) === norm) return true;
    if(item.note) return false; // dit woord heeft een altijd-zichtbare disambiguatie-hint gekregen -> alleen het exacte trefwoord telt nog voor DEZE betekenis
    // ...MAAR zonder bekeken hint zijn sommige Turkse woorden zelf ambigu (bv. "ay" = zowel "month" als "moon" —
    // geen vertaalfout, gewoon hetzelfde woord met 2 losstaande betekenissen, hier zonder context
    // getoond). Check daarom ook: is het antwoord van de gebruiker zelf een bekend Engels woord
    // waarvan de (gecachte) Turkse vertaling overlapt met die van het GETOONDE woord? Dan is het
    // een even geldige, alternatieve lezing van hetzelfde Turkse woord.
    // Fix: dit vergelijkt uitsluitend binnen de tr-en-curatie zelf (REVERSE_TR_INDEX), nooit meer
    // via de (gecachte) en-tr-vertaling -- de twee richtingen mogen elkaars brondata niet raadplegen.
    const shownTr = normalize(item.tr);
    const answerWordData = EN_WORDS_DATA.find(w => normalize(baseEnOf(w.en)) === norm);
    if(answerWordData){
      const answerTrEnOptions = (REVERSE_TR_INDEX[baseEnOf(answerWordData.en)] || []).map(o => normalize(o.tr));
      if(answerTrEnOptions.includes(shownTr)) return true;
    }
    return false;
  }
  // en-tr: Engels getoond, Turks gevraagd -> check tegen de specifiek voor DEZE oefening gekozen
  // betekenis (senseTr) ALLEEN als de gebruiker de disambiguatie-hint heeft bekeken (die verklapt
  // welke betekenis getest wordt, dus dan mag er ook streng op die ene betekenis beoordeeld worden).
  // Is de hint niet bekeken, dan is er geen eerlijke manier om te weten welke betekenis bedoeld was --
  // dan telt elke geldige betekenis van het woord als correct (de brede, platgeslagen lijst).
  const tr = (item.senseTr && item.note) ? item.senseTr : (cachedTranslation(item.en) || []);
  return matchesTrList(norm, tr);
}

export async function askDeepSeekJudge(item, answer, isRecheck){
  const isTrEn = item.direction === "tr-en";
  // Specifiek voor DEZE oefening gekozen betekenis heeft voorrang (zie pickWordSense) -- bij een
  // homoniem/polyseem woord (bv. "mine") mag de AI niet zomaar een antwoord goedrekenen dat bij een
  // ANDERE betekenis hoort dan de getoonde gloss, ook al is dat woord op zichzelf ook een geldige
  // vertaling van iets. Zonder senseTr (oude/niet-gecureerde woorden) blijft de brede lijst het redelijke alternatief.
  const tr = (item.senseTr && item.note) ? item.senseTr : (cachedTranslation(item.en) || (item.tr ? [item.tr] : []));
  const glossLine = (item.gloss && item.note) ? `\nBedoelde betekenis in deze oefening: "${item.gloss}" (dit woord heeft meerdere losstaande betekenissen; beoordeel ALLEEN tegen deze specifieke betekenis, niet tegen de andere).` : "";
  const sys = `Je bent een strenge maar faire docent Turks voor Engelstalige gebruikers.
${isTrEn
  ? `Je krijgt een Turks woord en het (correcte) Engelse trefwoord, en het Engelse antwoord dat de gebruiker gaf. Beoordeel of het antwoord een acceptabele Engelse vertaling is — accepteer synoniemen en kleine spelfouten. BELANGRIJK: sommige Turkse woorden zijn zelf ambigu/polyseem (bv. "ay" betekent zowel "month" als "moon" — geen vertaalfout, gewoon twee losstaande betekenissen van hetzelfde woord). Als het gegeven Turkse woord ZELF, onafhankelijk van het "verwachte" trefwoord, daadwerkelijk ook de betekenis heeft die de gebruiker gaf, reken dit dan GOED — ook als het een heel ander woord is dan het verwachte trefwoord. Is er hieronder een specifieke "bedoelde betekenis" vermeld, houd je daar dan wél strikt aan (dat is de betekenis die in DEZE oefening getest wordt, niet een andere betekenis van hetzelfde woord).`
  : `Je krijgt een Engels woord, de reeds bekende Turkse vertaling(en), en het Turkse antwoord dat de gebruiker gaf. Beoordeel of het antwoord een acceptabele Turkse vertaling is — accepteer synoniemen, alternatieve (correcte) vervoegingen en kleine spelfouten. Is er hieronder een specifieke "bedoelde betekenis" vermeld (dit Engelse woord heeft meerdere losstaande betekenissen): beoordeel dan ALLEEN tegen die ene betekenis, ook al zou het antwoord bij een ANDERE betekenis van hetzelfde Engelse woord wel correct zijn.`}
BELANGRIJK OVER TYPEFOUTEN: reken een antwoord GOED als het een tikfout bevat van de bedoelde vertaling, maar alleen als dat woord daadwerkelijk grotendeels dezelfde letters in vrijwel dezelfde volgorde bevat -- bv. één letter verwisseld, één letter te veel/te weinig, of twee letters omgewisseld (voorbeeld: "geliyor" i.p.v. "geliyour", of "tesekkur" i.p.v. "teşekkür"). Dit is GEEN tikfout en moet NIET als zodanig goedgekeurd worden: een kort/anders gespeld woord dat toevallig ergens op lijkt of er een beetje Turks/Engels uitziet, maar in werkelijkheid een ander of niet-bestaand woord is (voorbeeld: "çart" is GEEN tikfout van "grafik" -- die twee delen bijna geen letters, ook al lijkt "çart" fonetisch op het Engelse "chart"). Twijfel je of iets een tikfout is, ga dan uit van NEE (fout antwoord) tenzij de overeenkomst in spelling overduidelijk is. Zet een geaccepteerde tikfout dan wel kort en concreet in "afwijking" (zie hieronder), en zet "correct" niet op false enkel vanwege zo'n duidelijke, geringe tikfout.
ALS HET ANTWOORD GOED IS MAAR NIET EXACT DE MEEST GANGBARE VORM: vul dan "afwijking" in met een korte, concrete Engelse zin die zegt WAT er afwijkt -- een tikfout (en wat het verschil is), een minder gebruikelijk/formeel synoniem, een andere (maar correcte) vervoeging/vorm, of iets dergelijks. Dit is de tekst die de gebruiker DIRECT bij het resultaat te zien krijgt (niet pas in het uitklapbare uitleg-paneel), dus hou het kort (één zin volstaat meestal). Was het antwoord exact de standaard/meest gangbare vorm, of is het antwoord fout, laat "afwijking" dan leeg ("").
ALS HET ANTWOORD FOUT IS: geef in "betekenis_antwoord" aan wat het door de gebruiker ingevoerde woord ZELF betekent, VERTAALD NAAR ${isTrEn ? "het Turks" : "het Engels"} (dus NIET in dezelfde taal als het antwoord zelf — dat zou zinloos zijn, bv. nooit "great means great"), mits het een bestaand, betekenisvol woord is — dit helpt de gebruiker begrijpen welk ander woord hij in gedachten had. Is het antwoord geen bestaand woord, laat "betekenis_antwoord" dan leeg (""). Bij een GOED antwoord laat je "betekenis_antwoord" ook leeg.
"uitleg" is de tekst voor een apart, uitklapbaar "Explanation"-paneel dat de gebruiker vrijwillig opent -- hier mag en moet je ruim de tijd/ruimte voor nemen, dit hoeft GEEN korte tekst te zijn. Schrijf hem ALTIJD rechtstreeks tegen de gebruiker (spreek diegene aan met "je", NOOIT in de derde persoon zoals "de student"), in het Engels, en behandel in aparte, korte alinea's (gescheiden door een lege regel):
1) De betekenis van het TURKSE woord (${isTrEn ? `"${item.tr}"` : `"${tr[0] || baseEnOf(item.en)}"`}) zelf -- ALTIJD focussen op het Turkse woord, NOOIT op het Engelse woord op zich (de gebruiker spreekt al vloeiend Engels en heeft daar geen uitleg bij nodig -- leg dus bijvoorbeeld nooit uit wat een "pencil" is of waarvoor je 'm gebruikt, behandel alleen de Turkse kant): een heldere uitleg met relevante nuance of gebruikscontext.
2) ALLEEN als het Turkse woord duidelijk uit meerdere herkenbare delen bestaat (een samenstelling van twee woorden, zoals "kurşun kalem" = "kurşun" (lood) + "kalem" (pen/schrijfstok), of een duidelijke stam+achtervoegsel-opbouw): benoem die delen en wat elk deel apart betekent, en hoe ze samen tot de uiteindelijke betekenis komen. Geen duidelijke, betekenisvolle opsplitsing mogelijk? Sla dit punt dan gewoon over.
3) ALLEEN als het echt relevant is: het (nuance)verschil met aangrenzende/verwante Turkse begrippen waar dit woord makkelijk mee te verwarren is, EN/OF -- indien relevant voor de Turkse woordkeuze -- het nuanceverschil met een aangrenzend Engels begrip (bv. "pencil" vs "pen"). Sla dit punt over als er niets noemenswaardigs is.
4) ALLEEN als het echt iets toevoegt: een korte, interessante etymologie van het woord, EN/OF -- als het woord meerdere losstaande betekenissen heeft -- die andere betekenissen kort genoemd (dit mag je overslaan of leeg laten als er niets noemenswaardigs is, forceer het niet).
5) Bij een FOUT antwoord: wat het door de gebruiker gegeven woord zelf betekent (mag beknopt hetzelfde zeggen als "betekenis_antwoord", dat is geen probleem). Lag die betekenis dicht bij de bedoelde betekenis (bv. een verwant begrip, een deel-synoniem, een andere vorm/vervoeging, of een betekenis die overlapt maar net niet past)? Benoem dat dan expliciet en maak scherp wat het verschil/de nuance precies is, zodat de gebruiker leert wanneer je het ene woord gebruikt en wanneer het andere. Was het antwoord gewoon een heel ander/onverwant woord, dan hoeft dit punt niet uitgebreid; een enkele zin volstaat.
Bij een GOED antwoord vervalt punt 5 vanzelf (er is dan geen "fout" antwoord om te bespreken).
${isRecheck ? "De gebruiker is het NIET eens met een eerder 'onjuist'-oordeel en vraagt om een extra kritische herbeoordeling. Kijk nog eens goed of het antwoord toch (gedeeltelijk) correct kan zijn, bijvoorbeeld als minder gangbaar synoniem of alternatieve vorm." : ""}
Antwoord in JSON.`;
  const user = (isTrEn
    ? `Turks woord: "${item.tr}"\nCorrecte Engelse vertaling: "${baseEnOf(item.en)}"\nAntwoord van gebruiker: "${answer}"`
    : `Engels woord: "${baseEnOf(item.en)}"\nBekende Turkse vertaling(en): ${tr.join(", ") || "(geen)"}\nAntwoord van gebruiker: "${answer}"`) + glossLine;
  const schema = {
    name: "woord_oordeel",
    description: "Beoordeling van een los vertaal-antwoord.",
    input_schema: {
      type: "object",
      properties: {
        correct: {type:"boolean"},
        afwijking: {type:"string", description:"ALLEEN bij een GOED antwoord dat niet exact de standaardvorm was: korte Engelse zin die zegt wat afwijkt (tikfout, minder gebruikelijk synoniem, andere correcte vervoeging, ...). Leeg bij een exact antwoord of een fout antwoord."},
        uitleg: {type:"string", description:"Rijkere uitleg in het Engels voor het uitklapbare Explanation-paneel: betekenis van het geteste woord, evt. etymologie/deelbetekenissen, en bij een fout antwoord de betekenis van het gegeven woord plus (indien van toepassing) het verschil met de bedoelde betekenis. Meerdere zinnen/alinea's mogen, mag leeg zijn."},
        betekenis_antwoord: {type:"string", description:"Betekenis van het antwoord van de gebruiker (vertaald naar de andere taal), indien fout en een bestaand woord; anders leeg."},
      },
      required: ["correct","afwijking","uitleg","betekenis_antwoord"]
    }
  };
  const raw = await callAI("word", sys, user, 2500, 0, schema);
  try{
    const verdict = parseAIJson(raw);
    // Vangnet: promptaanpassingen alleen zijn kansrekening, geen garantie -- de AI kan een antwoord
    // toch nog als "tikfout" bestempelen terwijl het structureel een compleet ander woord is (bv.
    // "çart" goedgekeurd als tikfout van "grafik", terwijl die woorden bijna geen letters delen). Als
    // de AI zelf "correct"+een tikfout-achtige "afwijking" teruggeeft, controleer dat hier nog eens
    // deterministisch met dezelfde Levenshtein-tolerantie als de suffixtrainer, tegen ALLE bekende
    // geldige vertalingen -- ligt de kleinste afstand daarboven, dan overrulen we naar fout. Legitieme
    // maar structureel heel andere SYNONIEMEN (bv. "iyi" vs "güzel") worden door de AI nooit als
    // "tikfout" gelabeld, dus die blijven hierdoor gewoon buiten schot.
    if(verdict && verdict.correct && /typo|tikfout/i.test(verdict.afwijking || "")){
      const candidates = isTrEn ? [baseEnOf(item.en)] : tr;
      const answerFolded = foldTurkishDiacritics(normalize(answer));
      const isCloseToAny = candidates.some(c => {
        const cFolded = foldTurkishDiacritics(normalize(c));
        const dist = levenshteinDistance(answerFolded, cFolded);
        return dist <= typoTolerance(cFolded.length);
      });
      if(!isCloseToAny){
        return {correct:false, afwijking:"", uitleg:`Your answer, "${answer}," isn't actually a typo of the expected word — it's a different word.`, betekenis_antwoord: verdict.betekenis_antwoord || ""};
      }
    }
    return verdict;
  }catch(e){
    return {correct:false, uitleg:"(kon AI-antwoord niet verwerken: " + raw.slice(0,150) + ")"};
  }
}

export async function askDeepSeekFree(item, question, chatHistoryMsgs){
  const context = (item.type === "sentence" || item.type === "question")
    ? `Turkse oefen${item.type === "question" ? "vraag" : "zin"}: "${item.tr}" (doelwoorden: ${item.words.map(w=>`${w.tr} (${baseEnOf(w.en)})`).join(", ")}).`
    : `Woord: Turks "${item.tr || "?"}" = Engels "${baseEnOf(item.en)}" (richting van deze oefening: ${item.direction === "tr-en" ? "Turks -> Engels" : "Engels -> Turks"}).`;
  const sys = `Je bent een behulpzame docent Turks. Je gebruiker oefent het volgende:
${context}
Beantwoord vragen kort, duidelijk, rechtstreeks tegen de gebruiker gericht (spreek diegene aan met "je") en in het Engels.`;
  const messages = [...chatHistoryMsgs, {role:"user", content: question}];
  const raw = await callAI("sentence", sys, messages, 3000, 0.3);
  return raw || "(geen antwoord)";
}

export async function explainWordContent(item, userAnswer){
  if(!hasKeyFor("word")) return "";
  const isTrEnDir = item.direction === "tr-en";
  const given = (userAnswer || "").trim();
  const tr = (item.senseTr && item.note) ? item.senseTr : (cachedTranslation(item.en) || (item.tr ? [item.tr] : []));
  // Het Turkse woord dat uitgelegd moet worden -- bij tr-en is dat het getoonde woord zelf, bij en-tr
  // de (eerste) bekende Turkse vertaling van het getoonde Engelse woord.
  const trWord = isTrEnDir ? item.tr : (tr[0] || "");
  // Hergebruik (stap 7): punten 1-4 hangen alleen af van het woord zelf, niet van sessie-specifieke
  // state -- dezelfde combinatie van woord+richting+(evt.) het gegeven foute antwoord levert dus altijd
  // exact dezelfde uitleg op. Via SRS kom je hetzelfde woord keer op keer weer tegen, dus 1x genereren
  // en daarna hergebruiken bespaart herhaalde kosten/wachttijd voor identieke content.
  const cacheKey = item.direction + "::" + normalize(trWord) + "::" + normalize(given);
  const cachedEntry = explanationCache[cacheKey];
  if(cachedEntry && cachedEntry.uitleg) return cachedEntry.uitleg;
  const sys = `Je bent een docent Turks voor Engelstalige gebruikers. Schrijf een inhoudelijke uitleg over het Turkse woord "${trWord}" (Engelse betekenis: "${baseEnOf(item.en)}") voor een uitklapbaar "Explanation"-paneel. Schrijf ALTIJD rechtstreeks tegen de gebruiker (spreek "je" aan, NOOIT in de derde persoon), in het Engels, in aparte korte alinea's (gescheiden door een lege regel):
1) De betekenis van het TURKSE woord "${trWord}" zelf -- ALTIJD invullen, ook als er verder niets bijzonders te melden is. Focus op het Turkse woord, NIET op het Engelse woord op zich (de gebruiker spreekt al vloeiend Engels en heeft daar geen uitleg bij nodig -- leg dus nooit uit wat een "pencil" is of waar het voor gebruikt wordt, behandel alleen de Turkse kant).
2) ALLEEN als het Turkse woord duidelijk uit meerdere herkenbare delen bestaat (een samenstelling van twee woorden, zoals "kurşun kalem" = "kurşun" (lood) + "kalem" (pen/schrijfstok), of een duidelijke stam+achtervoegsel-opbouw): benoem die delen en wat elk deel apart betekent, en hoe ze samen tot de uiteindelijke betekenis komen. Is er geen duidelijke, betekenisvolle opsplitsing mogelijk, sla dit punt dan gewoon over (forceer het niet).
3) ALLEEN als het echt relevant is: het (nuance)verschil met aangrenzende/verwante Turkse begrippen waar de gebruiker dit woord makkelijk mee kan verwarren, EN/OF -- indien relevant voor de Turkse woordkeuze -- het nuanceverschil met een aangrenzend Engels begrip (bv. "pencil" vs "pen"). Sla dit punt over als er niets noemenswaardigs is.
4) ALLEEN als het echt iets toevoegt: een korte, interessante etymologie, EN/OF -- als het woord meerdere losstaande betekenissen heeft -- die kort genoemd (mag overgeslagen worden als er niets noemenswaardigs is).
${given ? `5) De gebruiker typte "${given}" (niet het verwachte antwoord). Leg uit wat dit door de gebruiker gegeven woord zelf betekent (als het een bestaand, betekenisvol woord is) en wat het verschil/de nuance precies is met de bedoelde betekenis van het geteste woord. Is "${given}" geen bestaand/betekenisvol woord, sla dit punt dan over.` : ""}
Punt 1 mag NOOIT leeg blijven; punten 2-4 mogen overgeslagen worden als ze niets toevoegen. Antwoord in JSON.`;
  const user = isTrEnDir
    ? `Turks woord: "${item.tr}"\nEngelse vertaling: "${baseEnOf(item.en)}"` + (given ? `\nAntwoord van gebruiker: "${given}"` : "")
    : `Engels woord: "${baseEnOf(item.en)}"\nBekende Turkse vertaling(en): ${tr.join(", ") || "(geen)"}` + (given ? `\nAntwoord van gebruiker: "${given}"` : "");
  const schema = {
    name: "woord_uitleg",
    description: "Inhoudelijke uitleg van het geteste woord voor het uitklapbare Explanation-paneel.",
    input_schema: {
      type: "object",
      properties: {
        uitleg: {type:"string", description:"Uitleg in het Engels, rechtstreeks tegen de gebruiker gericht. Punt 1 (betekenis van het woord) mag nooit leeg zijn."},
      },
      required: ["uitleg"]
    }
  };
  try{
    const raw = await callAI("word", sys, user, 1200, 0, schema);
    const parsed = parseAIJson(raw);
    const uitleg = parsed.uitleg || "";
    if(uitleg){
      explanationCache[cacheKey] = {uitleg, cachedAt: Date.now()};
      saveJSON(LS_EXPLANATION_CACHE, explanationCache);
    }
    return uitleg;
  }catch(e){
    return "";
  }
}

export async function lookupWrongAnswerMeaning(item, answer){
  if(!answer || !hasKeyFor("word")) return "";
  const isTrEnDir = item.direction === "tr-en";
  // Hergebruik (stap 7): dit is puur een woordvertaling naar de andere taal -- hangt alleen af van de
  // richting en de gegeven tekst zelf, niet van welk item/welke sessie het was. Dezelfde tikfout/hetzelfde
  // verkeerd-geraden woord komt met een beetje pech vaker voor (vooral bij een klein aantal veelvoorkomende
  // verwarringen), dus 1x vertalen en hergebruiken is hier goedkoop en zonder nadeel.
  const cacheKey = "wronglookup::" + (isTrEnDir ? "to-en" : "to-tr") + "::" + normalize(answer);
  const cachedEntry = explanationCache[cacheKey];
  if(cachedEntry && typeof cachedEntry.uitleg === "string") return cachedEntry.uitleg;
  const sys = `Je bent een vertaler ${isTrEnDir ? "Engels-Turks" : "Turks-Engels"}. De gebruiker gaf een fout antwoord op een vertaalvraag. Vertaal ALLEEN het door de gebruiker gegeven woord/de gegeven tekst naar ${isTrEnDir ? "het Engels" : "het Turks"}, als het een bestaand, betekenisvol woord is. Is het geen bestaand/betekenisvol woord (bv. een tikfout die nergens op lijkt, of onzin), geef dan een lege string terug. Kort en bondig, geen verdere uitleg. Antwoord in JSON.`;
  const user = `Door de gebruiker gegeven (foute) antwoord: "${answer}"`;
  const schema = {
    name: "betekenis_antwoord",
    description: "Korte betekenis/vertaling van het door de gebruiker gegeven foute woord.",
    input_schema: {
      type: "object",
      properties: {
        betekenis: {type:"string", description:"Vertaling van het gegeven woord naar de andere taal, of lege string als het geen bestaand/betekenisvol woord is."},
      },
      required: ["betekenis"]
    }
  };
  try{
    const raw = await callAI("word", sys, user, 150, 0, schema);
    const parsed = parseAIJson(raw);
    const betekenis = parsed.betekenis || "";
    // OOK een lege uitkomst cachen ("geen bestaand woord") -- dat antwoord is voor dezelfde tekst
    // net zo herbruikbaar, en voorkomt dat een bekende onzin-tikfout toch iedere keer opnieuw nagevraagd wordt.
    explanationCache[cacheKey] = {uitleg: betekenis, cachedAt: Date.now()};
    saveJSON(LS_EXPLANATION_CACHE, explanationCache);
    return betekenis;
  }catch(e){
    return "";
  }
}

export async function explainSentenceContent(item){
  if(!hasKeyFor("sentence")) return "";
  const gTopic = item.grammarTopic ? grammarTopicByKey(item.grammarTopic) : null;
  let masteryNote = "";
  if(gTopic){
    const level = getTopicProgress(gTopic).level;
    masteryNote = level >= 7
      ? `\nDeze zin is gebouwd rond het grammaticale onderwerp "${gTopic.label}", maar de gebruiker beheerst dat al (niveau ${level}/10) -- leg dat onderwerp dus NIET (opnieuw) uit.`
      : `\nDeze zin is gebouwd rond het grammaticale onderwerp "${gTopic.label}" (${gTopic.hint}), dat de gebruiker nog aan het leren is (niveau ${level}/10) -- dit mag je wél kort noemen als het relevant is voor punt 3.`;
  }
  const sys = `Je bent een taaldocent Turks. Schrijf een KORTE, compacte toelichting bij de Turkse ${item.type === "question" ? "oefenvraag" : "zin"} "${item.tr}" voor een uitklapbaar "Explanation"-paneel, gericht op een Engelstalige leerder die al een tijd Turks leert. Schrijf ALTIJD rechtstreeks tegen de gebruiker (spreek "you" aan, NOOIT in de derde persoon), in het Engels. Behandel PRECIES deze 3 punten, elk in hooguit 1-2 korte zinnen (geen lange alinea's, geen opsomming van losse woordbetekenissen die de gebruiker al kent uit de woordenlijst):
1) Wat betekent de zin/vraag, kort en natuurlijk geparafraseerd (geen woord-voor-woord vertaling, dat heeft de gebruiker al gezien).
2) Klinkt dit als natuurlijk, gebruikelijk Turks zoals een moedertaalspreker het daadwerkelijk zou zeggen -- of is het (in deze specifieke, gegenereerde vorm) wat gekunsteld/schools/ongebruikelijk? Wees eerlijk als het laatste het geval is, en zeg dan kort hoe een moedertaalspreker het WEL zou zeggen.
3) Wordt er idioom, een vaste uitdrukking, of een niet-letterlijke betekenis gebruikt? Zo ja, leg kort het verschil tussen de letterlijke en figuurlijke betekenis uit. Zo nee, zeg gewoon kort dat er geen idioom in zit -- verzin er niets bij.
BELANGRIJK: leg GEEN grammaticale constructie/regel uit die niet expliciet in punt 3 relevant is, en zeker niet als de gebruiker die al beheerst (zie hieronder) -- dit is geen grammaticales, de gebruiker kent de basis al vanuit zijn cursus.${masteryNote}
Dit is GEEN herhaling van de correctheidsbeoordeling (die heeft de gebruiker al apart gezien) -- ga niet in op of het antwoord van de gebruiker goed of fout was. Antwoord in JSON.`;
  const user = `Turkse ${item.type === "question" ? "vraag" : "zin"}: "${item.tr}"`;
  const schema = {
    name: "zin_uitleg",
    description: "Compacte toelichting (betekenis, natuurlijkheid, idioom) bij de geoefende Turkse zin/vraag voor het uitklapbare Explanation-paneel.",
    input_schema: {
      type: "object",
      properties: {
        uitleg: {type:"string", description:"Korte toelichting in het Engels (max 3 korte punten/zinnen), rechtstreeks tegen de gebruiker gericht."},
      },
      required: ["uitleg"]
    }
  };
  try{
    const raw = await callAI("sentence", sys, user, 500, 0, schema);
    return parseAIJson(raw).uitleg || "";
  }catch(e){
    return "";
  }
}

export async function generateDictationSentence(tier, _retry){
  const knownSample = pickKnownVocabSample(35, 8); // liefst al beheerst (niveau 8+), niet alleen "redelijk bekend" (7+)
  const exact = tier.min === tier.max;
  const sys = `Je maakt korte, natuurlijke Turkse luister-dictee-zinnen voor een taalleerapp: de gebruiker HOORT de zin (audio) en moet 'm naar het Engels vertalen, zonder de Turkse tekst te zien.
${exact
  ? `De zin moet PRECIES het opgegeven aantal woorden hebben, niet meer en niet minder -- tel elk los, spatie-gescheiden woord mee, INCLUSIEF vraagpartikels als "mi/mı/mu/mü" (die worden in het Turks apart geschreven en tellen dus gewoon als een eigen woord). Tel je eigen zin na voordat je antwoordt, en herschrijf 'm als het aantal niet precies klopt.`
  : `De zin moet BINNEN het opgegeven bereik vallen (functiewoorden en vraagpartikels als "mi/mı/mu/mü" meegeteld als apart woord) en grammaticaal correct + natuurlijk klinken voor een moedertaalspreker.`}
Dit is een LUISTEROEFENING (kunnen volgen/verstaan van gesproken Turks), GEEN woordenschat-uitbreiding: gebruik daarom ALLEEN eenvoudige, hoogfrequente woorden, bij voorkeur letterlijk uit de meegegeven bekende-woordenlijst van de gebruiker, aangevuld met simpele functiewoorden (voornaamwoorden, is/zijn, veelvoorkomende bijwoorden) waar nodig. Verzin geen nieuw/moeilijk woord puur om op het gevraagde aantal woorden uit te komen.
Bij 2 woorden: bouw een minimale maar volledige, natuurlijke zin (bv. onderwerp+werkwoord, bijvoeglijk naamwoord+zelfstandig naamwoord, werkwoord+lijdend voorwerp) -- geen twee losse woorden zonder samenhang.
Geef ook een natuurlijke, vloeiende Engelse referentievertaling van de hele zin.
Antwoord in JSON.`;
  const user = `Gevraagd aantal woorden: ${exact ? tier.min : `${tier.min}-${tier.max}`}${tier.n===7 ? " (mag ook iets meer zijn)" : ""}.
${knownSample.length ? `Bekende woorden van de gebruiker: ${knownSample.map(en=>`"${cachedTranslation(en)?.[0]||en}"`).join(", ")}` : ""}`;
  const schema = {
    name: "dictee_zin",
    description: "Een Turkse luister-dictee-zin met Engelse referentievertaling.",
    input_schema: {
      type: "object",
      properties: {
        tr: {type:"string", description:"De Turkse zin (of het Turkse woord bij 1-2 woorden)."},
        en: {type:"string", description:"Natuurlijke, vloeiende Engelse vertaling van de hele zin."},
      },
      required: ["tr","en"]
    }
  };
  const raw = await callAI("sentence", sys, user, 600, 0.6, schema);
  const parsed = parseAIJson(raw);
  if(!parsed.tr || !parsed.en) throw new Error("AI did not return a dictation sentence.");
  const n = countTrWords(parsed.tr);
  // BUGFIX: "ongeveer" gaf de AI bij EXACTE niveaus (bv. "3 woorden") te veel speelruimte -- die kon dan
  // gewoon 4 afleveren. Eén stille herpoging als het bij een exact niveau toch niet klopt, vóórdat de
  // (mogelijk nog steeds net-niet-kloppende) zin alsnog gebruikt wordt.
  if(exact && n !== tier.min && !_retry){
    return generateDictationSentence(tier, true);
  }
  return {tr: parsed.tr, en: parsed.en, wordCount: tier.n};
}

export async function generateDictationItem(){
  const tier = dictationTierFor(settings.dictationLevel);
  if(tier.n === 1){
    const item = await pickMasteredWordForDictation();
    if(item) return item;
    return null; // geen mastered woord beschikbaar -- renderDictationPractice toont dan een melding
  }
  return generateDictationSentence(tier);
}

export async function gradeDictationAnswer(item, answer){
  if(normalize(answer) === normalize(item.en)) return {correct:true};
  if(!hasKeyFor("sentence")) return {correct:false, noKey:true};
  const sys = `Je beoordeelt of de Engelse vertaling van een gebruiker de betekenis correct weergeeft van het Turkse ${item.wordCount===1?"woord":"zinnetje"} "${item.tr}". De referentievertaling is "${item.en}", maar andere bewoordingen die hetzelfde correct weergeven zijn OOK goed (parafrasering, synoniemen, een andere maar even correcte woordvolgorde). Kleine tikfouten met een ondubbelzinnige bedoeling reken je gewoon goed.${item.wordCount===1 ? ` LET OP: dit is een LOS woord zonder context -- Turkse woorden zijn vaak op zichzelf al ambigu (bv. "sonra" = zowel "then" als "after"). Is het antwoord van de gebruiker een ANDERE, ECHT BESTAANDE Engelse betekenis van "${item.tr}" dan de gekozen referentie "${item.en}", reken dat dan OOK gewoon goed -- niet alleen parafraseringen van de referentie zelf.` : ""} Antwoord in JSON.`;
  const schema = {
    name: "beoordeel_dictee",
    description: "Of de Engelse vertaling van de gebruiker een acceptabele weergave van de Turkse zin is.",
    input_schema: { type:"object", properties: { correct: {type:"boolean"} }, required: ["correct"] }
  };
  try{
    const raw = await callAI("sentence", sys, `Antwoord van gebruiker: "${answer}"`, 150, 0, schema);
    return {correct: !!parseAIJson(raw).correct};
  }catch(e){
    return {correct:false, error:e.message};
  }
}

export function baseWordList(){
  // BEWUST alleen de Oxford-kernlijst: newWords-ontdekking staat uit (zie ensureWordExists) en oude,
  // her en der nog aanwezige newWords-items uit vóór die beslissing mogen niet meer meetellen -- die
  // zaten eerder WEL in deze lijst (dus zichtbaar in de Woorden-tab, met een score als ze ooit geoefend
  // zijn) maar NIET in unlockedWordSet() (dat blijft uitsluitend EN_WORDS_DATA), waardoor zulke woorden
  // permanent als "not yet translated" bleven staan én nooit meer als opgave gekozen konden worden, ook
  // niet met een lage score. Door ze hier ook te laten vallen is er nergens meer een mismatch: een woord
  // staat óf helemaal (zichtbaar + selecteerbaar), óf helemaal niet in de actieve woordenlijst.
  return EN_WORDS_DATA;
}

export async function buildQuestionItem(target, grammarTopic){
  const targetWord = target ? target.tr : "ev";

  let parsed = await generateQuestionCandidate(targetWord, grammarTopic);
  if(!looksLikeQuestion(parsed.tr)){
    parsed = await generateQuestionCandidate(targetWord, grammarTopic, parsed._level, undefined, parsed._vocabLevel); // herkansing: AI maakte een stelling i.p.v. een vraag
  }
  if(!looksLikeQuestion(parsed.tr)){
    // nog steeds geen echte vraag na de herkansing: forceer een vraagteken zodat het UI-onderscheid
    // (badge "vraag" + instructie "beantwoord in het Turks") niet misleidend blijft
    parsed.tr = parsed.tr.replace(/[.!]+\s*$/, "") + "?";
  }
  try{
    const natural = await checkSentenceNatural(parsed.tr); // generieke check, werkt ook prima voor vragen
    if(!natural){
      parsed = await generateQuestionCandidate(targetWord, grammarTopic, parsed._level, undefined, parsed._vocabLevel); // één herkansing
      if(!looksLikeQuestion(parsed.tr)) parsed.tr = parsed.tr.replace(/[.!]+\s*$/, "") + "?";
    }
  }catch(e){ /* controle mislukt: gewoon doorgaan met de eerste kandidaat */ }

  // Vocab-niveau-check: zelfde redenering als bij generateSentence -- toetst tegen het APARTE
  // woordniveau-plafond (_vocabLevel), niet tegen de zinscomplexiteit (_level).
  if(Array.isArray(parsed.words)){
    const targetEnLower = target ? baseEnOf(target.en).toLowerCase() : null;
    const violations = parsed.words.filter(w =>
      w.en && w.en.toLowerCase() !== targetEnLower &&
      typeof w.cefr === "number" && w.cefr > parsed._vocabLevel
    );
    if(violations.length){
      const note = `LET OP: je vorige poging bevatte ${violations.length > 1 ? "woorden" : "een woord"} die te zwaar zijn voor het gevraagde WOORDNIVEAU (niet de zinscomplexiteit): ${violations.map(v=>`"${v.tr}" (${v.en}, niveau ${cefrLabel(v.cefr)})`).join(", ")}. De vraag mag qua zinsbouw nog steeds complex zijn, maar vervang deze woorden door eenvoudiger alternatieven op het opgegeven woordniveau.`;
      const retried = await generateQuestionCandidate(targetWord, grammarTopic, parsed._level, note, parsed._vocabLevel);
      if(retried.tr && looksLikeQuestion(retried.tr)) parsed = retried;
    }
  }

  const wordList = Array.isArray(parsed.words) ? parsed.words : [];
  const items = [];
  for(const w of wordList){
    if(!w.tr || !w.en) continue;
    const en = w.en.toLowerCase().trim();
    const isOfficialWord = EN_WORDS_DATA.some(x=>baseEnOf(x.en)===en);
    // zelfde redenering als in generateSentence(): geen groei van de woordenlijst meer via ensureWordExists().
    if(!isOfficialWord && !cachedTranslation(en)){
      trCache[en] = {tr: [w.tr], fetchedAt: Date.now()};
      saveJSON(LS_TRCACHE, trCache);
    }
    items.push({en, tr: w.tr});
  }
  if(target && !items.some(it=>baseEnOf(it.en)===baseEnOf(target.en))) items.push({en: target.en, tr: target.tr});

  const seen = new Set();
  const words = items.filter(it=>{ if(seen.has(it.en)) return false; seen.add(it.en); return true; });

  noteRecentSentence(parsed.tr);
  return {tr: parsed.tr, type:"question", words, grammarTopic: grammarTopic.key};
}

export function cachedTranslation(en){
  // Handmatige correctie heeft ALTIJD voorrang -- vervangt de vertaling volledig (i.t.t. custom,
  // dat een extra geaccepteerd antwoord TOEVOEGT zonder de primair getoonde vertaling te wijzigen).
  if(overrides[en] && overrides[en].tr && overrides[en].tr.length) return overrides[en].tr;
  const curated = curatedTr[en];
  let baseTr = null;
  if(curated){
    // Nieuwe vorm: {senses:[{gloss,tr,register}, ...]} -- voor "geef me een geldige vertaling"-doel-
    // einden (bv. Woorden-tab, vulwoord-weergave) alle zinnen platgeslagen tot één lijst; welke exacte
    // zin bedoeld is voor een SPECIFIEKE oefening wordt apart bepaald door pickWordSense() hieronder.
    if(Array.isArray(curated.senses)) baseTr = [...new Set(curated.senses.flatMap(s=>s.tr||[]))];
    else if(curated.tr) baseTr = curated.tr; // oude vlakke vorm (veiligheidsnet, zou niet meer moeten voorkomen)
  }
  const c = baseTr ? {tr: baseTr} : trCache[en];
  const extra = custom[en];
  if(!c) return null;
  const tr = extra && extra.tr ? [...new Set([...c.tr, ...extra.tr])] : c.tr;
  return tr;
}

export function canOfferNounSuffixDrill(){
  return masteredNounsForSuffixDrill().length > 0 && masteredTopicsForSuffixDrillNoun().length > 0;
}

export function canOfferVerbSuffixDrill(){
  return masteredVerbsForSuffixDrill().length > 0 && masteredTopicsForSuffixDrillVerb().length > 0;
}

export function cefrGuidance(idx){
  const major = CEFR_MAJOR[idx], sub = CEFR_SUB[idx];
  return `Niveau ${major} (${sub}) van het Europese CEFR-referentiekader: ${CEFR_LEVEL_GUIDANCE[idx]} ${CEFR_SUB_NOTE[sub]}`;
}

export async function checkSentenceNatural(sentenceTr){
  const sys = `Je bent een kritische moedertaalspreker Turks. Beoordeel of onderstaande zin grammaticaal correct is EN natuurlijk klinkt — dus niet geforceerd, niet zichzelf tegensprekend, geen rare combinatie van woorden die een moedertaalspreker nooit zo zou zeggen.
Let hierbij SPECIFIEK op naamval-consistentie: een kaal (naamvalloos) zelfstandig naamwoord vlak vóór het werkwoord wordt in het Turks standaard gelezen als ONDERWERP, niet als lijdend voorwerp. Als de zin een naamwoord kennelijk als lijdend voorwerp bedoelt (bv. bij een overgankelijk werkwoord met maar één passend naamwoord in de zin), moet dat naamwoord de accusatief-uitgang dragen (-ı/-i/-u/-ü of -yı/-yi/-yu/-yü); ontbreekt die waar hij nodig is, dan verandert het onderwerp/lijdend-voorwerp van de zin en is dat een echte fout, ook al is de zin op zichzelf (met de ANDERE, onbedoelde lezing) grammaticaal geldig Turks. Reken dit soort naamvalfout net zo hard aan als een overduidelijke spelfout.
Let ook op bezittelijkheid-consistentie: staat er een bezittelijk voornaamwoord (benim/senin/onun/bizim/sizin/onların) vóór een zelfstandig naamwoord, dan moet dat naamwoord ook zijn eigen bezittelijke uitgang dragen (bv. "benim evim", nooit kaal "benim ev"). Ontbreekt die uitgang, reken dat net zo hard aan als een naamvalfout.
Antwoord in JSON.`;
  const user = `Zin: "${sentenceTr}"`;
  const schema = {
    name: "natuurlijkheid_check",
    description: "Of een Turkse zin grammaticaal correct en natuurlijk klinkt.",
    input_schema: {
      type: "object",
      properties: { natuurlijk: {type:"boolean"} },
      required: ["natuurlijk"]
    }
  };
  try{
    const raw = await callAI("sentence", sys, user, 150, 0, schema);
    const parsed = parseAIJson(raw);
    return parsed.natuurlijk !== false;
  }catch(e){ return true; } // check zelf mislukt -> kandidaat gewoon accepteren, niet blokkeren
}

export function correctEnglishDisplayFor(item){
  if(item.wordSource === "tr" && item.trData) return displayTrEntryGloss(item.trData);
  return displayEnglishWord(item.en);
}

export function countTrWords(tr){
  return (tr || "").trim().split(/\s+/).filter(Boolean).length;
}

export function dictationTierFor(level){
  return DICTATION_LEVELS[Math.max(1, Math.min(7, level||1)) - 1];
}

export function ensureWordExists(en, cefr){
  if(!en || !looksLikeEnglishWord(en)) return false;
  if(EN_WORDS_DATA.some(w=>w.en===en) || newWords[en]) return false;
  newWords[en] = {cefr: typeof cefr === "number" ? cefr : Math.round(((settings.cefrMin ?? 3) + (settings.cefrMax ?? 5)) / 2)};
  saveJSON(LS_NEWWORDS, newWords);
  return true;
}

export function filterWordsActuallyInSentence(sentenceTr, words){
  if(!Array.isArray(words) || !words.length) return words || [];
  const normSentence = sentenceTr.toLocaleLowerCase("tr");
  const filtered = words.filter(w => w.tr && turkishWordLikelyInSentence(normSentence, w.tr));
  // Vangnet: mocht dit alsnog te streng blijken voor een specifieke zin, dan liever een spookwoord
  // laten staan dan per ongeluk de hele woordenlijst leegvegen.
  const result = filtered.length ? filtered : words;
  // BUGFIX: de AI gaf soms hetzelfde woord twee keer terug in "words" (bv. omdat het twee keer in de
  // zin voorkomt, of gewoon een AI-inconsistentie) -- dat toonde dan een dubbel chip'je onder de zin.
  // Dedupliceren op de kale, diakritisch-platgevouwen basisvorm (net als de typo-tolerantie elders).
  const seen = new Set();
  return result.filter(w=>{
    const key = foldTurkishDiacritics(normalize(w.tr || ""));
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateSingleTestItem(niveauIdx){
  const sys = `Je maakt één item voor een Turkse taaltoets, CEFR-niveau ${cefrLabel(niveauIdx)}. ${cefrGuidance(niveauIdx)}
Bij lagere niveaus (A1/A2): een los, hoogfrequent Turks woord. Bij hogere niveaus (B1 en hoger): een korte tot langere Turkse zin, met toenemende complexiteit/idiomatiek naarmate het niveau stijgt.
Antwoord in JSON.`;
  const schema = {
    name: "toets_item",
    description: "Eén item voor een adaptieve Turkse taaltoets.",
    input_schema: {
      type: "object",
      properties: {
        tr: {type:"string", description:"Turks woord of zin."},
        type: {type:"string", enum:["word","sentence"]},
        correct_en: {type:"string", description:"De meest gangbare, correcte Engelse vertaling."},
      },
      required: ["tr","type","correct_en"]
    }
  };
  const raw = await callAI("sentence", sys, `Niveau: ${cefrLabel(niveauIdx)} (niveau_index ${niveauIdx})`, 400, 0.5, schema);
  let parsed = parseAIJson(raw);
  if(!parsed.tr){
    // Eén stille herkansing i.p.v. meteen een foutmelding tonen -- een enkele lege/onvolledige AI-respons
    // (bv. DeepSeek's json_object-modus garandeert alleen geldige JSON, geen specifieke velden) hoeft de
    // gebruiker niet te raken; pas als het twee keer op rij misgaat is er echt iets aan de hand.
    const raw2 = await callAI("sentence", sys, `Niveau: ${cefrLabel(niveauIdx)} (niveau_index ${niveauIdx})`, 400, 0.5, schema);
    parsed = parseAIJson(raw2);
  }
  if(!parsed.tr) throw new Error("AI did not return a test item.");
  return parsed;
}

export async function getOrFetchTranslation(en){
  const cached = cachedTranslation(en);
  if(cached && cached.length) return cached;
  if(!hasKeyFor("word")) throw new Error(`No ${preferredModelFor("word") === "claude" ? "Anthropic" : "DeepSeek"} API key (or shared proxy) set — needed to generate Turkish translations.`);

  const sys = `Je bent een Engels-Turks vertaler voor een taalleerapp. Geef de meest gangbare Turkse vertaling(en) van een Engels woord, in de basisvorm (infinitief bij werkwoorden, bv. "gitmek" niet "gider"). Geef 1-3 veelgebruikte vertalingen (synoniemen/varianten). Antwoord in JSON.`;
  const user = `Engels woord: "${baseEnOf(en)}"`;
  const schema = {
    name: "vertaling",
    description: "Turkse vertaling(en) van een Engels woord.",
    input_schema: {
      type: "object",
      properties: {
        tr: {type:"array", items:{type:"string"}, minItems:1, maxItems:3, description:"1-3 Turkse vertalingen, basisvorm."},
      },
      required: ["tr"]
    }
  };
  const raw = await callAI("word", sys, user, 400, 0, schema);
  const parsed = parseAIJson(raw);
  const tr = Array.isArray(parsed.tr) && parsed.tr.length ? parsed.tr : [String(parsed.tr || "")];
  trCache[en] = {tr, fetchedAt: Date.now()};
  saveJSON(LS_TRCACHE, trCache);
  return tr;
}

export function getProgress(tr){
  if(!progress[tr]) progress[tr] = {level:0, due:Date.now(), reps:0, ease:EASE_START};
  return migrateLegacyProgress(progress[tr]);
}

export function getTopicProgress(topic){
  const variants = getTopicVariants(topic);
  const progresses = variants.map(v => getGrammarProgress(variantProgressKey(topic, v.id)));
  return {
    level: Math.min(...progresses.map(p=>p.level)),
    reps: progresses.reduce((s,p)=>s+p.reps, 0),
    correct: progresses.reduce((s,p)=>s+(p.correct||0), 0),
    due: Math.min(...progresses.map(p=>p.due)),
  };
}

export function grammarTopicByKey(key){
  if(!key) return null;
  const [baseKey, variantId] = key.includes("::") ? key.split("::") : [key, null];
  const topic = GRAMMAR_TOPICS.find(t=>t.key===baseKey);
  if(!topic) return null;
  if(!variantId) return topic;
  const variant = getTopicVariants(topic).find(v=>v.id===variantId);
  return variant ? effectiveTopicForVariant(topic, variant) : topic;
}

export function hasKeyFor(category){
  if(proxyConfigured()) return true; // de gedeelde tussenserver dekt beide categorieën, geen eigen sleutel nodig
  return preferredModelFor(category) === "claude" ? !!settings.anthropicApiKey : !!settings.apiKey;
}

export function inCefrRangeEn(en){
  const cefr = cefrOfEn(en);
  if(typeof cefr !== "number") return true;
  const lo = vocabCefrBand(Math.min(settings.cefrMin, settings.cefrMax));
  const hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  return vocabCefrBand(cefr) >= lo && vocabCefrBand(cefr) <= hi;
}

export function masteredNounsForSuffixDrill(){
  const hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  return EN_WORDS_DATA.filter(w => w.pos === "noun" && vocabCefrBand(w.cefr) <= hi && getProgress(w.en).reps >= 1);
}

export function masteredTopicsForSuffixDrillNoun(){
  const hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  return GRAMMAR_TOPICS.filter(t => SUFFIX_DRILL_NOUN_FRAMEWORKS.has(GRAMMAR_TOPIC_FRAMEWORK[t.key])
    && vocabCefrBand(t.minCefr) <= hi
    && getTopicProgress(t).reps >= 1);
}

export function masteredTopicsForSuffixDrillVerb(){
  const hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  return GRAMMAR_TOPICS.filter(t => SUFFIX_DRILL_VERB_FRAMEWORKS.has(GRAMMAR_TOPIC_FRAMEWORK[t.key])
    && vocabCefrBand(t.minCefr) <= hi
    && getTopicProgress(t).reps >= 1);
}

export function masteredVerbsForSuffixDrill(){
  const hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  return EN_WORDS_DATA.filter(w => w.pos === "verb" && vocabCefrBand(w.cefr) <= hi && getProgress(w.en).reps >= 1);
}

export function noteRecentSentence(tr){
  if(!tr) return;
  recentGeneratedTr.push(tr);
  if(recentGeneratedTr.length > RECENT_SENTENCES_MAX) recentGeneratedTr.shift();
}

export function pickLevelInRange(min, max){
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export async function pickMasteredWordForDictation(){
  const mastered = baseWordList().map(w=>w.en).filter(en => getProgress(en).level >= 8);
  const poolInRange = mastered.filter(inCefrRangeEn);
  const pool = poolInRange.length ? poolInRange : mastered;
  if(!pool.length) return null;
  const en = pool[Math.floor(Math.random()*pool.length)];
  const tr = await getOrFetchTranslation(en);
  if(!tr || !tr.length) return null;
  return {tr: tr[0], en: baseEnOf(en), wordCount: 1};
}

export function pickSentenceComplexityLevel(){
  return pickLevelInRange(settings.sentenceComplexityMin, settings.sentenceComplexityMax);
}

export async function pickSentenceFocus(){
  const grammarTopic = pickLessonGrammarTopic(); // bestaande logica: huidige-les-onderwerp, anders zwakste ontgrendelde
  const weakGrammar = getGrammarProgress(grammarTopic.key).level < 7;

  if(weakGrammar){
    const knownWord = pickWellKnownWord();
    if(knownWord){
      try{
        const tr = await getOrFetchTranslation(knownWord);
        return {target: {en:knownWord, tr:tr[0]}, grammarTopic};
      }catch(e){ /* vertaling van dit ene woord mislukte -> val terug op de normale, robuustere selectie */ }
    }
    // nog geen enkel woord goed beheerst (of de vertaling ervan lukte niet): val terug op de normale woordselectie
    return {target: await pickTurkishTargetForSentence(), grammarTopic};
  }

  // grammatica-onderwerp is hier al goed beheerst -> ruimte om juist op een zwak/nieuw woord te focussen
  const target = await pickTurkishTargetForSentence();
  const safeGrammarTopic = pickWellKnownGrammarTopic() || grammarTopic;
  return {target, grammarTopic: safeGrammarTopic};
}

export function pickSuffixDrillNoun(){
  const pool = masteredNounsForSuffixDrill();
  if(!pool.length) return null;
  const wellKnown = pool.filter(w => getProgress(w.en).level >= SUFFIX_DRILL_PREFERRED_VERB_LEVEL);
  const source = wellKnown.length ? wellKnown : pool;
  return source[Math.floor(Math.random()*source.length)];
}

export function pickSuffixDrillVerb(){
  const pool = masteredVerbsForSuffixDrill();
  if(!pool.length) return null;
  const wellKnown = pool.filter(w => getProgress(w.en).level >= SUFFIX_DRILL_PREFERRED_VERB_LEVEL);
  const source = wellKnown.length ? wellKnown : pool;
  return source[Math.floor(Math.random()*source.length)];
}

export function preferredModelFor(category){
  const setting = category === "word" ? settings.wordModel : category === "reading" ? settings.readingModel : settings.sentenceModel;
  return setting === "deepseek" || setting === "claude" ? setting : (category === "sentence" ? "claude" : "deepseek");
}

export function wordPosOf(en){
  if(!_wordPosMap){
    _wordPosMap = {};
    for(const w of EN_WORDS_DATA) if(w.pos) _wordPosMap[w.en] = w.pos;
  }
  return _wordPosMap[en] || null;
}

export function wordTransitivityOf(en){
  if(!_wordTransitivityMap){
    _wordTransitivityMap = {};
    for(const w of EN_WORDS_DATA) if(w.transitivity) _wordTransitivityMap[w.en] = w.transitivity;
  }
  return _wordTransitivityMap[en] || null;
}

export function baseEnOf(en){
  if(!en) return en;
  if(!_baseEnMap){
    _baseEnMap = {};
    for(const w of EN_WORDS_DATA) _baseEnMap[w.en] = w.base || w.en;
  }
  return _baseEnMap[en] || en;
}

export async function callClaude(systemPrompt, userContentOrMessages, maxTokens, temperature, _attempt, schema){
  const attempt = _attempt || 0;
  const useProxy = proxyConfigured();
  if(!useProxy && !settings.anthropicApiKey) throw new Error("No Anthropic API key set (Settings).");
  const messages = Array.isArray(userContentOrMessages)
    ? userContentOrMessages
    : [{role:"user", content:userContentOrMessages}];
  const url = useProxy ? (settings.proxyUrl.replace(/\/$/,"") + "/claude") : "https://api.anthropic.com/v1/messages";
  const headers = useProxy
    ? {"content-type": "application/json", "X-Proxy-Token": settings.proxyToken}
    : {
        "x-api-key": settings.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      };
  const body = {
    model: "claude-sonnet-5",
    max_tokens: maxTokens || 500,
    // De systeeminstructie is bij elke aanroep woordelijk hetzelfde (alleen het gebruikersbericht
    // verschilt) -- ideaal voor prompt-caching: cache_control markeert 'm als cachebaar, zodat
    // herhaalde aanroepen met dezelfde instructie tegen het veel lagere cache-hit-tarief draaien
    // i.p.v. steeds als nieuwe input te worden gefactureerd.
    system: [{type: "text", text: systemPrompt, cache_control: {type: "ephemeral"}}],
    messages,
    thinking: {"type": "disabled"}, // geen redenering nodig voor gestructureerde JSON-output; voorkomt ook dat de tekst in een 2e blok terechtkomt achter een thinking-blok
  };
  // Optioneel: een JSON-schema afdwingen via tool use i.p.v. het schema als platte tekst in de
  // systeemprompt uit te schrijven ("Antwoord ALLEEN met geldige JSON: {...}"). Dat scheelt tokens
  // (dus geld, ook al is de systeemprompt zelf al gecached) EN is betrouwbaarder: Claude kan het
  // schema dan niet meer per ongeluk lichtjes anders invullen (verkeerd aantal array-items, een
  // object i.p.v. een boolean, etc.) -- precies de klasse fouten waar parseAIJson() nu achteraf
  // gaten in probeert te repareren.
  if(schema){
    body.tools = [{name: schema.name, description: schema.description || "", input_schema: schema.input_schema}];
    body.tool_choice = {type: "tool", name: schema.name};
  }
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if(!res.ok){ const txt = await res.text().catch(()=>""); throw new Error("Claude API error (" + res.status + "): " + txt.slice(0,200)); }
  const data = await res.json();
  recordUsage("claude-sonnet-5", {
    prompt_tokens: data.usage?.input_tokens || 0,
    completion_tokens: data.usage?.output_tokens || 0,
    prompt_cache_hit_tokens: data.usage?.cache_read_input_tokens || 0,
  });
  // Het antwoord kan afgekapt zijn doordat de tokenlimiet werd geraakt vóórdat de JSON afgesloten was
  // (herkenbaar aan Claude's eigen stop_reason) -- dan herkansen met flink meer ruimte, i.p.v. de
  // gebruiker een cryptische "Unexpected end of JSON input"-foutmelding te tonen. Tot 2x herkansen,
  // want bij sommige (langere) oefeningen bleek 1x verdubbelen soms nog niet genoeg.
  if(data.stop_reason === "max_tokens" && attempt < 2){
    const nextBudget = Math.max((maxTokens || 500) * 2, 900);
    return callClaude(systemPrompt, userContentOrMessages, nextBudget, temperature, attempt + 1, schema);
  }
  if(schema){
    // Bij tool use zit het (al gestructureerde, gegarandeerd geldige) resultaat in een "tool_use"-blok
    // i.p.v. een tekstblok -- terug-serialiseren naar een JSON-string zodat parseAIJson() bij de
    // aanroepende functie ongewijzigd kan blijven werken, ongeacht of schema gebruikt werd of niet.
    const toolBlock = (data.content || []).find(b => b.type === "tool_use");
    if(toolBlock) return JSON.stringify(toolBlock.input);
    // Geen tool_use-blok gevonden (zou niet moeten gebeuren bij tool_choice:"tool", maar voor de
    // zekerheid): val terug op eventuele tekst, net als het niet-schema-pad hieronder.
  }
  // Claude kan een "thinking"-blok VOOR het eigenlijke tekstblok plaatsen (interne redenering);
  // ervan uitgaan dat content[0] altijd het tekstblok is, is dus niet veilig. Zoek expliciet naar
  // het/de blok(ken) met type "text" en gebruik die, ongeacht hun positie in de array.
  let raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("") || "";
  raw = raw.replace(/```json|```/g,"").trim();
  return raw;
}

export async function callDeepSeek(systemPrompt, userContentOrMessages, maxTokens, temperature, _attempt, schema){
  const attempt = _attempt || 0;
  const useProxy = proxyConfigured();
  if(!useProxy && !settings.apiKey) throw new Error("No DeepSeek API key set (Settings).");
  // DeepSeek krijgt, in tegenstelling tot Claude, geen apart 'tools'-schema dat de structuur afdwingt --
  // het heeft dus ALLEEN de systeemprompt-tekst om te weten welke velden verwacht worden. Sommige
  // systeemprompts zijn na het toevoegen van schema-ondersteuning bewust ingekort tot alleen "Antwoord
  // in JSON" (want voor Claude is het schema zelf voldoende) -- dat liet DeepSeek zonder enige aanwijzing
  // welke velden/vorm er verwacht wordt, met foutieve/onvolledige JSON tot gevolg. Daarom hier automatisch
  // een tekstuele veldbeschrijving afleiden UIT hetzelfde schema-object dat Claude ook krijgt: één bron
  // van waarheid, geen risico dat de twee ooit weer uit elkaar lopen.
  let effectiveSystemPrompt = systemPrompt;
  if(schema){
    const describe = (props, required) => Object.entries(props).map(([name, spec])=>{
      let type = spec.type;
      if(type === "array") type = `array of ${spec.items?.type === "object" ? "objects" : (spec.items?.type || "items")}`;
      const req = (required||[]).includes(name) ? "" : " (optioneel)";
      const enumStr = spec.enum ? ` [${spec.enum.join("|")}]` : "";
      const desc = spec.description ? ` -- ${spec.description}` : "";
      if(spec.type === "array" && spec.items?.type === "object" && spec.items.properties){
        return `  "${name}": array van objecten${req}, elk met: {${describe(spec.items.properties, spec.items.required)}}`;
      }
      return `  "${name}"${req}: ${type}${enumStr}${desc}`;
    }).join("\n");
    effectiveSystemPrompt = systemPrompt + "\n\nAntwoord met een JSON-object met exact deze velden:\n" + describe(schema.input_schema.properties, schema.input_schema.required);
  }
  const messages = Array.isArray(userContentOrMessages)
    ? [{role:"system", content:effectiveSystemPrompt}, ...userContentOrMessages]
    : [{role:"system", content:effectiveSystemPrompt}, {role:"user", content:userContentOrMessages}];
  const url = useProxy ? (settings.proxyUrl.replace(/\/$/,"") + "/deepseek") : "https://api.deepseek.com/chat/completions";
  const headers = useProxy
    ? {"Content-Type":"application/json", "X-Proxy-Token": settings.proxyToken}
    : {"Content-Type":"application/json", "Authorization":"Bearer " + settings.apiKey};
  const body = {
    model: "deepseek-v4-pro", max_tokens: maxTokens || 500, temperature: temperature ?? 0,
    messages,
    thinking: {"type":"disabled"}
  };
  // DeepSeek kent geen tool-schema-afdwinging zoals Claude's tool_choice -- de systeemprompt moet dus
  // (in tegenstelling tot bij Claude) wél zelf blijven uitleggen welke velden verwacht worden. Wat
  // response_format WEL garandeert: altijd geldige, kale JSON (nooit binnen ```json ... ``` verpakt,
  // nooit met verdwaalde tekst ervoor/erna) -- dus geen losse regex-opschoning meer nodig voor dat deel.
  if(schema) body.response_format = {type: "json_object"};
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if(!res.ok){ const txt = await res.text().catch(()=>""); throw new Error("DeepSeek API error (" + res.status + "): " + txt.slice(0,200)); }
  const data = await res.json();
  recordUsage("deepseek-v4-pro", data.usage);
  // Zelfde afkap-bescherming als bij callClaude: DeepSeek geeft finish_reason:"length" als de
  // tokenlimiet geraakt werd vóórdat de JSON afgesloten was.
  if(data.choices?.[0]?.finish_reason === "length" && attempt < 2){
    const nextBudget = Math.max((maxTokens || 500) * 2, 900);
    return callDeepSeek(systemPrompt, userContentOrMessages, nextBudget, temperature, attempt + 1, schema);
  }
  let raw = data.choices?.[0]?.message?.content || "";
  raw = raw.replace(/```json|```/g,"").trim();
  return raw;
}

export const RECENT_SENTENCES_MAX = 6;

export let recentGeneratedTr = [];

export function parseAIJson(raw){
  try{ return JSON.parse(raw); }catch(e){ /* val hieronder terug op reparatie */ }

  // Scenario 1: het antwoord is eigenlijk al compleet en geldig, maar heeft nog wat overtollige tekens
  // ACHTERAAN hangen (bv. een dwalend extra aanhalingsteken) -- zoek het punt waar de buitenste
  // haak/accolade voor het eerst weer op "helemaal gesloten" uitkomt, en knip alles daarna gewoon weg.
  {
    let depth = 0, inStr = false, esc = false, endIdx = -1;
    for(let i=0;i<raw.length;i++){
      const ch = raw[i];
      if(esc){ esc = false; continue; }
      if(ch === "\\"){ esc = true; continue; }
      if(ch === '"'){ inStr = !inStr; continue; }
      if(inStr) continue;
      if(ch === "{" || ch === "[") depth++;
      else if(ch === "}" || ch === "]"){
        depth--;
        if(depth === 0){ endIdx = i; break; }
      }
    }
    if(endIdx !== -1 && endIdx < raw.length - 1){
      try{ return JSON.parse(raw.slice(0, endIdx + 1)); }catch(e){ /* val verder terug op onderstaande strategie */ }
    }
  }

  // Scenario 2: het antwoord is juist AFGEKAPT (mist iets aan het einde) -- probeer net zo lang steeds
  // een stukje van het einde af te knippen (tot aan de laatste komma of openende haak) en dan de nog
  // openstaande haken/aanhalingstekens te sluiten, tot het weer geldige JSON oplevert — zo verlies je
  // in het ergste geval alleen het laatste, half afgemaakte element, i.p.v. de hele oefening.
  let s = raw;
  for(let i=0; i<6; i++){
    let attempt = s;
    const quoteCount = (attempt.match(/(?<!\\)"/g) || []).length;
    if(quoteCount % 2 === 1) attempt += `"`;
    const stack = [];
    for(const ch of attempt){
      if(ch === "{" || ch === "[") stack.push(ch);
      else if(ch === "}" && stack[stack.length-1] === "{") stack.pop();
      else if(ch === "]" && stack[stack.length-1] === "[") stack.pop();
    }
    while(stack.length){ attempt += stack.pop() === "{" ? "}" : "]"; }
    try{ return JSON.parse(attempt); }catch(e){ /* nog steeds ongeldig -> verder terugsnijden */ }
    const lastBreak = Math.max(s.lastIndexOf(","), s.lastIndexOf("{"), s.lastIndexOf("["));
    if(lastBreak <= 0) break;
    s = s.slice(0, lastBreak);
  }
  try{
    return JSON.parse(raw);
  }catch(e){
    // alle reparatiepogingen mislukt -> gooi een duidelijkere fout met wat er daadwerkelijk binnenkwam,
    // zodat een eventuele volgende keer meteen zichtbaar is of het om afkapping ging of iets anders
    throw new Error(`Unparseable AI response (${raw.length} chars, ends with: "${raw.slice(-60)}")`);
  }
}

/* ===================== LEESOEFENING (tekst + begripsvragen) =====================
   AI-gegenereerde leestekst op instelbaar CEFR-niveau + begripsvragen erover. Teksten/vragen worden
   BLIJVEND opgeslagen (readingTexts in app.js, zie ook LS_READING_TEXTS) zodat een tekst later
   hergebruikt kan worden zonder dat een vraag ooit twee keer gesteld wordt -- elke vraag heeft een
   eigen `asked`-vlag; is een tekst "op" (alle vragen al gesteld), dan kunnen er via
   generateMoreReadingQuestions() NIEUWE vragen bij die specifieke tekst bijgemaakt worden i.p.v. een
   hele nieuwe tekst te genereren. Model (DeepSeek/Claude) is expliciet instelbaar op het scherm zelf
   (settings.readingModel, zie preferredModelFor hierboven) i.p.v. verstopt in Settings -- dit is de
   enige oefening waar de kostenkant zo direct zichtbaar/kiesbaar is, op uitdrukkelijk verzoek. */
export async function generateReadingText(level, questionCount){
  if(!hasKeyFor("reading")) throw new Error(`No ${preferredModelFor("reading") === "claude" ? "Anthropic" : "DeepSeek"} API key (or shared proxy) set — needed to generate a reading text.`);
  const n = questionCount || 4;
  // Bewust een ruimere/lossere drempel (6) dan de "echt beheerst" 7-8 elders: dit is een LEESoefening
  // (het woord hoeft niet actief uit het hoofd geproduceerd te worden zoals bij een woord-oefening,
  // alleen herkend), dus een iets lagere bekendheidsdrempel is hier gepast.
  const knownSample = pickKnownVocabSample(40, 6);
  const sys = `Je bent een auteur van leesteksten voor taalleerders Turks. Schrijf een natuurlijke, samenhangende Turkse tekst van 150-220 woorden op CEFR-niveau ${level}, over een op zichzelf staand, interessant onderwerp (geen vervolg op iets eerders nodig). Zinsbouw en vocabulaire moeten qua complexiteit daadwerkelijk bij niveau ${level} passen -- niet kunstmatig versimpeld, niet nodeloos moeilijk. Gebruik waar relevant bekende woorden van de gebruiker (zie hieronder), aangevuld met ander vocabulaire dat bij het niveau past.
Bedenk daarna ${n} begripsvragen IN HET ENGELS over de tekst -- over de INHOUD (hoofdgedachte, een detail, een afleiding/interpretatie, oorzaak-gevolg, volgorde van gebeurtenissen), NIET over losse woordbetekenissen. Elke vraag moet in een kort Engels zinnetje te beantwoorden zijn. Geef ook een kort referentieantwoord (Engels) per vraag, voor de beoordeling achteraf.
Antwoord in JSON.`;
  const user = `CEFR-niveau: ${level}.
${knownSample.length ? `Bekende woorden van de gebruiker (mag gebruikt worden, geen verplichting): ${knownSample.map(en=>cachedTranslation(en)?.[0]||en).join(", ")}` : ""}`;
  const schema = {
    name: "leestekst",
    description: "Een Turkse leestekst op een gegeven CEFR-niveau, met begripsvragen erover.",
    input_schema: {
      type: "object",
      properties: {
        tr: {type:"string", description:"De Turkse leestekst, 150-220 woorden, op het gevraagde CEFR-niveau."},
        questions: {
          type: "array",
          description: `Precies ${n} begripsvragen in het Engels over de INHOUD van de tekst, elk met een kort referentieantwoord.`,
          items: {
            type: "object",
            properties: {
              q: {type:"string", description:"Begripsvraag in het Engels, over de inhoud van de tekst."},
              answerHint: {type:"string", description:"Kort referentieantwoord in het Engels, voor de beoordeling."},
            },
          },
        },
      },
      required: ["tr", "questions"],
    },
  };
  const raw = await callAI("reading", sys, user, 1800, 0.7, schema);
  const parsed = parseAIJson(raw);
  if(!parsed.tr || !Array.isArray(parsed.questions) || !parsed.questions.length) throw new Error("AI did not return a reading text with questions.");
  return {
    tr: parsed.tr,
    questions: parsed.questions.filter(q => q && q.q).map(q => ({q: q.q, answerHint: q.answerHint || ""})),
  };
}

// Genereert NIEUWE begripsvragen voor een AL BESTAANDE, opgeslagen tekst -- gebruikt wanneer alle
// eerdere vragen bij die tekst al gesteld zijn, zodat dezelfde tekst herbruikt kan worden zonder een
// vraag te herhalen. De AI krijgt de reeds gestelde vragen expliciet te zien, om overlap te vermijden.
export async function generateMoreReadingQuestions(readingItem, questionCount){
  if(!hasKeyFor("reading")) throw new Error(`No ${preferredModelFor("reading") === "claude" ? "Anthropic" : "DeepSeek"} API key (or shared proxy) set — needed to generate more questions.`);
  const n = questionCount || 3;
  const existingQs = readingItem.questions.map(q => q.q);
  const sys = `Je krijgt een Turkse leestekst en een lijst begripsvragen die daar AL over gesteld zijn. Bedenk ${n} NIEUWE, andere begripsvragen in het Engels over dezelfde tekst -- mogen over andere details/interpretaties gaan, maar herhaal GEEN van de bestaande vragen, ook niet in andere bewoordingen met dezelfde strekking. Geef ook een kort referentieantwoord (Engels) per nieuwe vraag. Antwoord in JSON.`;
  const user = `Tekst: "${readingItem.tr}"
${existingQs.length ? `Al gestelde vragen (NIET herhalen):\n${existingQs.map((q,i)=>`${i+1}. ${q}`).join("\n")}` : "Dit is de eerste keer dat er vragen over deze tekst gesteld worden -- er is dus nog niets te vermijden."}`;
  const schema = {
    name: "extra_vragen",
    description: "Nieuwe, niet eerder gestelde begripsvragen over dezelfde leestekst.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: `Precies ${n} NIEUWE begripsvragen (geen herhaling van de al gestelde), elk met een kort referentieantwoord.`,
          items: {
            type: "object",
            properties: {
              q: {type:"string", description:"Nieuwe begripsvraag in het Engels, niet eerder gesteld."},
              answerHint: {type:"string", description:"Kort referentieantwoord in het Engels."},
            },
          },
        },
      },
      required: ["questions"],
    },
  };
  const raw = await callAI("reading", sys, user, 1000, 0.7, schema);
  const parsed = parseAIJson(raw);
  if(!Array.isArray(parsed.questions) || !parsed.questions.length) throw new Error("AI did not return new questions.");
  return parsed.questions.filter(q => q && q.q).map(q => ({q: q.q, answerHint: q.answerHint || ""}));
}

export async function gradeReadingAnswer(readingItem, question, answer, clarification){
  if(!answer) return {correct: false, feedback: "", needsClarification: false};
  if(!hasKeyFor("reading")) throw new Error(`No ${preferredModelFor("reading") === "claude" ? "Anthropic" : "DeepSeek"} API key (or shared proxy) set — needed to check your answer.`);
  // `clarification` is gezet zodra dit de TWEEDE beoordelingsronde is voor deze vraag (de eerste ronde
  // leverde needsClarification=true op, en de gebruiker heeft net op de verduidelijkingsvraag
  // geantwoord) -- in dat geval MOET er nu een definitief oordeel komen, geen nieuwe vervolgvraag.
  const isFollowUp = !!clarification;
  const sys = `Je bent een vriendelijke, geduldige docent Turks die leesbegrip beoordeelt. Je toon is warm en bemoedigend, nooit streng of afwijzend -- ook bij een fout antwoord blijf je ondersteunend en leg je vriendelijk uit wat er anders zit.

Beoordeel of het Engelse antwoord van de gebruiker op een leesbegripsvraag over een Turkse tekst inhoudelijk correct/acceptabel is. Wees soepel met bewoording (parafrasering en synoniemen zijn prima), streng op inhoud (het antwoord moet daadwerkelijk kloppen met wat er in de tekst staat).

BELANGRIJK -- oorzaak vs. gevolg: vraagt de vraag naar een REDEN/OORZAAK (bv. "why...") maar noemt de tekst zelf alleen een GEVOLG (bv. "hierdoor gebeurde X", "dit leidde tot Y") zonder een expliciete reden te geven, reken dan een antwoord als "the text doesn't mention a reason, only a consequence/effect" (of een vergelijkbaar antwoord dat dit onderscheid herkent) als CORRECT. Verzin zelf ook nooit een reden die niet letterlijk of duidelijk impliciet in de tekst staat, en verwar een genoemd gevolg nooit met een genoemde oorzaak.

${!isFollowUp
  ? `Is het antwoord van de gebruiker ECHT ONDUIDELIJK OF DUBBELZINNIG geformuleerd (niet gewoon fout, maar zo vaag/onvolledig dat je zelf niet met vertrouwen kunt beoordelen of het klopt) -- stel dan GEEN oordeel, maar zet needsClarification op true en stel een korte, vriendelijke verduidelijkingsvraag om te snappen wat de gebruiker precies bedoelde. Gebruik dit spaarzaam en alleen bij ECHTE onduidelijkheid -- een gewoon fout of onvolledig antwoord krijgt gewoon meteen een oordeel (needsClarification blijft dan false), geen verduidelijkingsvraag als excuus om nooit te hoeven oordelen.`
  : `Dit is al een VERVOLGVRAAG-RONDE: de gebruiker heeft eerder geantwoord, is om verduidelijking gevraagd, en heeft die verduidelijking nu gegeven. Geef nu een DEFINITIEF oordeel (needsClarification MOET false zijn) op basis van het oorspronkelijke antwoord samen met de verduidelijking -- vraag niet nogmaals door.`}

Antwoord in JSON.`;
  const user = isFollowUp
    ? `Tekst: "${readingItem.tr}"
Vraag: "${question.q}"
Referentieantwoord: "${question.answerHint}"
Oorspronkelijk antwoord van de gebruiker: "${clarification.previousAnswer}"
Jouw verduidelijkingsvraag daarop: "${clarification.clarifyingQuestion}"
Antwoord van de gebruiker op de verduidelijkingsvraag: "${answer}"`
    : `Tekst: "${readingItem.tr}"
Vraag: "${question.q}"
Referentieantwoord: "${question.answerHint}"
Antwoord van gebruiker: "${answer}"`;
  const schema = {
    name: "leesbegrip_oordeel",
    description: "Beoordeling van een leesbegrip-antwoord, met optioneel een verduidelijkingsvraag i.p.v. een direct oordeel bij echte onduidelijkheid.",
    input_schema: {
      type: "object",
      properties: {
        needsClarification: {type:"boolean", description:"True als het antwoord te onduidelijk/dubbelzinnig is om te beoordelen en er eerst een verduidelijkingsvraag gesteld moet worden. Alleen bij ECHTE onduidelijkheid, nooit als vervanging voor een gewoon fout-oordeel. Moet false zijn tijdens een vervolgvraag-ronde."},
        clarifyingQuestion: {type:"string", description:"Alleen invullen als needsClarification true is: een korte, vriendelijke vervolgvraag aan de gebruiker."},
        correct: {type:"boolean", description:"Het oordeel. Alleen relevant/betrouwbaar als needsClarification false is."},
        feedback: {type:"string", description:"Korte, warme en bemoedigende Engelse toelichting -- vooral relevant bij een fout antwoord: wat mist er, of wat staat er daadwerkelijk in de tekst, in een vriendelijke toon."},
      },
      required: ["needsClarification", "correct", "feedback"],
    },
  };
  const raw = await callAI("reading", sys, user, 400, 0, schema);
  const parsed = parseAIJson(raw);
  if(parsed.needsClarification && !isFollowUp){
    return { needsClarification: true, clarifyingQuestion: parsed.clarifyingQuestion || "Could you clarify your answer a bit?", correct: false, feedback: "" };
  }
  return { correct: !!parsed.correct, feedback: parsed.feedback || "", needsClarification: false };
}


/* ===================== WIKIPEDIA-LEESTEKST (echte, niet-gegenereerde tekst) =====================
   Haalt een ECHT, van Turkse Wikipedia afkomstig tekstfragment op -- de AI genereert hier NIETS, en
   schat alleen ACHTERAF het CEFR-niveau van de gevonden tekst in (een beoordelingstaak). Komt er
   binnen het aantal pogingen geen tekst op het gevraagde niveau naar boven, dan geeft
   findWikipediaReadingText() null terug; de aanroeper (app.js) beslist zelf of/hoe er dan alsnog op
   AI-generatie (generateReadingText) teruggevallen wordt -- expliciet pas na het vragen van
   toestemming, zoals gevraagd. */

// Eén willekeurig Turks Wikipedia-artikel + tekstfragment ophalen. Gebruikt de publieke, CORS-
// vriendelijke MediaWiki-API (origin=*) -- rechtstreeks vanuit de browser, geen eigen server nodig.
// exchars=1200 begrenst de lengte grofweg; we knippen daarna zelf netjes af op een zinsgrens.
async function fetchRandomWikipediaExtract(){
  const url = "https://tr.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=1&prop=extracts&explaintext=1&exchars=1200&format=json&origin=*";
  const res = await fetchWithTimeout(url, {}, 15000);
  if(!res.ok) throw new Error("Wikipedia API returned status " + res.status);
  const data = await res.json();
  const pages = data && data.query && data.query.pages;
  if(!pages) return null;
  const page = Object.values(pages)[0];
  if(!page || !page.extract) return null;
  let text = page.extract.trim();
  if(text.length < 200) return null; // stub-artikel / doorverwijspagina, te kort om als leestekst te dienen
  // Netjes afkappen op de laatste volledige zin i.p.v. midden in een zin (exchars snijdt soms dwars
  // door een zin heen) -- alleen toepassen als dat punt niet belachelijk vroeg in de tekst zit.
  const lastSentenceEnd = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
  if(lastSentenceEnd > 200) text = text.slice(0, lastSentenceEnd + 1);
  return {
    tr: text,
    title: page.title,
    url: "https://tr.wikipedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")),
  };
}

// Schat het CEFR-niveau van een GEGEVEN (al bestaande, niet door AI geschreven) stuk Turkse tekst --
// puur een beoordelingstaak, vergelijkbaar met hoe checkStaticMatch/askDeepSeekJudge bestaande
// antwoorden beoordelen i.p.v. iets nieuws te verzinnen.
export async function estimateTextLevel(text){
  if(!hasKeyFor("reading")) throw new Error(`No ${preferredModelFor("reading") === "claude" ? "Anthropic" : "DeepSeek"} API key (or shared proxy) set — needed to estimate the text level.`);
  const sys = `Je krijgt een stuk Turkse tekst uit een echt Wikipedia-artikel. Schat het CEFR-niveau in op basis van zinsbouw en vocabulaire-complexiteit -- NIET op basis van het onderwerp zelf (een encyclopedisch onderwerp kan met eenvoudige zinnen beschreven zijn, en andersom). Kies EXACT een van: A2, B1, B2, C1. Antwoord in JSON.`;
  const user = `Tekst:\n"${text}"`;
  const schema = {
    name: "niveau_inschatting",
    description: "Geschat CEFR-niveau van de gegeven, al bestaande tekst.",
    input_schema: {
      type: "object",
      properties: { level: {type:"string", description:"Exact een van: A2, B1, B2, C1."} },
      required: ["level"],
    },
  };
  const raw = await callAI("reading", sys, user, 50, 0, schema);
  const parsed = parseAIJson(raw);
  return ["A2","B1","B2","C1"].includes(parsed.level) ? parsed.level : null;
}

// Probeert tot `maxAttempts` willekeurige Wikipedia-artikelen totdat er een gevonden wordt waarvan het
// geschatte niveau EXACT overeenkomt met het gevraagde niveau (geen "dichtstbijzijnde" fallback -- dat
// zou de indruk kunnen wekken dat het niveau klopt terwijl dat niet zo is). Geeft null terug als dat
// niet lukt binnen het aantal pogingen; een AI-infrastructuurfout (na callAI's eigen retries nog steeds
// mislukt) wordt NIET als "geen match" behandeld maar meteen doorgegeven aan de aanroeper (stap 6-
// patroon: geen zinloze herhaalde pogingen tegen een server die toch niet reageert).
export async function findWikipediaReadingText(targetLevel, maxAttempts){
  const attempts = maxAttempts || 5;
  for(let i=0; i<attempts; i++){
    let article;
    try{ article = await fetchRandomWikipediaExtract(); }catch(e){ continue; } // dit ene artikel mislukte op te halen -> gewoon een volgende proberen
    if(!article) continue;
    const level = await estimateTextLevel(article.tr); // AI-infrastructuurfout hier -> bewust NIET gevangen, propageert naar de aanroeper
    if(level === targetLevel) return {...article, level};
  }
  return null;
}
