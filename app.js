// ===================== app.js =====================
// Hoofdmodule van de app: dataladen, SRS-toepassing, AI-promptlaag, en alle UI-rendering. Gebruikt de
// zuivere/losstaande logica uit utils.js, typo.js en srs.js (zie die bestanden en /tests voor wat daar
// nu apart getest wordt). Dit is bewust nog een groot bestand -- verdere opsplitsing (AI-laag, UI-laag)
// is een vervolgstap; deze eerste opsplitsing haalt specifiek de meest bug-gevoelige, goed te isoleren
// kernlogica los.

import { CEFR_MAJOR, cefrLabel, vocabCefrBand, normalize, foldTurkishDiacritics, escapeHtml } from './utils.js';
import { isTypoOf } from './typo.js';
import { intervalMinutes, EASE_START, resolveWordMixSlot, pickBestPracticeType } from './srs.js';
import { scheduleReview, migrateLegacyProgress, gradeFromResult, GRADE_EASY } from './fsrs.js';
import {
  callAI,
  generateSuffixDrill,
  gradeSuffixDrillAnswer,
  gradeGrammarDrillAnswer,
  gradeCheckupWordAnswer,
  pickWordSense,
  gradeSingleTestItem,
  generateSentence,
  generateQuestion,
  gradeQuestionAnswer,
  gradeSentenceTranslation,
  stripTrClarifier,
  findMatchedTr,
  closestTrMatch,
  checkStaticMatch,
  askDeepSeekJudge,
  askDeepSeekFree,
  explainWordContent,
  lookupWrongAnswerMeaning,
  explainSentenceContent,
  generateDictationItem,
  gradeDictationAnswer,
  baseWordList,
  cachedTranslation,
  canOfferNounSuffixDrill,
  canOfferVerbSuffixDrill,
  cefrGuidance,
  checkSentenceNatural,
  correctEnglishDisplayFor,
  dictationTierFor,
  generateSingleTestItem,
  getOrFetchTranslation,
  getProgress,
  getTopicProgress,
  grammarTopicByKey,
  hasKeyFor,
  inCefrRangeEn,
  pickSentenceComplexityLevel,
  preferredModelFor,
  wordPosOf,
  wordTransitivityOf,
  baseEnOf,
  callClaude,
  parseAIJson,
  generateReadingText,
  generateMoreReadingQuestions,
  gradeReadingAnswer,
  findWikipediaReadingText,
} from './ai.js';



// Asynchrone laad-helper voor de externe databestanden (words.json, vocab-lessons.json,
// vocab-data.json, reverse-tr-index.json, lessons.json) -- gebruikt fetch() i.p.v. de vroegere
// SYNCHRONE XMLHttpRequest, die de hele pagina blokkeerde (geen rendering, geen interactie)
// totdat alle bestanden binnen waren, zonder enige visuele feedback voor de gebruiker. De
// bestanden worden nu parallel opgehaald door loadAllData() (verderop, na alle relevante
// functiedefinities) en pas daarna wordt de rest van de app geïnitialiseerd -- zie het
// laadscherm (#loading-overlay) en de DOMContentLoaded-handler onderaan dit bestand.
function loadJSONAsync(url){
  return fetch(url).then(res=>{
    if(!res.ok) throw new Error("Kon " + url + " niet laden (status " + res.status + ")");
    return res.json();
  });
}
export let EN_WORDS_DATA; // Oxford 3000/5000, {en, cefr} per item — no pre-translated Turkish; wordt gevuld door loadAllData()
// Voor woorden die zijn gesplitst op woordsoort (bv. "close__v"/"close__adj" voor het werkwoord
// resp. bijvoeglijk naamwoord "close") bevat words.json een apart "base"-veld met de schone,
// leesbare tekst ("close"). Voor alle niet-gesplitste woorden is er geen "base"-veld en is het
// woord zelf al schoon. baseEnOf() geeft ALTIJD de tekst die aan een mens getoond of aan de AI
// als natuurlijke taal doorgegeven mag worden -- gebruik dit overal waar het woord daadwerkelijk
// zichtbaar wordt, in tegenstelling tot de kale `en`-sleutel die voor opslag/lookup blijft dienen.



let VOCAB_LESSON_DATA, EMBEDDED_CURATED_TR;
export let REVERSE_TR_INDEX; // gevuld door loadAllData(); zie commentaar daar voor wat elk bevat


/* ===================== OPSLAG ===================== */
const LS_PROGRESS = "turks_progress_v1";      // { [en]: {level, due, reps} } — nu op ENGELS trefwoord (Oxford lemma)
const LS_CUSTOM    = "turks_custom_v1";        // { [en]: {tr:[...]} } — extra geaccepteerde Turkse antwoorden (via 'oneens')
const LS_OVERRIDES = "turks_overrides_v1";     // { [en]: {tr:[...]} } — HANDMATIGE correctie van een woordkaart, vervangt (i.p.v. vult aan) de vertaling en heeft ALTIJD voorrang, ook boven curatedTr
const LS_TR_OVERRIDES = "turks_tr_overrides_v1"; // { [trwordKey]: {tr, en} } — zelfde soort handmatige correctie, maar dan voor tr-en-woorden (TR_WORDS_DATA, eigen "trword:"-sleutel)
// Hoogste sub-niveau-index die daadwerkelijk in de woordenlijst voorkomt (C1 end) -- de "Language
// level"-sliders/dropdowns (woord-oefening) mogen hier niet overheen; de aparte "Sentence complexity"-
// sliders (zinsbouw, niet vocabulaire) blijven wél het volledige 0-17-bereik gebruiken.
export const MAX_VOCAB_CEFR_IDX = 14;
const LS_SETTINGS  = "turks_settings_v1";      // { apiKey, sentencePercent, cefrLevel, questionPercent, syncBinId, syncApiKey }
const LS_HISTORY   = "turks_history_v1";       // array of "word"/"sentence", laatste 20
export const LS_NEWWORDS  = "turks_newwords_v1";      // { [en]: {cefr} } — via zinnen ontdekte Engelse woorden, niet in de Oxford-lijst
const LS_GRAMMAR   = "turks_grammar_v1";       // { [topicKey]: {level, due, reps} } — per grammaticaal onderwerp, zelfde SRS-mechaniek als woorden
export const LS_TRCACHE   = "turks_trcache_v1";       // { [en]: {tr:[...], fetchedAt} } — op-aanvraag gegenereerde Turkse vertaling, 1x per woord
// Stap 7 van het verbeterplan ("gegenereerde uitleg hergebruiken i.p.v. steeds opnieuw genereren"):
// dezelfde woord-uitleg (explainWordContent) en dezelfde korte fout-antwoord-vertaling
// (lookupWrongAnswerMeaning) leverden bij elke hernieuwde aanvraag exact dezelfde inhoud op (de content
// hangt niet af van sessie-specifieke state), maar werden voorheen toch telkens opnieuw (en dus tegen
// herhaalde kosten/wachttijd) gegenereerd -- vooral merkbaar omdat je via SRS hetzelfde woord keer op
// keer weer tegenkomt. { [cacheKey]: {uitleg, cachedAt} }.
export const LS_EXPLANATION_CACHE = "turks_explanation_cache_v1";
const LS_CURATED_TR = "turks_curated_tr_v1";   // { [en]: {tr:[...], register, note} } — eenmalige, grondige AI-doorloop van de hele woordenlijst incl. registermetadata; heeft voorrang boven trCache
const LS_LESSONS   = "turks_lessons_v1";       // { [lessonId]: {completed:bool, done:n} } — voortgang door het gestructureerde lespad
const LS_SKILL_SCORES = "turks_skill_scores_v1"; // { [lessonId]: {correct, total} } — score van de laatst afgeronde "Practice this skill"-ronde
const LS_COURSE_SECTIONS = "turks_course_sections_v1"; // { grammar: {A1:bool,...}, vocab: {...} } — welke CEFR-secties in-/uitgeklapt staan
const LS_ACTIVE_LESSON  = "turks_active_lesson_v1";   // { lessonId, sessionDone } — tussentijdse les-sessie, overleeft tabwissel/minimaliseren
const LS_ACTIVE_CHECKUP = "turks_active_checkup_v1";  // volledige activeCheckup-state — tussentijdse kennischeck-sessie
const LS_ADAPTIVE_WINDOW = "turks_adaptive_v1";        // array van laatste N correct/fout-uitkomsten (reguliere oefeningen)
const LS_COST      = "turks_cost_v1";          // { byModel: {...} } — bevestigd/gesynct totaal
const LS_COST_PENDING = "turks_cost_pending_v1"; // { byModel: {...} } — lokaal verbruik nog niet samengevoegd met cloud
const LS_LESSON_GRADE_OVERRIDES = "turks_lesson_grade_overrides_v1"; // { [lessonId]: grade 0-10 } — handmatig ingesteld persoonlijk minimumcijfer per les ("ik beheers dit al")
// Leesoefening (tekst + begripsvragen, zie generateReadingText/gradeReadingAnswer in ai.js): elke
// tekst wordt BLIJVEND bewaard, samen met al zijn vragen -- elke vraag heeft een eigen `asked`-vlag
// zodat een tekst later hergebruikt kan worden zonder dat een vraag ooit twee keer gesteld wordt.
// { id, tr, level, createdAt, questions: [{q, answerHint, asked, correct}] }[]
export const LS_READING_TEXTS = "turks_reading_texts_v1";
const LS_ACTIVE_TAB = "turks_active_tab_v1"; // laatst geopende tabblad (practice/suffixes/course/words/stats/settings) — puur lokale UI-voorkeur, bewust NIET via saveJSON() (dus niet gesynct naar andere apparaten) en niet meegeteld in de cost-triggerende opslagsleutels
const LS_WORD_MIX_COUNTER = "turks_word_mix_counter_v1"; // simpele oplopende teller (nooit gereset/afgekapt), gebruikt als counter % 5 om exact settings.newWordsPer5 op elke 5 woordoefeningen te garanderen (zie pickNextItem) i.p.v. een schattend gemiddelde

function loadJSON(key, fallback){
  try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch(e){ return fallback; }
}
// Moet vóór de eerste saveJSON()-aanroep hieronder gedeclareerd zijn: saveJSON kan syncMaybePush()
// triggeren, die deze variabele direct gebruikt. Stond voorheen pas veel verderop in het bestand
// gedeclareerd (bij de andere sync-functies) -- met `let` geeft dat een "Cannot access before
// initialization"-fout zodra er vroeg in de opstart al eens iets opgeslagen wordt (bv. een
// eenmalige data-opschoning of instellingen-migratie, wat niet bij elke gebruiker even vaak voorkomt,
// vandaar dat dit niet meteen opviel). `function`-declaraties worden wel volledig gehesen, `let` niet.
let syncPushTimer = null;
export function saveJSON(key, val){
  localStorage.setItem(key, JSON.stringify(val));
  if(key === LS_PROGRESS || key === LS_CUSTOM || key === LS_OVERRIDES || key === LS_NEWWORDS || key === LS_GRAMMAR || key === LS_TRCACHE || key === LS_EXPLANATION_CACHE || key === LS_LESSONS || key === LS_READING_TEXTS) syncMaybePush();
}

export let progress = loadJSON(LS_PROGRESS, {});
export let custom   = loadJSON(LS_CUSTOM, {});
export let settings = loadJSON(LS_SETTINGS, {apiKey:"", sentencePercent:20, cefrLevel:4, questionPercent:0});
// EÉN gedeelde override-opslag voor zowel en-tr- als tr-en-correcties (voorheen twee gescheiden
// systemen: overrides + trOverrides, met elk hun eigen localStorage-sleutel, edit-modal-functie en
// save/clear-vertakking -- stap 5 van het verbeterplan, "en-tr en tr-en op één gedeelde abstractie").
// Dit kan veilig samen in 1 object, want en-tr-sleutels (het en-woord zelf) en tr-en-sleutels
// ("trword:...") zijn per constructie niet-overlappende sleutelruimtes -- geen botsingsrisico.
export let overrides = loadJSON(LS_OVERRIDES, {});
// Eenmalige migratie: bestaande correcties uit het oude, aparte trOverrides-systeem invoegen in de
// nieuwe gedeelde opslag. Het oude localStorage-item (LS_TR_OVERRIDES) blijft verder ongewijzigd staan
// (nooit verwijderd, puur voor rollback-veiligheid) -- er wordt alleen niet meer NAAR geschreven.
// LET OP: dit moet NA de `settings`-declaratie hierboven staan -- saveJSON() hangt via syncMaybePush()
// van settings af, en riep dat hier eerder aan vóórdat settings (met `let`, dus temporal-dead-zone)
// geïnitialiseerd was.
{
  const legacyTrOverrides = loadJSON(LS_TR_OVERRIDES, {});
  const legacyKeys = Object.keys(legacyTrOverrides);
  if(legacyKeys.length){
    let merged = 0;
    for(const key of legacyKeys){
      if(!overrides[key]){ overrides[key] = legacyTrOverrides[key]; merged++; }
    }
    if(merged) saveJSON(LS_OVERRIDES, overrides);
  }
}

// ===================== SCHEMA-VERSIE-BOEKHOUDING (stap 10 van het verbeterplan) =====================
// GEEN nieuwe migratielogica -- de eigenlijke migraties staan (en blijven staan) op hun eigen, meest
// logische plek (de trOverrides-merge vlak hierboven; migrateLegacyProgress in fsrs.js, die lazy per
// progress-entry migreert zodra 'ie voor het eerst weer aangeraakt wordt). Dit is PUUR boekhouding: een
// centraal, chronologisch overzicht van welke wijzigingen aan het opslagformaat een gebruiker met oudere
// data automatisch doorloopt, plus de afspraak voor toekomstige wijzigingen:
//   1. Een wijziging die het BETEKENIS of FORMAAT van een bestaand localStorage-veld verandert (niet:
//      een nieuw, optioneel veld toevoegen -- dat heeft geen migratie nodig, zie hieronder) krijgt hier
//      een nieuwe regel in SCHEMA_MIGRATIONS, met CURRENT_SCHEMA_VERSION opgehoogd.
//   2. Data-reads blijven ALTIJD achterwaarts-compatibel: een ontbrekend/verouderd veld krijgt een
//      zinnig fallback (zie loadJSON's default-parameter-patroon door de hele app heen, en
//      migrateLegacyProgress) i.p.v. te veronderstellen dat het al in het nieuwe formaat staat. Oude
//      velden worden nooit stilzwijgend verwijderd bij een migratie (zie ook: LS_TR_OVERRIDES blijft
//      hierboven gewoon ongebruikt in localStorage staan, puur voor rollback-veiligheid).
//   3. Zie CHANGELOG.md voor de gebruikersgerichte samenvatting per versie; dit log is de TECHNISCHE
//      tegenhanger, specifiek voor het opslagformaat.
const CURRENT_SCHEMA_VERSION = 2;
// Bewust puur documentatie: dit logboek wordt door een mens gelezen (zie CHANGELOG.md/de toelichting
// hierboven), niet door de code zelf geraadpleegd.
// eslint-disable-next-line no-unused-vars
const SCHEMA_MIGRATIONS = [
  {version: 1, description: "Uitgangspunt: handgerolde SM-2-achtige score (level/ease/intervalMin), aparte overrides/trOverrides-opslag."},
  {version: 2, description: "FSRS-scheduling (stability/difficulty, zie fsrs.js/migrateLegacyProgress) i.p.v. de handgerolde SM-2-variant; overrides + trOverrides samengevoegd tot één gedeelde opslag (zie hierboven)."},
];
{
  const LS_SCHEMA_VERSION = "turks_schema_version_v1";
  const storedVersion = parseInt(localStorage.getItem(LS_SCHEMA_VERSION) || "1", 10);
  if(storedVersion < CURRENT_SCHEMA_VERSION){
    // Niets uit te voeren hier -- de daadwerkelijke migraties (zie boven) zijn al toegepast, ongeacht
    // deze teller. Dit registreert alleen DAT een gebruiker met oudere data deze versiesprong doorloopt,
    // zodat toekomstige migraties (SCHEMA_MIGRATIONS met version > 2) hier een duidelijke basis hebben
    // om vanaf te bouwen i.p.v. steeds opnieuw te moeten uitzoeken "had deze gebruiker dit al of niet".
    localStorage.setItem(LS_SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));
  }
}

/* Alle netwerkaanroepen naar DeepSeek/Anthropic lopen hierdoorheen: voorkomt dat de app oneindig blijft
   hangen (bv. op "AI is checking your answer...") als de server traag is of niet reageert — na de
   opgegeven tijd wordt de aanvraag afgebroken met een duidelijke foutmelding i.p.v. stil te blijven wachten. */
export async function fetchWithTimeout(url, opts, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(()=> controller.abort(), timeoutMs || 30000);
  try{
    return await fetch(url, {...opts, signal: controller.signal});
  }catch(e){
    if(e.name === "AbortError") throw new Error("Request timed out after " + Math.round((timeoutMs||30000)/1000) + "s — the server may be slow or unreachable. Please try again.");
    throw e;
  }finally{
    clearTimeout(timer);
  }
}
if(settings.cefrLevel === undefined) settings.cefrLevel = 4;
if(settings.cefrMin === undefined) settings.cefrMin = Math.max(0, settings.cefrLevel - 1);
if(settings.cefrMax === undefined) settings.cefrMax = Math.min(MAX_VOCAB_CEFR_IDX, settings.cefrLevel + 1);
// Bestaande, eerder opgeslagen instellingen kunnen nog een hoger bereik bevatten dan nu is toegestaan
// (bv. via de placement-test of adaptive-difficulty-ophoging van vóór deze cap) -- die knijpen we hier
// terug, anders staat de dropdown straks op een waarde die niet meer als optie bestaat.
settings.cefrMin = Math.min(settings.cefrMin, MAX_VOCAB_CEFR_IDX);
settings.cefrMax = Math.min(settings.cefrMax, MAX_VOCAB_CEFR_IDX);
// Twee losse bereiken specifiek voor zin-generatie, standaard gelijk aan de woord-oefenslider tot de
// gebruiker ze zelf aanpast: complexiteit (zinsbouw/lengte/bijzinnen, stuurt cefrGuidance) en
// woordmoeilijkheid (welk vocabulaire in die zinnen gebruikt wordt) waren voorheen gedwongen gelijk
// aan elkaar en aan de woord-oefenslider -- nu onafhankelijk instelbaar.
if(settings.sentenceComplexityMin === undefined) settings.sentenceComplexityMin = settings.cefrMin;
if(settings.sentenceComplexityMax === undefined) settings.sentenceComplexityMax = settings.cefrMax;
// Sentence complexity heeft sinds v3.53 nog maar 1 slider -- een eventueel bestaand, uiteenlopend
// bereik van vóór die wijziging hier eenmalig samenvouwen tot 1 vaste waarde (het midden, afgerond).
if(settings.sentenceComplexityMin !== settings.sentenceComplexityMax){
  const mid = Math.round((settings.sentenceComplexityMin + settings.sentenceComplexityMax) / 2);
  settings.sentenceComplexityMin = mid;
  settings.sentenceComplexityMax = mid;
}

// Zinscomplexiteit (zinsbouw/lengte/bijzinnen, via cefrGuidance) gebruikt voortaan zijn EIGEN bereik
// i.p.v. de algemene woord-oefenslider -- zie de nieuwe instellingen-kaart "Sentence generation".

if(settings.questionPercent === undefined) settings.questionPercent = 0;
if(settings.adaptiveEnabled === undefined) settings.adaptiveEnabled = false;
// Of nieuwe (nog nooit getoonde) woorden meegemengd worden in de reguliere woord-pool op het
// hoofdscherm, en zo ja in welke verhouding (X per 5 woordoefeningen) -- zie pickNextItem. Zonder dit
// domineerden nieuwe woorden de praktijk altijd volledig (ze staan op niveau 0, dus gelden als
// "zwakst" en komen dus als eerste aan de beurt) totdat ze allemaal een keer gezien waren; met deze
// instelling kan de gebruiker dat temperen. Standaard aan, met een gematigde verhouding.
if(settings.mixNewWords === undefined) settings.mixNewWords = true;
if(settings.soundEffects === undefined) settings.soundEffects = true;
if(settings.specialMode === undefined) settings.specialMode = "suffixes";
if(settings.dictationLevel === undefined) settings.dictationLevel = 1;
if(settings.newWordsPer5 === undefined) settings.newWordsPer5 = 2;
// Welke woordenlijst de losse-woord-oefeningen op het hoofdscherm gebruikt: "en-tr" (alleen de en-tr-
// lijst), "tr-en" (alleen de onafhankelijk gecureerde tr-en-lijst), of "random" (elke beurt 50/50 geloot
// tussen de twee, elk met hun EIGEN score/SRS -- zie TR_WORDS_DATA/practiceWordEntries). Standaard
// "random", zodat bestaande gebruikers net als voorheen beide richtingen te zien blijven krijgen.
if(settings.wordDirection === undefined) settings.wordDirection = "random";
// Migratie: de vroegere "all"-optie (en-tr + tr-en in ÉÉN gemengde pool, gewogen op niveau) is
// vervangen door "random" (elke beurt geloot tussen de twee lijsten) -- die optie is niet meer
// selecteerbaar in de UI, dus bestaande instellingen worden hier eenmalig omgezet.
if(settings.wordDirection === "all") settings.wordDirection = "random";
if(settings.adaptiveThreshold === undefined) settings.adaptiveThreshold = 60;
if(settings.anthropicApiKey === undefined) settings.anthropicApiKey = "";
if(settings.proxyUrl === undefined) settings.proxyUrl = "";
if(settings.proxyToken === undefined) settings.proxyToken = "";
if(settings.wordModel === undefined) settings.wordModel = "deepseek";       // vertaling + woordbeoordeling
if(settings.sentenceModel === undefined) settings.sentenceModel = "claude"; // zin/vraag-generatie, -beoordeling, grammatica-oefeningen, taaltoets, "vraag aan AI"
if(settings.readingModel === undefined) settings.readingModel = "deepseek"; // leesoefening -- goedkoop als standaard, expliciet omschakelbaar op het scherm zelf (niet verstopt in Settings)
if(settings.readingLevel === undefined) settings.readingLevel = "B2";
if(settings.readingSource === undefined) settings.readingSource = "ai"; // "ai" | "wikipedia"
if(settings.sentencePercent === undefined){
  // migratie vanaf de oude "aantal van elke 5"-instelling
  settings.sentencePercent = Math.round(((settings.sentenceRatio || 1) / 5) * 100);
  saveJSON(LS_SETTINGS, settings);
}
// wordsPercent bestond nog niet in het oude (2-sliders-)model -- migreer zodat het drietal altijd op
// 100 sommeert: wat er na sentencePercent+questionPercent overblijft wordt woorden (nooit negatief).
if(settings.wordsPercent === undefined){
  settings.wordsPercent = Math.max(0, 100 - (settings.sentencePercent ?? 20) - (settings.questionPercent ?? 0));
  saveJSON(LS_SETTINGS, settings);
}
let history  = loadJSON(LS_HISTORY, []);
export let newWords = loadJSON(LS_NEWWORDS, {});
{
  // Eenmalige opschoning van eerder al foutief geregistreerde "woorden" (zie looksLikeEnglishWord
  // hieronder) -- deze functie zelf staat verderop gedefinieerd, maar dat is geen probleem: dit blok
  // wordt pas bij paginalading UITGEVOERD, ver nadat de hele file (incl. de functiedefinitie) geladen is.
  const badKeys = Object.keys(newWords).filter(en => !looksLikeEnglishWord(en));
  if(badKeys.length){
    for(const k of badKeys) delete newWords[k];
    saveJSON(LS_NEWWORDS, newWords);
  }
}
export let grammar = loadJSON(LS_GRAMMAR, {});
export let trCache = loadJSON(LS_TRCACHE, {});
export let readingTexts = loadJSON(LS_READING_TEXTS, []);
export let explanationCache = loadJSON(LS_EXPLANATION_CACHE, {});
export let curatedTr = loadJSON(LS_CURATED_TR, {}); // basislaag; wordt in loadAllData() aangevuld met EMBEDDED_CURATED_TR (heeft voorrang bij overlap) zodra die geladen is — ingebedde data is de volledige, verse curatie (alle 4932 woorden), de lokale/gesyncte laag was bedoeld voor de oude (inmiddels verwijderde) bulk-translate-knop en dient alleen nog als vangnet voor woorden die de ingebedde data zelf niet kent
let lessonProgress = loadJSON(LS_LESSONS, {});
/* Eenmalige reparatie van "gaten" in lesson-voortgang: door eerdere iteraties van de ontgrendellogica
   (deze cursus is meermaals herbouwd) kan het voorkomen dat een latere les als voltooid staat terwijl
   een eerdere dat niet is -- daardoor lijken lessen/skills "willekeurig" ontgrendeld i.p.v. netjes op
   volgorde. Als een latere les voltooid is, is dat afdoend bewijs dat de eerdere stof al doorlopen werd,
   dus die gaten mogen veilig gedicht worden. Idempotent: verandert niets zodra de data al aaneengesloten is. */
function repairLessonProgressGaps(){
  let changed = false;
  for(const track of ["grammar","vocab"]){
    const list = trackListOf(track);
    let lastCompletedIdx = -1;
    for(let i=0;i<list.length;i++){
      if(lessonProgress[list[i].id] && lessonProgress[list[i].id].completed) lastCompletedIdx = i;
    }
    for(let i=0;i<lastCompletedIdx;i++){
      const id = list[i].id;
      if(!lessonProgress[id] || !lessonProgress[id].completed){
        lessonProgress[id] = {completed:true, done:(lessonProgress[id]?.done||0)};
        changed = true;
      }
    }
  }
  if(changed) saveJSON(LS_LESSONS, lessonProgress);
}
let checkupState = null;  // state machine van de nieuwe adaptieve trapsgewijze kennischeck (of null)
let skillPracticeState = null; // { lesson, results:[] } — gerichte oefensessie op precies 1 les (of null)
let adaptiveWindow = loadJSON(LS_ADAPTIVE_WINDOW, []); // laatste N (correct/fout) van reguliere oefeningen
let wordMixCounter = loadJSON(LS_WORD_MIX_COUNTER, 0); // oplopende teller voor de nieuw/herhaling-verhouding, zie settings.mixNewWords
// Kleine in-memory buffer (niet persistent, reset bij herladen) met de laatst gegenereerde TR-zinnen/
// vragen -- meegegeven aan de AI als "vermijd dit" lijst, puur om te voorkomen dat opeenvolgende
// oefeningen sterk op elkaar lijken. Bewust klein (RECENT_SENTENCES_MAX) en niet opgeslagen: dit is
// alleen bedoeld om de eerstvolgende paar generaties uit elkaar te trekken, geen lange-termijn-log.



// Zelfde idee, maar dan voor de "veilige tegenpool"-woorden uit pickWellKnownWord() -- ook een kleine,
// niet-persistente pool kan bij pure random-keuze een paar keer na elkaar hetzelfde woord opleveren.
// Onthoudt de laatst GEKOZEN vulwoorden en sluit ze tijdelijk uit, mits de resterende pool nog bruikbaar is.
let recentWellKnownWords = [];
const RECENT_WELLKNOWN_MAX = 5;
function noteRecentWellKnownWord(en){
  if(!en) return;
  recentWellKnownWords.push(en);
  if(recentWellKnownWords.length > RECENT_WELLKNOWN_MAX) recentWellKnownWords.shift();
}
let costUsage = loadJSON(LS_COST, {byModel:{}});
let costPending = loadJSON(LS_COST_PENDING, {byModel:{}});

/* ===================== KOSTENTELLER (grove, lokale schatting) ===================== */
// Prijzen in USD per 1M tokens. Alleen een indicatie — DeepSeek kan tarieven wijzigen
// (zie o.a. de aangekondigde piek/dal-prijzen) en cache-gedrag is niet 100% te voorspellen.
const MODEL_PRICING = {
  "deepseek-v4-pro":   {hit:0.003625, miss:0.435, output:0.87},
  "deepseek-v4-flash": {hit:0.0028,   miss:0.14,  output:0.28},
  "claude-sonnet-5":   {hit:0.2,      miss:2.0,   output:10.0}, // introductieprijs t/m 31 aug 2026; wordt daarna 3/15
};

function mergeCostUsage(a, b){
  const result = {byModel:{}};
  for(const src of [a, b]){
    for(const [model, u] of Object.entries((src && src.byModel) || {})){
      const m = result.byModel[model] || (result.byModel[model] = {hit:0, miss:0, output:0});
      m.hit += u.hit || 0;
      m.miss += u.miss || 0;
      m.output += u.output || 0;
    }
  }
  return result;
}

// Per teller het MAXIMUM nemen i.p.v. optellen — gebruikt als basis vóór het toevoegen van costPending,
// zodat een lokaal totaal dat (nog) niet op de cloud stond nooit stilzwijgend kleiner gemaakt wordt.
function maxCostUsage(a, b){
  const result = {byModel:{}};
  const models = new Set([...Object.keys((a && a.byModel) || {}), ...Object.keys((b && b.byModel) || {})]);
  for(const model of models){
    const ua = (a && a.byModel && a.byModel[model]) || {hit:0, miss:0, output:0};
    const ub = (b && b.byModel && b.byModel[model]) || {hit:0, miss:0, output:0};
    result.byModel[model] = {
      hit: Math.max(ua.hit || 0, ub.hit || 0),
      miss: Math.max(ua.miss || 0, ub.miss || 0),
      output: Math.max(ua.output || 0, ub.output || 0),
    };
  }
  return result;
}

/* Generieke aanroep naar de Anthropic Messages API (Claude Sonnet 5), gebruikt voor alle
   kwaliteitsgevoelige taken (zin/vraag-generatie, beoordeling, grammatica-uitleg-oefeningen).
   Losse woordvertaling/-beoordeling blijft bewust op DeepSeek (zie askDeepSeekJudge/getOrFetchTranslation)
   — dat is hoogvolume en simpel genoeg dat het prijsverschil daar niet opweegt tegen de kwaliteitswinst. */
/* Generieke aanroep naar DeepSeek — analoog aan callClaude() hierboven, zodat beide providers
   via dezelfde soort interface (systeemprompt + gebruikersinhoud, evt. berichtenreeks) bruikbaar zijn. */


/* Dispatcher: kiest op basis van de instelling per taakcategorie ("word" = vertaling/woordbeoordeling,
   "sentence" = zin/vraag-generatie, -beoordeling, grammatica-oefeningen, taaltoets, "vraag aan AI")
   welke provider de aanroep daadwerkelijk uitvoert. De aanroepende functies hoeven zelf niets van dit
   onderscheid te weten — die roepen altijd gewoon callAI(categorie, ...) aan. */

export function proxyConfigured(){
  return !!(settings.proxyUrl && settings.proxyToken);
}

function keyNameFor(category){
  return preferredModelFor(category) === "claude" ? "Anthropic (Claude)" : "DeepSeek";
}
export function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
// Wordt aan ELKE systeemprompt toegevoegd, ongeacht welke aanroepplek callAI() gebruikt -- een
// centrale, niet-te-missen waarborg dat alle vrije/toelichtende tekst in het AI-antwoord (uitleg,
// feedback, hints, chatberichten, ...) in het Engels is, zelfs als een individuele prompt daar zelf
// niet expliciet om vraagt. Velden die BEDOELD Turks zijn (een vertaling, een woordenboekvorm, een
// gegenereerde Turkse zin) blijven hierdoor onaangetast -- die worden hieronder expliciet uitgezonderd.
export const ENGLISH_OUTPUT_GUARD = "\n\nLANGUAGE REQUIREMENT (always applies, regardless of what language this prompt above is written in): any free-text, explanatory, or feedback content you write in your response must be in English. This does NOT apply to fields that are explicitly meant to hold a Turkish word, phrase, sentence, or translation -- those stay in Turkish as instructed above.";
// Stap 6 van het verbeterplan ("AI-fouten fail-safe i.p.v. fail-closed"): een tijdelijke netwerk-/server-
// hik mag de gebruiker nooit score kosten. Twee automatische herkansingen met een korte pauze ertussen
// vangen het gros van zulke fluctuaties op, vóórdat de aanroeper het als een echte mislukking hoeft te
// behandelen. Een "geen API-key ingesteld"-fout is een configuratieprobleem, geen tijdelijke hik -- een
// retry lost dat nooit op, dus die meteen laten doorschieten voor een directe, duidelijke foutmelding.




export function recordUsage(model, usage){
  if(!usage) return; // sommige/oude responses geven geen usage-object terug
  const m = costPending.byModel[model] || (costPending.byModel[model] = {hit:0, miss:0, output:0});
  const hit = usage.prompt_cache_hit_tokens || 0;
  const miss = (usage.prompt_cache_miss_tokens != null)
    ? usage.prompt_cache_miss_tokens
    : Math.max(0, (usage.prompt_tokens || 0) - hit);
  m.hit += hit;
  m.miss += miss;
  m.output += usage.completion_tokens || 0;
  localStorage.setItem(LS_COST_PENDING, JSON.stringify(costPending));
  updateCostDisplay();
  syncMaybePush(); // plant ook een cloud-sync in, die costPending bij het cloud-totaal optelt (zie syncPushNow)
}

function estimateTotalCostUSD(usage){
  let total = 0;
  for(const [model, u] of Object.entries((usage && usage.byModel) || {})){
    const p = MODEL_PRICING[model] || MODEL_PRICING["deepseek-v4-pro"];
    total += (u.hit/1e6*p.hit) + (u.miss/1e6*p.miss) + (u.output/1e6*p.output);
  }
  return total;
}

function updateCostDisplay(){}

const LS_BALANCE = "turks_balance_v1"; // { total, granted, toppedUp, currency, fetchedAt } — laatst opgehaalde saldo (lokaal, niet gesynct)

async function fetchDeepSeekBalance(silent){
  if(!settings.apiKey){
    if(!silent) alert("Set your DeepSeek API key first.");
    return;
  }
  const statusEl = document.getElementById("balance-status");
  if(statusEl && !silent) statusEl.textContent = "🔄 Fetching balance…";
  try{
    const res = await fetchWithTimeout("https://api.deepseek.com/user/balance", {
      headers: {"Authorization": "Bearer " + settings.apiKey, "Accept": "application/json"}
    });
    if(!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    const info = data.balance_infos && data.balance_infos[0];
    if(!info) throw new Error("no balance information received");
    const balance = {
      total: info.total_balance, granted: info.granted_balance, toppedUp: info.topped_up_balance,
      currency: info.currency, fetchedAt: Date.now()
    };
    localStorage.setItem(LS_BALANCE, JSON.stringify(balance));
    if(statusEl) statusEl.textContent = `✅ Resterend saldo: ${balance.currency === "CNY" ? "¥" : "$"}${balance.total} (waarvan ${balance.currency === "CNY" ? "¥" : "$"}${balance.toppedUp} zelf opgeladen) · ververst elke minuut, laatst om ${new Date(balance.fetchedAt).toLocaleTimeString()}`;
    updateCostDisplay();
  }catch(e){
    if(statusEl) statusEl.textContent = "⚠️ Fetching balance failed: " + e.message;
  }
}


/* Grammatica-taxonomie (GRAMMAR_TOPICS) staat nu in het losse bestand grammar-topics.js, ingeladen
   via een <script>-tag vóór dit hoofdscript (zie net boven de <script>-tag van dit blok). */
// Sommige grammatica-onderwerpen bundelen meerdere, onderling duidelijk te onderscheiden vormen onder
// één label (bv. isaret_zamirleri = bu/şu/o, soru_kelimeleri = ne/kim/nerede/...). Die krijgen een eigen
// `variants`-array (zie hierboven); onderwerpen zonder `variants` gedragen zich exact als voorheen.
// Elke variant krijgt zijn EIGEN voortgangsteller (opgeslagen onder "<topicKey>::<variantId>"), zodat het
// systeem per vorm kan zien of die al voldoende geoefend is, i.p.v. één gedeelde teller voor het hele
// onderwerp die al na de makkelijkste/meest voorkomende vorm "vol" leek te zitten.
export function getTopicVariants(topic){
  return (topic.variants && topic.variants.length) ? topic.variants : [{id:null, hint:topic.hint}];
}
export function variantProgressKey(topic, variantId){
  return variantId ? `${topic.key}::${variantId}` : topic.key;
}
// Geeft het onderwerp met exact dezelfde vorm terug als voorheen ({key,label,hint,minCefr,...}), maar dan
// toegespitst op ÉÉN specifieke variant: `key` wordt de samengestelde variant-sleutel (voor opslag/lookup)
// en `hint` wordt de hint van die ene variant. Downstream code (promptopbouw, recordGrammarResult, opslag
// op het oefen-item) hoeft hierdoor niet te weten dat variants bestaan -- het ziet gewoon een gewoon
// topic-object, alleen preciezer.
export function effectiveTopicForVariant(topic, variant){
  return {...topic, key: variantProgressKey(topic, variant.id), hint: variant.hint || topic.hint};
}
// Kiest, binnen één onderwerp, de zwakst-beoefende variant (laagste niveau; bij gelijke stand willekeurig)
// -- dit is wat zorgt dat bv. şu en o ook echt aan de beurt komen zodra bu al vaker gebruikt is.
function pickWeakestVariant(topic){
  const variants = getTopicVariants(topic);
  if(variants.length === 1) return variants[0];
  const withLevel = variants.map(v => ({v, level: getGrammarProgress(variantProgressKey(topic, v.id)).level}));
  const minLevel = Math.min(...withLevel.map(x=>x.level));
  const pool = withLevel.filter(x=>x.level===minLevel).map(x=>x.v);
  return pool[Math.floor(Math.random()*pool.length)];
}
// Geaggregeerde voortgang van een heel onderwerp, over al zijn varianten heen -- gebruikt voor alles wat
// het onderwerp als GEHEEL beoordeelt (lesvoltooiing, statistiekschermen, CEFR-balkjes). `level` is het
// MINIMUM over alle varianten (dus de bottleneck: pas "voltooid" als ELKE vorm voldoende beheerst wordt,
// niet zodra de gemakkelijkste vorm vaak genoeg goed ging), `reps`/`correct` zijn de som, `due` is de
// vroegste due-datum (de eerstvolgende variant die aan herhaling toe is).



/* ===================== STRUCTURED COURSE (LESSONS) ===================== */
/* ===================== CEFR TAALNIVEAU (moet vóór GRAMMAR_LESSONS/LESSONS staan, want cefrLabel wordt
   daar al bij het laden van het script gebruikt om vocabulaire-lesteksten op te bouwen) ===================== */




// Eén expliciete richtlijn per van de 18 sub-niveaus (i.p.v. een grof major-niveau + generieke
// sub-notitie) -- nodig voor een echt geleidelijke opbouw, met name onderaan: A1-start moet HARD op
// 2 woorden blijven (znw+ww, niets anders), niet "2-3 woorden, meestal kaal" zoals de vorige versie
// toestond, want dat liet net genoeg ruimte voor de AI om af te wijken naar iets complexers.
export const CEFR_LEVEL_GUIDANCE = [
  // A1
  "EXACT 2 woorden: een kaal zelfstandig naamwoord + een werkwoord in de tegenwoordige tijd, niets anders. Bijvoorbeeld \"Kedi yürüyor.\" (de kat loopt), \"Adam koşuyor.\" (de man rent), \"Köpek içiyor.\" (de hond drinkt). GEEN lijdend voorwerp, GEEN bijvoeglijk naamwoord/bijwoord, GEEN naamval, GEEN bijzin, GEEN voegwoord. Vereist het opgegeven grammaticale onderwerp per se iets extra's (bv. een naamval): voeg dan precies dat ene woord toe en niets meer (dus 3 woorden max, alleen dan).",
  "3 woorden: zelfstandig naamwoord + werkwoord, met precies ÉÉN toevoeging — óf een kort lijdend voorwerp, óf één simpel bijvoeglijk naamwoord, óf één eenvoudige plaatsbepaling (bv. \"evde\"). Bijvoorbeeld \"Kedi süt içiyor.\" (de kat drinkt melk), \"Büyük köpek koşuyor.\" (de grote hond rent). Uitsluitend tegenwoordige tijd, geen bijzin, geen voegwoord.",
  "3-4 woorden: zelfstandig naamwoord + werkwoord + maximaal twee eenvoudige toevoegingen (object, bijvoeglijk naamwoord, of plaats-/tijdsbepaling). Nog steeds uitsluitend tegenwoordige tijd, geen bijzin. Bijvoorbeeld \"Kedi mutfakta süt içiyor.\" (de kat drinkt melk in de keuken).",
  // A2
  "4-5 woorden. Verleden of toekomende tijd mag nu naast de tegenwoordige tijd voorkomen (niet gemengd binnen één zin). Eén object/bijvoeglijk naamwoord/bepaling is prima, nog geen bijzin of voegwoord.",
  "5-6 woorden. Verleden/toekomende tijd, en nu mag er precies één basaal voegwoord bij (ve, ama) om twee korte, simpele ideeën te verbinden.",
  "6-7 woorden. Zoals hierboven, plus çünkü (omdat) is nu ook toegestaan. Dit is de bovenkant van A2 — net onder de eerste echte bijzin.",
  // B1
  "7-9 woorden, met precies één eenvoudige bijzin (bv. een çünkü-, ki-, of dat-achtige constructie). Gevarieerde werkwoordstijden mogen gemengd worden binnen de zin (bv. hoofdzin verleden tijd + bijzin tegenwoordige tijd).",
  "9-11 woorden, met één bijzin, iets gangbare maar minder hoogfrequente woordenschat toegestaan.",
  "10-12 woorden. Bovenkant van B1: de bijzin mag iets uitgebreider, en een tweede, korte gekoppelde gedachte mag er losjes bij (nog geen twee volwaardige bijzinnen).",
  // B2
  "10-13 woorden met twee gekoppelde ideeën/bijzinnen. Minder frequente, iets abstractere woordenschat toegestaan.",
  "12-14 woorden, twee bijzinnen, af en toe een idiomatische uitdrukking.",
  "13-15 woorden. Bovenkant van B2: complexere zinsbouw, meerdere gekoppelde ideeën, natuurlijke idiomatiek.",
  // C1
  "13-16 woorden met meerdere bijzinnen, genuanceerde en minder frequente woordenschat.",
  "15-18 woorden, gevarieerde geavanceerde grammaticale constructies, idiomatiek.",
  "17-20 woorden. Bovenkant van C1: complexe, vloeiende zinsbouw met meerdere ineengevlochten bijzinnen.",
  // C2
  "Zeldzame, literaire of zeer genuanceerde woordkeuze; lengte volgt puur uit wat natuurlijk is (geen kunstmatige ondergrens), doorgaans een complexe zin met meerdere bijzinnen.",
  "Zoals hierboven, met spreekwoorden/idiomatische uitdrukkingen waar natuurlijk.",
  "Vrijwel moedertaalniveau: volledig natuurlijke, vloeiende zinsbouw en woordkeuze, geen enkele kunstmatige beperking meer.",
];
export const CEFR_SUB_NOTE = {
  start: "Blijf aan de eenvoudige kant van dit niveau.",
  mid: "Dit is het kernniveau, gemiddeld voor dit niveau.",
  end: "Ga richting de bovenkant van dit niveau, net onder het volgende niveau."
};


let GRAMMAR_LESSONS; // gevuld door loadAllData()

/* Bouwt de volledige cursus: de 238 auto-gegenereerde vocabulaire-lessen (28-woordbatches per
   niveau+woordsoort) geïnterleaved met de 11 grammaticale oefenlessen (de eerste 2, pure leesstof,
   blijven vooraan staan). Zo wissel je doorlopend korte vocabulaire-blokjes af met grammatica-checkpoints. */
/* Uitleg per woordsoort-categorie, hergebruikt over alle vocabulaire-lessen van diezelfde categorie
   (238 losse lessen, maar slechts een handvol echt verschillende categorieën qua grammatica). De
   categorie "Prepositions" krijgt een grondige, lettergreep-voor-lettergreep behandeling inclusief
   klinkerharmonie en bufferletters, omdat dat verreweg de grammaticaal rijkste categorie is; de rest
   krijgt een korter maar inhoudelijk gefundeerd kader. */
const VOCAB_CATEGORY_EXPLANATIONS = {
  "Prepositions": `<p><b>Before this list:</b> Turkish "prepositions" come in two very different flavours — worth understanding before you dive in.</p>
<p><b>1. True postpositions</b> — separate words placed AFTER the noun, with little extra marking: <b>ile</b> (with), <b>gibi</b> (like), <b>kadar</b> (until/as much as), <b>için</b> (for), <b>göre</b> (according to). Essentially a mirror image of English prepositions.</p>
<p><b>2. "Relational noun" prepositions</b> — words like <b>üstünde</b> (on top of), <b>altında</b> (under), <b>önünde</b> (in front of), <b>arkasında</b> (behind) are NOT simple words at all. They're built from an ordinary Turkish noun (üst="top", alt="bottom", ön="front", arka="back") plus a chain of <b>three</b> grammatical suffixes. Let's take one apart completely.</p>
<p><b>Worked example: "on the table" → <i>masanın üstünde</i></b></p>
<p style="line-height:2;"><code>masa</code> + <code>nın</code> + <code>üst</code> + <code>ü</code> + <code>nde</code></p>
<ul>
<li><b>masa</b> — "table" (the noun itself).</li>
<li><b>+nın</b> — the GENITIVE suffix ("of the table"). It's needed because "üstü" further down literally means "its top" — and "its" needs an owner (compare English "the table's top"). <i>Vowel harmony:</i> masa's last vowel is <b>a</b> (back, unrounded) → suffix must match: <b>-ın</b> → <b>-nın</b>. <i>Buffer letter:</i> masa ends in a vowel and the suffix starts with one (ın) — two vowels can't sit together in Turkish, so a buffer <b>-n-</b> is inserted: masa+<b>n</b>+ın = <b>masanın</b>.</li>
<li><b>üst</b> — "top/upper part": an ordinary noun. Turkish reuses spatial nouns like this for what English does with prepositions.</li>
<li><b>+ü</b> — 3rd-person POSSESSIVE ("its"): üst→üstü = "its top". <i>Vowel harmony:</i> üst's vowel is <b>ü</b> (front, rounded) → suffix <b>-ü</b>.</li>
<li><b>+nde</b> — LOCATIVE case ("at/in/on"): üstü→üstünde = "at its top". <i>Vowel harmony:</i> üstü ends in <b>ü</b> → suffix <b>-nde</b>. <i>No buffer needed</i> here — üstü ends in a vowel, but the locative suffix starts with a CONSONANT (d); buffer letters only bridge vowel-vowel, never vowel-consonant.</li>
</ul>
<p>Together: <b>masanın üstünde</b> = literally "at the table's top" = "on the table".</p>
<p><b>Second example, different vowel set: "under the book" → <i>kitabın altında</i></b></p>
<ul>
<li><b>kitap</b> ("book") + genitive. <i>Vowel harmony:</i> back vowel <b>a</b> → suffix -ın. <i>Extra twist:</i> Turkish softens a word-final <b>p</b> to <b>b</b> before a vowel-starting suffix: <b>kitabın</b>, not "kitapın" (the same pattern shows up as ç→c, t→d, k→ğ on other words — common, not a one-off).</li>
<li><b>alt</b> ("underside") + possessive. <i>Vowel harmony:</i> back vowel <b>a</b> → suffix -ı → <b>altı</b> ("its underside").</li>
<li>+ locative: altı ends in <b>ı</b> (back, unrounded) → suffix -nda → <b>altında</b>. No buffer needed (vowel+consonant again).</li>
</ul>
<p>Together: <b>kitabın altında</b> = "at the book's underside" = "under the book".</p>
<p>Notice the two examples used entirely different suffix vowels (-nın/-ü/-nde vs. -ın/-ı/-nda) for the exact same grammatical job — vowel harmony doing its work automatically, driven purely by the vowel already present. As you meet more relational-noun prepositions below, try building them the same way yourself: [noun]+genitive, +[relational noun]+possessive, +locative.</p>`,

  "Nouns": `<p>Turkish nouns have no grammatical gender and no words for "a/an/the" — context tells you which is meant. Below, every noun is in its bare dictionary form: no suffixes attached yet. Once you reach the relevant grammar lessons, you'll start adding suffixes onto these same nouns for plural (-ler/-lar), possession ("my/your..."), and case (to/from/at/etc.) — for now, just build the bare word↔meaning link solidly, since everything later attaches onto this base.</p>`,

  "Verbs": `<p>Every Turkish verb's dictionary/citation form ends in <b>-mek</b> or <b>-mak</b> — vowel harmony decides which: a stem with front vowels (e,i,ö,ü) takes <b>-mek</b> (e.g. <b>gitmek</b>, to go — "git" has the front vowel i), a stem with back vowels (a,ı,o,u) takes <b>-mak</b> (e.g. <b>bakmak</b>, to look — "bak" has the back vowel a). This citation form isn't really how you'd say things in conversation (similar to how "to go" isn't how you'd naturally answer "where are you going?") — it's the form you'll always find a verb listed under, and the form these lessons show you. The grammar lessons scattered through the course teach you how to strip off -mek/-mak and attach the real tense/person endings (geliyorum, geldim, gelecek...) — this lesson is purely about locking in the base meaning first.</p>`,

  "Adjectives": `<p>Turkish adjectives are refreshingly simple: they go directly <b>before</b> the noun they describe, exactly like English, and — unlike many European languages — they <b>never change form</b>. No agreement for gender or number: <b>büyük ev</b> (big house) and <b>büyük evler</b> (big houses) both use the exact same "büyük". Any adjective can also stand alone as a description of something else, using the copula suffix from the grammar lessons: "Ev büyük." = "The house is big."</p>`,

  "Adverbs": `<p>Adverbs modify a verb, adjective, or other adverb, and typically sit directly before the word they modify — most often right before the verb, near the end of the sentence (remember Turkish is Subject-Object-Verb). A handful of adverbs below are historically built from other words using their own suffix patterns, but for this lesson just learn each one as a standalone vocabulary item; you'll naturally absorb the position rules through the example sentences you'll practise with.</p>`,

  "Pronouns": `<p>This lesson covers pronouns in their base form. Remember from the very first course lesson: because Turkish verb endings already show who's doing the action, personal pronouns (ben, sen, o...) are very often dropped entirely in real speech — they're mainly used for emphasis. Some pronouns you'll meet elsewhere in the course take case suffixes just like regular nouns do (e.g. ben → bana "to me", ben → beni "me" as an object) — here, focus on locking in the plain base forms first.</p>`,

  "Determiners": `<p>Determiners (words like "this/that/some/every") work grammatically just like adjectives in Turkish: they're placed directly before the noun they specify, and never change form regardless of number or the noun's case.</p>`,

  "Conjunctions": `<p>Linking words such as "and/but/because" mostly sit exactly where you'd expect from English, joining two words or clauses. A few — especially the borrowed word <b>ki</b> ("that/so that") and paired forms like <b>hem...hem</b> ("both...and") — behave a bit differently and get their own dedicated grammar lesson later in the course; here, just learn the plain vocabulary meanings.</p>`,

  "Numbers": `<p>Cardinal numbers in their base form. One quirk worth knowing early: after a number, Turkish nouns stay <b>singular</b> — <b>üç kitap</b> ("three book", not "three books") — the plural suffix is only used when quantity isn't already specified by a number. Ordinals (first, second, third...) are covered in their own grammar lesson later on.</p>`,

  "Modal verbs": `<p>A small set of helper words that combine with a main verb to add meaning like ability, necessity, or probability. Most of these (like "can" via -ebilmek, or "must" via -meli) are properly explained, suffix by suffix, in their own dedicated grammar lessons elsewhere in the course — this vocabulary lesson simply introduces the base words themselves.</p>`,

  "Auxiliary verbs": `<p>Helper verbs that combine with other words to build compound meanings (e.g. forms of "to be" or "to become" used alongside a main verb or noun). You've already met the most important one — the copula — as a suffix rather than a separate word; here you're learning a few more of these supporting verbs as standalone vocabulary.</p>`,

  "Exclamations": `<p>Interjections and fixed expressions used on their own — things like "hey!", "wow!", "ouch!". These don't follow regular grammar rules; they're essentially fixed vocabulary items to memorise as whole units, exactly as you would in English.</p>`,
};
function vocabCategoryExplanation(title){
  const category = title.split(" — ")[0];
  return VOCAB_CATEGORY_EXPLANATIONS[category] || "";
}

function buildFullLessonList(){
  const introLessons = GRAMMAR_LESSONS.slice(0, 2);   // welcome, pronouns — puur leesstof, altijd eerst
  const restGrammar = GRAMMAR_LESSONS.slice(2);        // de oefenlessen
  const grammarAll = [...introLessons, ...restGrammar];

  const vocabLessons = VOCAB_LESSON_DATA.map((v, i) => ({
    id: `vocab_${i}`,
    title: v.title,
    icon: "📚",
    cefr: v.cefr,
    grammarTopics: [],
    words: v.words,
    targetExercises: v.words.length,
    explanation: vocabCategoryExplanation(v.title) +
`<p>This lesson introduces ${v.words.length} words at level <b>${cefrLabel(v.cefr)}</b>:</p>
<table class="vocab-word-list"><tbody>${v.words.map(w=>`<tr><td><code>${baseEnOf(w)}</code></td><td>…</td></tr>`).join("")}</tbody></table>
<p>You'll be asked to translate each one — sometimes English→Turkish, sometimes Turkish→English — so start the practice session below whenever you're ready.</p>`
  }));

  // Elke les krijgt een eigen spoor ("grammar" of "vocab") + positie BINNEN dat spoor -- de twee sporen
  // ontgrendelen voortaan onafhankelijk van elkaar, ieder op zijn eigen tempo (zie isLessonUnlocked/
  // currentTrackIndex hieronder). De volgorde in de teruggegeven, gecombineerde lijst is verder alleen
  // nog relevant voor id-opzoeking, niet voor ontgrendeling.
  grammarAll.forEach((l,i)=>{ l.track = "grammar"; l.trackIndex = i; });
  vocabLessons.forEach((l,i)=>{ l.track = "vocab"; l.trackIndex = i; });

  const result = [...grammarAll];
  const interval = Math.max(1, Math.floor(vocabLessons.length / (restGrammar.length + 1)));
  let vi = 0;
  for(let i=0;i<vocabLessons.length;i++) result.push(vocabLessons[i]);
  return result;
}
let LESSONS = [], GRAMMAR_TRACK = [], VOCAB_TRACK = [];

/* Haalt alle 5 externe databestanden parallel op (i.p.v. de vroegere synchrone XHR-laadmethode die
   de pagina blokkeerde) en initialiseert vervolgens alles wat van die data afhangt: de curatedTr-merge,
   de opgebouwde lessenlijst (LESSONS/GRAMMAR_TRACK/VOCAB_TRACK) en de reparatie van eventuele gaten
   daarin. Wordt vóór de rest van de app-initialisatie aangeroepen door de DOMContentLoaded-handler
   onderaan dit bestand, terwijl #loading-overlay zichtbaar is. */
async function loadAllData(){
  const [enWords, vocabLessons, embeddedCuratedTr, reverseTrIndex, grammarLessons] = await Promise.all([
    loadJSONAsync("words.json"),           // Oxford 3000/5000, {en, cefr} per item
    loadJSONAsync("vocab-lessons.json"),   // {title, cefr, words:[...]} per vocabulary lesson, 28-word batches grouped by level+POS
    loadJSONAsync("vocab-data.json"),      // { [en]: {senses:[{gloss,pos,tr,register,note}]} } — gecureerd op basis van de Oxford 5000 en-tr-lijst
    loadJSONAsync("reverse-tr-index.json"),// { [en]: [{tr, gloss, pos, register, note}] } — reverse-lookup vanaf de APART gecureerde tr-en-lijst
    loadJSONAsync("lessons.json"),
  ]);
  EN_WORDS_DATA = enWords;
  VOCAB_LESSON_DATA = vocabLessons;
  EMBEDDED_CURATED_TR = embeddedCuratedTr;
  REVERSE_TR_INDEX = reverseTrIndex;
  GRAMMAR_LESSONS = grammarLessons;

  curatedTr = {...curatedTr, ...EMBEDDED_CURATED_TR};
  TR_WORDS_DATA = buildTrWordsData();
  seedTrProgressFromEnCounterpart();

  LESSONS = buildFullLessonList();
  GRAMMAR_TRACK = LESSONS.filter(l => l.track === "grammar");
  VOCAB_TRACK = LESSONS.filter(l => l.track === "vocab");
  repairLessonProgressGaps();
}

// Vindt de EN_WORDS_DATA-tegenhanger van een tr-en-entry: normaal gewoon een exacte match op het
// trefwoord, maar bij een op woordsoort GESPLITST Engels woord (bv. "close__v"/"close__a") moet de
// entry met de juiste pos gekozen worden -- baseEnOf() strip zo'n "__pos"-suffix weer terug tot het
// kale woord, dus vergelijk daarop i.p.v. op het rauwe "en"-veld.
function findEnCounterpartKey(trEntry){
  const candidates = EN_WORDS_DATA.filter(w => baseEnOf(w.en) === trEntry.en);
  if(!candidates.length) return null;
  if(candidates.length === 1) return candidates[0].en;
  const posMatch = candidates.find(w => w.pos === trEntry.pos);
  return (posMatch || candidates[0]).en;
}

// EENMALIGE migratie (v3.01): geeft elk nog-nooit-geoefend tr-en-woord als startpositie de score van
// zijn en-tr-tegenhanger mee, i.p.v. gewoon bij niveau 0 te beginnen -- een woord dat je in het en-tr-
// spoor al goed kent, hoeft niet vanaf nul herleerd te worden zodra het (met v2.99) ook een eigen tr-en-
// score krijgt. Raakt UITSLUITEND tr-en-woorden aan die zelf nog reps=0 hebben (al zelf geoefende tr-en-
// woorden blijven onaangeroerd), en alleen als de en-tr-tegenhanger zelf al minstens 1x geoefend is.
// Draait maar één keer per apparaat/Gist (zie LS_TR_SEED_DONE) -- dit is een startpositie, geen
// doorlopende regel die bij elke herlaad opnieuw scores zou overschrijven.
const LS_TR_SEED_DONE = "turks_tr_seed_from_en_v1";
function seedTrProgressFromEnCounterpart(){
  if(localStorage.getItem(LS_TR_SEED_DONE)) return;
  let seeded = 0;
  for(const w of TR_WORDS_DATA){
    const trP = getProgress(w.key);
    if(trP.reps > 0) continue; // al zelf geoefend in tr-en -> niet overschrijven
    const enKey = findEnCounterpartKey(w);
    if(!enKey) continue;
    const enP = progress[enKey];
    if(!enP || !enP.reps) continue; // en-tr-tegenhanger zelf nog nooit geoefend -> niets om over te nemen
    trP.level = enP.level;
    trP.ease = typeof enP.ease === "number" ? enP.ease : EASE_START;
    trP.reps = 1; // niet 0: anders behandelt recordResult de eerstvolgende beurt als "eerste keer" en overschrijft dit meteen weer
    trP.correct = 1;
    trP.intervalMin = intervalMinutes(trP.level);
    trP.due = Date.now() + trP.intervalMin * 60 * 1000;
    seeded++;
  }
  if(seeded) saveJSON(LS_PROGRESS, progress);
  localStorage.setItem(LS_TR_SEED_DONE, "1");
}

/* ===================== TR-EN WOORDENLIJST (eigen, onafhankelijke SRS-pool) =====================
   REVERSE_TR_INDEX is { [en]: [{tr, gloss, pos, register, note, cefr}] } -- gereverst vanuit de APART
   gecureerde tr-en-brondata. Voor een eigen tr-en-woordenlijst (met een EIGEN score per Turks woord,
   los van de en-tr-kaart) flatten we dit terug tot rijen, gegroepeerd op (tr + woordsoort): dezelfde
   Turkse term kan onder meerdere Engelse trefwoorden voorkomen (bv. "geçmek" onder zowel "pass" als
   "cross") -- dat zijn geen twee losstaande Turkse termen maar twee acceptabele Engelse vertalingen
   van ÉÉN term, dus die groeperen we tot ÉÉN entry (primair trefwoord = de eerst-gevonden gloss; de
   bestaande antwoord-validatie in checkStaticMatch/askDeepSeekJudge accepteert de andere gloss toch al
   automatisch via REVERSE_TR_INDEX, dus hoeft niet apart opgeslagen te worden). Een AFWIJKENDE
   woordsoort bij hetzelfde Turkse woord blijft wel een eigen, zelfstandige entry (net als bij de en-tr-
   lijst: "close" als werkwoord vs. bijvoeglijk naamwoord blijven ook losstaande termen). */
let TR_WORDS_DATA = [];
function buildTrWordsData(){
  const groups = new Map(); // key "tr::pos" -> entry
  for(const en in REVERSE_TR_INDEX){
    const senses = REVERSE_TR_INDEX[en] || [];
    senses.forEach(s => {
      if(!s || !s.tr) return;
      const pos = s.pos || "";
      const groupKey = s.tr + "::" + pos;
      let entry = groups.get(groupKey);
      if(!entry){
        const key = "trword:" + groupKey;
        // Handmatige correctie (zie openEditWordModal) heeft ALTIJD voorrang boven de gecureerde data,
        // net als bij en-tr -- beide gebruiken sinds stap 5 dezelfde gedeelde overrides-opslag. Alleen
        // tr/en zijn corrigeerbaar; pos/cefr/register/note blijven de gecureerde waarden -- die
        // veranderen niet mee als je alleen de spelling/vertaling aanpast.
        const ov = overrides[key];
        entry = {
          key,
          tr: ov?.tr || s.tr,
          en: ov?.en || en,
          pos: s.pos || null,
          cefr: typeof s.cefr === "number" ? s.cefr : 9,
          register: s.register || "neutral",
          gloss: s.gloss || null,
          note: s.note || null,
        };
        groups.set(groupKey, entry);
      }
    });
  }
  return [...groups.values()];
}
function trWordDataOf(key){
  return TR_WORDS_DATA.find(w => w.key === key) || null;
}
// Vindt de TR_WORDS_DATA-progress-sleutel die hoort bij een tr-en-oefening op Engels woord `en` --
// hergebruikt EXACT dezelfde pos/transitivity-matchlogica als pickWordSense(en,"tr-en") (zie hierboven),
// zodat de sleutel altijd overeenkomt met de daadwerkelijk getoonde Turkse vorm. Nodig omdat checkup/
// skill-practice de tr-en-richting nog via de oude REVERSE_TR_INDEX-flip op het Engelse woord kiezen
// (i.p.v. rechtstreeks uit TR_WORDS_DATA zoals het hoofdscherm) -- dit koppelt dat resultaat alsnog aan
// de juiste EIGEN tr-en-score, i.p.v. aan de gedeelde en-tr-score van hetzelfde Engelse woord.
function trWordsDataKeyFor(en){
  const trEnOptions = REVERSE_TR_INDEX[baseEnOf(en)];
  if(!trEnOptions || !trEnOptions.length) return null;
  const wantedPos = wordPosOf(en);
  const wantedTransitivity = wordTransitivityOf(en);
  let chosen;
  if(wantedPos){
    const candidates = trEnOptions.filter(o => o.pos === wantedPos);
    chosen = (wantedTransitivity && candidates.length > 1) ? candidates.find(o => o.transitivity === wantedTransitivity) : candidates[0];
  } else {
    chosen = trEnOptions[0];
  }
  if(!chosen) return null;
  return "trword:" + chosen.tr + "::" + (chosen.pos || "");
}
// Toont het Engelse trefwoord van een tr-en-entry, met "to " ervoor als het een werkwoord is -- gebruikt
// het EIGEN, al bekende pos-veld van de tr-en-entry zelf i.p.v. te gokken via de (mogelijk afwijkende)
// en-tr-woordsoort van hetzelfde Engelse trefwoord.
export function displayTrEntryGloss(entry){
  if(!entry) return "";
  return entry.pos === "verb" ? `to ${entry.en}` : entry.en;
}

function trackListOf(track){ return track === "grammar" ? GRAMMAR_TRACK : VOCAB_TRACK; }
// Vindt de eerste nog-niet-voltooide les BINNEN een spoor (-1 als het hele spoor klaar is)
function nextIncompleteInTrack(track){
  const list = trackListOf(track);
  for(let i=0;i<list.length;i++){ if(!isLessonCompleted(list[i].id)) return i; }
  return -1;
}
// De "huidige" positie binnen een spoor -- als alles voltooid is, geldt het hele spoor als ontgrendeld
function currentTrackIndex(track){
  const idx = nextIncompleteInTrack(track);
  const list = trackListOf(track);
  return idx === -1 ? Math.max(0, list.length - 1) : idx;
}
function currentGrammarLesson(){ return GRAMMAR_TRACK[currentTrackIndex("grammar")]; }
function currentVocabLesson(){ return VOCAB_TRACK[currentTrackIndex("vocab")]; }

function isLessonUnlocked(idx){
  return !!LESSONS[idx]; // niets is meer vergrendeld -- elke bestaande les is direct toegankelijk;
  // voortgang wordt zichtbaar gemaakt via een 0-10-cijfer (zie renderCourseLessonRow), niet via een slot
}
function isLessonCompleted(id){
  return !!(lessonProgress[id] && lessonProgress[id].completed);
}
function markLessonComplete(id){
  lessonProgress[id] = {completed:true, done: (lessonProgress[id]?.done||0)};
  saveJSON(LS_LESSONS, lessonProgress);
}
/* Grammatica-onderwerp kiezen binnen een actieve les (of het normale gedrag als er geen les actief is) */
export function pickLessonGrammarTopic(){
  const cefrCeiling = Math.max(settings.sentenceComplexityMin, settings.sentenceComplexityMax); // grammatica-zwaarte hoort bij zin-complexiteit, niet bij woordmoeilijkheid
  const cur = currentGrammarLesson();
  // voorkeur: het grammaticale onderwerp van de HUIDIGE les (in het grammatica-spoor), zolang dat nog
  // niet volledig beheerst is -- EN zolang het niet zwaarder is dan het ingestelde CEFR-plafond. Zonder
  // die laatste check kon een ver-gevorderd grammatica-onderwerp (bv. madan_once, B1) geforceerd in een
  // zin verschijnen terwijl de moeilijkheidssliders op A1 stonden, gewoon omdat de lessenvoortgang daar
  // toevallig staat -- de twee systemen (lesvoortgang vs. CEFR-slider) hielden geen rekening met elkaar.
  if(cur && cur.grammarTopics && cur.grammarTopics.length){
    const topic = grammarTopicByKey(cur.grammarTopics[0]);
    // getTopicProgress().level is de bottleneck over alle varianten -- dus dit onderwerp blijft actief
    // zolang ook maar ÉÉN vorm (bv. şu) nog niet voldoende beheerst wordt, niet alleen de makkelijkste.
    if(topic && topic.minCefr <= cefrCeiling && getTopicProgress(topic).level < 10){
      return effectiveTopicForVariant(topic, pickWeakestVariant(topic));
    }
  }
  // anders: herhaling — zwakste onderwerp binnen alles wat al ontgrendeld is, EN binnen het CEFR-plafond
  const unlockedKeys = [...unlockedGrammarTopicSet()];
  const candidateKeys = unlockedKeys.length ? unlockedKeys : GRAMMAR_TOPICS.map(t=>t.key);
  let topics = candidateKeys.map(grammarTopicByKey).filter(t => t.minCefr <= cefrCeiling);
  if(!topics.length) topics = candidateKeys.map(grammarTopicByKey); // veiligheidsnet: nooit een lege pool
  const minLevel = Math.min(...topics.map(t=>getTopicProgress(t).level));
  const pool = topics.filter(t=>getTopicProgress(t).level === minLevel);
  const topic = pool[Math.floor(Math.random()*pool.length)];
  return effectiveTopicForVariant(topic, pickWeakestVariant(topic));
}

/* ===================== KENNISCHECK (adaptieve trapsgewijze toets) ===================== */
// Twee gescheiden onderdelen: vocabulaire (begint laag, per niveau een BATCH vragen — niet 1 losse
// vraag — zodat een conclusie als "B2" ook echt voldoende onderbouwd is) en grammatica (geïsoleerde
// oefeningen met gegarandeerd bekende basiswoorden, zodat een onbekend woord nooit de reden is dat
// een grammatica-vraag fout gaat).
const CHECKUP_QUESTIONS_PER_VOCAB_LEVEL = 5;   // per CEFR-subniveau minstens dit aantal vragen vóór een oordeel
const CHECKUP_QUESTIONS_PER_GRAMMAR_TOPIC = 3; // idem per grammatica-onderwerp
const CHECKUP_LEVEL_PASS_THRESHOLD = 60;       // % nodig binnen zo'n batch om door te gaan naar het volgende niveau
const CHECKUP_DRILL_BASE_WORDS = "ev (house), kitap (book), su (water), ekmek (bread), okul (school), gün (day), adam (man), kadın (woman), çocuk (child), gitmek (to go), gelmek (to come), görmek (to see), yemek (to eat), içmek (to drink)";

function sortedGrammarTopicsByLevel(){
  return [...GRAMMAR_TOPICS].sort((a,b)=>a.minCefr-b.minCefr);
}

function persistCheckupState(){
  if(checkupState) localStorage.setItem(LS_ACTIVE_CHECKUP, JSON.stringify(checkupState));
  else localStorage.removeItem(LS_ACTIVE_CHECKUP);
}
function restoreActiveSessions(){
  localStorage.removeItem(LS_ACTIVE_LESSON); // legacy sleutel, niet meer gebruikt sinds lessen automatisch voortgaan
  try{
    const raw = localStorage.getItem(LS_ACTIVE_CHECKUP);
    if(raw){
      checkupState = JSON.parse(raw);
      el("modal-checkup").classList.remove("hidden");
      showCheckupResumeNotice();
    }
  }catch(e){ checkupState = null; }
}
function showCheckupResumeNotice(){
  el("checkup-question-box").classList.add("hidden");
  el("checkup-result-box").classList.remove("hidden");
  el("checkup-result-text").className = "feedback correct";
  el("checkup-result-text").innerHTML = "Resuming your knowledge check where you left off.";
  el("btn-checkup-close").textContent = "Continue";
}

async function startCheckup(){
  if(!hasKeyFor("word") || !hasKeyFor("sentence")){ alert("Both a " + keyNameFor("word") + " and a " + keyNameFor("sentence") + " API key are needed for the knowledge check (Settings)."); return; }
  recentGrammarDrillWords = new Set(); // nieuwe sessie -> geen woorden van een vorige sessie meer vermijden
  recentCheckupVocabWords = new Set(); // idem voor het vocabulaire-deel
  checkupState = {
    phase: "vocab",
    vocabLevel: 0, vocabLevelResults: [], vocabCeiling: -1,
    grammarTopicIdx: 0, grammarTopicResults: [], grammarCeiling: -1,
    current: null, consecutiveFailures: 0,
  };
  persistCheckupState();
  el("modal-checkup").classList.remove("hidden");
  await nextCheckupQuestion();
}

/* Geïsoleerde grammatica-oefening: puur de transformatie, met een gegarandeerd bekend basiswoord,
   zodat een verkeerd antwoord nooit te wijten kan zijn aan een toevallig onbekend woord. */
/* Verzamelt Turkse basiswoorden voor de geïsoleerde grammatica-oefening: bij voorkeur woorden die de
   student zelf al goed beheerst (A1-begin, hoge nauwkeurigheid) — dat voorkomt twee problemen:
   1) met een vaste, kleine voorbeeldwoordenlijst (zoals voorheen) leert een testkandidaat het patroon
      simpelweg door herhaling binnen de toets zelf, zonder echte grammaticale kennis nodig te hebben;
   2) een woord waarvan de student de betekenis niet kent, zou de vraag alsnog onbedoeld laten testen
      op woordenschat i.p.v. puur grammatica.
   Heeft de student nog niets geoefend, dan valt dit terug op de ruwe A1-begin-Oxford-pool. */
// Categorieën die NIET geschikt zijn als basiswoord voor een grammatica-oefening: dit zijn functiewoorden
// die vaak al zelf een naamval-achtige constructie zijn (bv. "under" -> "altında", zelf al vervoegd) of
// grammaticaal niet vrij verder te vervoegen zijn (voegwoorden, voornaamwoorden, telwoorden, tussenwerpsels).
// Zonder dit filter kon de AI zo'n al-complex woord als basis krijgen en in de war raken bij het nóg een
// keer vervoegen, met kale/onbegrijpelijke uitkomsten als gevolg — exact het gerapporteerde probleem.
const GRAMMAR_DRILL_EXCLUDED_CATEGORIES = new Set(["Prepositions","Conjunctions","Determiners","Pronouns","Exclamations","Numbers"]);
let _grammarDrillFunctionWords = null;
function grammarDrillFunctionWordSet(){
  if(_grammarDrillFunctionWords) return _grammarDrillFunctionWords;
  _grammarDrillFunctionWords = new Set();
  for(const v of VOCAB_LESSON_DATA){
    const cat = v.title.split(" — ")[0];
    if(GRAMMAR_DRILL_EXCLUDED_CATEGORIES.has(cat)) for(const w of v.words) _grammarDrillFunctionWords.add(w);
  }
  return _grammarDrillFunctionWords;
}

// Woordsoort van elk woord (zelfst. nw, ww, bijv. nw, enz.) — afgeleid uit dezelfde categorie-indeling
// die ook de vocabulaire-lessen groepeert, dus geen aparte data nodig.
const WORD_CATEGORY_ABBR = {
  "noun": "n.", "verb": "v.", "adjective": "adj.", "adverb": "adv.",
  "pronoun": "pron.", "determiner": "det.", "preposition": "prep.",
  "conjunction": "conj.", "number": "num.", "exclamation": "excl.",
  "modal verb": "modal v.", "auxiliary verb": "aux. v.", "abbreviation": "abbr.",
};
let _wordCategoryMap = null;
/* Kiest woorden voor gebruik ALS bouwstenen in een oefening (niet het doelwoord zelf): prioriteit aan
   woorden die de gebruiker al aantoonbaar goed beheerst (op elk ontgrendeld niveau, niet alleen A1) --
   pas als daar te weinig van zijn, wordt aangevuld met woorden uit de allereerste vocab-lessen van de
   cursus (ongeacht beheersing), zodat een oefening nooit draait om woorden die de gebruiker nog niet
   kent. */
function pickMasteredOrFallbackWords(count, excludeSet){
  const excluded = excludeSet || new Set();
  const allEn = baseWordList().map(w=>w.en).filter(en => !excluded.has(en));
  const level8 = allEn.filter(en => getProgress(en).level >= 8);
  const level7 = allEn.filter(en => getProgress(en).level >= 7);
  let pool = level8.length >= count ? level8 : level7;
  if(!pool.length){
    // allerlaatste redmiddel: nog helemaal geen woord op niveau 7+ (bv. een gloednieuwe gebruiker) ->
    // val terug op de eenvoudigste (A1) woorden, puur om sowieso een oefening te kunnen tonen
    pool = allEn.filter(en => { const w = EN_WORDS_DATA.find(x=>x.en===en); return w && w.cefr <= 2; });
  }
  const shuffled = [...pool];
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  return shuffled.slice(0, count);
}

function wordCategoryOf(en){
  if(!_wordCategoryMap){
    _wordCategoryMap = {};
    // Sommige Engelse woorden staan met meerdere pos-rijen in de brondata (bv. "close" als werkwoord
    // ÉN als bijvoeglijk naamwoord, "watch" als werkwoord ÉN zelfstandig naamwoord). Als we simpelweg
    // de laatste rij laten winnen, kan een woord dat WEL een werkwoordbetekenis heeft toch als "geen
    // werkwoord" geclassificeerd worden -- met als zichtbaar gevolg dat displayEnglishWord() de "to"
    // ervoor weglaat. Daarom: als een woord ÉÉN van zijn rijen als werkwoord heeft, telt het als
    // werkwoord, ongeacht de volgorde in de brondata. Voor overige (niet-werkwoord) botsingen blijft
    // de laatste rij bepalend, zoals voorheen.
    for(const w of EN_WORDS_DATA){
      if(!w.pos) continue;
      const abbr = WORD_CATEGORY_ABBR[w.pos] || w.pos;
      if(abbr === "v." || _wordCategoryMap[w.en] !== "v.") _wordCategoryMap[w.en] = abbr;
    }
  }
  return _wordCategoryMap[en] || "";
}
let _wordCefrMap = null;
// Bouwt de metatekst onder een geoefend woord (CEFR-niveau · woordsoort · evt. betekenis-hint).
// De hint (bv. "(approximately)") wordt ALTIJD getoond zodra een woord er een heeft -- niet pas na
// een fout antwoord -- want juist bij een woord met meerdere losstaande betekenissen (bv. "about" als
// voorzetsel vs bijwoord) moet de gebruiker VOORAF weten welke specifieke betekenis hier getest wordt.
function wordMetaText(cefrIdx, en, note){
  const cefrTxt = typeof cefrIdx === "number" ? cefrLabel(cefrIdx) : null;
  if(!note){
    return [cefrTxt, wordCategoryOf(en) || null].filter(Boolean).join(" · ");
  }
  // Zodra er een betekenis-hint is, vervangt die de kale grammaticale afkorting (adv./prep.) --
  // "concerning" of "approximately" zegt een leerder veel meer dan "prep."/"adv.".
  const noteTxt = /^\(.*\)$/.test(note.trim()) ? note.trim() : `(${note.trim()})`;
  return [cefrTxt, noteTxt].filter(Boolean).join(" · ");
}
function wordCefrOf(en){
  if(!_wordCefrMap){
    _wordCefrMap = {};
    for(const w of EN_WORDS_DATA) _wordCefrMap[w.en] = w.cefr;
  }
  return _wordCefrMap[en];
}
/* Cefr van een los Engels woord, inclusief dynamisch-ontdekte woorden (newWords) -- wordCefrOf zelf
   kent alleen de vaste Oxford-lijst. Gedeelde basis voor alle onderstaande CEFR-bereik-filters. */
export function cefrOfEn(en){
  const known = wordCefrOf(en);
  return typeof known === "number" ? known : newWords[en]?.cefr;
}
/* Of een los Engels woord (op basis van zijn cefr-niveau) binnen het ingestelde bereik valt. Woorden
   zonder bekend niveau tellen als "binnen bereik" (kunnen niet uitgesloten worden op iets wat er niet is). */
// De woordenlijst zelf bevat GEEN enkel woord met cefr 15/16/17 (C2) -- de hoogste waarde die ooit
// voorkomt is 14 (C1-end). Een sliderselectie die (deels) in C2 valt, vond dus altijd een gegarandeerd
// lege pool en viel noodgedwongen 100% van de tijd terug op lagere niveaus. Omdat de indeling daarboven
// toch enigszins arbitrair is, behandelen we voor woordSELECTIE alles vanaf C1-start (12) als één brede
// "C1+"-band: een woord met cefr 14 valt zo ook binnen een zuivere C2-selectie. Zinscomplexiteit
// (CEFR_LEVEL_GUIDANCE) en grammatica-onderwerpen (minCefr) blijven wél gewoon per subniveau verschillen
// -- alleen de onderliggende woordenpool wordt vanaf hier gedeeld.


// Zin-generatie gebruikt nu dezelfde woordmoeilijkheidsslider als de gewone woordoefening (was
// voorheen een los "sentenceVocab"-bereik, samengevoegd op verzoek -- zie inCefrRangeEn hierboven).

/* Toont een Engels woord zoals het aan de gebruiker gepresenteerd wordt: werkwoorden krijgen een
   "to" ervoor (bv. "to meet" i.p.v. kaal "meet"), duidelijker herkenbaar als werkwoord — net als in
   een woordenboek. Modale/hulpwerkwoorden (can, must, ...) nemen geen "to" en blijven kaal.
   Een handmatige correctie (overrides[en].en, bv. "born" -> "to be born") heeft altijd voorrang. */
// Of een gegeven basisvorm (bv. "name", "close") tot een SPLIT-groep behoort: meerdere onafhankelijk
// bijgehouden termen (aparte "en"-sleutel, aparte score, vaak een compleet andere Turkse vertaling)
// die toevallig dezelfde geschreven Engelse vorm delen (bv. "name__n"=isim vs "name__v"=adlandırmak).
// 603 van zulke groepen in de huidige woordenlijst -- zonder duidelijke markering ziet een gebruiker
// "name" een paar sessies later gewoon nogmaals verschijnen en denkt "dit heb ik al gedaan, mijn score
// is zeker niet opgeslagen", terwijl het in werkelijkheid een andere, apart bijgehouden betekenis is
// die nog nooit geoefend is. Werkwoorden zijn al enigszins te onderscheiden via de "to "-prefix
// hieronder, maar niet-werkwoord-botsingen (bv. twee zelfstandignaamwoord-betekenissen, of een
// bijvoeglijk naamwoord dat met een werkwoord botst) bleven volledig onzichtbaar identiek.
let _baseSenseCountMap = null;
function hasMultipleSenses(base){
  if(!_baseSenseCountMap){
    _baseSenseCountMap = {};
    for(const w of EN_WORDS_DATA){
      const b = w.base || w.en;
      _baseSenseCountMap[b] = (_baseSenseCountMap[b] || 0) + 1;
    }
  }
  return (_baseSenseCountMap[base] || 0) > 1;
}
let _wordDataByEn = null;
function wordDataOf(en){
  if(!_wordDataByEn){
    _wordDataByEn = {};
    for(const w of EN_WORDS_DATA) _wordDataByEn[w.en] = w;
  }
  return _wordDataByEn[en];
}
const POS_ABBR_TO_FULL = Object.fromEntries(Object.entries(WORD_CATEGORY_ABBR).map(([full, abbr]) => [abbr, full]));
export function displayEnglishWord(en){
  if(overrides[en] && overrides[en].en) return overrides[en].en;
  const base = baseEnOf(en);
  const pos = wordCategoryOf(en);
  const w = wordDataOf(en);
  const transitivity = w && w.transitivity; // enige huidige botsing van 2 werkwoord-sensen op dezelfde base ("change__v"/"change__vi") -- de "to "-prefix alleen onderscheidt die twee niet.
  if(pos === "v.") return transitivity ? `to ${base} (${transitivity})` : `to ${base}`;
  if(pos && hasMultipleSenses(base)) return `${base} (${POS_ABBR_TO_FULL[pos] || pos})`;
  return base;
}

async function pickGrammarDrillBaseWords(){
  const excluded = grammarDrillFunctionWordSet();
  const picks = pickMasteredOrFallbackWords(12, excluded);
  const pairs = [];
  for(const w of picks){
    try{
      const tr = await getOrFetchTranslation(w);
      pairs.push(`${tr[0]} (${w})`);
    }catch(e){ /* deze overslaan als vertalen mislukt */ }
  }
  return pairs;
}

async function generateGrammarDrillCandidate(topic, wordList, correctionNote){
  const sys = `You create an ISOLATED grammar drill for a given Turkish grammar topic.

CRITICAL — TEST THE SKILL IN ACTUAL USE, NEVER ABSTRACTLY:
WRONG (never do this): a meta-question about the rule itself, like "What does the suffix -e mean?" or "What is the dative case used for?", and absolutely NEVER show a bare, standalone suffix like "-e" or "-den" as the prompt or answer — that tests knowledge ABOUT the grammar, not actually APPLYING it.
WRONG (also never do this): a bare, standalone function word/preposition on its own, like just "to" or "from" with no surrounding phrase — that isolates the preposition/case itself instead of testing it "in use".
RIGHT (always do this): have the student translate a concrete, real, complete word or short phrase, in a randomly chosen direction:
- en-tr: give an English phrase that requires the skill to translate correctly — e.g. "on the table", "from home", "next to him" (a full phrase, never just "on"/"from"/"next to" alone) — and ask for the correct Turkish form.
- tr-en: give a real, already correctly inflected/derived Turkish word or phrase (e.g. "okula", or "masanın üstünde"), and ask for the English meaning.
IMPORTANT FOR TOPICS WITH "RELATIONAL NOUNS" (preposition-like constructions using üst/alt/ön/arka/yan etc.): occasionally also test the bare building-block word itself as plain vocabulary (e.g. "üst" -> top, "yan" -> side, with no further inflection) — that's just as important as the suffix mechanics itself, and may simply be asked as a word translation.
CRITICAL — DO NOT LET THE ENGLISH PROMPT ACCIDENTALLY TEST A DIFFERENT, NEIGHBOURING CONSTRUCTION: this topic is specifically "${topic.label}" (${topic.hint}), NOT any other tense/aspect/modality that a bare English phrase could also plausibly map to. Turkish has several near-neighbour pairs that collapse into the SAME plain English phrasing unless you add an explicit disambiguating word — most notably: present/general ABILITY "-EBİLİR" ("can you swim?") vs. FUTURE ability "-EBİLECEK" ("will you be able to swim?") -- these are NOT interchangeable, so if the topic is the future-ability pattern, the English prompt MUST make the future/eventual framing explicit (e.g. "will you be able to come tomorrow?", not the bare present "can you come?"), and vice versa for present ability; PRESENT CONTINUOUS "-İYOR" ("is doing, right now") vs. AOR IST/habitual "-İR/-ER" ("does, in general") -- add "right now"/"at this moment" for the former, "usually"/"in general" for the latter; WITNESSED past "-Dİ" vs. REPORTED/inferred past "-Mİş" -- make explicit whether the speaker saw it happen themselves or is reporting/inferring it. Before finalizing your answer, check: could this exact English "prompt" just as naturally be answered using the NEIGHBOURING pattern instead of "${topic.label}"? If yes, rewrite the prompt to remove that ambiguity.
STRICT REQUIREMENT: the base word MUST come literally from the list given to you for this call, no other word whatsoever. Pick whichever one best fits the topic (a verb for verb conjugation topics, a noun for case topics, etc.) — do not invent a different word yourself, even if you think you could come up with a "better" example.
NOTE — THE ENGLISH GLOSS IN PARENTHESES IS ONLY A MEMORY AID, NOT AN INSTRUCTION TO RE-TRANSLATE IT YOURSELF: each item in the list is formatted as "TURKISH_WORD (english meaning)" — use the GIVEN Turkish word literally as written. Do NOT re-translate the English gloss yourself, because English words are often ambiguous (e.g. "like" can mean either "to like" (beğenmek) or "similar to" (gibi)) — if the list contains "gibi (like)", the intended word is ALWAYS "gibi", never a self-invented translation of "like" such as "beğenmek".
Write everything in English and Turkish ONLY — never any other language.
Respond in JSON.`;
  const userMsg = `Topic: "${topic.label}" (${topic.hint})
Allowed base words (pick exactly one): ${wordList}` + (correctionNote ? `\n\nNOTE: your previous attempt was rejected — ${correctionNote} Please get it right this time.` : "");
  const schema = {
    name: "grammar_drill",
    description: "Een geïsoleerde grammatica-oefening: een concrete zin/frase, geen abstracte regelvraag.",
    input_schema: {
      type: "object",
      properties: {
        direction: {type:"string", enum:["en-tr","tr-en"]},
        prompt: {type:"string", description:"De Engelse frase (en-tr) of Turkse vorm (tr-en) die aan de gebruiker getoond wordt."},
        correct: {type:"string", description:"Het correcte antwoord, in de andere taal dan prompt."},
        baseWord: {type:"string", description:"Het gekozen basiswoord, letterlijk overgenomen uit de gegeven lijst."},
      },
      required: ["direction","prompt","correct","baseWord"]
    }
  };
  const raw = await callAI("sentence", sys, userMsg, 2500, 0.4, schema);
  return parseAIJson(raw);
}

/* Keurt een drill af als de AI de instructies toch negeerde: een metavraag over een kale uitgang,
   of een basiswoord dat niet daadwerkelijk uit de meegegeven, beheerste woordenlijst komt. */
// Losse functiewoorden die NOOIT als op-zichzelf-staand antwoord/prompt mogen voorkomen — een oefening
// moet altijd een ECHTE woordgroep zijn (bv. "on the table"), nooit alleen het voorzetsel zelf. Ook
// een handvol Nederlandse woorden erbij, want de AI liet af en toe per ongeluk Nederlands lekken
// (waarschijnlijk doordat de instructieprompt zelf in het Nederlands is) i.p.v. zuiver Engels/Turks.
const BARE_FUNCTION_WORDS = new Set([
  "to","from","at","on","in","under","over","with","without","before","after","like","as","of","by",
  "for","near","between","behind","toward","towards","above","below","through","during","until","since",
  "naar","van","bij","op","onder","in","met","zonder","voor","na","als","zoals","achter","tussen","door","tijdens","tot","sinds","boven",
]);
function drillLooksInvalid(drill, baseWords){
  if(!drill || !drill.prompt || !drill.correct) return true;
  const p = drill.prompt.trim();
  const c = drill.correct.trim();
  // kale uitgang zoals "-e"/"-den" ERGENS in de tekst, niet alleen aan het begin
  if(/-[a-zA-ZçğıöşüÇĞİÖŞÜ]{1,5}\b/.test(p) || /-[a-zA-ZçğıöşüÇĞİÖŞÜ]{1,5}\b/.test(c)) return true;
  if(/\bsuffix\b|\bwhat (does|is)\b|\bmean(ing)?\??$|\bwhat.{0,15}case\b|\bcase (is|used)\b/i.test(p)) return true;
  // geen van beide velden mag een KAAL los functiewoord zijn (zonder woordgroep eromheen) — dat toetst
  // het voorzetsel/de naamval geïsoleerd i.p.v. "in gebruik", precies wat we juist willen vermijden
  const isBareFunctionWord = s => BARE_FUNCTION_WORDS.has(s.toLowerCase().replace(/[.?!]/g,"").trim());
  if(isBareFunctionWord(p) || isBareFunctionWord(c)) return true;
  const trPool = baseWords.map(s => s.split(" (")[0].trim().toLowerCase()).filter(Boolean);
  if(!trPool.length) return false; // geen lijst om tegen te toetsen (bv. fallback-lijst) -> niet afkeuren
  const haystack = `${drill.baseWord||""} ${drill.prompt} ${drill.correct}`.toLowerCase();
  const usesProvidedWord = trPool.some(w => w.length > 1 && haystack.includes(w));
  return !usesProvidedWord;
}

/* Voor "ruimtelijke" onderwerpen (voorzetsel-achtige constructies + de bijbehorende naamvallen) is een
   vaste, kleine set anker- en hulp-zelfstandignaamwoorden veel betrouwbaarder dan telkens een willekeurig
   woord: het dwingt de AI om een ECHT kort zinnetje te bouwen (bv. "Kedi masanın üstünde.") in plaats van
   losse, soms te abstracte fragmenten. */
/* ===================== OEFENFRAMEWORKS PER GRAMMATICA-ONDERWERP =====================
   In plaats van 46 losse, individueel afgestelde oefenformats: een handvol herbruikbare
   "frameworks" (patronen), elk met een eigen woordsoort-behoefte. Elk framework trekt zijn
   voorbeeldwoorden uit een DYNAMISCHE pool van al beheerste A1-woorden van de juiste woordsoort
   — nooit een vaste woordenset — zodat er variatie is (goed voor klinkerharmonie-gewenning) en
   de vaardigheid ISOLEERD maar wel PRAKTISCH TOEGEPAST (in een echt kort zinnetje) getoetst wordt. */

// Welke woordsoort-pool(s) elk onderwerp nodig heeft, en welk framework (zinspatroon) daarbij hoort.
export const GRAMMAR_TOPIC_FRAMEWORK = {
  // ruimtelijk: naamval-constructies (locatief/datief/ablatief) -> [onderwerp-nw] + [ankernw]+constructie.
  // Deze werken vrijwel altijd met een willekeurig naamwoord als anker, dus puur "spatial" blijft prima.
  bulunma_hali:"spatial", yonelme_hali:"spatial", ayrilma_hali:"spatial",
  // postposities (için/ile/rağmen/göre) zaten voorheen ook op "spatial", maar "göre" ("volgens X")
  // vereist een MENINGSHOUDER (persoon/groep/bron) als anker -- gedwongen combineren met een
  // willekeurig object (bv. "volgens de sleutel") leverde onzinnige zinnen op. Eigen framework dat de
  // AI zelf laat kiezen welke van de vier postposities bij het gegeven naamwoord past.
  edatlar:"postpositions",
  // werkwoord-gebaseerd: tijd/wijze/çatı toegepast op een los werkwoord (+onderwerp)
  olumsuzluk:"verb", simdiki_zaman:"verb", genis_zaman:"verb", gecmis_di:"verb",
  gecmis_mis:"verb", gelecek_zaman:"verb", gecmis_devam:"verb", gelecek_gecmis:"verb",
  birlesik_gecmis:"verb", gereklilik_kipi:"verb", sart_kipi:"verb", istek_kipi:"verb",
  emir_kipi:"verb", yeterlik_kipi:"verb", mastar:"verb", edilgen_cati:"verb", ettirgen_cati:"verb",
  donusluluk_cati:"verb", islik_cati:"verb", isim_fiil:"verb", dolayli_anlatim:"verb",
  sart_bilesik:"verb", tezlik_fiili:"verb", rivayet_bilesik:"verb", devrik_cumle:"verb",
  resmi_dil:"verb", surerlik_fiili:"verb",
  // nieuw (volledigheidscontrole): zarflar (bijwoord bij een werkwoord), diktan_sonra en
  // aliskanlik_gecmis (beide simpele werkwoord+achtervoegsel-constructies), kendi_zamiri (meestal in
  // combinatie met een werkwoord/handeling) -- allemaal 1 werkwoord (+onderwerp) volstaat.
  zarflar:"verb", diktan_sonra:"verb", aliskanlik_gecmis:"verb", kendi_zamiri:"verb",
  // nieuw (volledigheidscontrole ronde 2): soru_eki (mi/mı-vraagpartikel) en vurgu_partikelleri
  // (de/da, bile) hangen allebei aan een kort werkwoord-predicaat vast -- zelfde minimale opzet als
  // de rest van de werkwoord-groep, 1 werkwoord (+onderwerp) volstaat.
  soru_eki:"verb", vurgu_partikelleri:"verb",
  // twee werkwoorden nodig: verbindende/temporele constructies
  madan_once:"verb2", diginde:"verb2", inca:"verb2", dikce:"verb2", zarf_fiil:"verb2", ortac:"verb2",
  // nieuw: ip_baglaci verbindt twee opeenvolgende acties van hetzelfde onderwerp -- zelfde vorm als verb2.
  ip_baglaci:"verb2",
  // zelfstandig-naamwoord-gebaseerd: 1 nw (predicaat) -- incl. de 3 copula-onderdelen (predicaat is een nw/bijv.nw, geen werkwoord)
  belirtme_hali:"noun", iyelik_ekleri:"noun", cogul_eki:"noun", kucultme_eki:"noun",
  sayilar_siralar:"noun", copula_basic:"noun", copula_plural:"noun", copula_soru_olumsuz:"noun",
  ikileme:"noun", atasozu_deyim:"noun", gecmis_copula:"noun",
  // Address forms (Ahmet Bey / Ayşe Hanım) zijn geen "predicaat op een willekeurig zelfstandig
  // naamwoord"-constructie zoals de rest van de noun-groep -- het is letterlijk een titel + een
  // ECHTE Turkse voornaam, verder niets. De generieke "noun"-instructie liet de AI voorheen een
  // willekeurig vocabulaire-woord (bv. "tafel") als anker gebruiken, wat geen zinnig resultaat
  // opleverde. Eigen, minimale framework: geen zin, geen los vocabulairewoord nodig, alleen naam+titel.
  hitap_bicimleri:"address_form",
  // nieuw: var_yok (bestaan/bezit, functioneert als een soort copula), soru_kelimeleri (vraagwoord +
  // een naamwoord om over te vragen), isaret_zamirleri (bu/şu/o + naamwoord), belirsiz_zamirler
  // (biri/herkes/bazı + naamwoord), arac_hali (naamval op 1 naamwoord), yardimci_fiiller
  // (naamwoord + etmek/olmak-patroon) -- allemaal 1 naamwoord volstaat.
  var_yok:"noun", soru_kelimeleri:"noun", isaret_zamirleri:"noun", belirsiz_zamirler:"noun",
  arac_hali:"noun", yardimci_fiiller:"noun",
  // formele/geschreven-register postposities (dair/ilişkin/itibaren/nazaran) -- eigen framework,
  // want dit is een compleet ander (en kleiner) setje dan de spreektalige postposities (edatlar).
  ileri_edatlar:"postpositions_formal",
  // correlatieve voegwoorden (ne...ne de, gerek...gerek) verbinden twee items -- zelfde vorm als noun2.
  ileri_baglaclar:"noun2",
  // twee zelfstandige naamwoorden nodig
  // isim_tamlamasi (onbepaalde/belirtisiz compound, bv. "araba anahtarı") werkt met VRIJWEL elk
  // willekeurig naamwoordpaar, want het is een "type/categorie"-relatie -- eigen framework.
  // tamlayan_hali (bepaalde/belirtili compound + genitief, bv. "arabanın anahtarı") vereist ECHTE
  // bezitsrelatie -- twee volledig willekeurige naamwoorden (bv. "lepel" + "olifant") leverden hier
  // geforceerde/rare voorbeelden op, dus dat krijgt een aparte curated "bezitter"-pool (zie
  // POSSESSOR_NOUNS/pickMasteredPossessorWords) i.p.v. de brede, willekeurige Nouns-pool.
  isim_tamlamasi:"noun_compound_indefinite", tamlayan_hali:"noun_compound_definite",
  // ki_eki ("-ki" achtervoegsel) zat ook op "noun2" (twee volledig willekeurige naamwoorden), maar de
  // meest gangbare -ki-vorm (bv. "masadaki kitap" = het boek OP de tafel) vereist dat het tweede
  // naamwoord fysiek/plausibel bij het eerste kan horen -- willekeurige paren gaven onzin als
  // "kupadaki başarı" ("het succes in de beker"). Eigen framework, zie hieronder.
  karsilastirma:"noun2", ki_eki:"relative_ki",
  // nieuw (volledigheidscontrole ronde 2): baglaclar (ve/ama/çünkü/veya) verbindt twee items --
  // zelfde minimale opzet als de rest van de noun2-groep (2 zelfstandige naamwoorden, geen extra's).
  baglaclar:"noun2",
  // Nieuw (suffix-dekkingscontrole): vier achtervoegsels die op een NAAMWOORD/BIJVOEGLIJK NAAMWOORD
  // landen (geen werkwoordvervoeging), dus horen bij de "noun"-groep -- consistent met hoe
  // kucultme_eki (verkleinwoord) en copula_basic hierboven ook al "noun" gebruiken. ce_eki's
  // opinion-variant ("bence") gebruikt om diezelfde reden geen willekeurig zelfstandig naamwoord als
  // anker maar een klein eigen framework (zie opinion_ce hieronder), net zoals address_form dat al
  // deed voor Ahmet Bey/Ayşe Hanım.
  lik_eki:"noun", li_siz_eki:"noun", genelleme_diri:"noun", ce_eki:"opinion_ce",
  // Nieuw (suffix-dekkingscontrole ronde 2): beide landen op een naamwoord (ci_eki) resp. naamwoord/
  // bijvoeglijk-naamwoord-predicaat (mis_copula), dus horen ook bij de "noun"-groep.
  ci_eki:"noun", mis_copula:"noun",
  // rest: geen duidelijke woordsoort-voorkeur, gebruikt de brede gemengde pool (bestaand gedrag)
};

let _a1CategoryCache = {};
function categoryWordSet(category){
  if(_a1CategoryCache[category]) return _a1CategoryCache[category];
  const set = new Set();
  for(const v of VOCAB_LESSON_DATA){
    if(v.title.startsWith(category)) for(const w of v.words) set.add(w);
  }
  _a1CategoryCache[category] = set;
  return set;
}

/* Trekt `count` VERSCHILLENDE woorden van een bepaalde woordsoort, bij voorkeur al goed beheerste
   woorden (op elk ontgrendeld niveau) — dat geeft variatie (i.p.v. steeds dezelfde 2 vaste woorden)
   en dus meer blootstelling aan verschillende klinkerharmonie-patronen. */
async function pickMasteredPoolWords(category, count, avoidEn){
  const catWords = categoryWordSet(category); // per-woordsoort set, over alle niveaus
  const allInCat = [...catWords];
  const level8 = allInCat.filter(en => getProgress(en).level >= 8);
  const level7 = allInCat.filter(en => getProgress(en).level >= 7);
  let pool = level8.length >= count ? level8 : level7;
  if(!pool.length){
    // allerlaatste redmiddel: nog helemaal geen woord van deze woordsoort op niveau 7+
    pool = allInCat.filter(en => { const w = EN_WORDS_DATA.find(x=>x.en===en); return w && w.cefr <= 2; });
  }
  // CEFR-bereik: deze functie filterde voorheen ALLEEN op "al beheerst" (level>=7/8), nooit op het
  // ingestelde niveau -- een allang gemasterd, maar zwaar woord (bv. "danışman" = consultant) kon dus
  // zomaar in een A1-grammatica-oefening belanden. Eerst binnen bereik proberen, terugval als leeg.
  const poolInRange = pool.filter(inCefrRangeEn);
  if(poolInRange.length) pool = poolInRange;
  // Recent-binnen-deze-sessie-gebruikte woorden vermijden (voorkomt "steeds hetzelfde zinnetje" bij
  // grammatica-oefeningen) -- maar alleen als dat niet de hele pool leegveegt.
  if(avoidEn && avoidEn.size){
    const filtered = pool.filter(en => !avoidEn.has(en));
    if(filtered.length) pool = filtered;
  }
  const shuffled = [...pool];
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  const picks = shuffled.slice(0, count);
  const pairs = [];
  for(const en of picks){
    try{ const tr = await getOrFetchTranslation(en); pairs.push({en: baseEnOf(en), tr:tr[0]}); }
    catch(e){ /* deze overslaan als vertalen mislukt */ }
  }
  return pairs;
}

// Naamwoorden die zinvol als "bezitter" in een BEPAALDE naamwoordgroep (belirtili isim tamlaması/
// genitief) kunnen optreden: levende wezens, organisaties, plekken -- dingen die daadwerkelijk iets
// kunnen "hebben". Een volledig willekeurig abstract naamwoord (bv. "lepel", "banaan") kan dat niet,
// wat eerder tot geforceerde/rare voorbeelden leidde (zie noun_compound_definite hierboven).
const POSSESSOR_NOUNS = new Set([
  "mother","father","teacher","dog","cat","king","queen","doctor","family","sister","brother",
  "student","friend","man","woman","child","boy","girl","president","company","city","country",
  "school","team","government","nurse","farmer","driver","police","army","church","university","hospital",
  "village","town","house","office","shop","store","bird","horse","cow","lion","elephant","baby","parent",
  "grandmother","grandfather","husband","wife","son","daughter","uncle","aunt","cousin","worker","manager",
  "boss","owner","customer","client","leader","captain","soldier","lawyer","judge","priest","prince","princess",
]);
async function pickMasteredPossessorWords(count, avoidEn){
  const allEn = baseWordList().map(w=>w.en).filter(en => POSSESSOR_NOUNS.has(en));
  const level8 = allEn.filter(en => getProgress(en).level >= 8);
  const level7 = allEn.filter(en => getProgress(en).level >= 7);
  let pool = level8.length >= count ? level8 : level7;
  if(!pool.length) pool = allEn; // nog geen enkele possessor-noun op niveau 7+: pak elk bekend exemplaar
  if(!pool.length) pool = [...POSSESSOR_NOUNS]; // allerlaatste redmiddel: de curated lijst zelf (nog niet vertaald)
  const poolInRange = pool.filter(inCefrRangeEn);
  if(poolInRange.length) pool = poolInRange;
  if(avoidEn && avoidEn.size){
    const filtered = pool.filter(en => !avoidEn.has(en));
    if(filtered.length) pool = filtered;
  }
  const shuffled = [...pool];
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  const picks = shuffled.slice(0, count);
  const pairs = [];
  for(const en of picks){
    try{ const tr = await getOrFetchTranslation(en); pairs.push({en: baseEnOf(en), tr:tr[0]}); }
    catch(e){ /* deze overslaan als vertalen mislukt */ }
  }
  return pairs;
}

const FRAMEWORK_INSTRUCTIONS = {
  spatial: {needCategory:["Nouns","Nouns"], needCount:[1,1],
    instr: (w1,w2) => `Build one short, natural sentence using EXACTLY these two nouns: "${w1.tr}" (${w1.en}) as the subject, and "${w2.tr}" (${w2.en}) as the location/reference noun that the grammar point attaches to.\nIllustration only (build your OWN sentence with the given words/topic, don't just copy this): "Kedi masanın üstünde." (The cat is on the table.)\nKeep it SHORT (3-6 words) and use no other nouns besides the two given.`},
  // Postposities (için "for", ile "with", rağmen "despite", göre "according to") stellen heel
  // verschillende eisen aan het naamwoord waar ze aan hangen -- daarom kiest de AI hier zelf welke
  // postpositie past bij het gegeven tweede naamwoord, i.p.v. één vaste (locatieve) framing te forceren.
  postpositions: {needCategory:["Nouns","Nouns"], needCount:[1,1],
    instr: (w1,w2) => `Build one short, natural sentence using EXACTLY these two nouns: "${w1.tr}" (${w1.en}) as the subject, and "${w2.tr}" (${w2.en}) as the noun that a Turkish postposition attaches to. Choose WHICHEVER of these four postpositions fits "${w2.en}" most naturally: için ("for"), ile ("with"), rağmen ("despite"), or göre ("according to"). için/ile/rağmen work with almost any noun. göre is an EXCEPTION: it only makes natural sense if "${w2.en}" is a person, group, or source capable of holding an opinion/view (e.g. "according to my mother", "according to the teacher") — if "${w2.en}" is an inanimate object or abstract thing, do NOT use göre; pick için, ile, or rağmen instead. Keep it SHORT (3-6 words) and use no other nouns besides the two given.`},
  verb: {needCategory:["Verbs"], needCount:[1],
    instr: (w1) => `Build one short, natural sentence applying the grammar point to EXACTLY this verb: "${w1.tr}" (${w1.en}). Pick any subject (I/you/he/she/we/they) yourself. Do NOT add an object or any other noun beyond the subject unless the verb is grammatically impossible to use without one — a bare subject + verb is the goal, not a fuller scene. Keep it SHORT (2-5 words) and use no other verb besides the one given.`},
  verb2: {needCategory:["Verbs","Verbs"], needCount:[1,1],
    instr: (w1,w2) => `Build one short, natural sentence that links/combines EXACTLY these two verbs using the grammar point: "${w1.tr}" (${w1.en}) and "${w2.tr}" (${w2.en}). Example shape only (build your own): "Koşarak geldi." combines running+coming. Keep it SHORT and use no other verbs besides the two given.`},
  noun: {needCategory:["Nouns"], needCount:[1],
    instr: (w1) => `Build one short, natural sentence applying the grammar point to EXACTLY this noun: "${w1.tr}" (${w1.en}). Do NOT return a single bare inflected word with no verb/copula/context (e.g. just "${w1.tr}lar" alone is NOT acceptable) — always embed it in a minimal real clause (a copula, "var"/"yok", or a simple verb) so it's an actual testable sentence, not an isolated inflected form. Do NOT add any further nouns, objects, or extra descriptive details beyond what the grammar point itself requires — a bare subject + predicate is the goal, not a fuller scene. Keep it SHORT (2-5 words) and use no other noun besides the one given.`},
  noun2: {needCategory:["Nouns","Nouns"], needCount:[1,1],
    instr: (w1,w2) => `Build one short, natural phrase or sentence that relates EXACTLY these two nouns using the grammar point: "${w1.tr}" (${w1.en}) and "${w2.tr}" (${w2.en}). Keep it SHORT and use no other nouns besides the two given.`},
  // Onbepaalde naamwoordgroep (belirtisiz isim tamlaması): eerste naamwoord blijft KAAL (geen
  // achtervoegsel), tweede krijgt de 3e-persoons bezittelijke uitgang -(s)I. Dit is een "type/categorie"-
  // relatie (bv. "araba anahtarı" = auto-sleutel/soort sleutel), die met vrijwel ELK naamwoordpaar werkt.
  noun_compound_indefinite: {needCategory:["Nouns","Nouns"], needCount:[1,1],
    instr: (w1,w2) => `Build a Turkish INDEFINITE noun compound (belirtisiz isim tamlaması) using EXACTLY these two nouns in this order: "${w1.tr}" (${w1.en}) + "${w2.tr}" (${w2.en}). The first noun stays in its bare dictionary form (no suffix); only the second noun takes the 3rd-person possessive suffix -(s)I. This construction expresses a category/type relation ("a ${w2.en} of/for/made-of ${w1.en}-type"), similar to "araba anahtarı" (car key) — it works naturally even for an unusual pair, since it just names a type/category, not literal ownership. Build a short, natural phrase (2-4 words).`},
  // Bepaalde naamwoordgroep (belirtili isim tamlaması) + genitief: eerste naamwoord krijgt de genitief
  // -(n)In, tweede weer de bezittelijke uitgang -(s)I (bv. "okulun bahçesi" = de tuin VAN de school).
  // Vereist een ECHTE bezitsrelatie -- daarom komt het eerste woord uit een curated pool van "bezitter"-
  // achtige naamwoorden (mensen, dieren, organisaties, plekken) i.p.v. een volledig willekeurig naamwoord.
  noun_compound_definite: {needCategory:["PossessorNouns","Nouns"], needCount:[1,1],
    instr: (w1,w2) => `Build a Turkish DEFINITE noun compound (belirtili isim tamlaması) expressing genuine, specific possession, using EXACTLY these two nouns: "${w1.tr}" (${w1.en}) as the possessor, and "${w2.tr}" (${w2.en}) as the thing possessed. The first noun takes the genitive suffix -(n)In; the second noun takes the 3rd-person possessive suffix -(s)I — e.g. "okulun bahçesi" (the school's garden, okul+un + bahçe+si). Build a short, natural phrase or short sentence (2-5 words) using exactly these two nouns.`},
  // Het -ki achtervoegsel heeft twee heel verschillende hoofdgebruiken; de AI kiest zelf welke bij het
  // gegeven paar past, i.p.v. één vaste (locatieve) lezing te forceren op een paar dat daar niet bij past.
  relative_ki: {needCategory:["Nouns","Nouns"], needCount:[1,1],
    instr: (w1,w2) => `Build one short, natural phrase or sentence using the Turkish relative suffix -ki, involving EXACTLY these two nouns: "${w1.tr}" (${w1.en}) and "${w2.tr}" (${w2.en}). -ki has two common uses — pick WHICHEVER actually fits this pair, don't force the wrong one:\n1) Locative-relative: [noun1 in locative + -ki] + noun2, meaning "the noun2 that is at/in/on noun1" (e.g. "masadaki kitap" = the book on the table). ONLY use this if "${w2.en}" could plausibly be physically located at/in/on "${w1.en}" (a book CAN be on a table; success CANNOT be in a cup).\n2) Possessive/comparative substitute: [noun1 in genitive + -ki], replacing an implied noun2, often comparing to noun2 (e.g. "Ahmet'in arabası benimkinden hızlı" = Ahmet's car is faster than mine). Use this if the locative reading doesn't make sense.\nKeep it SHORT and use no other nouns besides the two given.`},
  // Formele/geschreven-register postposities -- een compleet ander, kleiner setje dan de spreektalige
  // edatlar-postposities (için/ile/göre/rağmen). De AI kiest zelf welke van de vier het beste bij het
  // gegeven tweede naamwoord past, zelfde aanpak als bij "postpositions" hierboven.
  postpositions_formal: {needCategory:["Nouns","Nouns"], needCount:[1,1],
    instr: (w1,w2) => `Build one short, natural FORMAL/WRITTEN-register Turkish sentence using EXACTLY these two nouns: "${w1.tr}" (${w1.en}) as the subject or topic, and "${w2.tr}" (${w2.en}) as the noun that a formal Turkish postposition attaches to. Choose WHICHEVER of these four fits "${w2.en}" most naturally: dair ("regarding/about"), ilişkin ("related to/concerning"), itibaren ("starting from", typically with a time noun), or nazaran ("compared to/relative to"). itibaren specifically needs a time/date-like noun (e.g. "yarından itibaren" = starting from tomorrow) — if "${w2.en}" isn't time-related, use dair, ilişkin, or nazaran instead. This is FORMAL/WRITTEN register (news, official documents, reports) — keep the sentence itself simple and SHORT (3-7 words) even though the register is formal, and use no other nouns besides the two given.`},
  // Adresvormen (Ahmet Bey / Ayşe Hanım): geen zin, geen los vocabulairewoord -- alleen een titel
  // ("Bey" of "Hanım") toegepast op een ECHTE, gangbare Turkse voornaam. needCategory is expres
  // leeg: dit onderwerp heeft geen woord uit de vocabulairepool nodig, de AI kiest zelf een naam.
  address_form: {needCategory:[], needCount:[],
    // Dit onderwerp heeft 3 varianten (titel/diminutief/register, zie GRAMMAR_TOPICS.hitap_bicimleri)
    // die elk hun EIGEN oefenvorm nodig hebben -- voorheen negeerde deze instr() de variant volledig
    // en testte hij altijd alleen de titel-vorm (Ahmet Bey), ook wanneer diminutief/register aan de
    // beurt was. topic.key bevat na effectiveTopicForVariant "hitap_bicimleri::<variantId>".
    instr: (topic) => {
      const variantId = topic && topic.key && topic.key.includes("::") ? topic.key.split("::")[1] : null;
      if(variantId === "diminutief"){
        return `Produce ONLY a single affectionate/diminutive Turkish address term — nothing else, no sentence, no verb, no extra words. Pick a real, genuinely common Turkish term of endearment yourself (vary between calls: e.g. "anneciğim" (mommy), "canım" (dear/darling), "tatlım" (sweetie), "aşkım" (my love), "babacığım" (daddy), "kızım" (used affectionately for a girl/young woman) — never an invented word). The English side should be the natural affectionate English equivalent (e.g. "mommy", "dear", "sweetie"). Nothing beyond the one address term — no greeting, no verb, no sentence.`;
      }
      if(variantId === "register"){
        return `Produce ONLY one short, complete, natural everyday Turkish phrase or question, in EITHER the informal "sen" register OR the formal/polite "siz" register — pick which register RANDOMLY each call and vary the phrase itself (e.g. "Nasılsın?"/"Nasılsınız?", "Ne yapıyorsun?"/"Ne yapıyorsunuz?", "Adın ne?"/"Adınız ne?", "Nerelisin?"/"Nerelisiniz?" — don't reuse the same phrase every time). The English side is the natural translation. Nothing beyond that one short phrase — no extra sentence, no explanation of which register it is.`;
      }
      // default: "titel" variant (of geen variants-array, backward compatible)
      return `Produce ONLY a title + a real, common Turkish first name — nothing else, no sentence, no verb, no extra words. Pick a real Turkish first name yourself (vary between calls: e.g. Ahmet, Mehmet, Ayşe, Fatma, Ali, Zeynep, Elif, Mustafa, Hasan, Emine, and other genuinely common Turkish names — never a placeholder or invented name), and attach the correct title: "Bey" after a male name, "Hanım" after a female name. Example shape only (pick a DIFFERENT name yourself, don't reuse this exact one): "Ahmet Bey". The English side should be the plain "Mr./Ms. [Name]" equivalent. Nothing beyond title + name — no greeting, no verb, no sentence.`;
    }},
  // Nieuw (suffix-dekkingscontrole): -ce/-ca heeft 2 heel verschillende ankers per variant -- de
  // opinion-vorm ("bence") werkt ALLEEN met een klein, vast setje persoonlijke voornaamwoorden (geen
  // willekeurig zelfstandig naamwoord), dus needCategory blijft leeg, net als bij address_form.
  opinion_ce: {needCategory:[], needCount:[],
    instr: (topic) => {
      const variantId = topic && topic.key && topic.key.includes("::") ? topic.key.split("::")[1] : null;
      if(variantId === "gorus"){
        return `Produce a SHORT opinion phrase or short sentence using EXACTLY ONE of these genuinely common Turkish "-ce" opinion forms: "bence" (in my opinion), "sence" (in your opinion), "bizce" (in our opinion), or "sizce" (in your/plural-formal opinion) — pick randomly, vary between calls. Follow it with a short opinion (e.g. "Bence bu doğru." = In my opinion, this is right.). Keep it SHORT (2-5 words). Do NOT use "onca" or "onlarca" — those are not genuinely common opinion forms in everyday Turkish.`;
      }
      // default: "zarf" variant (bijwoordelijke "op een ... manier"-vorm)
      return `Pick a real, common Turkish adjective yourself and attach the "-ce/-ca" adverbial suffix to it to mean "in a ... way" (e.g. "hızlı" -> "hızlıca" = quickly, "sessiz" -> "sessizce" = silently, "yavaş" -> "yavaşça" = slowly). Build one short, natural sentence using that adverb with a simple verb (e.g. "Yavaşça yürüdü." = He walked slowly). Keep it SHORT (2-4 words).`;
    }},
};

/* Voor de "Prepositions"-vocabulairelessen: verpakt een specifiek voorzetsel-woord in een kort,
   natuurlijk zinnetje met een willekeurig, al beheerst zelfstandig naamwoord — in plaats van het
   woord kaal te tonen. Hergebruikt dezelfde poolgebaseerde aanpak als de grammatica-frameworks. */
let _prepositionWordSet = null;
function prepositionWordSet(){
  if(_prepositionWordSet) return _prepositionWordSet;
  _prepositionWordSet = new Set();
  for(const v of VOCAB_LESSON_DATA){
    if(v.title.startsWith("Prepositions")) for(const w of v.words) _prepositionWordSet.add(w);
  }
  return _prepositionWordSet;
}

// Losse woorden binnen "Pronouns"/"Determiners" die zelf al een naamval- of bezitsvorm zijn (dus geen
// kale grondvorm) — "him"/"her" zijn objectvorm (accusatief), "my"/"his"/"our" zijn bezittelijk. De rest
// van die categorieën (who/what/every/some/many, enz.) is wél gewoon een losstaand woord en blijft prima
// bare testbaar. Samen met prepositionWordSet() dekt dit alle drie de categorieën met dit probleem.
const CONTEXTUAL_VOCAB_WORDS = new Set(["me","him","her","us","them","my","his","its","our","your","their"]);
function needsContextualDrill(en){
  return prepositionWordSet().has(en) || CONTEXTUAL_VOCAB_WORDS.has(en);
}

async function generateContextualVocabDrill(en){
  const tr = await getOrFetchTranslation(en);
  const baseText = baseEnOf(en);
  const helperPicks = await pickMasteredPoolWords("Nouns", 1);
  const helper = helperPicks[0] || {en:"cat", tr:"kedi"};
  const isPreposition = prepositionWordSet().has(en);
  const roleDescription = isPreposition
    ? `preposition/postposition "${tr[0]}" (English: "${baseText}")`
    : `word "${tr[0]}" (English: "${baseText}"), which is itself already a case-marked or possessive form (not a bare root) — showing it completely alone would test it out of context`;
  const sys = `You create a SHORT, natural example sentence that clearly demonstrates the Turkish ${roleDescription}.
Build one short sentence using this noun somewhere in it: "${helper.tr}" (${helper.en}). Keep it SHORT (3-6 words) and natural.
Randomly choose the test direction: en-tr (show the English sentence, ask for the Turkish translation) or tr-en (show the Turkish sentence, ask for the English translation).
Write everything in English and Turkish ONLY — never any other language.
Respond in JSON.`;
  const schema = {
    name: "vocab_drill",
    description: "Een kort zinnetje dat een specifiek Turks woord in context demonstreert.",
    input_schema: {
      type: "object",
      properties: {
        direction: {type:"string", enum:["en-tr","tr-en"]},
        prompt: {type:"string", description:"De zin die aan de gebruiker getoond wordt, in de taal die bij direction hoort."},
        correct: {type:"string", description:"De correcte vertaling in de andere taal."},
      },
      required: ["direction","prompt","correct"]
    }
  };
  const raw = await callAI("sentence", sys, `Word: ${tr[0]} (${baseText})`, 2500, 0.5, schema);
  return parseAIJson(raw);
}

async function generateFrameworkDrillCandidate(topic, framework, correctionNote, avoidEn){
  const cfg = FRAMEWORK_INSTRUCTIONS[framework];
  const words = [];
  for(let i=0;i<cfg.needCategory.length;i++){
    // "PossessorNouns" is geen echte vocab-categorie maar de curated bezitter-pool (zie
    // POSSESSOR_NOUNS hierboven) -- alleen relevant voor noun_compound_definite (genitief).
    const picked = cfg.needCategory[i] === "PossessorNouns"
      ? await pickMasteredPossessorWords(1, avoidEn)
      : await pickMasteredPoolWords(cfg.needCategory[i], 1, avoidEn);
    words.push(picked[0] || (cfg.needCategory[i] === "PossessorNouns" ? {en:"teacher", tr:"öğretmen"} : {en:"school", tr:"okul"})); // veiligheidsnet als de pool leeg is
  }
  // Bijhouden voor de "vermijd recent gebruikte woorden"-check bij de volgende drill in dezelfde sessie.
  for(const w of words){
    recentGrammarDrillWords.add(w.en);
    while(recentGrammarDrillWords.size > RECENT_GRAMMAR_DRILL_WORDS_MAX){
      recentGrammarDrillWords.delete(recentGrammarDrillWords.values().next().value); // oudste (eerst toegevoegde) eruit
    }
  }
  const sys = `You create a SHORT, concrete example testing a given Turkish grammar topic, isolated to that one skill but applied PRACTICALLY (a real short sentence/phrase, never an abstract rule question, and NEVER a single bare inflected word with no surrounding context), using only the word(s) given to you for that call.
Randomly choose the test direction: en-tr (show the English version, ask for the Turkish translation) or tr-en (show the Turkish version, ask for the English translation).
If you use a possessive pronoun (benim/senin/onun/bizim/sizin/onların) before a noun, that noun ALWAYS needs its own possessive suffix too — the pronoun alone is never enough in Turkish, unlike English "my house" (e.g. "benim evim", NEVER bare "benim ev"; "benim ineğim" not "benim inek").
Write everything in English and Turkish ONLY — never any other language.
Respond in JSON.`;
  const level = pickSentenceComplexityLevel();
  const userMsg = `Topic: "${topic.label}" (${topic.hint})
Niveau: ${cefrLabel(level)}. ${cefrGuidance(level)}
${cfg.instr(...words, topic)}` + (correctionNote ? `\n\nNOTE: your previous attempt was rejected — ${correctionNote} Please get it right this time.` : "");
  const schema = {
    name: "grammar_drill",
    description: "Een geïsoleerde grammatica-oefening: een concrete zin/frase, geen abstracte regelvraag.",
    input_schema: {
      type: "object",
      properties: {
        direction: {type:"string", enum:["en-tr","tr-en"]},
        prompt: {type:"string", description:"De zin/frase die aan de gebruiker getoond wordt, in de taal die bij direction hoort."},
        correct: {type:"string", description:"De correcte vertaling in de andere taal."},
        baseWord: {type:"string", description:"Het/de gegeven woord(en), zoals gebruikt."},
      },
      required: ["direction","prompt","correct","baseWord"]
    }
  };
  const raw = await callAI("sentence", sys, userMsg, 2500, 0.5, schema);
  return parseAIJson(raw);
}

// Haalt de Turkse kant van een framework-drill op, ongeacht de gekozen richting -- nodig om 'm door
// checkSentenceNatural te kunnen halen (die verwacht altijd Turkse tekst).
function drillTurkishText(drill){
  return drill.direction === "tr-en" ? drill.prompt : drill.correct;
}
// SUFFIX-OEFENING: een woord dat de gebruiker al minstens 1x is TEGENGEKOMEN wordt vervoegd met een
// grammaticaal patroon dat de gebruiker ook al minstens 1x geoefend heeft. Puur woordniveau -- geen
// zin, geen context -- de gebruiker typt precies ÉÉN vervoegde Turkse vorm. Geen eigen scoresysteem
// meer (zie screen-suffixes): puur goed/fout, met een morfeem-opbouw als uitleg (zie "breakdown"
// hieronder) i.p.v. een niveau 0-10.
// BUGFIX: ontgrendelvereiste versoepeld van "BEHEERST" (level >= 7, voor zowel werkwoord als
// onderwerp) naar puur "TEGENGEKOMEN" (reps >= 1) -- bij een nog vrij nieuwe gebruiker bleef de pool
// met de oude, strenge drempel zo goed als altijd leeg (level 7 op EN een werkwoord EN een
// grammatica-onderwerp is een hoge lat), waardoor het tabblad wekenlang ontoegankelijk bleef. Net als
// bij masteredVerbsForSuffixDrill()/masteredTopicsForSuffixDrill() hieronder telt nu ook het
// ingestelde CEFR-bereik mee (voorheen ontbrak die check hier volledig) -- alleen de BOVENgrens: een
// allang-bekend, "te makkelijk" werkwoord/onderwerp is prima bruikbaar, alleen iets BOVEN je huidige
// bereik (nog niet relevant/te moeilijk) wordt geweerd.

// Zelfde opzet als masteredVerbsForSuffixDrill hierboven, maar dan voor zelfst. naamwoorden -- de
// suffixtrainer versuffixte voorheen ALLEEN werkwoorden; dit maakt naamwoord-achtervoegsels (meervoud,
// bezit, naamval, verkleinwoord, copula, ...) even goed oefenbaar.

// Kiest, binnen de pool van al-tegengekomen werkwoorden, bij VOORKEUR een al goed BEHEERST exemplaar
// (level >= SUFFIX_DRILL_PREFERRED_VERB_LEVEL) -- dat geeft een prettigere oefening (je hoeft niet ook
// nog aan het werkwoord zelf te twijfelen, alleen aan het grammaticapatroon). Is er nog geen enkel zo
// goed beheerst werkwoord, dan valt dit terug op de volledige pool.
export const SUFFIX_DRILL_PREFERRED_VERB_LEVEL = 7;

// Naamwoord-tegenhanger van pickSuffixDrillVerb() hierboven.

// BUGFIX: hierboven wordt ALTIJD een werkwoord vervoegd, dus alleen grammatica-onderwerpen die
// daadwerkelijk op een werkwoord toegepast worden (framework "verb"/"verb2" in
// GRAMMAR_TOPIC_FRAMEWORK) horen hier in aanmerking te komen. Voorheen ontbrak dit filter volledig --
// een beheerst NAAMWOORD-patroon (bv. meervoud, accusatief, verkleinwoord) kon dan alsnog gekozen
// worden en werd vervolgens geforceerd op een werkwoord toegepast, wat taalkundig onzin oplevert (een
// werkwoord heeft geen meervoud/naamval). Onderwerpen zonder framework-vermelding (de "rest"-categorie
// onderaan GRAMMAR_TOPIC_FRAMEWORK) worden voorzichtigheidshalve ook uitgesloten.
export const SUFFIX_DRILL_VERB_FRAMEWORKS = new Set(["verb", "verb2"]);

// Naamwoord-tegenhanger: alleen onderwerpen die daadwerkelijk op een LOS naamwoord landen (framework
// "noun" -- meervoud, bezit, naamval, verkleinwoord, copula, var/yok, ...), net zoals hierboven alleen
// "verb"/"verb2" meetelt voor werkwoorden.
export const SUFFIX_DRILL_NOUN_FRAMEWORKS = new Set(["noun"]);



function canOfferSuffixDrill(){
  return canOfferVerbSuffixDrill() || canOfferNounSuffixDrill();
}
// Kiest willekeurig tussen een werkwoord- en een naamwoord-suffixoefening -- alleen uit de soort(en)
// die daadwerkelijk beschikbaar zijn (zie canOfferVerbSuffixDrill/canOfferNounSuffixDrill).



// Naamwoord-tegenhanger van generateVerbSuffixDrill hierboven. Belangrijk verschil: veel naamwoord-
// patronen (m.n. de copula-groep: var/yok, copula_basic, isaret_zamirleri, ...) kunnen NIET als kaal,
// op zichzelf staand woord getoond worden -- die hebben een minimale zin/context nodig om natuurlijk te
// zijn (bv. "Kitap var." i.p.v. een geïsoleerd woord). Daarom vraagt dit een OPTIONELE korte
// contextzin aan de AI, met het te beoordelen doelwoord expliciet apart benoemd (targetWord +
// targetMeaning), zodat de gebruiker ALLEEN dat ene woord hoeft te vertalen/produceren -- niet de hele
// zin -- en dat woord in de UI onderstreept kan worden (zie renderSuffixPractice).


// Beoordeelt een suffix-antwoord: alleen goed/fout, GEEN algemene uitleg -- bij een fout antwoord
// specifiek het VERSCHIL met de eigen (foute) invoer, zodat de gebruiker precies ziet welk achtervoegsel
// ontbrak/verkeerd was, naast de morfeem-opbouw (breakdown) die hierboven al gegenereerd is.
// Werkt voor beide richtingen: bij "en-tr" (standaard) typt de gebruiker de Turkse vervoeging; bij
// "tr-en" wordt de Turkse vorm al getoond en typt de gebruiker de Engelse betekenis ervan -- dan wordt
// beoordeeld of de vertaling het juiste tijd/aspect/persoon van díe specifieke vorm correct weergeeft,
// niet of het exact dezelfde bewoording is als de oorspronkelijke Engelse aanwijzing.


async function generateGrammarDrill(topic, avoidEn){
  // BUGFIX: topic.key kan variant-gescoped zijn (bv. "hitap_bicimleri::titel", "ce_eki::gorus" --
  // zie effectiveTopicForVariant/variantProgressKey), maar GRAMMAR_TOPIC_FRAMEWORK is alleen op de
  // KALE topic-sleutel gevuld. Zonder deze strip faalde de lookup voor ELK onderwerp met varianten
  // zodra er een specifieke variant gekozen was, en viel de code stilzwijgend terug op het generieke
  // (niet-framework) pad -- dus de zorgvuldig gecureerde frameworks (bv. address_form, postpositions,
  // opinion_ce) werden voor die onderwerpen in de praktijk nooit gebruikt.
  const baseTopicKey = topic.key && topic.key.includes("::") ? topic.key.split("::")[0] : topic.key;
  const framework = GRAMMAR_TOPIC_FRAMEWORK[baseTopicKey];
  if(framework){
    let drill = await generateFrameworkDrillCandidate(topic, framework, undefined, avoidEn);
    let attempts = 1;
    // Structuurcheck (kale uitgang/metavraag/functiewoord) ÉN natuurlijkheidscheck (klinkt de zin echt
    // als iets een moedertaalspreker zou zeggen, i.p.v. een geforceerde combinatie van twee willekeurig
    // gekozen woorden -- zie de "kupadaki başarı"-klasse problemen die hiermee opgevangen worden,
    // ook voor topic-combinaties die niet apart met een eigen framework gecureerd zijn).
    while(attempts < 3 && (drillLooksInvalid(drill, []) || !(await checkSentenceNatural(drillTurkishText(drill))))){
      drill = await generateFrameworkDrillCandidate(topic, framework, "make sure it's a real short sentence/phrase using only the given word(s), never a bare suffix or standalone preposition/function word, and make sure the result sounds genuinely natural to a native speaker -- not a forced or nonsensical combination of the two given words.", avoidEn);
      attempts++;
    }
    return drill;
  }
  const baseWords = await pickGrammarDrillBaseWords();
  const wordList = baseWords.length ? baseWords.join(", ") : CHECKUP_DRILL_BASE_WORDS;
  let drill = await generateGrammarDrillCandidate(topic, wordList);
  let attempts = 1;
  while(drillLooksInvalid(drill, baseWords) && attempts < 3){
    const p = (drill.prompt || "").trim();
    const isBareSuffix = /-[a-zA-ZçğıöşüÇĞİÖŞÜ]{1,5}\b/.test(p) || /-[a-zA-ZçğıöşüÇĞİÖŞÜ]{1,5}\b/.test((drill.correct||""));
    const isMeta = /\bsuffix\b|\bwhat (does|is)\b/i.test(p);
    const isBareWord = BARE_FUNCTION_WORDS.has(p.toLowerCase().replace(/[.?!]/g,"")) || BARE_FUNCTION_WORDS.has((drill.correct||"").toLowerCase().replace(/[.?!]/g,""));
    let note;
    if(isBareSuffix || isMeta){
      note = "you asked a meta-question about the bare rule/suffix itself, or showed a bare suffix, instead of having the student translate a concrete word.";
    } else if(isBareWord){
      note = 'you used a bare, standalone preposition/function word with no surrounding phrase (e.g. just "to" or "from") — this must always be a full phrase like "on the table" or "next to him", testing the skill in actual use, never the isolated word alone.';
    } else {
      note = `you used the word "${drill.baseWord || drill.prompt}", which does not literally appear in the given word list — you likely re-translated an English gloss yourself instead of using the given Turkish word.`;
    }
    drill = await generateGrammarDrillCandidate(topic, wordList, note);
    attempts++;
  }
  return drill;
}



// Klik op het kale checkup/skill-practice-woord (alleen onderstreept als de vertaling lokaal bekend is):
// zelfde progressieve letterhint als peekCurrentWord() op het hoofdscherm -- 1e klik toont de eerste
// letter + puntjes, elke volgende klik voegt een letter toe, zonder de oefening te beëindigen. Telt al
// bij de eerste hint-letter bij de daadwerkelijke Check-actie linea recta als fout (SRS-terugval op de
// score die op dit moment achter dit woord zit).
function peekCheckupWord(){
  const state = skillPracticeState || checkupState;
  const cur = state && state.current;
  if(!cur || cur.type !== "word" || cur.sentenceDrill) return;
  const primary = cur.direction === "tr-en" ? baseEnOf(cur.en) : (cur.tr || (cachedTranslation(cur.en)||[])[0] || "");
  if(!primary) return;
  const letterCount = primary.replace(/\s/g, "").length;
  cur.hintLevel = Math.min(letterCount, (cur.hintLevel || 0) + 1);
  cur.peeked = true;
  const fullyRevealed = cur.hintLevel >= letterCount;
  el("checkup-peek-hint").textContent = "💡 " + maskWordForHint(primary, cur.hintLevel) + (fullyRevealed ? "" : "  (tap for another letter)");
  el("checkup-peek-hint").classList.remove("hidden");
  el("checkup-peek-hint").style.cursor = fullyRevealed ? "default" : "pointer";
  el("checkup-peek-hint").onclick = fullyRevealed ? null : peekCheckupWord;
  if(fullyRevealed){
    el("checkup-word").style.cursor = "default";
    el("checkup-word").style.textDecoration = "none";
    el("checkup-word").onclick = null;
  }
}

async function nextCheckupQuestion(){
  el("checkup-question-box").classList.remove("hidden");
  el("checkup-result-box").classList.add("hidden");
  el("checkup-answer-input").value = "";
  el("checkup-answer-input").disabled = true;
  el("btn-checkup-next").disabled = true;
  el("btn-checkup-reveal").classList.add("hidden");
  el("checkup-peek-hint").classList.add("hidden");
  el("checkup-peek-hint").textContent = "";
  el("checkup-peek-hint").onclick = null;
  setCheckupSpeakableTr(null); // default: pas expliciet weer aanzetten zodra er echt een los Turks woord getoond wordt

  if(checkupState.phase === "vocab"){
    el("checkup-modal-title").textContent = "📋 Knowledge Check — Vocabulary";
    const lvl = Math.min(17, checkupState.vocabLevel);
    el("checkup-progress").textContent = `Level ${cefrLabel(lvl)} · question ${checkupState.vocabLevelResults.length+1}/${CHECKUP_QUESTIONS_PER_VOCAB_LEVEL}`;
    el("checkup-word").textContent = "🤖 …";
    const pool = EN_WORDS_DATA.filter(w=>w.cefr===lvl);
    const poolAvoidingRecent = pool.filter(w => !recentCheckupVocabWords.has(w.en));
    const effectivePool = poolAvoidingRecent.length ? poolAvoidingRecent : pool; // niets meer over binnen dit niveau na uitsluiting -> toch maar herhalen, beter dan vastlopen
    const word = effectivePool.length ? effectivePool[Math.floor(Math.random()*effectivePool.length)] : EN_WORDS_DATA[Math.floor(Math.random()*EN_WORDS_DATA.length)];
    recentCheckupVocabWords.add(word.en);
    while(recentCheckupVocabWords.size > RECENT_CHECKUP_VOCAB_WORDS_MAX){
      recentCheckupVocabWords.delete(recentCheckupVocabWords.values().next().value); // oudste eruit
    }
    if(needsContextualDrill(word.en)){
      try{
        const drill = await generateContextualVocabDrill(word.en);
        checkupState.current = {type:"word", en: word.en, cefr: word.cefr, tr: null, direction: drill.direction, sentenceDrill: drill};
        el("checkup-word").textContent = drill.prompt;
        el("checkup-word").className = "tr-word sentence";
        el("checkup-word").style.textDecoration = "none";
        el("checkup-word").style.cursor = "default";
        el("checkup-word").onclick = null;
        el("checkup-answer-input").placeholder = drill.direction === "tr-en" ? "Type the English translation…" : "Type the Turkish translation…";
        checkupState.consecutiveFailures = 0; // gelukte generatie -> teller resetten
        persistCheckupState();
        el("checkup-answer-input").disabled = false;
        el("btn-checkup-next").disabled = false;
        el("btn-checkup-reveal").classList.remove("hidden");
        el("checkup-answer-input").focus();
        return;
      }catch(e){ /* generatie mislukt: val terug op de gewone, kale woordoefening hieronder (die zelf ook beveiligd is, zie try/catch eronder) */ }
    }
    // Zelfde robuuste aanpak als het grammatica-deel hieronder: resolveWordSense() kan in theorie
    // falen (bv. een netwerkfout bij een nog niet gecureerd woord) -- dat crashte voorheen de hele
    // kennischeck stilletjes, zonder enige verklaring ("wordt zomaar afgebroken"). Nu: 3x herkansen
    // met een ander woord, dan een duidelijke stopmelding i.p.v. een stille crash.
    try{
      const direction = resolveCheckupWordDirection();
      const sense = await resolveWordSense(word.en, direction);
      // tr-en-richting: apart, EIGEN progress-sleutel (net als het hoofdscherm) i.p.v. de gedeelde en-tr-
      // score van hetzelfde Engelse woord -- zie trWordsDataKeyFor.
      const progressKey = (sense && direction === "tr-en") ? (trWordsDataKeyFor(word.en) || word.en) : word.en;
      const trData = direction === "tr-en" ? trWordDataOf(progressKey) : null;
      checkupState.current = {type:"word", en: word.en, cefr: word.cefr, tr: sense ? sense.tr[0] : null, senseTr: sense ? sense.tr : null, gloss: sense ? sense.gloss : null, note: sense ? sense.note : null, direction: sense ? direction : "en-tr", progressKey};
      el("checkup-word").textContent = checkupState.current.direction === "tr-en" ? checkupState.current.tr : displayEnglishWord(checkupState.current.en);
      setCheckupSpeakableTr(checkupState.current.direction === "tr-en" ? checkupState.current.tr : null);
      if(checkupState.current.direction === "tr-en" && checkupState.current.tr) speakTurkish(checkupState.current.tr);
      el("checkup-word").className = "tr-word";
      checkupState.current.hintRevealed = false;
      checkupState.current.peeked = false;
      const knownCu = !!sense;
      if(knownCu){
        el("checkup-word").style.textDecoration = "underline";
        el("checkup-word").style.textDecorationStyle = "dotted";
        el("checkup-word").style.cursor = "pointer";
        el("checkup-word").onclick = peekCheckupWord;
      } else {
        el("checkup-word").style.textDecoration = "none";
        el("checkup-word").style.cursor = "default";
        el("checkup-word").onclick = null;
      }
      // Bij tr-en: EIGEN cefr/pos van de tr-en-entry tonen (kan afwijken van het en-tr-cefr van
      // hetzelfde Engelse woord), consistent met hoe het hoofdscherm dit al deed.
      if(trData){
        const posAbbr = WORD_CATEGORY_ABBR[trData.pos] || trData.pos || "";
        const cefrTxt = typeof trData.cefr === "number" ? cefrLabel(trData.cefr) : null;
        el("checkup-word-meta").textContent = [cefrTxt, posAbbr || null].filter(Boolean).join(" · ");
      } else {
        el("checkup-word-meta").textContent = wordMetaText(word.cefr, word.en, checkupState.current.note);
      }
      el("checkup-answer-input").placeholder = checkupState.current.direction === "tr-en" ? "Type the English translation…" : "Type the Turkish translation…";
      checkupState.consecutiveFailures = 0;
    }catch(e){
      checkupState.consecutiveFailures = (checkupState.consecutiveFailures || 0) + 1;
      if(checkupState.consecutiveFailures >= 3){
        el("checkup-word").textContent = "⚠️ Exercise generation kept failing (" + e.message + "). Stopping here for now — your progress so far is saved.";
        el("checkup-word").className = "tr-word";
        el("checkup-answer-input").disabled = true;
        el("btn-checkup-next").disabled = true;
        persistCheckupState();
        return;
      }
      persistCheckupState();
      await nextCheckupQuestion(); // ander woord proberen
      return;
    }
  } else {
    const topics = sortedGrammarTopicsByLevel();
    const topic = topics[Math.min(topics.length-1, checkupState.grammarTopicIdx)];
    el("checkup-modal-title").textContent = "📋 Knowledge Check — Grammar";
    el("checkup-progress").textContent = `${topic.label} · question ${checkupState.grammarTopicResults.length+1}/${CHECKUP_QUESTIONS_PER_GRAMMAR_TOPIC}`;
    el("checkup-word").textContent = "🤖 …";
    try{
      const drill = await generateGrammarDrill(topic, recentGrammarDrillWords);
      checkupState.current = {type:"grammar", topic, drill};
      checkupState.consecutiveFailures = 0; // gelukte generatie -> teller resetten
      el("checkup-word").textContent = drill.prompt;
      el("checkup-word").className = "tr-word sentence";
      el("checkup-word").style.textDecoration = "none";
      el("checkup-word").style.cursor = "default";
      el("checkup-word").onclick = null;
    }catch(e){
      checkupState.consecutiveFailures = (checkupState.consecutiveFailures || 0) + 1;
      if(checkupState.consecutiveFailures >= 3){
        // herhaaldelijk mislukt (bv. een structureel probleem, niet gewoon 1x pech) -> hier stoppen
        // i.p.v. stilletjes door alle resterende onderwerpen heen te blijven proberen, wat aanvoelt
        // als "vastlopen" zonder dat de gebruiker weet wat er aan de hand is.
        el("checkup-word").textContent = "⚠️ Exercise generation kept failing (" + e.message + "). Stopping here for now — your progress so far is saved.";
        el("checkup-word").className = "tr-word";
        el("checkup-answer-input").disabled = true;
        el("btn-checkup-next").disabled = true;
        persistCheckupState();
        return;
      }
      // generatie mislukt: sla dit hele onderwerp over zonder het mee te tellen (voorkomt vastlopen)
      checkupState.grammarTopicIdx++;
      checkupState.grammarTopicResults = [];
      persistCheckupState();
      await nextCheckupQuestion();
      return;
    }
    el("checkup-answer-input").placeholder = checkupState.current.drill.direction === "tr-en" ? "Type the English translation…" : "Type the Turkish translation…";
  }
  persistCheckupState();
  el("checkup-answer-input").disabled = false;
  el("btn-checkup-next").disabled = false;
  el("btn-checkup-reveal").classList.remove("hidden");
  el("checkup-answer-input").focus();
}

// Beoordeelt een woord- of sentence-drill-antwoord op het checkup/skill-practice-scherm -- voorheen had
// submitCheckupAnswer en submitSkillPracticeAnswer hier elk hun eigen, bijna woord-voor-woord identieke
// kopie van (stap 5, "en-tr en tr-en op één gedeelde abstractie"). Muteert zelf GEEN sessie-state (geen
// score/staircase/ronde-telling) -- dat blijft de eigen verantwoordelijkheid van elke aanroeper, alleen
// de daadwerkelijke beoordeling zelf is gedeeld. `cur.wordSource === "tr"` (een rechtstreeks tr-en-item
// uit de gemengde weak-words-pool) komt alleen via skill-practice voor, maar hoort inhoudelijk bij deze
// gedeelde beoordelingslogica, niet bij sessie-specifieke afhandeling.


// Stap 6 van het verbeterplan ("AI-fouten fail-safe i.p.v. fail-closed"): bij een AI-infrastructuurfout
// (na callAI's eigen 2 automatische herkansingen nog steeds mislukt) telt deze beurt NIET mee -- geen
// enkele score-mutatie, de vraag blijft gewoon staan, simpelweg opnieuw proberen. Gedeeld door
// submitCheckupAnswer/submitSkillPracticeAnswer (dezelfde checkup-*-DOM-elementen).
function handleAIUnavailableRetry(){
  el("checkup-answer-input").disabled = false;
  el("btn-checkup-next").disabled = false;
  if(hasLikelyPhysicalKeyboard()) el("checkup-answer-input").focus();
  alert("⚠️ Could not reach the AI to check your answer after retrying. This attempt doesn't count against you — please try Check again.");
}

async function submitCheckupAnswer(){
  const answer = el("checkup-answer-input").value.trim();
  el("btn-checkup-next").disabled = true;
  el("checkup-answer-input").disabled = true;
  el("btn-checkup-reveal").classList.add("hidden");
  const cur = checkupState.current;
  let correct = false;
  let correctAnswerTxt = "";

  let spokenTr = null; // welk specifiek Turks synoniem uitgesproken moet worden -- null = val terug op cur.tr
  if(cur.type === "word"){
    const g = await gradeCheckupWordAnswer(cur, answer);
    if(g.aiUnavailable){ handleAIUnavailableRetry(); return; }
    correct = g.correct; correctAnswerTxt = g.correctAnswerTxt; spokenTr = g.spokenTr;
    const scoreCorrect = cur.peeked ? false : correct;
    recordResult(cur.progressKey || cur.en, scoreCorrect, (cur.peeked && correct) ? hintPenaltySeverity(cur) : 1); // telt gewoon mee voor je normale voortgang op dat woord
    if(cur.direction === "en-tr" && cur.tr) setCheckupSpeakableTr(spokenTr || cur.tr);
    if(correct && cur.direction === "en-tr" && cur.tr) speakTurkish(spokenTr || cur.tr);
    checkupState.vocabLevelResults.push(scoreCorrect);
  } else {
    correctAnswerTxt = cur.drill.correct;
    let gAiUnavailable = false;
    if(answer && normalize(answer) === normalize(correctAnswerTxt)){
      correct = true;
    } else if(answer){
      try{
        const verdict = await gradeGrammarDrillAnswer(cur.drill, answer);
        correct = !!verdict.correct;
      }catch(e){ gAiUnavailable = true; }
    }
    if(gAiUnavailable){ handleAIUnavailableRetry(); return; }
    recordGrammarResult(cur.topic.key, correct);
    checkupState.grammarTopicResults.push(correct);
  }

  el("checkup-question-box").classList.add("hidden");
  el("checkup-result-box").classList.remove("hidden");
  el("checkup-result-text").className = "feedback " + (correct ? "correct" : "wrong");
  playFeedbackSound(correct ? "correct" : "wrong");
  const promptShown = cur.type === "word"
    ? (cur.sentenceDrill ? cur.sentenceDrill.prompt : (cur.direction === "tr-en" ? cur.tr : displayEnglishWord(cur.en)))
    : cur.drill.prompt;
  el("checkup-result-text").innerHTML = `<div class="muted" style="margin-bottom:6px;">${escapeHtml(promptShown)}</div>` +
    (correct ? "✅ Correct!" + (cur.peeked ? " <span class='muted'>(still counted as a miss since you used a hint)</span>" : "") : (answer ? "❌ Not quite.<br>" : "") + `Correct answer: <b>${escapeHtml(correctAnswerTxt)}</b>`);

  advanceCheckupStaircase();
  persistCheckupState();
  el("btn-checkup-close").textContent = checkupState.phase === "done" ? "See results" : "Continue";
  el("checkup-answer-input").disabled = false; // opnieuw inschakelen zodat Enter (-> volgende) blijft werken
  if(hasLikelyPhysicalKeyboard()) el("checkup-answer-input").focus(); // alleen auto-focus bij laptop/desktop, niet bij touch
}

/* Bepaalt of het huidige niveau/onderwerp-batch compleet is, en zo ja: of de trap omhoog gaat (batch
   geslaagd, ≥60%), van vocabulaire naar grammatica overschakelt, of helemaal stopt (batch gezakt).
   Bij een geslaagde batch wordt het cijfer van de betrokken woorden/het onderwerp op 7 gezet (als dat
   nog lager stond) -- de kennischeck dient ter INDICATIE, geen vervanging van echte oefening tot 8-10.
   Puur state-berekening, toont zelf nog geen nieuwe vraag (dat gebeurt pas na de klik op "Continue"). */
const CHECKUP_PASS_LEVEL = 7;
function advanceCheckupStaircase(){
  const cur = checkupState.current;
  if(cur.type === "word"){
    if(checkupState.vocabLevelResults.length >= CHECKUP_QUESTIONS_PER_VOCAB_LEVEL){
      const pct = 100 * checkupState.vocabLevelResults.filter(Boolean).length / checkupState.vocabLevelResults.length;
      if(pct >= CHECKUP_LEVEL_PASS_THRESHOLD){
        checkupState.vocabCeiling = Math.min(17, checkupState.vocabLevel); // dit niveau is nu met genoeg vragen bevestigd
        for(const w of EN_WORDS_DATA.filter(w=>w.cefr===checkupState.vocabLevel)){
          const p = getProgress(w.en);
          if(p.level < CHECKUP_PASS_LEVEL) p.level = CHECKUP_PASS_LEVEL;
        }
        saveJSON(LS_PROGRESS, progress);
        checkupState.vocabLevel++;
        checkupState.vocabLevelResults = [];
        if(checkupState.vocabLevel > 17) checkupState.phase = "grammar";
      } else {
        checkupState.phase = "grammar"; // dit niveau-batch gezakt -> sectie stopt; ceiling blijft het laatst BEVESTIGDE niveau (kan -1 zijn)
      }
    }
  } else {
    const topics = sortedGrammarTopicsByLevel();
    if(checkupState.grammarTopicResults.length >= CHECKUP_QUESTIONS_PER_GRAMMAR_TOPIC){
      const pct = 100 * checkupState.grammarTopicResults.filter(Boolean).length / checkupState.grammarTopicResults.length;
      const topic = topics[Math.min(topics.length-1, checkupState.grammarTopicIdx)];
      if(pct >= CHECKUP_LEVEL_PASS_THRESHOLD){
        checkupState.grammarCeiling = topic.minCefr; // dit onderwerp is nu met genoeg vragen bevestigd
        // Zet de vloer op ELKE variant van dit onderwerp, niet alleen de basissleutel -- anders ziet de
        // gewone oefenlogica (die per variant leest) deze checkup-bevestiging niet.
        for(const v of getTopicVariants(topic)){
          const gp = getGrammarProgress(variantProgressKey(topic, v.id));
          if(gp.level < CHECKUP_PASS_LEVEL) gp.level = CHECKUP_PASS_LEVEL;
        }
        saveJSON(LS_GRAMMAR, grammar);
        checkupState.grammarTopicIdx++;
        checkupState.grammarTopicResults = [];
        if(checkupState.grammarTopicIdx >= topics.length) checkupState.phase = "done";
      } else {
        checkupState.phase = "done"; // dit onderwerp-batch gezakt -> hele check stopt; ceiling blijft het laatst BEVESTIGDE onderwerp
      }
    }
  }
}

async function checkupContinue(){
  if(!checkupState) return;
  if(checkupState.phase === "done"){
    finishCheckup();
  } else {
    await nextCheckupQuestion();
  }
}

function finishCheckup(){
  const vc = checkupState.vocabCeiling >= 0 ? checkupState.vocabCeiling : 17;
  const gc = checkupState.grammarCeiling >= 0 ? checkupState.grammarCeiling : 17;
  // De 7-waardering per geslaagd niveau/onderwerp is al gebeurd tijdens de trap zelf (zie
  // advanceCheckupStaircase) -- hier dus alleen nog een samenvatting tonen.
  el("checkup-question-box").classList.add("hidden");
  el("checkup-result-box").classList.remove("hidden");
  el("checkup-result-text").className = "feedback correct";
  el("checkup-result-text").innerHTML = `<b>Knowledge check complete!</b><br>` +
    `Vocabulary ceiling: <b>${cefrLabel(vc)}</b><br>` +
    `Grammar ceiling: <b>${cefrLabel(gc)}</b><br><br>` +
    `📊 Everything you passed has been rated <b>${CHECKUP_PASS_LEVEL}/10</b> as an indication — keep practising to build it up further.`;
  el("btn-checkup-close").textContent = "Close";
  checkupState = null;
  persistCheckupState();
  // De rest van de interface expliciet verversen: zonder dit bleef bv. de Course-tab (als die al open
  // stond vóór de check) de oude, verouderde vergrendel-status tonen, ook al was de data zelf al bijgewerkt.
  renderCourseTab();
  currentItem = null; // forceert dat de eerstvolgende oefening het nieuw ontgrendelde bereik gebruikt
  syncMaybePush(); // meteen (gedebouncet) naar de cloud, i.p.v. te wachten tot de volgende willekeurige save
}

function cancelCheckup(){
  checkupState = null;
  persistCheckupState();
  el("modal-checkup").classList.add("hidden");
}

/* ===================== "PRACTICE THIS SKILL" (gerichte sessie op precies 1 les) =====================
   Hergebruikt dezelfde modal en dezelfde onderliggende oefen-generatie als de kennischeck, maar:
   - blijft op ÉÉN vaste les/onderwerp (geen trap door opeenvolgende niveaus)
   - werkt in afgebakende rondes van 10 oefeningen; de score van de laatst afgeronde ronde wordt
     opgeslagen en als "x/10" bij de les getoond (zie lastSkillPracticeScore hieronder)
   - heeft geen effect op lessen ontgrendelen — puur extra herhaling op verzoek */
const SKILL_PRACTICE_ROUND_SIZE = 10;

let lastSkillPracticeScore = loadJSON(LS_SKILL_SCORES, {}); // { [lessonId]: {correct, total} } -- score van de laatst afgeronde ronde

async function startSkillPractice(lesson){
  if(!hasKeyFor("word") || !hasKeyFor("sentence")){ alert("Both a " + keyNameFor("word") + " and a " + keyNameFor("sentence") + " API key are needed to practise (Settings)."); return; }
  recentGrammarDrillWords = new Set(); // nieuwe sessie -> geen woorden van een vorige sessie meer vermijden
  skillPracticeState = {lesson, roundResults: [], current: null};
  el("modal-lesson").classList.add("hidden");
  el("modal-checkup").classList.remove("hidden");
  await nextSkillPracticeQuestion();
}

/* Kiest een woord UIT een specifieke les volgens spaced repetition, i.p.v. willekeurig -- voorkomt dat
   dezelfde paar woorden steeds terugkomen voordat de rest van de les ook maar één keer gezien is. */
function pickSkillPracticeWord(words){
  const now = Date.now();
  // 1. voorkeur: woorden uit deze les die nog nooit getest zijn (garandeert volledige dekking eerst)
  const untested = words.filter(en => getProgress(en).reps === 0);
  if(untested.length) return untested[Math.floor(Math.random()*untested.length)];
  // 2. anders: woorden die nu due zijn (hun herhalingsmoment is verstreken), laagste niveau eerst
  const due = words.filter(en => getProgress(en).due <= now);
  if(due.length){
    const minLevel = Math.min(...due.map(en=>getProgress(en).level));
    const lowest = due.filter(en=>getProgress(en).level === minLevel);
    return lowest[Math.floor(Math.random()*lowest.length)];
  }
  // 3. niets is nu due: pak het woord dat het eerst weer aan de beurt is
  return [...words].sort((a,b)=>getProgress(a).due - getProgress(b).due)[0];
}

/* Zelfde spaced-repetition-keuzelogica als pickSkillPracticeWord hierboven, maar dan op volledige
   entry-objecten ({key, source, trData?, ...} zoals getWeakestWords() teruggeeft) i.p.v. kale Engelse
   woorden -- nodig omdat een tr-en-item zijn EIGEN "trword:"-progress-sleutel heeft, niet een Engelse. */
function pickSkillPracticeEntry(entries){
  const now = Date.now();
  const untested = entries.filter(w => getProgress(w.key).reps === 0);
  if(untested.length) return untested[Math.floor(Math.random()*untested.length)];
  const due = entries.filter(w => getProgress(w.key).due <= now);
  if(due.length){
    const minLevel = Math.min(...due.map(w=>getProgress(w.key).level));
    const lowest = due.filter(w=>getProgress(w.key).level === minLevel);
    return lowest[Math.floor(Math.random()*lowest.length)];
  }
  return [...entries].sort((a,b)=>getProgress(a.key).due - getProgress(b.key).due)[0];
}

async function nextSkillPracticeQuestion(){
  el("checkup-question-box").classList.remove("hidden");
  el("checkup-result-box").classList.add("hidden");
  el("checkup-answer-input").value = "";
  el("checkup-answer-input").disabled = true;
  el("btn-checkup-next").disabled = true;
  el("btn-checkup-reveal").classList.add("hidden");
  el("checkup-peek-hint").classList.add("hidden");
  el("checkup-peek-hint").textContent = "";
  el("checkup-peek-hint").onclick = null;
  setCheckupSpeakableTr(null); // default: pas expliciet weer aanzetten zodra er echt een los Turks woord getoond wordt
  el("btn-checkup-skip").classList.remove("hidden");
  el("checkup-explanation-box").classList.add("hidden");
  el("checkup-post-actions").classList.add("hidden");
  const lesson = skillPracticeState.lesson;

  el("checkup-modal-title").textContent = `🎯 Practice: ${lesson.title}`;
  el("checkup-progress").textContent = `Question ${skillPracticeState.roundResults.length+1}/${SKILL_PRACTICE_ROUND_SIZE}`;
  el("checkup-word").textContent = "🤖 …";
  el("checkup-word-meta").textContent = "";
  const badgeEl = el("checkup-badge");
  badgeEl.classList.remove("hidden");

  if(lesson.wordEntries && lesson.wordEntries.length){
    const entry = pickSkillPracticeEntry(lesson.wordEntries);
    badgeEl.textContent = "word"; badgeEl.className = "badge badge-word";
    if(entry.source === "tr"){
      // Rechtstreeks tr-en-item (EIGEN "trword:"-sleutel, onafhankelijke SRS-score) -- geen omweg via
      // een Engelse sleutel of REVERSE_TR_INDEX-flip nodig, we hebben de trData al compleet.
      const trData = entry.trData;
      skillPracticeState.current = {type:"word", wordSource:"tr", en: trData.en, tr: trData.tr, note: trData.note, trData, direction:"tr-en", progressKey: entry.key};
      el("checkup-word").textContent = trData.tr;
      setCheckupSpeakableTr(trData.tr);
      speakTurkish(trData.tr);
      el("checkup-word").className = "tr-word";
      // Net als op het hoofd-oefenscherm: tr-en-woorden komen altijd uit de eigen gecureerde
      // TR_WORDS_DATA (dus de Engelse vertaling is altijd bekend) -- peekCheckupWord ondersteunt de
      // tr-en-richting al generiek (via cur.direction/baseEnOf(cur.en)), dus gewoon aansluiten.
      el("checkup-word").style.textDecoration = "underline";
      el("checkup-word").style.textDecorationStyle = "dotted";
      el("checkup-word").style.cursor = "pointer";
      el("checkup-word").onclick = peekCheckupWord;
      skillPracticeState.current.hintRevealed = false;
      skillPracticeState.current.peeked = false;
      const posAbbr = WORD_CATEGORY_ABBR[trData.pos] || trData.pos || "";
      const cefrTxt = typeof trData.cefr === "number" ? cefrLabel(trData.cefr) : null;
      const noteTxt = trData.note ? (/^\(.*\)$/.test(trData.note.trim()) ? trData.note.trim() : `(${trData.note.trim()})`) : null;
      el("checkup-word-meta").textContent = [cefrTxt, noteTxt || (posAbbr || null)].filter(Boolean).join(" · ");
      el("checkup-answer-input").placeholder = "Type the English translation…";
    } else {
      // Gewoon een en-tr-item -- zelfde afhandeling als de reguliere lesson.words-tak hieronder, alleen
      // met de vaste richting "en-tr" (dit is expliciet de en-tr-helft van de zwakste-woorden-lijst;
      // resolveCheckupWordDirection zou 'm alsnog naar tr-en kunnen omflippen, wat hier niet de bedoeling is).
      const en = entry.key;
      const sense = await resolveWordSense(en, "en-tr");
      skillPracticeState.current = {type:"word", en, tr: sense ? sense.tr[0] : null, senseTr: sense ? sense.tr : null, gloss: sense ? sense.gloss : null, note: sense ? sense.note : null, direction: "en-tr", progressKey: en};
      el("checkup-word").textContent = displayEnglishWord(en);
      el("checkup-word").className = "tr-word";
      setCheckupSpeakableTr(null); // en-tr: pas na het beoordelen bekend
      skillPracticeState.current.hintRevealed = false;
      skillPracticeState.current.peeked = false;
      if(sense){
        el("checkup-word").style.textDecoration = "underline";
        el("checkup-word").style.textDecorationStyle = "dotted";
        el("checkup-word").style.cursor = "pointer";
        el("checkup-word").onclick = peekCheckupWord;
      } else {
        el("checkup-word").style.textDecoration = "none";
        el("checkup-word").style.cursor = "default";
        el("checkup-word").onclick = null;
      }
      el("checkup-word-meta").textContent = wordMetaText(wordCefrOf(en), en, skillPracticeState.current.note);
      el("checkup-answer-input").placeholder = "Type the Turkish translation…";
    }
    el("checkup-answer-input").disabled = false;
    el("btn-checkup-next").disabled = false;
    el("btn-checkup-reveal").classList.remove("hidden");
    el("checkup-answer-input").focus();
    return;
  }

  if(lesson.words && lesson.words.length){
    const en = pickSkillPracticeWord(lesson.words);
    badgeEl.textContent = "word"; badgeEl.className = "badge badge-word";
    if(needsContextualDrill(en) || lesson.title.startsWith("Prepositions")){
      // voorzetsel-vocabulaire is inherent relationeel (bv. "under" = "altında", zelf al een naamval-
      // constructie) -- als kaal woordpaar getoetst herhaalt dat precies het "geïsoleerd, niet in gebruik"
      // probleem, nu op vocabulaire-niveau. Dus: verpak 'm in een kort zinnetje, net als bij de grammatica-frameworks.
      try{
        const drill = await generateContextualVocabDrill(en);
        skillPracticeState.current = {type:"word", en, tr: null, direction: drill.direction, sentenceDrill: drill};
        el("checkup-word").textContent = drill.prompt;
        el("checkup-word").className = "tr-word sentence";
        el("checkup-word").style.textDecoration = "none";
        el("checkup-word").style.cursor = "default";
        el("checkup-word").onclick = null;
        el("checkup-answer-input").placeholder = drill.direction === "tr-en" ? "Type the English translation…" : "Type the Turkish translation…";
        el("checkup-answer-input").disabled = false;
        el("btn-checkup-next").disabled = false;
        el("btn-checkup-reveal").classList.remove("hidden");
        el("checkup-answer-input").focus();
        return;
      }catch(e){ /* generatie mislukt: val terug op de gewone, kale woordoefening hieronder */ }
    }
    const direction = resolveCheckupWordDirection();
    const sense = await resolveWordSense(en, direction);
    const progressKey = (sense && direction === "tr-en") ? (trWordsDataKeyFor(en) || en) : en;
    const trData = direction === "tr-en" ? trWordDataOf(progressKey) : null;
    skillPracticeState.current = {type:"word", en, tr: sense ? sense.tr[0] : null, senseTr: sense ? sense.tr : null, gloss: sense ? sense.gloss : null, note: sense ? sense.note : null, direction: sense ? direction : "en-tr", progressKey};
    el("checkup-word").textContent = skillPracticeState.current.direction === "tr-en" ? skillPracticeState.current.tr : displayEnglishWord(en);
    setCheckupSpeakableTr(skillPracticeState.current.direction === "tr-en" ? skillPracticeState.current.tr : null);
    if(skillPracticeState.current.direction === "tr-en" && skillPracticeState.current.tr) speakTurkish(skillPracticeState.current.tr);
    el("checkup-word").className = "tr-word";
    skillPracticeState.current.hintRevealed = false;
    skillPracticeState.current.peeked = false;
    if(sense){
      el("checkup-word").style.textDecoration = "underline";
      el("checkup-word").style.textDecorationStyle = "dotted";
      el("checkup-word").style.cursor = "pointer";
      el("checkup-word").onclick = peekCheckupWord;
    } else {
      el("checkup-word").style.textDecoration = "none";
      el("checkup-word").style.cursor = "default";
      el("checkup-word").onclick = null;
    }
    if(trData){
      const posAbbr = WORD_CATEGORY_ABBR[trData.pos] || trData.pos || "";
      const cefrTxt = typeof trData.cefr === "number" ? cefrLabel(trData.cefr) : null;
      el("checkup-word-meta").textContent = [cefrTxt, posAbbr || null].filter(Boolean).join(" · ");
    } else {
      el("checkup-word-meta").textContent = wordMetaText(wordCefrOf(en), en, skillPracticeState.current.note);
    }
    el("checkup-answer-input").placeholder = skillPracticeState.current.direction === "tr-en" ? "Type the English translation…" : "Type the Turkish translation…";
  } else {
    badgeEl.textContent = "grammar"; badgeEl.className = "badge badge-sentence";
    // BUGFIX: voorheen werd hier de KALE topic (zonder variant) gebruikt. Voor onderwerpen met een
    // `variants`-array (bv. hitap_bicimleri: titel/diminutief/register) betekende dat: (1) de oefening
    // testte altijd hetzelfde ene ding (zie address_form hierboven), en (2) het resultaat werd
    // opgeslagen onder de kale sleutel ("hitap_bicimleri"), terwijl het cijfer van de les
    // (lessonProficiency) het MINIMUM leest over de variant-sleutels ("hitap_bicimleri::titel" etc.) --
    // die bleven dus altijd op 0 staan, wat maakte dat de score van zo'n les nooit vooruitging, hoeveel
    // je ook oefende. Door hier -- net als elders in de app -- de zwakst-beoefende variant te kiezen,
    // testen we de juiste vorm EN slaat het resultaat op onder de sleutel die het cijfer ook echt leest.
    const baseTopic = grammarTopicByKey(lesson.grammarTopics[0]);
    const topic = effectiveTopicForVariant(baseTopic, pickWeakestVariant(baseTopic));
    try{
      const drill = await generateGrammarDrill(topic, recentGrammarDrillWords);
      skillPracticeState.current = {type:"grammar", topic, drill};
      el("checkup-word").textContent = drill.prompt;
      el("checkup-word").className = "tr-word sentence";
      el("checkup-word").style.textDecoration = "none";
      el("checkup-word").style.cursor = "default";
      el("checkup-word").onclick = null;
    }catch(e){
      el("checkup-word").textContent = "⚠️ Could not generate an exercise: " + e.message;
      el("btn-checkup-next").disabled = true;
      return;
    }
    el("checkup-answer-input").placeholder = skillPracticeState.current.drill.direction === "tr-en" ? "Type the English translation…" : "Type the Turkish translation…";
  }
  el("checkup-answer-input").disabled = false;
  el("btn-checkup-next").disabled = false;
  el("btn-checkup-reveal").classList.remove("hidden");
  el("checkup-answer-input").focus();
}

async function submitSkillPracticeAnswer(){
  const answer = el("checkup-answer-input").value.trim();
  el("btn-checkup-next").disabled = true;
  el("checkup-answer-input").disabled = true;
  el("btn-checkup-reveal").classList.add("hidden");
  el("btn-checkup-skip").classList.add("hidden");
  const cur = skillPracticeState.current;
  let correct = false;
  let correctAnswerTxt = "";
  let uitleg = "";
  let spokenTr = null; // welk specifiek Turks synoniem uitgesproken moet worden -- null = val terug op cur.tr

  if(cur.type === "word"){
    const g = await gradeCheckupWordAnswer(cur, answer);
    if(g.aiUnavailable){ handleAIUnavailableRetry(); return; }
    correct = g.correct; correctAnswerTxt = g.correctAnswerTxt; uitleg = g.uitleg; spokenTr = g.spokenTr;
    const scoreCorrect = cur.peeked ? false : correct;
    recordResult(cur.progressKey || cur.en, scoreCorrect, (cur.peeked && correct) ? hintPenaltySeverity(cur) : 1);
    if(cur.direction === "en-tr" && cur.tr) setCheckupSpeakableTr(spokenTr || cur.tr);
    if(correct && cur.direction === "en-tr" && cur.tr) speakTurkish(spokenTr || cur.tr);
    chatItem = {type:"word", en:cur.en, tr:cur.tr || correctAnswerTxt, direction:cur.direction};
  } else {
    correctAnswerTxt = cur.drill.correct;
    let gAiUnavailable = false;
    if(answer && normalize(answer) === normalize(correctAnswerTxt)){
      correct = true;
    } else if(answer){
      try{ const v = await gradeGrammarDrillAnswer(cur.drill, answer); correct = !!v.correct; uitleg = v.uitleg || ""; }catch(e){ gAiUnavailable = true; }
    }
    if(gAiUnavailable){ handleAIUnavailableRetry(); return; }
    recordGrammarResult(cur.topic.key, correct);
    chatItem = {type:"word", tr:cur.drill.correct, en:cur.drill.prompt, direction:cur.drill.direction};
  }
  const scoreCorrect = cur.type === "word" && !cur.sentenceDrill ? (cur.peeked ? false : correct) : correct;
  skillPracticeState.roundResults.push(scoreCorrect);
  skillPracticeState.lastAnswer = {answer, correctAnswerTxt};

  // de opgave-tekst die getoond werd, zodat je 'm terugziet in de feedback (niet alleen je eigen antwoord)
  const promptShown = cur.type === "word"
    ? (cur.sentenceDrill ? cur.sentenceDrill.prompt : (cur.direction === "tr-en" ? cur.tr : displayEnglishWord(cur.en)))
    : cur.drill.prompt;

  el("checkup-question-box").classList.add("hidden");
  el("checkup-result-box").classList.remove("hidden");
  el("checkup-result-text").className = "feedback " + (correct ? "correct" : "wrong");
  playFeedbackSound(correct ? "correct" : "wrong");

  let extra = "";
  let roundJustCompleted = false;
  // De "weakest words"-sessie (25/50/100 slechtste woorden) is geen echte les en krijgt bewust geen
  // eigen lescijfer -- de afzonderlijke woorden erin worden via recordResult() hierboven wél gewoon
  // hoger of lager gewaardeerd op basis van het gegeven antwoord.
  const isWeakWordsSession = skillPracticeState.lesson.id === "weak-words-session";
  if(skillPracticeState.roundResults.length >= SKILL_PRACTICE_ROUND_SIZE){
    const roundCorrect = skillPracticeState.roundResults.filter(Boolean).length;
    if(!isWeakWordsSession){
      lastSkillPracticeScore[skillPracticeState.lesson.id] = {correct: roundCorrect, total: SKILL_PRACTICE_ROUND_SIZE};
      saveJSON(LS_SKILL_SCORES, lastSkillPracticeScore);
    }
    skillPracticeState.roundResults = [];
    roundJustCompleted = true;
    extra = isWeakWordsSession
      ? `<br><br>📊 <b>Round complete: ${roundCorrect}/${SKILL_PRACTICE_ROUND_SIZE} correct.</b>`
      : `<br><br>📊 <b>Round complete: ${roundCorrect}/${SKILL_PRACTICE_ROUND_SIZE} correct.</b> Saved as this lesson's score.`;
  }
  skillPracticeState.roundJustCompleted = roundJustCompleted;
  el("checkup-result-text").innerHTML = `<div class="muted" style="margin-bottom:6px;">${escapeHtml(promptShown)}</div>` +
    (correct ? "✅ Correct!" + (cur.peeked ? " <span class='muted'>(still counted as a miss since you used a hint)</span>" : "") : (answer ? "❌ Not quite.<br>" : "") + `Correct answer: <b>${escapeHtml(correctAnswerTxt)}</b>`) + extra;
  el("btn-checkup-close").textContent = roundJustCompleted ? "OK" : "Continue";
  el("checkup-answer-input").disabled = false; // opnieuw inschakelen zodat Enter (-> volgende) blijft werken, net als het hoofdscherm
  if(hasLikelyPhysicalKeyboard()) el("checkup-answer-input").focus(); // alleen auto-focus bij laptop/desktop, niet bij touch

  // dezelfde post-actions als het reguliere oefenscherm: uitleg, vraag-aan-AI, dispuut
  el("checkup-post-actions").classList.remove("hidden");
  el("btn-checkup-ask-ai").classList.remove("hidden");
  el("btn-checkup-dispute").classList.toggle("hidden", !!correct);
  if(uitleg){
    el("checkup-explanation-box").textContent = "💬 " + uitleg;
    el("btn-checkup-show-explanation").classList.remove("hidden");
  } else {
    el("checkup-explanation-box").classList.add("hidden");
    el("btn-checkup-show-explanation").classList.add("hidden");
  }
}

function toggleSkillPracticeExplanation(){
  el("checkup-explanation-box").classList.toggle("hidden");
}

async function skipSkillPracticeQuestion(){
  const cur = skillPracticeState.current;
  if(!cur) return;
  if(cur.type === "word") recordResult(cur.progressKey || cur.en, false);
  else recordGrammarResult(cur.topic.key, false);
  skillPracticeState.roundResults.push(false);
  if(skillPracticeState.roundResults.length >= SKILL_PRACTICE_ROUND_SIZE){
    const roundCorrect = skillPracticeState.roundResults.filter(Boolean).length;
    if(skillPracticeState.lesson.id !== "weak-words-session"){
      lastSkillPracticeScore[skillPracticeState.lesson.id] = {correct: roundCorrect, total: SKILL_PRACTICE_ROUND_SIZE};
      saveJSON(LS_SKILL_SCORES, lastSkillPracticeScore);
    }
    skillPracticeState.roundResults = [];
  }
  await nextSkillPracticeQuestion();
}

async function disputeSkillPracticeAnswer(){
  const cur = skillPracticeState.current;
  const {answer, correctAnswerTxt} = skillPracticeState.lastAnswer || {};
  if(!cur || !answer) return;
  el("btn-checkup-dispute").disabled = true;
  el("checkup-result-text").className = "feedback pending";
  el("checkup-result-text").innerHTML = "🤖 AI is critically re-checking your answer…";
  try{
    let correct, uitleg = "";
    if(cur.type === "word"){
      const drill = cur.sentenceDrill;
      if(drill){ const v = await gradeGrammarDrillAnswer(drill, answer); correct = !!v.correct; uitleg = v.uitleg || ""; }
      else { const v = await askDeepSeekJudge({en:cur.en, tr:cur.tr, direction:cur.direction, senseTr:cur.senseTr, gloss:cur.gloss}, answer, true); correct = !!v.correct; uitleg = v.uitleg || ""; }
      if(correct) recordResult(cur.progressKey || cur.en, true);
    } else {
      const v = await gradeGrammarDrillAnswer(cur.drill, answer);
      correct = !!v.correct; uitleg = v.uitleg || "";
      if(correct) recordGrammarResult(cur.topic.key, true);
    }
    el("checkup-result-text").className = "feedback " + (correct ? "correct" : "wrong");
  playFeedbackSound(correct ? "correct" : "wrong");
    el("checkup-result-text").innerHTML = correct
      ? "🔁 ✅<br>Score restored."
      : `🔁 ❌<br>Still incorrect. Correct answer: <b>${escapeHtml(correctAnswerTxt)}</b>`;
    if(uitleg){
      el("checkup-explanation-box").textContent = "💬 " + uitleg;
      el("checkup-explanation-box").classList.remove("hidden");
      el("btn-checkup-show-explanation").classList.remove("hidden");
    }
    el("btn-checkup-dispute").classList.add("hidden");
  }catch(e){
    el("checkup-result-text").className = "feedback wrong";
    el("checkup-result-text").innerHTML = "⚠️ Could not reach the AI: " + escapeHtml(e.message);
  }
  el("btn-checkup-dispute").disabled = false;
}

function skillPracticeContinueOrClose(){
  if(skillPracticeState.roundJustCompleted){
    skillPracticeState = null;
    el("modal-checkup").classList.add("hidden");
    renderCourseTab();
    return;
  }
  nextSkillPracticeQuestion();
}

/* Centrale plek voor lesvoortgang bijwerken na een oefening (correct, fout, overgeslagen of leeg) —
   hergebruikt door alle antwoordpaden zodat er geen losse, uiteenlopende kopieën meer bestaan. */
const LESSON_ACCURACY_THRESHOLD = 60; // % — woorden/onderwerp moeten dit gemiddelde niveau (als %) halen, niet alleen "geprobeerd" zijn

function advanceLessonSession(){
  // Beide sporen onafhankelijk checken -- een enkele oefening kan het vocabulaire-spoor, het
  // grammatica-spoor, of allebei (bij een zin/vraag die zowel een doelwoord als een grammatica-
  // onderwerp raakt) laten vorderen. Beide checks zijn veilig om altijd allebei uit te voeren: een
  // spoor dat niet relevant geraakt is door deze oefening is simpelweg nog niet klaar, dus er gebeurt niets.
  return advanceTrackSession("vocab") + advanceTrackSession("grammar");
}

function advanceTrackSession(track){
  const idx = currentTrackIndex(track);
  const list = trackListOf(track);
  const l = list[idx];
  if(!l || isLessonCompleted(l.id)) return "";
  let done = false;
  if(l.words && l.words.length){
    const attempted = l.words.filter(en => getProgress(en).reps > 0);
    done = attempted.length >= l.words.length;
  } else if(l.grammarTopics && l.grammarTopics.length){
    const topic = grammarTopicByKey(l.grammarTopics[0]);
    // Voltooid vereist nu ZOWEL genoeg herhalingen in totaal ALS dat elke variant (bu/şu/o e.d.)
    // level 10 heeft gehaald -- niet langer alleen een totaal-repscore over het onderwerp als geheel.
    const tp = getTopicProgress(topic);
    done = tp.reps >= l.targetExercises && tp.level >= 10;
  } else {
    return ""; // pure leesles: geen eigen oefenstof
  }
  if(done) markLessonComplete(l.id); // stille bijhouding -- voortgang is al zichtbaar via het 0-10-cijfer, geen apart bericht meer nodig
  return "";
}

/* ===================== ADAPTIEVE MOEILIJKHEIDSGRAAD ===================== */
// Houdt een schuivend venster van de laatste ADAPTIVE_WINDOW_SIZE reguliere oefeningen bij (dus NIET
// tijdens een les- of kennischeck-sessie, want die zijn doelbewust op iets anders gericht dan "hoe
// moeilijk moet het algemene niveau nu zijn"). Zodra het venster vol is, wordt het percentage vergeleken
// met de ingestelde streefwaarde ± een hysteresemarge, zodat het niveau niet heen-en-weer schiet
// rond de grenswaarde. Bij een aanpassing wordt het venster geleegd (natuurlijke afkoelperiode).
const ADAPTIVE_WINDOW_SIZE = 10;
const ADAPTIVE_HYSTERESIS = 10; // procentpunten boven/onder de streefwaarde voordat er iets verandert

function recordAdaptiveResult(correct){
  if(!settings.adaptiveEnabled) return "";
  // (de kennischeck loopt tegenwoordig in een eigen modal, dus hoeft hier niet meer uitgesloten te worden)
  adaptiveWindow.push(!!correct);
  if(adaptiveWindow.length > ADAPTIVE_WINDOW_SIZE) adaptiveWindow.shift();
  saveJSON(LS_ADAPTIVE_WINDOW, adaptiveWindow);
  if(document.getElementById("adaptive-status")) updateAdaptiveLabels();
  if(adaptiveWindow.length < ADAPTIVE_WINDOW_SIZE) return "";

  const pct = Math.round(100 * adaptiveWindow.filter(Boolean).length / adaptiveWindow.length);
  const threshold = settings.adaptiveThreshold ?? 60;
  const upper = Math.min(100, threshold + ADAPTIVE_HYSTERESIS);
  const lower = Math.max(0, threshold - ADAPTIVE_HYSTERESIS);

  if(pct >= upper && settings.cefrMax < MAX_VOCAB_CEFR_IDX){
    settings.cefrMin++; settings.cefrMax++;
    saveJSON(LS_SETTINGS, settings);
    adaptiveWindow = [];
    saveJSON(LS_ADAPTIVE_WINDOW, adaptiveWindow);
    return `<br><br>📈 <b>Adaptive difficulty: level up!</b> ${pct}% correct over your last ${ADAPTIVE_WINDOW_SIZE} exercises — moving your range up to <b>${cefrLabel(settings.cefrMin)} – ${cefrLabel(settings.cefrMax)}</b>.`;
  }
  if(pct <= lower && settings.cefrMin > 0){
    settings.cefrMin--; settings.cefrMax--;
    saveJSON(LS_SETTINGS, settings);
    adaptiveWindow = [];
    saveJSON(LS_ADAPTIVE_WINDOW, adaptiveWindow);
    return `<br><br>📉 <b>Adaptive difficulty: easing off.</b> ${pct}% correct over your last ${ADAPTIVE_WINDOW_SIZE} exercises — moving your range down to <b>${cefrLabel(settings.cefrMin)} – ${cefrLabel(settings.cefrMax)}</b>.`;
  }
  return ""; // binnen de hysteresemarge -> geen verandering
}

/* checkupNoteAfterAnswer() is vervangen door de nieuwe, zelfstandige modal-gedreven kennischeck-flow
   (zie startCheckup / nextCheckupQuestion / submitCheckupAnswer verderop). */



export function getGrammarProgress(key){
  if(!grammar[key]) grammar[key] = {level:0, due:Date.now(), reps:0};
  return migrateLegacyProgress(grammar[key]);
}
function recordGrammarResult(key, correct){
  const p = getGrammarProgress(key);
  scheduleReview(p, gradeFromResult(correct));
  p.reps += 1;
  p.correct = (p.correct || 0) + (correct ? 1 : 0); // ECHTE nauwkeurigheid, los van het SRS-niveau hierboven
  grammar[key] = p;
  saveJSON(LS_GRAMMAR, grammar);
}
/* ===================== CLOUD-SYNCHRONISATIE (GitHub Gist) ===================== */
// Slaat progress/custom/newWords op in een privé GitHub Gist zodat je voortgang niet vastzit
// aan één apparaat/browser. Werkt alleen als syncGistId + syncApiKey (GitHub token) zijn ingesteld.
// Gebruikt GitHub i.p.v. jsonbin.io: geen apart account nodig (je hebt al GitHub voor de app zelf),
// en geen last van jsonbin's 100KB-limiet op het gratis plan.
const GIST_FILENAME = "turks-app-voortgang.json";
let syncInProgress = false;

function syncConfigured(){
  return !!(settings.syncBinId && settings.syncApiKey);
}

function setSyncStatus(text){
  const elS = document.getElementById("sync-status");
  if(elS) elS.textContent = text;
}

function syncMaybePush(){
  if(!syncConfigured()) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(syncPushNow, 1500); // debounce: pas 1,5s na de laatste wijziging echt versturen
}

async function githubApiError(res){
  const body = await res.text().catch(()=>"" );
  let msg = body;
  try{ msg = JSON.parse(body).message || body; }catch(e){}
  return new Error(res.status + ": " + msg);
}

// BUGFIX: GitHub's Gist API TRUNCATES a file's "content" field once it passes a size threshold
// (well under 1MB) -- the response still says res.ok, but file.content is then cut off mid-string,
// so JSON.parse() blows up with an "Unterminated string"/"Unexpected end of JSON input" error. This
// silently broke pulling as soon as the synced progress payload (progress+custom+overrides+newWords+
// grammar+cost, for ~4932 words) grew past that threshold: the pull failed, the OLD local progress
// stayed in place, and a subsequent push then re-uploaded that stale local data as if it were fresh
// (hence "sync successful" while devices still visibly differ). Fix: GitHub flags this via
// file.truncated===true and provides file.raw_url with the FULL, untruncated content -- fetch that
// instead whenever truncation is signalled.
async function fetchFullGistFileContent(file){
  if(!file.truncated) return file.content;
  // GEEN Authorization-header hier: gist.githubusercontent.com (de raw_url-host) staat geen custom
  // headers toe via CORS, dus een credentialed fetch hierheen faalt met een kale "Failed to fetch"
  // (mislukte preflight, geen bruikbare foutmelding). Een gewone, ongeauthenticeerde GET volstaat --
  // de raw-URL is zelf al onraadbaar/uniek genoeg (zelfde principe als bij een secret gist: wie de URL
  // kent, kan de inhoud lezen, ook zonder token).
  const rawRes = await fetch(file.raw_url);
  if(!rawRes.ok) throw new Error("Failed to fetch full (untruncated) gist content: " + rawRes.status);
  return await rawRes.text();
}
async function fetchRemoteGistData(){
  const res = await fetch(`https://api.github.com/gists/${settings.syncBinId}`, {
    headers: {
      "Authorization": "Bearer " + settings.syncApiKey,
      "Accept": "application/vnd.github+json"
    }
  });
  if(!res.ok) throw await githubApiError(res);
  const data = await res.json();
  const file = data.files && data.files[GIST_FILENAME];
  if(!file) return null;
  return JSON.parse(await fetchFullGistFileContent(file));
}

async function syncPushNow(){
  if(!syncConfigured() || syncInProgress) return;
  syncInProgress = true;
  setSyncStatus("🔄 Syncing…");
  try{
    // kosten-verbruik optellen i.p.v. overschrijven: eerst het cloud-totaal ophalen, het maximum
    // nemen t.o.v. het lokale totaal (veiligheidsnet tegen dataverlies, bv. als lokaal nog nooit
    // gesynct was), en daar pas het nog-niet-samengevoegde lokale verbruik bij optellen
    let mergedCost = costUsage;
    try{
      const remoteNow = await fetchRemoteGistData();
      const remoteCost = (remoteNow && remoteNow.cost) || {byModel:{}};
      const base = maxCostUsage(costUsage, remoteCost);
      mergedCost = mergeCostUsage(base, costPending);
    }catch(e){
      // ophalen mislukt: val terug op lokaal samenvoegen, dan gaat er bij een sync-conflict
      // in het ergste geval iets kosten-verbruik verloren, maar nooit de rest van de voortgang
      mergedCost = mergeCostUsage(costUsage, costPending);
    }
    costUsage = mergedCost;
    costPending = {byModel:{}};
    localStorage.setItem(LS_COST, JSON.stringify(costUsage));
    localStorage.setItem(LS_COST_PENDING, JSON.stringify(costPending));
    updateCostDisplay();

    const payload = { progress, custom, overrides, newWords, grammar, cost: costUsage, updatedAt: Date.now() };
    const res = await fetch(`https://api.github.com/gists/${settings.syncBinId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + settings.syncApiKey,
        "Accept": "application/vnd.github+json"
      },
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(payload) } } })
    });
    if(!res.ok) throw await githubApiError(res);
    setSyncStatus("✅ Gesynchroniseerd om " + new Date().toLocaleTimeString());
  }catch(e){
    setSyncStatus("⚠️ Syncing (upload) failed: " + e.message);
  }
  syncInProgress = false;
}

async function syncPullNow(showAlertOnEmpty){
  if(!syncConfigured()) return;
  setSyncStatus("🔄 Fetching progress…");
  try{
    const res = await fetch(`https://api.github.com/gists/${settings.syncBinId}`, {
      headers: {
        "Authorization": "Bearer " + settings.syncApiKey,
        "Accept": "application/vnd.github+json"
      }
    });
    if(!res.ok) throw await githubApiError(res);
    const data = await res.json();
    const file = data.files && data.files[GIST_FILENAME];
    if(!file){
      if(showAlertOnEmpty) setSyncStatus("⚠️ Gist found, but does not contain " + GIST_FILENAME + " bestand.");
      return;
    }
    const remote = JSON.parse(await fetchFullGistFileContent(file));
    if(remote && remote.updatedAt){
      progress = remote.progress || {};
      custom = remote.custom || {};
      overrides = remote.overrides || {};
      newWords = remote.newWords || {};
      grammar = remote.grammar || {};
      costUsage = remote.cost ? maxCostUsage(costUsage, remote.cost) : costUsage; // laat lokaal costPending ongemoeid, dat wordt bij de volgende push meegeteld
      // curatedTr wordt niet meer gesynct (zie syncPushNow): de ingebedde data is nu de volledige,
      // verse bron, en persoonlijke correcties lopen via de veel kleinere overrides-laag hieronder.
      localStorage.setItem(LS_PROGRESS, JSON.stringify(progress));
      localStorage.setItem(LS_CUSTOM, JSON.stringify(custom));
      localStorage.setItem(LS_OVERRIDES, JSON.stringify(overrides));
      localStorage.setItem(LS_NEWWORDS, JSON.stringify(newWords));
      localStorage.setItem(LS_GRAMMAR, JSON.stringify(grammar));
      localStorage.setItem(LS_COST, JSON.stringify(costUsage));
      localStorage.setItem(LS_CURATED_TR, JSON.stringify(curatedTr));
      updateCostDisplay();
      setSyncStatus("✅ Opgehaald van server (laatst bijgewerkt: " + new Date(remote.updatedAt).toLocaleString() + ")");
    } else if(showAlertOnEmpty){
      setSyncStatus("ℹ️ There is nothing in cloud storage yet — your first sync will populate it.");
    }
  }catch(e){
    setSyncStatus("⚠️ Fetching failed: " + e.message);
  }
}

async function syncCreateBin(){
  if(!settings.syncApiKey){
    alert("Enter your GitHub Personal Access Token first.");
    return;
  }
  setSyncStatus("🔄 Creating new cloud storage (Gist)…");
  try{
    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + settings.syncApiKey,
        "Accept": "application/vnd.github+json"
      },
      body: JSON.stringify({
        description: "Turkish vocab trainer progress (do not edit manually)",
        public: false,
        files: { [GIST_FILENAME]: { content: JSON.stringify({ progress:{}, custom:{}, newWords:{}, grammar:{}, cost:{byModel:{}}, updatedAt: Date.now() }) } }
      })
    });
    if(!res.ok) throw await githubApiError(res);
    const data = await res.json();
    settings.syncBinId = data.id;
    saveJSON(LS_SETTINGS, settings);
    const inputEl = document.getElementById("sync-bin-id");
    if(inputEl) inputEl.value = settings.syncBinId;
    setSyncStatus("✅ New cloud storage created! Gist ID has been filled in and saved automatically — use this SAME ID on your other devices.");
  }catch(e){
    setSyncStatus("⚠️ Creation failed: " + e.message);
  }
}

/* ===================== SPACED REPETITION (alleen woorden) ===================== */
                 // niveau 0 -> 15 minuten
      // niveau 10 -> 1 jaar (in minuten)




/* Per-woord ease-factor: het 0-10 niveau blijft intact voor alles wat daarvan afhangt
   (grammatica-drempels, suffix-trainer, kennischeck, sortering) -- alleen de daadwerkelijke
   herhaal-timing (p.due) wordt voortaan per woord verfijnd via deze ease-factor i.p.v.
   uitsluitend via het (voor iedereen gelijke) niveau-interval hierboven. */


         // was 3.2 -- verlaagd naar literatuur-typische bovengrens; zonder apart
                                // "makkelijk"-signaal is er geen goede grond om verder te laten stijgen
function easeOf(en){
  const p = getProgress(en);
  return typeof p.ease === "number" ? p.ease : EASE_START;
}

// Elke toegang tot een progress-entry migreert 'm (idempotent) van de oude SM-2-achtige velden
// (level/ease/intervalMin) naar de nieuwe FSRS-velden (stability/difficulty) -- zie migrateLegacyProgress
// in fsrs.js. De oude velden blijven gewoon staan (nooit verwijderd), alleen de SCHEDULING zelf stapt over.


// Voorkomt dat een woord binnen een paar minuten na de vorige beurt alwéér wordt voorgelegd: zonder
// deze afkoeltijd bleef een net fout beantwoord woord het "zwakste" (laagste niveau) en kwam het via
// pickWeakestSoonest/pickEnglishWordForSentence gewoon meteen weer boven drijven, ongeacht due -- due
// bepaalt daar alleen de VOLGORDE bij een gelijk niveau, niet OF een woord in aanmerking komt. Met
// deze cooldown krijgt de gebruiker het woord in de tussentijd niet nogmaals fout of "toevallig" goed,
// wat de zwakke status juist verhulde in plaats van zichtbaar hield.
const WORD_COOLDOWN_MS = 5 * 60 * 1000; // 5 minuten
function isInCooldown(en, now){
  const lastShownAt = getProgress(en).lastShownAt;
  return !!lastShownAt && (now - lastShownAt) < WORD_COOLDOWN_MS;
}
function markShown(en){
  getProgress(en).lastShownAt = Date.now();
  saveJSON(LS_PROGRESS, progress);
}



function allWords(){
  // basislijst (Engels + cefr); de Turkse vertaling zit NIET hier — die wordt pas
  // opgevraagd/gegenereerd op het moment dat een woord daadwerkelijk aan de beurt is.
  return baseWordList();
}

// Levert alleen nog-nooit-getoonde woorden op die "binnen bereik" liggen van het ingestelde
// CEFR-niveau (met een kleine uitdagingsmarge), zodat nieuwe stof gedoseerd wordt geïntroduceerd
// i.p.v. willekeurig uit alle ~5000 Oxford-woorden — de kern van een echte niveau-opbouw.
/* Het oorspronkelijke les-voor-les-ontgrendelmechanisme is losgelaten -- grammatica-onderwerpen en
   woorden zijn nu allemaal meteen "ontgrendeld"; alleen het ingestelde CEFR-bereik (en voor
   introductie de voortgang zelf) bepaalt nog wat er geoefend wordt. Deze twee functies bestaan als
   dunne wrapper zodat de aanroepers niet hoeven te weten dat dat zo is -- ze geven altijd de VOLLEDIGE
   set terug. */
function unlockedWordSet(){
  const set = new Set();
  for(const w of EN_WORDS_DATA) set.add(w.en);
  return set;
}
function unlockedGrammarTopicSet(){
  const set = new Set();
  for(const t of GRAMMAR_TOPICS) set.add(t.key);
  return set;
}

function getIntroducibleWords(){
  const words = baseWordList();
  const lo = vocabCefrBand(Math.min(settings.cefrMin, settings.cefrMax)), hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  const inRange = w => typeof w.cefr !== "number" || (vocabCefrBand(w.cefr) >= lo && vocabCefrBand(w.cefr) <= hi);
  const unlocked = unlockedWordSet();
  const allIntroducible = words.filter(w => unlocked.has(w.en) && getProgress(w.en).reps === 0);
  // Deze functie is puur bereik-respecterend en mag een LEGE array teruggeven als er binnen bereik
  // niets meer te introduceren valt -- géén interne "verbreed als leeg"-terugval meer. Die zat er
  // eerder wél in, en dat was precies het probleem: de aanroepers (pickNextItem,
  // pickEnglishWordForSentence) hebben elk al hun EIGEN nette, expliciete terugvallogica voor "niets
  // binnen bereik" (eerst due-herhaling ongeacht bereik proberen, pas daarna pas echt breed zoeken) --
  // maar die werd ondermijnd doordat DEZE functie zelf al in het geniep verbreedde naar alle niveaus
  // zodra de bereik-pool leeg was, en de aanroepers dat resultaat vervolgens vertrouwden als "binnen
  // bereik". Twee stille verbredingen die elkaar versterkten: zodra je binnen een smal bereik alle
  // nieuwe woorden had gehad, kreeg je zonder waarschuwing woorden van willekeurig welk ander niveau.
  const pool = allIntroducible.filter(inRange);

  // Lichte voorkeur voor woorden uit de HUIDIGE les (voor een wat gestructureerdere introductie-volgorde
  // binnen een les) -- maar alleen als er BINNEN de al bereik-correcte pool ook echt iets van die les
  // zit; nooit als reden om de pool te negeren of te verkleinen.
  if(!pool.length) return pool;
  const cur = currentVocabLesson();
  if(cur && cur.words && cur.words.length){
    const curSet = new Set(cur.words);
    const fromCurrentLesson = pool.filter(w => curSet.has(w.en));
    if(fromCurrentLesson.length === pool.length || fromCurrentLesson.length === 0) return pool; // les dekt de hele pool al, of dekt 'm helemaal niet -> gewoon de volledige pool
    const rest = pool.filter(w => !curSet.has(w.en));
    return [...fromCurrentLesson, ...rest];
  }
  return pool;
}

/* Bewaakt tegen AI-fouten waarbij het "en"-veld eigenlijk geen Engels woord is (bv. per ongeluk een
   Turks grammaticaal patroon zoals "ya ... ya da" in plaats van een vertaling) -- zonder deze check
   belanden zulke strings alsnog als "nieuw Engels woord" in de trackinglijst, waar ze nooit een
   zinnige vertaling krijgen en dus voor altijd op "nog niet vertaald" blijven staan. */
export function looksLikeEnglishWord(en){
  if(!en || typeof en !== "string") return false;
  if(en.includes("...") || en.includes("…")) return false; // grammaticaal patroon, geen los woord
  if(en.includes("/")) return false; // AI die meerdere opties/vertalingen in één "woord" samenperst
  if(/^to\s/i.test(en)) return false; // "to " hoort niet IN het en-veld te zitten -- de app voegt dat zelf toe voor werkwoorden
  if(/[ışğüöçİŞĞÜÖÇ]/.test(en)) return false; // Turkse tekens horen niet in een Engels woord
  if(en.length > 40) return false; // te lang om een plausibel woordenboek-lemma te zijn
  return true;
}

/* Voegt een nieuw Engels woord toe aan de lijst (ontdekt via een zin), tenzij het al bestaat. */


/* ===================== VERTALING OP AANVRAAG ===================== */
// Kern van de nieuwe opzet: de Turkse vertaling van een Engels woord wordt pas opgevraagd
// bij de AI op het moment dat dat woord daadwerkelijk aan de beurt is — niet vooraf voor
// alle ~5000 woorden. Eenmaal opgehaald wordt het resultaat lokaal gecached (en gesynct),
// zodat elk woord maar 1x per apparaat-cluster vertaald hoeft te worden.

// Kiest, voor een NIEUWE oefening met dit woord, welke specifieke betekenis getest wordt (bij een
// homoniem/polyseem woord zoals "mine" of "light" zijn dat er meerdere) -- de gekozen zin (incl. gloss
// en de bijbehorende Turkse vertaling(en)) wordt op het oefening-item zelf bewaard, zodat weergave EN
// beoordeling binnen diezelfde oefening consistent naar dezelfde betekenis verwijzen.
// Volledige woordsoort ("verb", "noun", ...) zoals in words.json/REVERSE_TR_INDEX, in tegenstelling
// tot wordCategoryOf() dat de afgekorte weergavevorm ("v.", "n.") teruggeeft. Nodig om bij een
// gesplitst woord (bv. "fly__v"/"fly__n") de juiste tr-en-tegenhanger te kiezen uit REVERSE_TR_INDEX,
// dat zelf niet gesplitst is en per basiswoord soms meerdere, verschillende-woordsoort opties bevat.

// Voor de zeldzame gevallen waarin twee entries van hetzelfde basiswoord dezelfde woordsoort delen
// maar taalkundig toch echt verschillend zijn (bv. "change__v"=değiştirmek/overgankelijk vs
// "change__vi"=değişmek/onovergankelijk, allebei "verb") -- wordPosOf alleen kan die twee dan niet
// uit elkaar houden bij het kiezen van de juiste tr-en-tegenhanger. Voor woorden zonder dit onderscheid
// (verreweg de meeste) geeft dit null en heeft het geen effect op de bestaande pos-matching.


// Gedeelde resolutie-stap voor alle drie de plekken die een los woord tonen (hoofdscherm, kennischeck,
// skill-practice): probeert eerst synchroon een zin te kiezen uit de gecureerde data (per richting, zie
// hierboven), en haalt alleen bij een écht nog niet gecureerd woord (zeldzaam) alsnog live iets op.
// LET OP: de live-vertaalfallback (getOrFetchTranslation) leest zelf eerst de en-tr-cache -- die mag
// dus NOOIT gebruikt worden om een tr-en-oefening alsnog van een Turks woord te voorzien. Voor tr-en
// zonder REVERSE_TR_INDEX-tegenhanger blijft sense hier bewust null; renderPractice zet de oefening
// voor dat woord dan gewoon om naar en-tr in plaats van de en-tr-lijst "achterstevoren" te raadplegen.
async function resolveWordSense(en, direction){
  let sense = pickWordSense(en, direction);
  if(!sense && direction !== "tr-en"){
    try{
      const tr = await getOrFetchTranslation(en);
      sense = {tr, gloss: null, register: "neutral"};
    }catch(e){ sense = null; }
  }
  return sense;
}
// Registermetadata (formeel/informeel/etc.) van een woord -- gebruikt als er GEEN al-gekozen zin
// (pickWordSense-resultaat) beschikbaar is, bv. bij de AI-beoordeelde terugvalpaden. Pakt de EERSTE
// (meest gangbare) zin als representatief; voor de exacte, bij de oefening horende zin wordt liever
// het bewaarde .registerInfo van het item zelf gebruikt (zie renderPractice).
function translationRegisterInfo(en){
  const curated = curatedTr[en];
  let register, note;
  if(curated && Array.isArray(curated.senses) && curated.senses.length){
    register = curated.senses[0].register; note = "";
  } else if(curated){
    register = curated.register; note = curated.note || "";
  }
  if(!register || register === "neutral") return null;
  return {register, note};
}

/* ===================== EENMALIGE, GRONDIGE VERTAALDOORLOOP (heel Oxford 3000/5000, incl. register) =====================
   In tegenstelling tot getOrFetchTranslation() (die 1 los woord vertaalt zodra het voor het eerst nodig is)
   doorloopt dit de HELE woordenlijst in batches, via Claude (kwaliteit + registerbeoordeling), en slaat het
   resultaat blijvend op in curatedTr — dat heeft daarna altijd voorrang, dus geen dubbel werk en geen losse
   AI-call meer nodig tijdens het oefenen zelf. Voortgang wordt na elke batch opgeslagen, dus onderbreken en
   later hervatten is geen probleem (de al-gedane woorden worden vanzelf overgeslagen). */
const BULK_TRANSLATE_BATCH_SIZE = 25;
let bulkTranslateRunning = false;
let bulkTranslateCancelled = false;

async function runBulkTranslate(onProgress){
  if(!proxyConfigured() && !settings.anthropicApiKey) throw new Error("An Anthropic (Claude) API key (or shared proxy) is needed for this (Settings).");
  const remaining = EN_WORDS_DATA.filter(w => !curatedTr[w.en]);
  bulkTranslateRunning = true;
  bulkTranslateCancelled = false;
  for(let i=0;i<remaining.length;i+=BULK_TRANSLATE_BATCH_SIZE){
    if(bulkTranslateCancelled) break;
    const batch = remaining.slice(i, i+BULK_TRANSLATE_BATCH_SIZE);
    const sys = `Je bent een ervaren Engels-Turks vertaler en taalkundige, gespecialiseerd in natuurlijkheid en spreektaal-register.
Voor elk gegeven Engels woord geef je:
- de 1-2 meest gangbare Turkse vertaling(en), in de basisvorm (infinitief bij werkwoorden, bv. "gitmek" niet "gider")
- een registerclassificatie: "neutral" (standaard, in vrijwel elke context bruikbaar/correct), "formal" (formeel, ongebruikelijk in casual spraak), "informal" (informeel/spreektaal, prima onder vrienden maar niet formeel/schriftelijk), "colloquial" (heel informeel/straattaal/jargon), of "caution" (verouderd, zeldzaam, dialectisch, of makkelijk verward met een ander woord)
- ALLEEN als het register NIET "neutral" is: een korte toelichting in het Engels (max 8 woorden), gericht aan een taalstudent (bv. "more formal than everyday 'gitmek'")
Antwoord in JSON. De volgorde en het aantal items in "words" moet EXACT overeenkomen met de gegeven lijst, in dezelfde volgorde.`;
    const userMsg = "Woorden: " + batch.map(w=>w.en).join(", ");
    const schema = {
      name: "vertaal_batch",
      description: "Vertalingen + registerclassificatie voor een batch Engelse woorden.",
      input_schema: {
        type: "object",
        properties: {
          words: {
            type: "array",
            minItems: batch.length, maxItems: batch.length,
            items: {
              type: "object",
              properties: {
                en: {type:"string"},
                tr: {type:"array", items:{type:"string"}, minItems:1, maxItems:2},
                register: {type:"string", enum:["neutral","formal","informal","colloquial","caution"]},
                note: {type:"string", description:"Alleen bij een niet-neutraal register: max 8 woorden toelichting in het Engels."},
              },
              required: ["en","tr","register","note"]
            }
          }
        },
        required: ["words"]
      }
    };
    try{
      const raw = await callClaude(sys, userMsg, 3500, 0.2, 0, schema);
      const parsed = parseAIJson(raw);
      for(const item of (parsed.words || [])){
        if(item.en && Array.isArray(item.tr) && item.tr.length){
          curatedTr[item.en] = {tr:item.tr, register:item.register||"neutral", note:item.note||""};
        }
      }
      saveJSON(LS_CURATED_TR, curatedTr);
    }catch(e){
      // deze batch overslaan; de woorden erin blijven ontbreken en worden bij een volgende run alsnog opgepakt
      // (en tellen dus BEWUST niet mee in de voortgang hieronder -- anders zou de balk tijdelijk te veel
      // voortgang tonen en na afloop weer terugspringen naar het werkelijke, lagere percentage)
    }
    // Voortgang altijd baseren op het daadwerkelijke aantal gecureerde woorden, niet op hoeveel batches
    // geprobeerd zijn -- zo kan de balk nooit meer laten zien dan er ook echt gelukt is.
    if(onProgress){
      const actuallyDone = EN_WORDS_DATA.length - EN_WORDS_DATA.filter(w => !curatedTr[w.en]).length;
      onProgress(actuallyDone, EN_WORDS_DATA.length);
    }
  }
  bulkTranslateRunning = false;
}



// Aantal woorden dat binnen het ingestelde CEFR-bereik daadwerkelijk "due" is (al eerder getoond ÉN
// het herhalingsmoment is verstreken) -- puur informatief label op het hoofdscherm, telt bewust GEEN
// nog-nooit-getoonde woorden mee (die zijn "nieuw", niet "te herhalen" -- zie countNewWords hieronder).
function countDueWords(){
  const now = Date.now();
  const lo = vocabCefrBand(Math.min(settings.cefrMin, settings.cefrMax)), hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  // BUGFIX: bij "Mix in new words" op 5/5 (alwaysNew, zie pickNextItem) biedt de daadwerkelijke
  // oefening NOOIT due/review-woorden aan -- dan telt alleen "geen nieuwe woorden meer" als uitgeput,
  // due woorden zijn in die stand irrelevant. Deze teller hield daar geen rekening mee en bleef due
  // woorden meetellen die de gebruiker in die instelling nooit te zien krijgt, wat de indruk gaf dat er
  // nog van alles te herhalen was terwijl de oefening zelf "niets te tonen" meldde.
  const alwaysNew = settings.mixNewWords && (settings.newWordsPer5 ?? 2) >= 5;
  if(alwaysNew) return 0;
  // Telt over de pool die het huidige settings.wordDirection ook daadwerkelijk gebruikt (en-tr, tr-en,
  // of -- bij "random" -- allebei; practiceWordEntries() sluit alleen uit bij een letterlijke "en-tr"/
  // "tr-en"-waarde, elke andere waarde levert dus al beide lijsten). Voorheen telde dit UITSLUITEND de
  // en-tr-lijst, ongeacht de ingestelde richting -- dat gaf een misleidend getal zodra er ook (of vooral)
  // in tr-en geoefend werd.
  return practiceWordEntries(settings.wordDirection || "random").filter(w => {
    if(typeof w.cefr === "number" && (vocabCefrBand(w.cefr) < lo || vocabCefrBand(w.cefr) > hi)) return false;
    const p = getProgress(w.key);
    return p.reps > 0 && p.due <= now;
  }).length;
}
// Aantal woorden binnen het ingestelde CEFR-bereik dat nog NOOIT getoond is -- de tegenhanger van
// countDueWords hierboven. LET OP: dit is bewust een ANDERE telling dan getIntroducibleWords()/
// pickEnglishWordForSentence (die blijven EN-only, want zinnen worden alleen rond Engelse woorden
// opgebouwd) -- deze telling is puur voor de "X nieuwe woorden"-weergave en volgt daarom dezelfde
// en-tr/tr-en/random-richting als de daadwerkelijke losse-woord-oefening (zie practiceWordEntries).
function countNewWords(){
  const lo = vocabCefrBand(Math.min(settings.cefrMin, settings.cefrMax)), hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  return practiceWordEntries(settings.wordDirection || "random").filter(w => {
    if(typeof w.cefr === "number" && (vocabCefrBand(w.cefr) < lo || vocabCefrBand(w.cefr) > hi)) return false;
    return getProgress(w.key).reps === 0;
  }).length;
}
// Toont twee losse regels i.p.v. één enkel getal: hoeveel woorden nog nieuw zijn (nog nooit getoond,
// binnen bereik) en hoeveel al eerder getoonde woorden nu due zijn voor herhaling. Voorheen liet dit
// alleen het due-getal zien, wat de indruk kon wekken dat de telling niet klopte -- in de praktijk
// worden namelijk óók (juist als eerste, want niveau 0 = "zwakst") nieuwe woorden geoefend, die in die
// ene due-teller nergens in terugkwamen.
function renderDueCount(){
  const newCount = countNewWords();
  const dueCount = countDueWords();
  const lines = [];
  if(newCount > 0) lines.push(`${newCount} new word${newCount===1?"":"s"}`);
  if(dueCount > 0) lines.push(`${dueCount} due exercise${dueCount===1?"":"s"}`);
  el("due-count").innerHTML = lines.map(l => `<div>${l}</div>`).join("");

  // Schakelaar + draaiknop voor het mengen van nieuwe woorden in de reguliere pool: alleen tonen als
  // er binnen het huidige CEFR-bereik daadwerkelijk nieuwe woorden zijn (anders is de instelling zinloos).
  el("mix-new-words-row").classList.toggle("hidden", newCount === 0);
  if(newCount > 0){
    el("mix-new-words-toggle").checked = !!settings.mixNewWords;
    el("mix-new-words-dial-row").classList.toggle("hidden", !settings.mixNewWords);
    const ratio = settings.newWordsPer5 ?? 2;
    el("mix-new-words-dial").value = ratio;
    el("mix-new-words-dial-label").textContent = `${ratio} / 5`;
  }
}

// Kandidatenpool voor de losse-woord-oefeningen op het hoofdscherm: de en-tr-lijst (EN_WORDS_DATA,
// richting vast op "en-tr") en/of de tr-en-lijst (TR_WORDS_DATA, richting vast op "tr-en"), afhankelijk
// van de opgegeven richting ("en-tr" | "tr-en" | "all"). Elke entry krijgt een EIGEN progress-sleutel
// ("key") -- voor en-tr-entries is dat gewoon het Engelse woord (ongewijzigd, dus bestaande scores
// blijven behouden), voor tr-en-entries is dat de aparte "trword:"-sleutel uit TR_WORDS_DATA. Zo houdt
// bv. "ball" (en-tr) een eigen score los van "top" (tr-en), ook al zijn het elkaars vertaling.
function practiceWordEntries(dir){
  const entries = [];
  if(dir !== "tr-en"){
    for(const w of EN_WORDS_DATA) entries.push({key: w.en, en: w.en, cefr: w.cefr, direction: "en-tr", source: "en"});
  }
  if(dir !== "en-tr"){
    for(const w of TR_WORDS_DATA) entries.push({key: w.key, en: w.en, tr: w.tr, cefr: w.cefr, direction: "tr-en", source: "tr", trData: w});
  }
  return entries;
}

// Heeft een richting ("en-tr"/"tr-en") binnen het ingestelde CEFR-bereik nog minstens 1 woord dat NIET
// in de 5-minuten-afkoeltijd zit? Gebruikt door resolveWordDirectionForThisTurn (random-modus) om een
// net getoond, piepklein poolletje (bv. een kersvers, amper-gevulde tr-en-bereik) te ontwijken i.p.v. --
// via de bestaande cooldown-terugval-naar-volledige-lijst hieronder -- gedwongen hetzelfde woord
// meteen opnieuw te tonen terwijl de ANDERE richting nog volop verse kandidaten heeft.
function poolHasEligibleCandidate(dir, lo, hi, now){
  return practiceWordEntries(dir).some(w => {
    if(typeof w.cefr === "number" && (vocabCefrBand(w.cefr) < lo || vocabCefrBand(w.cefr) > hi)) return false;
    return !isInCooldown(w.key, now);
  });
}

// Bepaalt welke richting DEZE beurt gebruikt wordt.
// - "random": eerst kijken welke van de twee lijsten (binnen het CEFR-bereik) nog verse, niet-
//   afgekoelde kandidaten heeft -- alleen als BEIDE dat hebben, wordt er daadwerkelijk 50/50 geloot.
//   Heeft er maar één verse kandidaten, dan wordt die richting gebruikt (voorkomt geforceerde herhaling
//   van hetzelfde woord terwijl de andere richting nog frisse stof had); hebben BEIDE niets vers meer
//   (zeldzaam, alleen bij een heel smal bereik), dan valt het alsnog terug op een gewone 50/50-worp --
//   een herhaling is dan sowieso onvermijdelijk, ongeacht welke richting gekozen wordt.
// - "en-tr"/"tr-en" (vaste richting): normaal gewoon die ene lijst, MAAR als die vaste richting binnen
//   bereik geen enkel DUE woord heeft terwijl de ANDERE richting dat wel heeft, wordt er voor deze beurt
//   automatisch naar die andere richting overgeschakeld (en vice versa) -- i.p.v. te wachten tot je
//   zelf de instelling omzet, of een "nieuw woord"/"niets te bieden"-melding te krijgen terwijl er
//   elders due stof ligt. Hebben BEIDE richtingen niets due, dan blijft de ingestelde richting gewoon
//   staan -- de due->nieuw->uitgeput-cascade in pickNextItem handelt dat verder af.
function resolveWordDirectionForThisTurn(){
  const dir = settings.wordDirection || "random";
  const lo = vocabCefrBand(Math.min(settings.cefrMin, settings.cefrMax)), hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  const now = Date.now();
  lastAutoSwitchedFrom = null; // reset -- alleen gezet als er deze beurt daadwerkelijk werd overgeschakeld
  if(dir !== "random"){
    const poolHasDue = (d) => practiceWordEntries(d).some(w => {
      if(typeof w.cefr === "number" && (vocabCefrBand(w.cefr) < lo || vocabCefrBand(w.cefr) > hi)) return false;
      const p = getProgress(w.key);
      return p.reps > 0 && p.due <= now;
    });
    if(poolHasDue(dir)) return dir;
    const other = dir === "en-tr" ? "tr-en" : "en-tr";
    if(poolHasDue(other)){
      lastAutoSwitchedFrom = dir;
      return other;
    }
    return dir;
  }
  const enFresh = poolHasEligibleCandidate("en-tr", lo, hi, now);
  const trFresh = poolHasEligibleCandidate("tr-en", lo, hi, now);
  if(enFresh && !trFresh) return "en-tr";
  if(trFresh && !enFresh) return "tr-en";
  return Math.random() < 0.5 ? "en-tr" : "tr-en";
}

// Zelfde richtingsvoorkeur (settings.wordDirection) als het hoofdscherm, maar dan voor kennischeck/
// skill-practice -- die kiezen het WOORD zelf via een heel ander mechanisme (CEFR-niveau resp. een vaste
// lesbrede woordenlijst, geen SRS-due-cascade), dus de volledige due->nieuw->uitgeput-logica van
// pickNextItem is hier niet van toepassing. Alleen de richtingskeuze wordt gelijkgetrokken: voorheen was
// dat een losstaande 50/50-worp die alleen bij een API-sleutel tr-en overwoog; nu volgt het gewoon de
// ingestelde voorkeur (en-tr only / tr-en only / random), net als overal elders in de app. Heeft het
// gekozen woord toch geen tr-en-tegenhanger, dan valt resolveWordSense() vanzelf terug op en-tr (zie
// de nulcontrole bij de aanroepers).
function resolveCheckupWordDirection(){
  const dir = settings.wordDirection || "random";
  if(dir === "en-tr") return "en-tr";
  if(dir === "tr-en") return "tr-en";
  return Math.random() < 0.5 ? "en-tr" : "tr-en";
}

/* ===================== PURE, TESTBARE KERNLOGICA (zie /tests) =====================
   Deze twee functies bevatten precies de mix/type-keuzebeslissingen die in eerdere sessies een paar
   keer subtiel stuk waren (mix-kwotering die niet mixte, een 0%-type dat toch verscheen, twee keer
   achter elkaar hetzelfde type). Bewust als PURE functies (alleen primitieven in/uit, geen afhankelijkheid
   van globale state zoals settings/currentItem) zodat ze zonder de rest van de app te laden getest
   kunnen worden -- zie /tests/mixing.test.js. */

// Beslist WELKE pool (nieuw/herhaling/alles/leeg) voor een woordoefening gebruikt moet worden. Geeft een
// van "all"|"new"|"quotaNew"|"empty"|"review"|"quotaReview"|"reviewOrNew" terug; de aanroeper vertaalt
// dat naar de daadwerkelijke woordenlijst (zie pickNextItem).


// Kiest welk oefentype (word/sentence/question) nu aan de beurt is, gebaseerd op het deficit t.o.v. het
// ingestelde streefaandeel over de laatste 10 oefeningen (herstelt de gewenste verhouding vanzelf).


function pickNextItem(){
  const lo = vocabCefrBand(Math.min(settings.cefrMin, settings.cefrMax)), hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  const inRange = w => typeof w.cefr !== "number" || (vocabCefrBand(w.cefr) >= lo && vocabCefrBand(w.cefr) <= hi);
  const now = Date.now();

  // Bouwt de kandidatenpool (due/nieuw) voor een specifieke richting -- apart als functie, want bij
  // "random" moet er soms een tweede keer geprobeerd worden met de ANDERE richting (zie hieronder).
  function computePoolFor(dir){
    const allUnlocked = practiceWordEntries(dir);
    const wordsInRange = allUnlocked.filter(inRange);
    const dueNow = wordsInRange.filter(w => getProgress(w.key).reps > 0 && getProgress(w.key).due <= now);
    const neverShown = wordsInRange.filter(w => getProgress(w.key).reps === 0);
    return {allUnlocked, wordsInRange, dueNow, neverShown};
  }

  // "Mix in new words" op 5/5 betekent: ALTIJD een nieuw woord, NOOIT terugvallen op due/review -- dus
  // in die stand telt alleen "geen nieuwe woorden meer" als "uitgeput" (due woorden zijn dan irrelevant,
  // want die worden toch nooit gebruikt). Zonder die stand telt "uitgeput" pas als er ZOWEL niets due
  // ALS niets nieuws is. Deze functie moet VOOR de richtingskeuze bekend zijn, want de hieronder
  // volgende cross-richting-terugval moet 'm ook gebruiken (zie de toelichting daar).
  const alwaysNew = settings.mixNewWords && (settings.newWordsPer5 ?? 2) >= 5;
  function poolExhausted(pool){
    if(!pool.wordsInRange.length) return false; // leeg bereik is een ander scenario (allUnlocked-fallback verderop), geen "uitgeput"
    return alwaysNew ? pool.neverShown.length === 0 : (pool.dueNow.length === 0 && pool.neverShown.length === 0);
  }

  let chosenDir = resolveWordDirectionForThisTurn();
  let pool = computePoolFor(chosenDir);

  // Bij "random" kan de 50/50-worp toevallig net de richting treffen die op DIT moment niets te bieden
  // heeft, terwijl de ANDERE richting wél volop due/nieuwe woorden heeft -- dat gaf ten onrechte "geen
  // woorden beschikbaar" te zien (bv. honderden nieuwe en-tr-woorden, maar de worp trof toevallig een
  // tr-en-pool zonder nieuwe woorden). BUGFIX (1): deze check gebruikte voorheen altijd de "gewone"
  // (niet-alwaysNew) definitie van "uitgeput" (dueNow===0 EN neverShown===0), ook als "Mix in new
  // words" op 5/5 stond -- daardoor werd bij 5/5 een pool met wél due maar geen nieuwe woorden NOOIT
  // als "uitgeput" herkend. Nu hergebruikt dit dezelfde poolExhausted()-definitie als de daadwerkelijke
  // melding hieronder.
  // BUGFIX (2): zelfs met fix (1) werd er ALLEEN overgeschakeld als de gekozen richting volledig
  // uitgeput was. Had die richting toevallig gewoon 0 due woorden (maar nog wél nieuwe, dus niet
  // "uitgeput"), dan bleef de oefening voor altijd nieuwe woorden in DIE richting aanbieden, terwijl de
  // ANDERE richting misschien tientallen due woorden had liggen te wachten -- precies het scenario waar
  // de (over beide richtingen gesommeerde) "X to review"-teller wél een groot aantal liet zien, maar de
  // daadwerkelijke oefening domweg nooit due-materiaal uit de andere richting aanbood en in plaats
  // daarvan "no words are due in your selected range" meldde. Nu wordt er ook overgeschakeld wanneer de
  // gekozen richting zelf geen due woorden heeft, maar de andere richting dat wél heeft.
  if((settings.wordDirection || "random") === "random"){
    const otherDir = chosenDir === "en-tr" ? "tr-en" : "en-tr";
    const currentHasDue = !alwaysNew && pool.dueNow.length > 0;
    if(!currentHasDue){
      const otherPool = computePoolFor(otherDir);
      const otherHasDue = !alwaysNew && otherPool.dueNow.length > 0;
      const shouldSwitch = poolExhausted(pool) ? !poolExhausted(otherPool) : otherHasDue;
      if(shouldSwitch){
        chosenDir = otherDir;
        pool = otherPool;
      }
    }
  }

  const {allUnlocked, wordsInRange, dueNow, neverShown} = pool;

  // Woordselectie kiest uit het ingestelde CEFR-bereik. Prioriteit: (1) due woorden -- normale mix-
  // logica hieronder; (2) niets due, maar wél nog nooit-getoonde woorden -- expliciete terugval op
  // NIEUWE woorden, ongeacht settings.mixNewWords (dat regelt alleen de nieuw/herhaling-verhouding
  // wanneer er wél iets due is, niet wat er moet gebeuren als er NIETS due is); (3) niets due EN niets
  // nieuws -- er is dan letterlijk niks zinvols te tonen binnen dit bereik; renderPractice toont dan een
  // melding i.p.v. een oefening, met een voorstel om het maximumbereik met 1 te verhogen.
  if(alwaysNew){
    lastNoneDueInRange = false;
    wordsExhausted = poolExhausted(pool);
  } else {
    lastNoneDueInRange = wordsInRange.length > 0 && dueNow.length === 0 && neverShown.length > 0; // melding: terugval op nieuwe woorden
    wordsExhausted = poolExhausted(pool); // melding: niets te bieden, bereik vergroten?
  }

  // Mix nieuwe (nog nooit getoonde) woorden en al-eerder-geziene woorden volgens settings.mixNewWords/
  // newWordsPer5, i.p.v. altijd de volledige pool te gebruiken (waarin nieuwe woorden vanzelf domineren
  // omdat ze op niveau 0 staan en dus als "zwakst" gelden). Zie wordSourceHistory verderop voor hoe de
  // verhouding over een venster van 5 gestuurd wordt.
  // BUGFIX: newInRange/reviewInRange gebruikten voorheen altijd de pool van chosenDir -- bij "random"
  // is dat de richting die DEZE beurt toevallig de coin-flip/cooldown-afweging "won" (zie hierboven),
  // niet per se de richting waar het meeste te mixen valt. Had die gewonnen richting toevallig geen
  // nieuwe woorden meer (bv. en-tr al bijna volledig geïntroduceerd), dan viel de mix hieronder altijd
  // terug op "!newInRange.length -> dueWords = reviewInRange" -- 100% herhaling, VOLLEDIG ongeacht de
  // dial-stand, terwijl de andere richting (tr-en) misschien nog volop nieuwe woorden had liggen. Gebruik
  // daarom voor de mix-verhouding zelf altijd de VOLLEDIG gecombineerde pool zodra de richting op
  // "random" staat (pickWeakestSoonest kan toch al met een gemengde en-tr/tr-en-lijst overweg, elk item
  // draagt zijn eigen richting) -- alleen bij een VASTE richting-instelling blijft dit de pool van
  // chosenDir (inclusief een eventuele due-gestuurde auto-omschakeling hierboven).
  const mixPool = (settings.wordDirection || "random") === "random" ? computePoolFor("random") : pool;
  const newInRange = mixPool.neverShown;
  const reviewInRange = mixPool.dueNow;
  const mixDecision = resolveWordMixSlot({
    hasWordsInRange: wordsInRange.length > 0,
    alwaysNew,
    dueCount: dueNow.length,
    newCount: newInRange.length,
    reviewCount: reviewInRange.length,
    mixNewWords: settings.mixNewWords,
    newWordsPer5: settings.newWordsPer5 ?? 2,
    wordMixCounter,
  });
  let dueWords;
  switch(mixDecision){
    case "all": dueWords = allUnlocked; break; // niets binnen bereik -> toch iets tonen
    case "new": case "quotaNew": dueWords = newInRange; break;
    case "empty": dueWords = []; break; // niets due EN niets nieuws -> wordsExhausted, hieronder afgehandeld
    case "review": case "quotaReview": dueWords = reviewInRange; break;
    case "reviewOrNew": dueWords = reviewInRange.length ? reviewInRange : newInRange; break;
  }

  // Verhouding woorden/zinnen/vragen (som = 100%, via de driehoek-widget in Instellingen). Kies elke
  // keer het type dat, over de laatste 10 oefeningen, het verst ONDER zijn streefaandeel zit -- dat
  // herstelt de gewenste verhouding vanzelf over een venster van 10, i.p.v. bij elke beurt puur toeval.
  const canGenerate = hasKeyFor("sentence");
  const wordsPct = settings.wordsPercent ?? 60;
  const sentPct = canGenerate ? (settings.sentencePercent ?? 20) : 0;
  const questPct = canGenerate ? (settings.questionPercent ?? 20) : 0;
  const bestType = pickBestPracticeType(history, wordsPct, sentPct, questPct);

  // Sorteer op zwakste niveau eerst, en bij gelijk niveau op de dichtstbijzijnde duedatum (nog-nooit-
  // getoonde woorden staan al op niveau 0 met due = "nu", dus die komen vanzelf bovenaan). Bij een
  // exacte gelijke stand (zelfde niveau EN zelfde duedatum) alsnog willekeurig kiezen, anders krijg je
  // steeds precies hetzelfde woord. Werkt nu over de GECOMBINEERDE en-tr + tr-en-pool (elk item heeft
  // zijn eigen progress-sleutel "key"), zodat een due tr-en-item evengoed kan winnen als een due en-tr-
  // item -- de richting van het gekozen item ligt al vast (zie practiceWordEntries), geen losse
  // willekeurige direction-flip meer nodig/nuttig.
  function pickWeakestSoonest(list){
    if(!list.length) return null;
    // Eerst woorden die de laatste 5 minuten al aan de beurt zijn geweest uitsluiten, zodat een net
    // (fout) beantwoord woord niet meteen weer als "zwakste" bovenaan komt te staan. Als daardoor niets
    // meer overblijft (bv. een heel smal CEFR-bereik met maar een paar woorden), toch de volledige lijst
    // gebruiken -- beter een woord iets te vroeg herhalen dan helemaal geen oefening meer kunnen tonen.
    const now = Date.now();
    const eligible = list.filter(it => !isInCooldown(it.key, now));
    const pool = eligible.length ? eligible : list;
    const sorted = [...pool].sort((a,b)=>{
      const pa = getProgress(a.key), pb = getProgress(b.key);
      if(pa.level !== pb.level) return pa.level - pb.level;
      return pa.due - pb.due;
    });
    const top = getProgress(sorted[0].key);
    const tied = sorted.filter(it=>{
      const p = getProgress(it.key);
      return p.level === top.level && p.due === top.due;
    });
    const chosen = tied[Math.floor(Math.random()*tied.length)];
    markShown(chosen.key);
    // Teller ophogen voor de volgende beurt (zie de kwotering hierboven) -- ALTIJD, ongeacht of mixen
    // nu aan of uit staat, zodat de rotatie na het weer inschakelen van mixen gewoon doorloopt vanaf
    // waar hij was, i.p.v. steeds vanaf 0 te herstarten.
    wordMixCounter++;
    saveJSON(LS_WORD_MIX_COUNTER, wordMixCounter);
    return {type:"word", direction: chosen.direction, progressKey: chosen.key, en: chosen.en, cefr: chosen.cefr, wordSource: chosen.source, trData: chosen.trData};
  }

  // Suffix-oefening (vervoeging/suffixen): sinds v2.76 een EIGEN tab i.p.v. een 15%-kans binnen de
  // gewone woord-beurt hier -- zie screen-suffixes/renderSuffixPractice. Deze functie levert dus geen
  // suffix-items meer op; canOfferSuffixDrill()/generateSuffixDrill() blijven bestaan, alleen voor die
  // aparte tab.
  if(bestType === "sentence" && canGenerate) return {needsGeneration:true, kind:"sentence"};
  if(bestType === "question" && canGenerate) return {needsGeneration:true, kind:"question"};

  // Geen due woorden EN geen nieuwe woorden binnen dit bereik -> er is niets zinvols te tonen. Geen
  // woord-item teruggeven; renderPractice toont dan de melding + voorstel om het maximumbereik te
  // verhogen i.p.v. alsnog (zoals voorheen) stilzwijgend een willekeurig, niet-due woord te herhalen.
  if(wordsExhausted) return {needsRangeExpansion: true};

  return pickWeakestSoonest(dueWords);
}

/* ===================== CEFR TAALNIVEAU ===================== */





/* ===================== ZIN LATEN GENEREREN DOOR AI (niet in spaced repetition) ===================== */
function pickEnglishWordForSentence(){
  // altijd maar 1 doelwoord. Twee woorden verplicht samenpersen leidt tot onlogische
  // zinnen (bv. een vraagwoord + een concreet antwoord die elkaar tegenspreken),
  // ook als het model expliciet de instructie kreeg dat te vermijden.
  const words = [...unlockedWordSet()];
  const now = Date.now();

  // BUGFIX: dit gebruikte voorheen dezelfde "laagste level eerst"-aanpak als het gewone woordoefenpad,
  // maar dan zonder de mix-kwotering die dat pad WEL heeft (settings.mixNewWords) -- een nooit-getoond
  // woord staat altijd op niveau 0 (het laagst mogelijke, exclusief voor nieuwe woorden), dus zodra due-
  // en introduceerbare woorden gewoon samengevoegd en op laagste-niveau gesorteerd werden, wonnen nieuwe
  // woorden ALTIJD van due-woorden (due-woorden hebben nooit niveau 0). Zinnen gebruikten daardoor vrijwel
  // nooit een due-woord zolang er nog iets introduceerbaars was. Nu: due-woorden krijgen expliciet
  // voorrang, en pas als er ECHT niets due is binnen bereik valt dit terug op een nieuw/introduceerbaar
  // woord.
  const introducible = getIntroducibleWords(); // al gescoped op de huidige/ontgrendelde les(sen) + CEFR-bereik
  const dueShownAll = words.filter(en => { const p = getProgress(en); return p.reps > 0 && p.due <= now; });
  const dueShownInRange = dueShownAll.filter(inCefrRangeEn);
  if(dueShownInRange.length){
    // Due-woorden altijd voorrang boven nieuwe woorden (zie toelichting hierboven) -- en daarbinnen bij
    // voorkeur een "redelijk sterk" woord (niveau 3+, niet het broze net-geleerde niveau 1-2), zodat de
    // gebruiker zich in de zin op de zinsbouw kan concentreren i.p.v. ook nog met het doelwoord zelf te
    // worstelen. Is er binnen due niets van niveau 3+, dan toch gewoon uit alle due-woorden kiezen.
    const decent = dueShownInRange.filter(en => getProgress(en).level >= 3);
    const pool = decent.length ? decent : dueShownInRange;
    return pool[Math.floor(Math.random()*pool.length)];
  }
  if(introducible.length){
    return introducible[Math.floor(Math.random()*introducible.length)].en;
  }

  // Niets due binnen bereik EN niets introduceerbaar -> breder zoeken: eerst due-woorden ongeacht bereik,
  // en pas als er ECHT niks meer is, terugvallen op het absoluut laagste niveau van alle woorden.
  if(dueShownAll.length){
    const minLevel = Math.min(...dueShownAll.map(en=>getProgress(en).level));
    const pool = dueShownAll.filter(en=>getProgress(en).level === minLevel);
    return pool[Math.floor(Math.random()*pool.length)];
  }
  if(!words.length) return null;
  const wordsInRange = words.filter(inCefrRangeEn);
  const rankPool = wordsInRange.length ? wordsInRange : words; // ECHT niets binnen bereik (zelfs geen due-woord) -> pas dan breder
  const minLevel = Math.min(...rankPool.map(en=>getProgress(en).level));
  const pool = rankPool.filter(en=>getProgress(en).level === minLevel);
  return pool.length ? pool[Math.floor(Math.random()*pool.length)] : null;
}

/* Kiest een Engels doelwoord en zorgt dat de Turkse vorm bekend is (op aanvraag opgehaald indien nog niet gecached). */
export async function pickTurkishTargetForSentence(){
  // Tot 3 verschillende woorden proberen: als de vertaling van het eerst-gekozen woord toevallig
  // mislukt (tijdelijke netwerk-/API-hik, of een parse-foutje), moet dat niet de HELE zin-generatie
  // laten crashen -- probeer gewoon een ander woord in plaats van de fout door te laten borrelen.
  for(let i=0;i<3;i++){
    const en = pickEnglishWordForSentence();
    if(!en) break;
    try{
      const tr = await getOrFetchTranslation(en);
      return {en, tr: tr[0]};
    }catch(e){ /* dit ene woord lukte niet -> volgende poging met een ander woord */ }
  }
  // laatste redmiddel: een woord dat al zeker een (gecureerde of eerder opgehaalde) vertaling heeft,
  // dus GEEN nieuwe live AI-call meer nodig -- kan dus niet meer op dezelfde manier mislukken.
  const fallbackEn = [...unlockedWordSet()].find(en => cachedTranslation(en));
  if(fallbackEn) return {en: fallbackEn, tr: cachedTranslation(fallbackEn)[0]};
  return null;
}

/* Steekproef van woorden die de gebruiker daadwerkelijk al goed beheerst (binnen het ontgrendelde deel
   van de cursus) -- gebruikt om aan de AI expliciet mee te geven welke "vulwoorden" veilig zijn, zodat
   een zin niet stiekem onbekende woorden binnensmokkelt enkel omdat ze "bij het niveau passen". */


/* De AI geeft naast de zin zelf ook een lijst van "betekenisvolle woorden" terug (voor de klikbare
   woord-chips in het oefenscherm) -- af en toe komt het voor dat die lijst een woord bevat dat de AI
   uiteindelijk niet daadwerkelijk in de zin heeft verwerkt (een inconsistentie tussen de zin en de eigen
   metadata). Filtert zulke "spookwoorden" eruit: een woord telt mee als zijn basisvorm (of een
   herkenbare verbogen/verzachte vorm ervan) als substring in de zin voorkomt. */
// Turkse medeklinkerverzachting bij een klinker-achtervoegsel: p->b, ç->c, t->d, k->ğ (kitap->kitabı,
// ağaç->ağacı, kanat->kanadı, köpek->köpeğe/git->gid-). Levert de verzachte variant van de LAATSTE
// letter van de stam, of null als die letter niet in dit patroon valt.
function softenedStemVariant(w){
  const map = {p:"b", "ç":"c", t:"d", k:"ğ"};
  const last = w.slice(-1);
  return map[last] ? w.slice(0, -1) + map[last] : null;
}
// Bepaalt of een los doelwoord daadwerkelijk (in wat voor vervoegde/verzachte vorm dan ook) in de zin
// voorkomt: eerst de letterlijke basisvorm, dan de verzachte stam, en als laatste vangnet een kortere
// stam-prefix (achtervoegsels plakken altijd ACHTERAAN, dus de eerste paar letters blijven vrijwel
// altijd staan, op de allerlaatste letter na) -- dit voorkomt dat een woord onterecht als "spookwoord"
// uit de lijst verdwijnt puur omdat het in de zin een suffix heeft gekregen.
export function turkishWordLikelyInSentence(normSentence, trWord){
  const w = String(trWord || "").toLocaleLowerCase("tr").trim();
  if(!w) return false;
  if(normSentence.includes(w)) return true;
  if(w.includes(" ")) return false; // meerwoordige uitdrukkingen niet af-prefix-kappen
  const softened = softenedStemVariant(w);
  if(softened && normSentence.includes(softened)) return true;
  const minLen = 3;
  for(let cut = 1; cut <= 2 && w.length - cut >= minLen; cut++){
    if(normSentence.includes(w.slice(0, w.length - cut))) return true;
  }
  return false;
}




/* Aparte, gerichte controle: zou een moedertaalspreker deze zin echt zo zeggen? */


/* Een redelijk bekend woord binnen wat ontgrendeld is — gebruikt als "veilige" tegenpool wanneer een
   oefening juist gericht is op een zwak grammatica-onderwerp, zodat niet twee onbekende dingen tegelijk
   getest worden. Drempel getrapt (7 -> 4 -> 1) i.p.v. altijd hard >=7: vroeg in het leerproces zijn er
   vaak maar een paar (soms zelfs 1) woorden met level>=7, waardoor telkens exact datzelfde ene woord
   ("cd", "ev", ...) als doelwoord terugkwam in bijna elke zin van een grammatica-les. Door de drempel te
   verlagen zodra de striktere pool te klein is, wordt de pool woorden vroeg in de app een stuk groter,
   zonder de voorkeur voor beter-beheerste woorden helemaal los te laten wanneer die pool wél groot genoeg is.
   Sluit daarnaast de laatst gekozen woorden (recentWellKnownWords) tijdelijk uit: ook een pool van pak 'm
   beet 8 woorden kan bij kale random-keuze een paar keer op rij hetzelfde woord opleveren. */
export function pickWellKnownWord(){
  const unlocked = [...unlockedWordSet()];
  const MIN_POOL = 5; // onder dit aantal proberen we een soepelere drempel
  let words = [];
  for(const minLevel of [7, 4, 1]){
    const allKnown = unlocked.filter(en => { const p = getProgress(en); return p.reps > 0 && p.level >= minLevel; });
    const inRange = allKnown.filter(inCefrRangeEn);
    words = inRange.length >= MIN_POOL ? inRange : allKnown;
    if(words.length >= MIN_POOL) break;
  }
  if(!words.length) return null;
  // Recent gekozen vulwoorden tijdelijk uitsluiten, zodat een kleine pool niet alsnog telkens hetzelfde
  // woord teruggeeft door pure toevalsherhaling. Alleen toepassen als er na uitsluiting nog genoeg
  // overblijft -- anders (heel kleine pool) liever een keer herhalen dan helemaal niets kunnen kiezen.
  const fresh = words.filter(en => !recentWellKnownWords.includes(en));
  const pool = fresh.length ? fresh : words;
  const chosen = pool[Math.floor(Math.random()*pool.length)];
  noteRecentWellKnownWord(chosen);
  return chosen;
}
/* Zelfde idee, maar dan een goed beheerst grammatica-onderwerp — gebruikt als "veilige" grammatica
   wanneer een oefening juist gericht is op een nog niet goed gekend woord. */
export function pickWellKnownGrammarTopic(){
  const cefrCeiling = Math.max(settings.sentenceComplexityMin, settings.sentenceComplexityMax); // grammatica-zwaarte hoort bij zin-complexiteit, niet bij woordmoeilijkheid
  const unlockedKeys = [...unlockedGrammarTopicSet()];
  const keys = unlockedKeys.length ? unlockedKeys : GRAMMAR_TOPICS.map(t=>t.key);
  const topics = keys.map(grammarTopicByKey).filter(t => t.minCefr <= cefrCeiling);
  // level >= 7 hier is de bottleneck over alle varianten (zie getTopicProgress) -- een onderwerp telt pas
  // als "goed beheerst" zodra ELKE vorm dat niveau haalt, niet zodra gemiddeld genomen goed gescoord wordt.
  const known = topics.filter(t => getTopicProgress(t).level >= 7);
  if(!known.length) return null;
  const topic = known[Math.floor(Math.random()*known.length)];
  return effectiveTopicForVariant(topic, pickWeakestVariant(topic)); // ook als "veilige" filler: nog steeds per variant rouleren
}

/* Combineert de vocabulaire- en grammaticastand tot ÉÉN keuze per oefening: ofwel een zwak
   grammatica-onderwerp (met een woord dat al goed beheerst wordt erbij), ofwel een nog niet goed
   gekend woord (met een grammatica-onderwerp dat al goed beheerst wordt erbij) — nooit allebei
   tegelijk onbekend, en zwakkere grammatica-onderdelen komen zo vanzelf vaker aan de beurt. */




/* ===================== TR-VRAAG / TR-ANTWOORD (begrip zonder vertaling) ===================== */


// Lokale, snelle check (geen extra AI-call) of een zin daadwerkelijk een vraag is —
// vangt het geval af waarin de AI per ongeluk een mededelende stelling maakt.
export function looksLikeQuestion(tr){
  const clean = tr.trim();
  if(/\?\s*$/.test(clean)) return true; // eindigt op vraagteken
  const qWords = new Set(["ne","nasıl","niçin","neden","kim","kime","kimi","kimin","nerede","nereye",
    "nereden","kaç","kaçta","kaçıncı","hangi","hangisi","mi","mı","mu","mü",
    "misin","musun","müsün","mısın","misiniz","musunuz","müsünüz","mısınız",
    "mıyım","miyim","muyum","müyüm","mıyız","miyiz","muyuz","müyüz"]);
  const tokens = clean.toLowerCase().replace(/[.,!]/g,"").split(/\s+/);
  return tokens.some(t=>qWords.has(t));
}



// Losgetrokken uit generateQuestion() zodat generateSentence() hetzelfde pad kan hergebruiken voor
// recognitionStyle-onderwerpen (zie daar) -- zonder pickSentenceFocus() twee keer aan te roepen.




/* Laat de AI de vertaling van de hele zin beoordelen, EN per doelwoord aangeven of dat woord goed vertaald is. */


function recordResult(tr, correct, severity){
  const p = getProgress(tr);
  const grade = gradeFromResult(correct, severity);
  scheduleReview(p, grade); // zet p.stability/p.difficulty/p.due, en (voor UI-compatibiliteit) p.level/p.ease
  p.reps += 1;
  p.correct = (p.correct || 0) + (correct ? 1 : 0); // ECHTE nauwkeurigheid, los van het SRS-niveau hierboven
  if(!correct) p.lastWrongAt = Date.now(); // nodig voor het "meest recent fout"-criterium in weaknessScore()
  saveJSON(LS_PROGRESS, progress);
}

// Schaalverdeling voor de SRS-terugval/moeilijkheids-straf bij "hint gebruikt, maar toch zelf goed
// getypt": bij 1 onthulde letter/hint 50% van de volle terugval, lineair oplopend tot 100% zodra n-2
// letters onthuld zijn (en daarboven -- vanaf dat punt is het woord al zo goed als weggegeven, dus
// dan is een volledige terugval terecht). Bij een te kort woord (waar n-2 geen zinvolle marge overlaat)
// gewoon altijd de volle 100%.
function hintPenaltySeverity(item){
  let primary = item.direction === "tr-en"
    ? baseEnOf(item.en)
    : (item.tr || (item.senseTr && item.senseTr[0]) || (cachedTranslation(item.en) || [])[0] || "");
  // Werkwoorden eindigen in het Turks ALTIJD op -mek/-mak -- dat achtervoegsel weggeven is dus geen
  // echte hint (de gebruiker weet dat toch al), en mag niet meetellen in de lengte waarop de
  // schaalverdeling (n-2) gebaseerd is. Alleen relevant voor en-tr (bij tr-en is "primary" de Engelse
  // vertaling, die niet op -mek/-mak eindigt).
  if(item.direction !== "tr-en" && wordCategoryOf(item.en) === "v."){
    primary = primary.replace(/(mek|mak)$/i, "");
  }
  const letterCount = (primary || "").replace(/\s/g, "").length;
  const cap = letterCount - 2;
  if(cap <= 1) return 1;
  const hintLevel = Math.max(1, Math.min(item.hintLevel || 1, cap));
  return 0.5 + 0.5 * (hintLevel - 1) / (cap - 1);
}

function recordHistory(type){
  history.push(type);
  if(history.length > 30) history = history.slice(-30);
  saveJSON(LS_HISTORY, history);
}

/* ===================== ANTWOORD CONTROLEREN ===================== */
/* Probeert eerst gewoon te parsen; lukt dat niet, dan wordt aangenomen dat de string halverwege is
   afgekapt (ontbrekende sluithaakjes/-aanhalingsteken) en wordt die afsluiting alsnog toegevoegd,
   als allerlaatste redmiddel ná de herkansingen die callClaude/callDeepSeek zelf al doen. Zo verlies
   je in het ergste geval alleen het allerlaatste, half afgemaakte veld, in plaats van de hele oefening. */


// Een deel van de en-tr-curatie plakt een verduidelijkende context-noot ACHTER de eigenlijke vertaling,
// bv. "grup (müzik)" of "başlık (unvan)" -- bedoeld als leeshulp bij de referentievertaling die na het
// beoordelen getoond wordt, niet als letterlijk te typen tekst. Zonder deze stap zou een gebruiker die
// gewoon "grup" typt (een prima, volledig antwoord) afgekeurd worden puur omdat de opgeslagen string ook
// de haakjes-toevoeging bevat. Strip daarom bij het BEOORDELEN een eventuele losse "(...)" aan het einde
// -- de volledige, ongestripte tekst blijft intact voor weergave (cachedTranslation/correctAnswer etc.).

// Zoekt, binnen de bekende vertalingen van dit woord, de specifieke (correct geaccentueerde) Turkse
// tekst die overeenkomt met wat de gebruiker typte -- een en-tr-woord kan meerdere geldige Turkse
// synoniemen hebben (bv. "çağrı" EN "arama" voor "call"), en zonder deze check werd bij het uitspreken
// altijd de eerste/standaard vertaling gepakt, ongeacht welke van de synoniemen de gebruiker had getypt.


// Bij een door de AI als TIKFOUT goedgekeurd antwoord (verdict.afwijking bevat "typo"/"tikfout") mag niet
// de getypte tekst zelf uitgesproken worden (dat is per definitie verkeerd gespeld) -- zoek in plaats
// daarvan de dichtstbijzijnde bekende, correct gespelde vertaling op (Levenshtein, net als de tikfout-
// tolerantie zelf al gebruikt).






/* ===================== DEEPSEEK API ===================== */




/* ===================== UI STATE ===================== */
let currentItem = null;
let lastNoneDueInRange = false; // true als er niets due is, maar er WEL nog nieuwe woorden zijn om op terug te vallen
let wordsExhausted = false; // true als er niets due EN niets nieuws is binnen het ingestelde CEFR-bereik -- niets zinvols te tonen
let lastAutoSwitchedFrom = null; // bij een vaste richting: de richting waar deze beurt vanaf geswitcht is (null = geen switch), zie resolveWordDirectionForThisTurn
let retryPending = false; // true na een fout antwoord op een los woord: de fout is al geregistreerd, maar "Next" blijft geblokkeerd tot het juiste antwoord alsnog getypt is
let currentAnswered = false;
let currentCorrect = null;
let chatMsgs = []; // voor de "vraag aan AI"-modal, per huidige item
let revealedWords = new Set(); // woorden waarvan de gebruiker binnen deze oefening de vertaling heeft opgevraagd -> tellen als fout
let lastExplanation = "";
// Onthoudt de laatste paar woorden die als basis voor een grammatica-drill zijn gebruikt (binnen de
// huidige skill-practice/kennischeck-sessie), zodat pickMasteredPoolWords/pickMasteredPossessorWords
// ze kan vermijden -- voorkomt dat je bij een klein "beheerst"-pool telkens (bijna) dezelfde zin krijgt.
// Gereset bij het starten van een nieuwe sessie (startSkillPractice/startCheckup).
let recentGrammarDrillWords = new Set();
const RECENT_GRAMMAR_DRILL_WORDS_MAX = 5;
// Zelfde idee, maar voor het VOCABULAIRE-deel van de kennischeck: welk woord er als volgende gevraagd
// wordt, hield tot nu toe totaal geen rekening met wat er zonet al gevraagd is binnen dezelfde sessie
// -- bij een niveau met een kleine woordenpool kon dat (meerdere keren) hetzelfde woord opleveren,
// soms zelfs meerdere keren achter elkaar. Gereset bij het starten van een nieuwe kennischeck.
let recentCheckupVocabWords = new Set();
const RECENT_CHECKUP_VOCAB_WORDS_MAX = 8;

const el = id => document.getElementById(id);

let explanationLoader = null; // functie die, pas op verzoek (klik), een Promise<string> ophaalt

function setExplanation(text){
  lastExplanation = (text || "").trim();
  explanationLoader = null;
  el("explanation-box").classList.add("hidden");
  el("explanation-box").textContent = "";
  el("btn-show-explanation").classList.toggle("hidden", !lastExplanation);
}
// Toont de Explanation-knop meteen, maar stelt de daadwerkelijke (AI-)inhoud uit tot de gebruiker 'm
// echt opent -- zo kost een simpel, meteen-goed antwoord GEEN automatische AI-call; alleen desgevraagd,
// en dan met echte inhoud (nooit een kaal statusbericht als "no answer entered").
function setExplanationLoader(loaderFn){
  lastExplanation = "";
  explanationLoader = loaderFn;
  el("explanation-box").classList.add("hidden");
  el("explanation-box").textContent = "";
  el("btn-show-explanation").classList.remove("hidden");
}
async function toggleExplanation(){
  const box = el("explanation-box");
  if(!box.classList.contains("hidden")){
    box.classList.add("hidden");
    return;
  }
  if(lastExplanation){
    box.textContent = lastExplanation;
    box.classList.remove("hidden");
    return;
  }
  if(explanationLoader){
    const loader = explanationLoader;
    box.textContent = "🤖 Loading explanation…";
    box.classList.remove("hidden");
    const text = await loader();
    if(explanationLoader !== loader) return; // ondertussen naar een ander woord/oefening gewisseld
    lastExplanation = text || "(No explanation available.)";
    explanationLoader = null;
    box.textContent = lastExplanation;
  }
}

// Detecteert apparaten met waarschijnlijk een fysiek toetsenbord (laptop/desktop met muis/trackpad),
// zodat we daar automatisch focussen (Enter = volgende) maar op telefoon/tablet niet (voorkomt dat
// het schermtoetsenbord na elk antwoord vanzelf opduikt).
function hasLikelyPhysicalKeyboard(){
  try{
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }catch(e){ return false; }
}

function fmtLevel(p){
  return `level ${p.level} / 10 · next review in ${fmtDuration(p.due - Date.now())}`;
}
function fmtDuration(ms){
  if(ms <= 0) return "now";
  const min = ms/60000;
  if(min < 60) return Math.round(min) + " min";
  const hr = min/60;
  if(hr < 24) return Math.round(hr) + " hr";
  const day = hr/24;
  if(day < 30) return Math.round(day) + " day" + (Math.round(day)===1?"":"s");
  const month = day/30;
  if(month < 12) return Math.round(month) + " month" + (Math.round(month)===1?"":"s");
  return (day/365).toFixed(1) + " yr";
}

function renderWordChips(){
  el("level-label").innerHTML = "scoring words (tap to peek — counts as wrong): " +
    currentItem.words.map(w=>{
      const revealed = revealedWords.has(w.en);
      if(revealed){
        return `<span class="word-chip revealed">${w.tr} = ${baseEnOf(w.en)}</span>`;
      }
      return `<span class="word-chip" data-word="${w.en.replace(/"/g,'&quot;')}">${w.tr} 👁️</span>`;
    }).join(" ");
  el("level-label").querySelectorAll(".word-chip:not(.revealed)").forEach(chip=>{
    chip.addEventListener("click", ()=> revealWord(chip.dataset.word));
  });
}

function revealWord(en){
  if(currentAnswered) return; // na beoordeling niet meer relevant
  revealedWords.add(en);
  renderWordChips();
}

// Verhoogt settings.cefrMax met 1 (geklemd op MAX_VOCAB_CEFR_IDX) en houdt de CEFR-range-UI in
// Instellingen synchroon, mocht die net zichtbaar zijn. Gedeelde, globale tegenhanger van de nested
// applyCefrRange()-helper in de DOMContentLoaded-init (die niet van buiten die scope aan te roepen is).
function bumpMaxCefrRangeByOne(){
  const newMax = Math.min(MAX_VOCAB_CEFR_IDX, (settings.cefrMax ?? 0) + 1);
  if(newMax === settings.cefrMax) return false; // al op het maximum -- niets te verhogen
  settings.cefrMax = newMax;
  if(settings.cefrMin > settings.cefrMax) settings.cefrMin = settings.cefrMax;
  saveJSON(LS_SETTINGS, settings);
  if(el("cefr-max-slider")){
    el("cefr-max-slider").value = settings.cefrMax;
    el("cefr-max-select").value = settings.cefrMax;
    el("cefr-max-label").textContent = cefrLabel(settings.cefrMax);
    el("cefr-min-slider").value = settings.cefrMin;
    el("cefr-min-select").value = settings.cefrMin;
    el("cefr-min-label").textContent = cefrLabel(settings.cefrMin);
  }
  updateCefrUnlockedInfo();
  return true;
}

// Toont de "niets te tonen binnen dit bereik"-melding i.p.v. een oefening: geen due woorden EN geen
// nieuwe woorden meer binnen het ingestelde CEFR-bereik. Stelt concreet voor het maximumbereik met 1
// te verhogen (ja/nee) -- bij "ja" wordt dat direct doorgevoerd en de oefening opnieuw geladen.
function showRangeExhaustedNotice(){
  currentItem = null;
  el("badge-type").textContent = "word";
  el("badge-type").className = "badge badge-word";
  el("tr-word").textContent = "No words available";
  el("tr-word").className = "tr-word";
  el("word-meta").textContent = "";
  el("btn-edit-flashcard").classList.add("hidden");
  el("btn-reveal-word").classList.add("hidden");
  el("level-fill").style.width = "0%";
  el("level-label").textContent = "";
  el("answer-instruction").querySelector("span").textContent = "";
  el("answer-input").value = "";
  el("answer-input").disabled = true;
  el("btn-check").disabled = true;
  el("btn-skip").disabled = true;
  el("range-empty-notice").classList.add("hidden");
  const nextMax = Math.min(MAX_VOCAB_CEFR_IDX, (settings.cefrMax ?? 0) + 1);
  el("range-expand-target").textContent = cefrLabel(nextMax);
  el("btn-expand-range-yes").classList.toggle("hidden", nextMax === settings.cefrMax); // al op het plafond -> geen zinloze "ja"-knop
  el("range-exhausted-notice").classList.remove("hidden");
}

async function renderPractice(){
  currentAnswered = false;
  retryPending = false;
  currentCorrect = null;
  chatMsgs = [];
  revealedWords = new Set();
  setExplanation("");
  el("feedback-box").innerHTML = "";
  el("post-actions").classList.add("hidden");
  el("btn-dispute").disabled = false;
  el("btn-check").textContent = "Check";
  el("answer-input").value = "";
  el("answer-input").disabled = true;
  el("btn-check").disabled = true;

  el("btn-skip").disabled = true;
  el("range-exhausted-notice").classList.add("hidden");
  el("direction-switch-notice").classList.add("hidden");
  renderDueCount();

  let picked = pickNextItem();

  if(picked && picked.needsRangeExpansion){
    showRangeExhaustedNotice();
    return;
  }

  if(picked && picked.needsGeneration){
    const kind = picked.kind || "sentence";
    const isQ = kind === "question";
    const isSuffix = kind === "suffix";
    el("badge-type").textContent = isSuffix ? "suffix" : (isQ ? "question" : "sentence");
    el("badge-type").className = "badge " + (isSuffix ? "badge-word" : (isQ ? "badge-question" : "badge-sentence"));
    el("tr-word").textContent = isSuffix ? "🤖 …" : (isQ ? "🤖 AI is coming up with a question…" : "🤖 AI is generating a sentence…");
    el("tr-word").className = "tr-word" + (isSuffix ? "" : " sentence");
    el("word-meta").textContent = ""; // anders blijft de ondertitel (bv. CEFR-niveau/pos) van het VORIGE woord zichtbaar tijdens het genereren
    setSpeakableTr(null); // idem voor de 🔊-knop, die anders ook naar het vorige woord bleef wijzen
    el("level-fill").style.width = "0%";
    el("level-label").textContent = "please wait…";
    el("answer-instruction").querySelector("span").textContent = "";
    try{
      picked = isSuffix ? await generateSuffixDrill() : (isQ ? await generateQuestion() : await generateSentence());
    }catch(e){
      showFeedback("wrong", "⚠️ Could not generate a " + (isSuffix ? "suffix exercise" : (isQ ? "question" : "sentence")) + ": " + e.message + ". Try again or continue with a word.");
      recordHistory("word");
      picked = null;
    }
  } else if(picked && picked.type === "word"){
    // vertaling op aanvraag: pas nu, want dit woord is nu daadwerkelijk aan de beurt
    el("badge-type").textContent = "word";
    el("badge-type").className = "badge badge-word";
    el("tr-word").textContent = "🤖 …";
    el("level-fill").style.width = "0%";
    el("level-label").textContent = "please wait…";
    if(picked.wordSource === "tr"){
      // tr-en-item: alle gegevens staan al rechtstreeks in TR_WORDS_DATA (trData), geen aparte
      // resolveWordSense/REVERSE_TR_INDEX-opzoeking nodig -- dat zou hetzelfde nogmaals doen.
      const td = picked.trData;
      picked.tr = td.tr;
      picked.senseTr = [td.tr];
      picked.gloss = td.gloss;
      picked.note = td.note;
      picked.registerInfo = (td.register && td.register !== "neutral") ? {register: td.register, note: ""} : null;
    } else {
      let sense = await resolveWordSense(picked.en, picked.direction);
      if(sense){
        picked.tr = sense.tr[0];
        picked.senseTr = sense.tr; // de volledige, bij DEZE oefening horende vertaal-lijst -- gebruikt bij het beoordelen
        picked.gloss = sense.gloss; // alleen gezet als dit woord >1 betekenis heeft
        picked.note = sense.note; // korte, altijd zichtbare betekenis-hint -- zie wordMetaText()
        picked.registerInfo = (sense.register && sense.register !== "neutral") ? {register: sense.register, note: ""} : null;
      } else {
        picked.tr = null; // geen sleutel of fout: en-tr blijft dan werken via tekstinvoer, tr-en niet mogelijk
        if(picked.direction === "tr-en") picked.direction = "en-tr";
      }
    }
  }

  if(!picked){
    // val terug op het eerst beschikbare EN-TR-woord (bv. na een mislukte generatie)
    const words = allWords();
    const now = Date.now();
    const due = words.filter(w => getProgress(w.en).due <= now);
    const base = due.length ? due[0] : words[0];
    picked = {...base, type:"word", direction:"en-tr", progressKey: base.en, wordSource:"en"};
  }

  currentItem = picked;
  el("answer-input").disabled = false;
  el("btn-check").disabled = false;
  el("btn-skip").disabled = false;

  if(!currentItem){
    el("tr-word").textContent = "No items found.";
    return;
  }
  const isSentence = currentItem.type === "sentence";
  const isQuestion = currentItem.type === "question";
  const isWord = currentItem.type === "word";
  const isTrEn = isWord && currentItem.direction === "tr-en";
  const isSuffix = currentItem.type === "suffix";

  el("badge-type").textContent = isSuffix ? "suffix" : (isQuestion ? "question" : (isSentence ? "sentence" : (isTrEn ? "TR → EN" : "EN → TR")));
  el("badge-type").className = "badge " + (isQuestion ? "badge-question" : (isSentence ? "badge-sentence" : "badge-word"));
  el("btn-edit-flashcard").classList.toggle("hidden", !isWord);
  el("btn-reveal-word").classList.toggle("hidden", !isWord);
  const wordEl = el("tr-word");
  wordEl.textContent = isSuffix ? currentItem.prompt : ((isWord && !isTrEn) ? displayEnglishWord(currentItem.en) : (currentItem.tr || baseEnOf(currentItem.en)));
  setSpeakableTr((isTrEn || isSentence || isQuestion) ? currentItem.tr : null); // bij en-tr is de Turkse vertaling pas na het beoordelen bekend; zinnen/vragen tonen meteen Turkse tekst
  if((isTrEn || isSentence || isQuestion) && currentItem.tr) speakTurkish(currentItem.tr); // automatisch uitspreken zodra het in beeld komt
  currentItem.hintRevealed = false;
  wordEl.className = "tr-word" + ((isSentence||isQuestion) ? " sentence" : "");
  el("word-peek-hint").classList.add("hidden");
  el("word-peek-hint").textContent = "";
  el("word-peek-hint").onclick = null;

  if(isWord){
    // Alleen onderstreept/klikbaar als de vertaling lokaal (zonder AI) bekend is -- tr-en-woorden komen
    // altijd uit de eigen gecureerde TR_WORDS_DATA (dus altijd bekend); en-tr-woorden alleen als er al
    // een curatedTr/override-vertaling voor bestaat.
    const known = currentItem.wordSource === "tr" ? true : !!(cachedTranslation(currentItem.en) && cachedTranslation(currentItem.en).length);
    if(known && !revealedWords.has(currentItem.progressKey || currentItem.en)){
      wordEl.style.textDecoration = "underline";
      wordEl.style.textDecorationStyle = "dotted";
      wordEl.style.cursor = "pointer";
      wordEl.onclick = peekCurrentWord;
    } else {
      wordEl.style.textDecoration = "none";
      wordEl.style.cursor = "default";
      wordEl.onclick = null;
    }
    if(currentItem.wordSource === "tr"){
      // tr-en-item: gebruik het EIGEN pos/cefr van de tr-en-entry, niet de (mogelijk afwijkende)
      // en-tr-gegevens van hetzelfde Engelse trefwoord.
      const posAbbr = (currentItem.trData && (WORD_CATEGORY_ABBR[currentItem.trData.pos] || currentItem.trData.pos)) || "";
      const cefrTxt = typeof currentItem.cefr === "number" ? cefrLabel(currentItem.cefr) : null;
      // Woorden met meerdere losstaande betekenissen (bv. "yüz" = gezicht/zwemmen/honderd) kregen tot
      // v3.53 hun disambiguatie letterlijk IN het te raden Turkse woord verwerkt ("yüz (sayı)"), en
      // dat nog in het Turks -- dat helpt een Engelstalige gebruiker niet. Zit er een (nu Engelse)
      // note bij deze entry, toon die dan als hint i.p.v. de kale pos-afkorting, net als wordMetaText
      // dat al voor de en-tr-richting doet.
      const note = currentItem.trData && currentItem.trData.note;
      const noteTxt = note ? (/^\(.*\)$/.test(note.trim()) ? note.trim() : `(${note.trim()})`) : null;
      el("word-meta").textContent = [cefrTxt, noteTxt || (posAbbr || null)].filter(Boolean).join(" · ");
    } else {
      const cefr18 = wordCefrOf(currentItem.en);
      el("word-meta").textContent = wordMetaText(cefr18, currentItem.en, currentItem.note);
    }
  } else if(isSuffix){
    el("word-meta").textContent = "conjugate this verb using a grammar pattern you've already mastered";
    wordEl.style.textDecoration = "none";
    wordEl.style.cursor = "default";
    wordEl.onclick = null;
  } else {
    el("word-meta").textContent = "";
    // sentences/questions gebruiken hun EIGEN klikbare-woord-chips-mechanisme (renderWordChips) i.p.v.
    // het hele blok klikbaar te maken -- dus hier altijd resetten.
    wordEl.style.textDecoration = "none";
    wordEl.style.cursor = "default";
    wordEl.onclick = null;
  }

  el("answer-input").placeholder = isQuestion
    ? "Type your answer in Turkish…"
    : (isTrEn ? "Type the English translation…" : "Type the Turkish translation…");

  const instrEl = el("answer-instruction").querySelector("span");
  if(isQuestion){
    instrEl.textContent = "❓ Answer this Turkish question — IN TURKISH (not a translation!)";
    instrEl.style.color = "#5fc4e8";
  } else if(isSentence){
    instrEl.textContent = "✍️ Translate this Turkish sentence into English";
    instrEl.style.color = "var(--warn)";
  } else if(isSuffix){
    instrEl.textContent = "✍️ Type the correctly conjugated Turkish word";
    instrEl.style.color = "var(--muted)";
  } else if(isTrEn){
    instrEl.textContent = "✍️ Translate this Turkish word into English";
    instrEl.style.color = "var(--muted)";
  } else {
    instrEl.textContent = "✍️ Translate this English word into Turkish";
    instrEl.style.color = "var(--muted)";
  }

  if(isSentence || isQuestion){
    el("level-fill").style.width = "0%";
    renderWordChips();
  } else {
    const p = getProgress(currentItem.progressKey || currentItem.en);
    el("level-fill").style.width = (p.level*10) + "%";
    el("level-label").textContent = fmtLevel(p);
  }

  el("no-key-warning").style.display = hasKeyFor("word") ? "none" : "block";
  el("range-empty-notice").classList.toggle("hidden", !lastNoneDueInRange);
  const showSwitchNotice = currentItem.type === "word" && !!lastAutoSwitchedFrom;
  if(showSwitchNotice){
    el("direction-switch-from").textContent = lastAutoSwitchedFrom === "en-tr" ? "EN→TR" : "TR→EN";
    el("direction-switch-to").textContent = lastAutoSwitchedFrom === "en-tr" ? "TR→EN" : "EN→TR";
  }
  el("direction-switch-notice").classList.toggle("hidden", !showSwitchNotice);
  setTimeout(()=> el("answer-input").focus(), 50);
}

/* ===================== GELUIDSEFFECTEN (correct/fout) =====================
   Gesynthetiseerd via de Web Audio API i.p.v. een los geluidsbestand -- geen extra download, werkt ook
   offline in de PWA. AudioContext wordt pas bij de EERSTE aanroep aangemaakt (en zo nodig resumed),
   want browsers staan geen audio toe voordat er een user-gesture is geweest; een klik op "Check" is
   zo'n gesture, dus dat komt vanzelf goed. Nooit kritiek voor de werking van de app -- elke fout
   (geen Web Audio-ondersteuning, autoplay-blokkade, etc.) wordt stilzwijgend genegeerd. */
let _feedbackAudioCtx = null;
function getFeedbackAudioCtx(){
  if(!_feedbackAudioCtx){
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if(!Ctor) return null;
    try{ _feedbackAudioCtx = new Ctor(); }catch(e){ return null; }
  }
  if(_feedbackAudioCtx.state === "suspended") _feedbackAudioCtx.resume().catch(()=>{});
  return _feedbackAudioCtx;
}
function playFeedbackTone(ctx, freq, startTime, duration, type, peakGain){
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008); // korte fade-in, voorkomt een tikje/klik
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}
// kind: "correct" -> vrolijke oplopende pling (2 tonen, samen ~310ms); "wrong" -> korte, schurende
// buzzer (2 net-niet-samenvallende lage tonen tegelijk, ~400ms). Beide ruim binnen de 500ms-grens.
function playFeedbackSound(kind){
  if(!settings.soundEffects) return;
  if(kind !== "correct" && kind !== "wrong") return; // "pending" en overige kinds blijven stil
  const ctx = getFeedbackAudioCtx();
  if(!ctx) return;
  try{
    const now = ctx.currentTime;
    if(kind === "correct"){
      playFeedbackTone(ctx, 880.0, now, 0.16, "sine", 0.18);
      playFeedbackTone(ctx, 1318.5, now + 0.09, 0.22, "sine", 0.16);
    } else {
      playFeedbackTone(ctx, 165, now, 0.4, "sawtooth", 0.12);
      playFeedbackTone(ctx, 155, now, 0.4, "sawtooth", 0.10);
    }
  }catch(e){ /* geluid is nooit kritiek voor de werking van de oefening -- gewoon negeren */ }
}

/* ===================== TURKSE UITSPRAAK (tekst-naar-spraak) =====================
   Gebruikt de ingebouwde Web Speech API (SpeechSynthesis) van de browser -- GEEN AI, geen server-call,
   geen audiobestand nodig. Kwaliteit/beschikbaarheid van een Turkse stem hangt af van het apparaat/de
   browser van de gebruiker; is er geen "tr-TR"-stem beschikbaar, dan valt de browser meestal terug op
   een andere stem of doet gewoon niets -- dat is buiten onze controle en niet iets om over te alarmeren. */
let _cachedVoices = [];
function refreshVoiceCache(){
  if(!("speechSynthesis" in window)) return;
  try{ _cachedVoices = window.speechSynthesis.getVoices() || []; }catch(e){ /* negeren */ }
}
if("speechSynthesis" in window){
  // BUGFIX (TTS "werkt niet altijd" #1): getVoices() geeft bij de ALLEREERSTE aanroep in veel browsers
  // een lege lijst terug -- de stemmenlijst wordt pas asynchroon geladen. Zonder deze warm-up kon de
  // eerste uitspraak van een sessie stil blijven (geen tr-TR-stem gevonden, browser valt soms op niets
  // terug i.p.v. op een andere stem) terwijl latere uitspraken wel werkten.
  refreshVoiceCache();
  window.speechSynthesis.addEventListener("voiceschanged", refreshVoiceCache);
}
function pickTurkishVoice(){
  if(!_cachedVoices.length) refreshVoiceCache();
  return _cachedVoices.find(v => v.lang === "tr-TR")
    || _cachedVoices.find(v => (v.lang||"").toLowerCase().startsWith("tr"))
    || null;
}
function speakTurkish(text, rate){
  if(!text || !("speechSynthesis" in window)) return;
  const doSpeak = (retry)=>{
    try{
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "tr-TR";
      utter.rate = rate || 0.9; // iets trager dan standaard, makkelijker te volgen tijdens het leren
      const voice = pickTurkishVoice();
      if(voice) utter.voice = voice; // BUGFIX #2: expliciet een tr-TR-stem meegeven i.p.v. alleen op
      // utter.lang te vertrouwen -- sommige browsers negeren lang stilzwijgend als er geen exact
      // passende stem "toegewezen" is, en spreken dan met de systeemstandaardstem (of helemaal niet).
      if(!retry){
        // BUGFIX (TTS "werkt niet altijd" #3): geen enkele automatische herpoging bestond bij een falende
        // uitspraak (bv. browser negeert de aanroep zonder foutmelding, of de stem was nog niet geladen).
        // Eén stille herpoging na een korte pauze vangt het gros van die stille fails op.
        utter.onerror = ()=> setTimeout(()=> doSpeak(true), 150);
      }
      window.speechSynthesis.speak(utter);
    }catch(e){ /* uitspraak is nooit kritiek voor de werking van de oefening -- gewoon negeren */ }
  };
  try{
    window.speechSynthesis.cancel(); // een eventuele nog lopende uitspraak afbreken voor de nieuwe
  }catch(e){ /* negeren */ }
  // BUGFIX (TTS "werkt niet altijd" #4): speak() vlak na cancel() in dezelfde synchrone tick wordt in
  // sommige Chromium-versies stilzwijgend genegeerd (bekende browserbug) -- een héél korte vertraging
  // ertussen voorkomt dat.
  setTimeout(()=> doSpeak(false), 40);
}
// Houdt bij welk Turks woord op dit moment "spreekbaar" is voor de twee vaste 🔊-knoppen (hoofdscherm en
// checkup-scherm). Bij tr-en is dat vanaf het tonen van de vraag al bekend; bij en-tr pas na het
// beoordelen (dan is de Turkse vertaling immers pas bekend).
let currentSpeakableTr = null;
let currentCheckupSpeakableTr = null;
function setSpeakableTr(text){
  currentSpeakableTr = text || null;
  const btn = el("btn-speak-word");
  if(btn) btn.classList.toggle("hidden", !currentSpeakableTr);
  const slowBtn = el("btn-speak-word-slow");
  if(slowBtn) slowBtn.classList.toggle("hidden", !currentSpeakableTr);
}
function setCheckupSpeakableTr(text){
  currentCheckupSpeakableTr = text || null;
  const btn = el("btn-checkup-speak-word");
  if(btn) btn.classList.toggle("hidden", !currentCheckupSpeakableTr);
}

function showFeedback(kind, html){
  const box = el("feedback-box");
  box.innerHTML = `<div class="feedback ${kind}">${html}</div>`;
  playFeedbackSound(kind);
}

// Short, clearly coloured line: "wrong answer: X" (red) and/or "correct answer: Y" (green)
function answerCompareLine(userAnswer, correctAnswer, wasCorrect, wrongMeaning, registerInfo, deviation){
  const wrongPart = (!wasCorrect && userAnswer)
    ? (wrongMeaning
        ? `Wrong: <span style="color:var(--accent);font-weight:600;">${escapeHtml(userAnswer)}</span> means <span style="color:var(--accent);font-weight:600;">${escapeHtml(wrongMeaning)}</span>.`
        : `wrong answer: <span style="color:var(--accent);font-weight:600;">${escapeHtml(userAnswer)}</span>`)
    : "";
  const goodPart = correctAnswer
    ? `${wasCorrect ? "correct answer" : "Correct answer is"}: <span style="color:var(--accent2);font-weight:600;">${escapeHtml(correctAnswer)}</span>`
    : "";
  const registerPart = (wasCorrect && registerInfo)
    ? `<br><span class="muted">ℹ️ Heads up: this is a bit ${registerInfo.register}${registerInfo.note ? " — " + escapeHtml(registerInfo.note) : ""}.</span>`
    : "";
  // Wat precies afweek bij een GOEDGEKEURD-maar-niet-exact antwoord (tikfout, minder gebruikelijk
  // synoniem, andere vervoeging, ...) -- direct zichtbaar in de feedback, niet pas na het openen van
  // het uitklapbare "Explanation"-paneel.
  const deviationPart = (wasCorrect && deviation)
    ? `<br><span class="muted">📝 ${escapeHtml(deviation)}</span>`
    : "";
  return [wrongPart, goodPart].filter(Boolean).join("<br>") + registerPart + deviationPart;
}

// Toont het correcte Engelse antwoord bij een tr-en-oefening -- voor een tr-en-item afkomstig uit de
// EIGEN tr-en-lijst (TR_WORDS_DATA) gebruikt dit het EIGEN pos-veld van die entry (displayTrEntryGloss),
// i.p.v. te gokken via de mogelijk afwijkende woordsoort van hetzelfde Engelse trefwoord in de en-tr-lijst.


// Masking-helper voor de progressieve letterhint: toont de eerste `revealCount` letters, de rest als
// puntjes -- spaties (bij een meerwoordig antwoord, bv. "diş hekimi") blijven altijd zichtbaar en tellen
// niet mee als "letter".
function maskWordForHint(word, revealCount){
  let shown = 0;
  return word.split("").map(ch=>{
    if(ch === " ") return " ";
    shown++;
    return shown <= revealCount ? ch : "•";
  }).join("");
}

// Klik op het woord zelf (alleen actief als onderstreept, d.w.z. de vertaling lokaal/zonder AI bekend
// is): geeft een PROGRESSIEVE hint -- 1e klik toont de eerste letter + puntjes voor de rest, elke
// volgende klik voegt daar nog een letter aan toe, tot het hele woord onthuld is. Dit gebeurt ZONDER de
// oefening te beëindigen of het antwoordveld te blokkeren -- dat gebeurt pas zodra je daadwerkelijk op
// Check drukt (zie handleCheck hieronder), net als bij het klikbare-woord-chips-mechanisme binnen
// zinnen/vragen. Al bij de EERSTE hint-letter geldt dit woord als "opgezocht", zodat het bij die latere
// Check-actie linea recta als fout wordt geteld -- een SRS-terugval, ongeacht wat je daarna nog typt.
function peekCurrentWord(){
  if(!currentItem || currentItem.type !== "word" || currentAnswered) return;
  const key = currentItem.progressKey || currentItem.en;
  const primary = currentItem.direction === "tr-en"
    ? correctEnglishDisplayFor(currentItem)
    : ((currentItem.senseTr && currentItem.senseTr[0]) || (cachedTranslation(currentItem.en) || [])[0] || "");
  if(!primary) return;
  const letterCount = primary.replace(/\s/g, "").length;
  currentItem.hintLevel = Math.min(letterCount, (currentItem.hintLevel || 0) + 1);
  revealedWords.add(key); // al bij de eerste hint-letter telt dit woord als "opgezocht" voor de score
  const fullyRevealed = currentItem.hintLevel >= letterCount;
  el("word-peek-hint").textContent = "💡 " + maskWordForHint(primary, currentItem.hintLevel) + (fullyRevealed ? "" : "  (tap for another letter)");
  el("word-peek-hint").classList.remove("hidden");
  // De hint-tekst zelf moet ook klikbaar zijn -- "tap for another letter" staat IN dat blokje, dus wie
  // daarop tikt (i.p.v. op het woord erboven) moet ook echt een letter erbij krijgen.
  el("word-peek-hint").style.cursor = fullyRevealed ? "default" : "pointer";
  el("word-peek-hint").onclick = fullyRevealed ? null : peekCurrentWord;
  if(fullyRevealed){
    el("tr-word").style.cursor = "default";
    el("tr-word").style.textDecoration = "none";
    el("tr-word").onclick = null;
  }
}

// Wordt aangeroepen bij een fout antwoord op een los woord (verkeerd getypt, leeg, gepiept, of AI-
// afgekeurd): registreert de fout ÉÉNMALIG (zoals voorheen), maar schakelt -- in tegenstelling tot
// finalizeAnswer() -- NIET meteen door naar "Next": het antwoordveld blijft actief en btn-check blijft
// "Check" tonen, zodat de gebruiker gedwongen wordt het juiste antwoord alsnog te typen voordat hij
// verder kan. Zie de `retryPending`-tak bovenaan handleCheck() voor de herkansing zelf.
function enterWordRetry(message){
  currentCorrect = false;
  if(currentItem.direction === "en-tr" && currentItem.tr) setSpeakableTr(currentItem.tr); // nu bekend, ook bij een fout antwoord
  recordHistory("word");
  recordResult(currentItem.progressKey || currentItem.en, false);
  const lessonNote = advanceLessonSession();
  const adaptiveNote = recordAdaptiveResult(false);
  showFeedback("wrong", message + lessonNote + adaptiveNote);
  el("post-actions").classList.remove("hidden");
  el("btn-dispute").classList.remove("hidden");
  el("btn-reveal-word").classList.add("hidden");
  const p = getProgress(currentItem.progressKey || currentItem.en);
  el("level-fill").style.width = (p.level*10) + "%";
  el("level-label").textContent = fmtLevel(p);
  retryPending = true;
  el("btn-check").textContent = "Check"; // blijft "Check" i.p.v. "Next" -- geforceerde herkansing
  el("btn-check").disabled = false;
  el("answer-input").value = "";
  el("answer-input").disabled = false;
  if(hasLikelyPhysicalKeyboard()) el("answer-input").focus();
}

// Toont "Correct!" (de gebruiker typte het antwoord zelf, ook al kwam dat met hulp van een hint), maar
// registreert er ACHTER DE SCHERMEN toch een fout mee (de SRS-terugval voor het gebruikte hint blijft
// gewoon staan) -- i.p.v. het verwarrende "Wrong answer: X / Correct answer: X" van voorheen, en zonder
// nog een aparte herkansing te forceren: de gebruiker heeft het antwoord net al 1x zelf goed getypt.
function finalizeCorrectDisplayButScoredWrong(message){
  currentCorrect = false;
  if(currentItem.direction === "en-tr" && currentItem.tr) setSpeakableTr(currentItem.matchedTr || currentItem.tr);
  if(currentItem.direction === "en-tr" && currentItem.tr) speakTurkish(currentItem.matchedTr || currentItem.tr); // getypt antwoord was zelf wél juist -- spreek dat specifieke synoniem uit
  recordHistory("word");
  recordResult(currentItem.progressKey || currentItem.en, false, hintPenaltySeverity(currentItem));
  const lessonNote = advanceLessonSession();
  const adaptiveNote = recordAdaptiveResult(false);
  showFeedback("correct", message + lessonNote + adaptiveNote);
  el("post-actions").classList.remove("hidden");
  el("btn-dispute").classList.add("hidden");
  el("btn-reveal-word").classList.add("hidden");
  el("btn-skip").disabled = true;
  const p = getProgress(currentItem.progressKey || currentItem.en);
  el("level-fill").style.width = (p.level*10) + "%";
  el("level-label").textContent = fmtLevel(p);
  currentAnswered = true;
  el("btn-check").textContent = "Next ▶";
  el("btn-check").disabled = false;
  el("answer-input").disabled = false;
  if(hasLikelyPhysicalKeyboard()) el("answer-input").focus();
}

/* ===================== WOORD-UITLEG (los van correctheidsbeoordeling) =====================
   De volledige AI-beoordeling (askDeepSeekJudge) genereert als bijproduct al een inhoudelijke
   "uitleg" over het geteste woord. Maar bij een leeg antwoord, een al-gepiepte hint, of een direct
   (lokaal, zonder AI) herkend goed antwoord wordt askDeepSeekJudge helemaal niet aangeroepen -- in
   die gevallen liet het Explanation-paneel voorheen alleen een kaal statusbericht zien ("no answer
   entered", "you used a hint", ...) i.p.v. daadwerkelijke inhoud over het Turkse/Engelse woord. Deze
   functie dekt precies die gevallen: ALTIJD punt 1 (betekenis van het woord), en -- als er een
   antwoord van de gebruiker is meegegeven -- ook het verschil daarmee. */

// Registreert de uitleg als "op verzoek" (lazy): de knop is meteen zichtbaar, maar er gebeurt GEEN
// automatische AI-call -- pas als de gebruiker de knop daadwerkelijk indrukt (zie toggleExplanation)
// wordt explainWordContent() aangeroepen. Zo kost een simpel goed/leeg antwoord geen ongevraagde
// AI-call, maar is er desgevraagd wél altijd echte inhoud beschikbaar (nooit een kaal statusbericht).
// Korte, GOEDKOPE AI-lookup: alleen de betekenis van het door de gebruiker gegeven (foute) woord, voor
// de automatische "Wrong: 'X' means Y" regel direct onder het antwoord. Los van explainWordContent()
// (die blijft lazy/op-verzoek voor de volledige uitleg) -- dit is bewust minimaal, zodat een fout
// antwoord altijd meteen deze korte duiding krijgt zonder te wachten op de zwaardere uitleg.


function registerWordExplanation(item, userAnswer){
  if(!hasKeyFor("word")){ setExplanation(""); return; }
  setExplanationLoader(() => explainWordContent(item, userAnswer));
}

async function handleCheck(){
  if(!currentItem || currentAnswered) return;
  const answer = el("answer-input").value.trim();

  el("btn-check").disabled = true;
  el("answer-input").disabled = true;

  // Zin/vraag-oefeningen gaan ALTIJD door de volledige AI-beoordeling, ook bij een leeg antwoord --
  // anders krijg je nooit de referentievertaling te zien (voorheen toonde een leeg antwoord hier alleen
  // een kale woord-voor-woord-lijst, niet de daadwerkelijke vertaling van de hele zin/vraag). De AI
  // beoordeelt een leeg antwoord toch al betrouwbaar als fout, dus dit kost geen nauwkeurigheid, alleen
  // één AI-call die je anders miste op precies het moment dat je de vertaling het hardst nodig hebt.
  if(currentItem.type === "sentence"){
    await handleCheckSentence(answer);
    return;
  }
  if(currentItem.type === "question"){
    await handleCheckQuestion(answer);
    return;
  }
  if(currentItem.type === "suffix"){
    await handleCheckSuffix(answer);
    return;
  }

  if(retryPending){
    // Er is deze beurt al een fout antwoord geregistreerd (zie enterWordRetry) -- nu wordt alleen nog
    // gecontroleerd of het juiste antwoord getypt is, zonder opnieuw te scoren of een AI-call te doen.
    const correctAnswer = currentItem.direction === "tr-en" ? correctEnglishDisplayFor(currentItem) : (currentItem.senseTr || cachedTranslation(currentItem.en) || []).join(", ");
    const match = checkStaticMatch(currentItem, answer);
    if(match){
      retryPending = false;
      currentAnswered = true;
      showFeedback("correct", "✅ Correct!");
      el("post-actions").classList.remove("hidden");
      el("btn-check").textContent = "Next ▶";
      el("btn-check").disabled = false;
      el("btn-skip").disabled = true;
      el("answer-input").disabled = false;
      if(hasLikelyPhysicalKeyboard()) el("answer-input").focus();
    } else {
      showFeedback("wrong", "Not quite yet — type <b>" + escapeHtml(correctAnswer) + "</b> to continue.");
      el("btn-check").disabled = false;
      el("answer-input").value = "";
      el("answer-input").disabled = false;
      if(hasLikelyPhysicalKeyboard()) el("answer-input").focus();
    }
    return;
  }

  const pgKey = currentItem.progressKey || currentItem.en;
  if(revealedWords.has(pgKey)){
    // Dit woord is deze beurt al gepiept (zie peekCurrentWord) -- telt sowieso als fout voor de SRS.
    // Maar als het GETYPTE antwoord toch al klopt (bv. met behulp van de hint-letters), hoeft er geen
    // aparte herkansing geforceerd te worden -- dat antwoord is dan al 1x zelf getypt.
    const correctAnswer = currentItem.direction === "tr-en" ? correctEnglishDisplayFor(currentItem) : (currentItem.senseTr || cachedTranslation(currentItem.en) || []).join(", ");
    if(checkStaticMatch(currentItem, answer)){
      currentItem.matchedTr = findMatchedTr(currentItem, answer);
      finalizeCorrectDisplayButScoredWrong("✅ Correct! (still counted as a miss since you used a hint)");
      registerWordExplanation(currentItem, null);
      return;
    }
    showFeedback("pending", "🤖 Checking your answer…");
    const wrongMeaning = await lookupWrongAnswerMeaning(currentItem, answer);
    enterWordRetry("👁️ You peeked at the meaning, so this round is counted as a miss.<br>" + answerCompareLine(answer, correctAnswer, false, wrongMeaning));
    registerWordExplanation(currentItem, answer);
    return;
  }

  if(!answer){
    // leeg antwoord bij een los woord = "ik weet het niet", meteen als fout tellen, geen AI-call nodig
    // om de correctheid te bepalen -- de statische vertaling is toch al meteen beschikbaar. Het
    // Explanation-paneel krijgt via registerWordExplanation() wél nog steeds inhoudelijke uitleg over
    // het woord (dat kost apart wél een AI-call, maar levert nuttige content i.p.v. een kaal statusbericht).
    const correctAnswer = currentItem.direction === "tr-en" ? correctEnglishDisplayFor(currentItem) : (currentItem.senseTr || cachedTranslation(currentItem.en) || []).join(", ");
    enterWordRetry("❌ No answer entered, so this round is counted as a miss.<br>" + answerCompareLine("", correctAnswer, false));
    registerWordExplanation(currentItem, null);
    return;
  }

  const staticMatch = checkStaticMatch(currentItem, answer);

  if(staticMatch){
    currentItem.matchedTr = findMatchedTr(currentItem, answer);
    const regInfo = currentItem.direction === "en-tr" ? currentItem.registerInfo : null;
    finalizeAnswer(true, "✅" + (regInfo ? `<br><span class="muted">ℹ️ Heads up: this is a bit ${regInfo.register}${regInfo.note ? " — " + escapeHtml(regInfo.note) : ""}.</span>` : ""));
    registerWordExplanation(currentItem, null);
    el("btn-skip").disabled = true;
    return;
  }

  const correctAnswer = currentItem.direction === "tr-en" ? correctEnglishDisplayFor(currentItem) : (cachedTranslation(currentItem.en)||[]).join(", ");

  if(!hasKeyFor("word")){
    enterWordRetry("❌<br>" + answerCompareLine(answer, correctAnswer, false) + "<br><span class='muted'>Set a " + keyNameFor("word") + " API key to have other translations judged too, or dispute this result.</span>");
    return;
  }

  showFeedback("pending", "🤖 AI is checking your answer…");
  try{
    const verdict = await askDeepSeekJudge(currentItem, answer);
    setExplanation(verdict.uitleg);
    const regInfo = (verdict.correct && currentItem.direction === "en-tr") ? currentItem.registerInfo : null;
    if(verdict.correct){
      const wasTypo = /typo|tikfout/i.test(verdict.afwijking || "");
      currentItem.matchedTr = (currentItem.direction === "en-tr")
        ? (wasTypo ? (closestTrMatch(currentItem, answer) || currentItem.tr) : (findMatchedTr(currentItem, answer) || answer))
        : null;
      finalizeAnswer(true, "✅" + (correctAnswer ? "<br>" + answerCompareLine(answer, correctAnswer, true, verdict.betekenis_antwoord, regInfo, verdict.afwijking) : ""));
      el("btn-skip").disabled = true;
    } else {
      enterWordRetry("❌" + (correctAnswer ? "<br>" + answerCompareLine(answer, correctAnswer, false, verdict.betekenis_antwoord, regInfo, verdict.afwijking) : ""));
    }
    if(verdict.correct && currentItem.direction === "en-tr"){
      el("post-actions").querySelector("#btn-add-answer")?.remove();
      const addBtn = document.createElement("button");
      addBtn.className = "btn-ghost btn-small";
      addBtn.id = "btn-add-answer";
      addBtn.textContent = "➕ Add permanently to list";
      addBtn.onclick = ()=> { promptAddTranslation(currentItem, answer); addBtn.textContent = "✅ Added"; addBtn.disabled = true; };
      el("post-actions").appendChild(addBtn);
    }
  }catch(e){
    enterAIUnavailableRetry("⚠️ Could not reach the AI to check your answer after retrying. This attempt doesn't count against you — please try Check again.");
  }
}

// Stap 6 van het verbeterplan ("AI-fouten fail-safe i.p.v. fail-closed"): bij een AI-infrastructuurfout
// (na callAI's eigen 2 automatische herkansingen nog steeds mislukt) telt deze beurt NIET mee -- geen
// enkele score-mutatie (geen recordResult/recordHistory/lesson-voortgang), het getypte antwoord blijft
// gewoon staan, simpelweg opnieuw proberen. "pending"-stijl i.p.v. "wrong": dit is geen inhoudelijk
// oordeel over het antwoord, dus geen rode kleur en geen fout-geluidseffect (playFeedbackSound negeert
// "pending" al).
function enterAIUnavailableRetry(message){
  showFeedback("pending", message);
  el("btn-check").textContent = "Check";
  el("btn-check").disabled = false;
  el("answer-input").disabled = false;
  if(hasLikelyPhysicalKeyboard()) el("answer-input").focus();
}

async function handleCheckSuffix(answer){
  if(!answer){
    finalizeAnswer(false, "❌<br>" + answerCompareLine("", currentItem.correct, false));
    return;
  }
  if(normalize(answer) === normalize(currentItem.correct)){
    finalizeAnswer(true, "✅");
    return;
  }
  if(!hasKeyFor("word")){
    finalizeAnswer(false, "❌<br>" + answerCompareLine(answer, currentItem.correct, false) + "<br><span class='muted'>Set a " + keyNameFor("word") + " API key to have other forms judged too, or dispute this result.</span>");
    return;
  }
  showFeedback("pending", "🤖 AI is checking your answer…");
  try{
    const verdict = await gradeGrammarDrillAnswer({prompt: currentItem.prompt, correct: currentItem.correct, direction:"en-tr"}, answer);
    setExplanation(verdict.uitleg);
    finalizeAnswer(!!verdict.correct, (verdict.correct ? "✅" : "❌") + "<br>" + answerCompareLine(answer, currentItem.correct, !!verdict.correct));
  }catch(e){
    enterAIUnavailableRetry("⚠️ Could not reach the AI to check your answer after retrying. This attempt doesn't count against you — please try Check again.");
  }
}

/* ===================== ZIN-UITLEG (taalkundige toelichting, los van de correctheidsbeoordeling) =====================
   gradeSentenceTranslation/gradeQuestionAnswer leveren als bijproduct al een KORTE, puur op correctheid
   gerichte "uitleg" (max 2 zinnen: wat klopte niet). Deze functie levert iets heel anders: een compacte
   duiding van de zin zelf. BEWUST kort en gericht op precies 3 dingen (zie prompt) i.p.v. een brede,
   altijd-verplichte grammatica-uitleg -- en grammaticale constructies die de gebruiker al beheerst
   (blijkend uit zijn eigen cursus-voortgang op dat exacte onderwerp) worden niet meer herhaald. */

// Registreert de Explanation-knop lazy: toont de al-bekende (gratis) korte correctheids-uitleg meteen
// zodra de gebruiker 'm opent, aangevuld met de taalkundige duiding (die WEL een aparte AI-call kost,
// dus pas bij het daadwerkelijk openen opgehaald wordt).
function registerSentenceExplanation(item, shortUitleg){
  if(!hasKeyFor("sentence")){ setExplanation(shortUitleg || ""); return; }
  setExplanationLoader(async ()=>{
    const deep = await explainSentenceContent(item);
    return [shortUitleg, deep].map(s=>(s||"").trim()).filter(Boolean).join("\n\n");
  });
}

async function handleCheckSentence(answer){
  if(!hasKeyFor("sentence")){
    showFeedback("wrong", "Sentences can only be graded by AI — set a " + keyNameFor("sentence") + " API key in Settings.");
    el("btn-check").disabled = false;
    el("answer-input").disabled = false;
    return;
  }
  showFeedback("pending", "🤖 AI is checking your translation and the individual words…");
  try{
    const verdict = await gradeSentenceTranslation(currentItem, answer);
    registerSentenceExplanation(currentItem, verdict.uitleg);
    currentAnswered = true;
    currentCorrect = !!verdict.correct;
    recordHistory("sentence");

    // per doelwoord de score bijwerken (verdict.words is een plat boolean-array, zelfde volgorde als currentItem.words)
    currentItem.words.forEach((w, i)=>{
      const correct = revealedWords.has(w.en) ? false : !!verdict.words[i]; // opgezocht woord = altijd fout
      recordResult(w.en, correct);
    });
    saveJSON(LS_PROGRESS, progress);
    if(currentItem.grammarTopic && typeof verdict.grammar_correct === "boolean"){
      recordGrammarResult(currentItem.grammarTopic, verdict.grammar_correct);
    }

    const lessonNote = advanceLessonSession();
    const adaptiveNote = recordAdaptiveResult(!!verdict.correct);

    const wordLines = currentItem.words.map((w, i)=>{
      const ok = revealedWords.has(w.en) ? false : !!verdict.words[i];
      return `${ok ? "✅" : "❌"} ${w.tr}`;
    }).join(" &nbsp; ");

    showFeedback(verdict.correct ? "correct" : "wrong",
      (verdict.correct ? "✅" : "❌") +
      (verdict.referentie ? "<br>" + answerCompareLine(answer, verdict.referentie, !!verdict.correct) : "") +
      "<br><br><b>Word scores:</b><br>" + wordLines + lessonNote + adaptiveNote);

    el("post-actions").classList.remove("hidden");
    el("btn-check").textContent = "Next ▶";
    el("btn-check").disabled = false;
    el("btn-dispute").classList.remove("hidden"); // bij zinnen altijd tonen, ook per-woord kan afwijken
    el("answer-input").disabled = false; // opnieuw inschakelen zodat Enter (-> volgende) blijft werken
    if(hasLikelyPhysicalKeyboard()) el("answer-input").focus(); // alleen auto-focus bij laptop/desktop, niet bij touch (voorkomt oppoppend schermtoetsenbord)
  }catch(e){
    showFeedback("pending", "⚠️ Could not reach the AI to check your translation after retrying. Nothing was scored — please try Check again, or skip this sentence.");
    el("btn-check").disabled = false;
    el("answer-input").disabled = false;
  }
}

async function handleCheckQuestion(answer){
  if(!hasKeyFor("sentence")){
    showFeedback("wrong", "Turkish question/answer exercises can only be graded by AI — set a " + keyNameFor("sentence") + " API key in Settings.");
    el("btn-check").disabled = false;
    el("answer-input").disabled = false;
    return;
  }
  showFeedback("pending", "🤖 AI is checking your Turkish answer…");
  try{
    const verdict = await gradeQuestionAnswer(currentItem, answer);
    registerSentenceExplanation(currentItem, verdict.uitleg);
    currentAnswered = true;
    currentCorrect = !!verdict.correct;
    recordHistory("question");

    currentItem.words.forEach((w, i)=>{
      const correct = revealedWords.has(w.en) ? false : !!verdict.words[i]; // opgezocht woord = altijd fout
      recordResult(w.en, correct);
    });
    saveJSON(LS_PROGRESS, progress);
    if(currentItem.grammarTopic && typeof verdict.grammar_correct === "boolean"){
      recordGrammarResult(currentItem.grammarTopic, verdict.grammar_correct);
    }

    const adaptiveNote = recordAdaptiveResult(!!verdict.correct);

    // Geen "Word scores"-regel meer hier: in een vraag-oefening beantwoord je in het Turks, er wordt
    // niets vertaald, dus een per-woord ✅/❌ (dat bij zin-vertaling wél zinvol is) suggereert hier iets
    // wat niet klopt. De voortgang per woord (recordResult hierboven) blijft gewoon meelopen.
    showFeedback(verdict.correct ? "correct" : "wrong",
      (verdict.correct ? "✅" : "❌") +
      (verdict.referentie ? "<br>" + answerCompareLine(answer, verdict.referentie, !!verdict.correct) : "") +
      ((verdict.vraag_en || verdict.antwoord_en) ? "<br><span class='muted'>" +
        (verdict.vraag_en ? "Question: " + verdict.vraag_en : "") +
        (verdict.vraag_en && verdict.antwoord_en ? "<br>" : "") +
        (verdict.antwoord_en ? "Your answer: " + verdict.antwoord_en : "") +
        "</span>" : "") +
      adaptiveNote);

    el("post-actions").classList.remove("hidden");
    el("btn-check").textContent = "Next ▶";
    el("btn-check").disabled = false;
    el("btn-dispute").classList.remove("hidden");
    el("answer-input").disabled = false;
    if(hasLikelyPhysicalKeyboard()) el("answer-input").focus(); // alleen auto-focus bij laptop/desktop, niet bij touch
  }catch(e){
    showFeedback("pending", "⚠️ Could not reach the AI to check your answer after retrying. Nothing was scored — please try Check again, or skip this question.");
    el("btn-check").disabled = false;
    el("answer-input").disabled = false;
  }
}

// Klik op "👁️ Reveal" bij een losse-woord-oefening: toont de vertaling direct (geen AI nodig, want
// die staat al lokaal in de woordenlijst/curatedTr) en telt dit woord meteen als fout, net als bij een
// leeg ingediend antwoord -- consistent met hoe een opgezocht woord binnen een zin/vraag ook altijd
// als fout telt (zie revealWord/revealedWords hierboven).
function revealWordHint(){
  if(!currentItem || currentItem.type !== "word" || currentAnswered || retryPending) return;
  const correctAnswer = currentItem.direction === "tr-en" ? correctEnglishDisplayFor(currentItem) : (currentItem.senseTr || cachedTranslation(currentItem.en) || []).join(", ");
  setExplanation("You revealed the translation, so this round is counted as a miss. Type the answer to continue.");
  enterWordRetry("👁️<br>" + answerCompareLine("", correctAnswer, false));
}

// "👁️ Reveal"-knop in de kennischeck/les-oefeningen-modal: functioneel identiek aan met een LEEG
// veld op "Check" klikken (dat telt daar al als fout zonder AI-call, zie submitCheckupAnswer/
// submitSkillPracticeAnswer hierboven), maar dan als expliciete, ontdekbare actie op het woord zelf.
function revealCheckupHint(){
  el("checkup-answer-input").value = "";
  if(skillPracticeState) submitSkillPracticeAnswer(); else submitCheckupAnswer();
}

function finalizeAnswer(correct, message){
  currentAnswered = true;
  if(currentItem.direction === "en-tr" && currentItem.tr) setSpeakableTr(currentItem.matchedTr || currentItem.tr);
  if(correct && currentItem.direction === "en-tr" && currentItem.tr) speakTurkish(currentItem.matchedTr || currentItem.tr); // spreek het specifiek getypte synoniem uit, niet altijd de standaardvertaling
  currentCorrect = correct;
  recordHistory("word");
  recordResult(currentItem.progressKey || currentItem.en, correct);
  const lessonNote = advanceLessonSession();
  const adaptiveNote = recordAdaptiveResult(correct);
  showFeedback(correct ? "correct" : "wrong", message + lessonNote + adaptiveNote);
  el("post-actions").classList.remove("hidden");
  el("btn-check").textContent = "Next ▶";
  el("btn-check").disabled = false;
  el("btn-dispute").classList.toggle("hidden", !!correct);
  el("btn-reveal-word").classList.add("hidden");
  el("btn-skip").disabled = true;
  const p = getProgress(currentItem.progressKey || currentItem.en);
  el("level-fill").style.width = (p.level*10) + "%";
  el("level-label").textContent = fmtLevel(p);
  el("answer-input").disabled = false; // opnieuw inschakelen zodat Enter (-> volgende) blijft werken
  if(hasLikelyPhysicalKeyboard()) el("answer-input").focus(); // alleen auto-focus bij laptop/desktop, niet bij touch
}

/* ===================== SUFFIX TRAINER TAB =====================
   Losstaand van de gewone Practice-lus hierboven (eigen DOM-elementen, eigen state). GEEN scoresysteem
   (geen niveau 0-10, geen recordResult) -- puur goed/fout. Bij elk antwoord toont dit de morfeem-
   opbouw (generateSuffixDrill's "breakdown": kale stam -> ... -> volledige vorm, 1 achtervoegsel per
   regel met de veranderde betekenis); bij een fout antwoord komt daar via gradeSuffixDrillAnswer ook
   een korte uitleg van het verschil met het eigen antwoord bij. */
let currentSuffixItem = null;
let suffixAnswered = false;

// Rendert de morfeem-opbouw als een verticale lijst: elke regel = de vorm tot en met dat achtervoegsel
// + de betekenis op die stap, zodat je letterlijk ziet hoe elk toegevoegd achtervoegsel de betekenis
// verandert (bv. "gel" -> come, "gelebil" -> can come, "gelebilir" -> can come (general tense)).
function renderSuffixBreakdown(breakdown){
  if(!Array.isArray(breakdown) || !breakdown.length) return "";
  const rows = breakdown.map(step =>
    `<div class="row space-between" style="padding:3px 0;border-bottom:1px solid var(--border, #2a3a4a);">
       <span class="tr-word" style="font-size:1rem;">${escapeHtml(step.form)}</span>
       <span class="muted" style="font-size:.8rem;text-align:right;">${escapeHtml(step.meaning)}</span>
     </div>`
  ).join("");
  return `<div class="muted" style="font-weight:700;font-size:.78rem;margin-bottom:4px;">🧩 Suffix breakdown</div>${rows}`;
}

async function renderSuffixPractice(){
  suffixAnswered = false;
  currentSuffixItem = null;
  el("suf-feedback-box").innerHTML = "";
  el("suf-diff-box").classList.add("hidden");
  el("suf-diff-box").textContent = "";
  el("suf-breakdown-box").classList.add("hidden");
  el("suf-breakdown-box").innerHTML = "";
  el("suf-answer-input").value = "";
  el("suf-answer-input").disabled = true;
  el("suf-btn-check").disabled = true;
  el("suf-btn-check").textContent = "Check"; // terug naar "Check" -- zie finalizeSuffixAnswer voor de omzetting naar "Continue ▶"
  el("suf-btn-skip").disabled = true;

  if(!canOfferSuffixDrill()){
    el("suf-verb-label").textContent = "";
    el("suf-word").textContent = "—";
    el("suf-word-meta").textContent = "";
    el("suf-empty-notice").classList.remove("hidden");
    return;
  }
  el("suf-empty-notice").classList.add("hidden");
  el("suf-verb-label").textContent = "";
  el("suf-word").textContent = "🤖 …";
  el("suf-word-meta").textContent = "";

  try{
    currentSuffixItem = await generateSuffixDrill();
  }catch(e){
    el("suf-word").textContent = "⚠️ Could not generate an exercise: " + e.message;
    return;
  }

  // Toont het te vervoegen werkwoord voortaan als GEHEEL (de volledige infinitief -mek/-mak, bv.
  // "etmek", "yapmak", "hareket etmek") boven de Engelse aanwijzing, i.p.v. de gebruiker te laten
  // gokken/onthouden welk Turks werkwoord er precies bij het Engelse prompt-zinnetje hoort. Het
  // werkwoord komt nog steeds uit de beheerst-pool (masteredVerbsForSuffixDrill, ongewijzigd).
  // Onderstreept (naast vetgedrukt) zodat het te vervoegen werkwoord in één oogopslag duidelijk is,
  // ongeacht de richting van de oefening.
  const isTrEn = currentSuffixItem.direction === "tr-en";
  const isNoun = currentSuffixItem.pos === "noun";
  if(isNoun){
    el("suf-verb-label").innerHTML = `Noun: <u><b>${escapeHtml(currentSuffixItem.nounTr)}</b></u> (<u>${escapeHtml(displayEnglishWord(currentSuffixItem.nounEn))}</u>)`;
  } else {
    el("suf-verb-label").innerHTML = `Verb: <u><b>${escapeHtml(currentSuffixItem.verbTr)}</b></u> (<u>${escapeHtml(displayEnglishWord(currentSuffixItem.verbEn))}</u>)`;
  }
  // Naamwoord-oefeningen tonen soms een korte contextzin i.p.v. het kale doelwoord (zie
  // generateNounSuffixDrill) -- alleen dan het doelwoord ONDERSTREPEN binnen die zin, zodat duidelijk
  // is dat alléén dat ene woord vertaald/beoordeeld hoeft te worden, niet de hele zin.
  const showsContext = isNoun && isTrEn && currentSuffixItem.contextSentence;
  if(showsContext){
    const sentence = currentSuffixItem.contextSentence;
    const target = currentSuffixItem.targetWordTr;
    const idx = sentence.indexOf(target);
    el("suf-word").innerHTML = idx === -1
      ? escapeHtml(sentence)
      : escapeHtml(sentence.slice(0, idx)) + "<u><b>" + escapeHtml(target) + "</b></u>" + escapeHtml(sentence.slice(idx + target.length));
  } else {
    el("suf-word").textContent = currentSuffixItem.prompt;
  }
  el("suf-word-meta").textContent = isTrEn
    ? (showsContext ? "translate ONLY the underlined word above into English" : "translate the meaning of the Turkish form above into English")
    : `${isNoun ? "form" : "conjugate"} the ${isNoun ? "noun" : "verb"} above using a grammar pattern you've already mastered`;
  el("suf-answer-instruction").textContent = isTrEn ? "✍️ Type the English translation" : "✍️ Type the correctly formed Turkish word";
  el("suf-answer-input").placeholder = isTrEn ? "Type the English translation…" : "Type the formed word…";
  el("suf-answer-input").disabled = false;
  el("suf-btn-check").disabled = false;
  el("suf-btn-skip").disabled = false;
  setTimeout(()=> el("suf-answer-input").focus(), 50);
}

// Geen niveau/score meer bij te werken -- alleen de feedback (✅/❌), evt. het verschil met het eigen
// antwoord, en de morfeem-opbouw tonen.
function finalizeSuffixAnswer(correct, diffText){
  suffixAnswered = true;
  playFeedbackSound(correct ? "correct" : "wrong");
  const wasBlank = !correct && /^You left this blank/.test(diffText || "");
  el("suf-feedback-box").innerHTML = `<div class="feedback ${correct ? "correct" : "wrong"}">${correct ? "✅ Correct!" : (wasBlank ? "" : "❌ Not quite.")}</div>`;
  // diffText wordt nu ook bij een GOED antwoord getoond (bv. de accentfoutjes-melding hierboven) --
  // niet meer alleen bij fout.
  if(diffText){
    el("suf-diff-box").textContent = "📝 " + diffText;
    el("suf-diff-box").classList.remove("hidden");
  }
  const breakdownHtml = renderSuffixBreakdown(currentSuffixItem.breakdown);
  if(breakdownHtml){
    el("suf-breakdown-box").innerHTML = breakdownHtml;
    el("suf-breakdown-box").classList.remove("hidden");
  }
  // Eén knop voor zowel indienen als doorgaan: na het antwoord wordt "Check" een "Continue ▶"-knop
  // (zie de click-handler bij suf-btn-check, die op suffixAnswered checkt) i.p.v. een aparte Next-knop.
  // Skip is dan niet meer van toepassing (er is al geantwoord), dus die blijft uitgeschakeld.
  el("suf-btn-check").textContent = "Continue ▶";
  el("suf-btn-check").disabled = false;
  el("suf-btn-skip").disabled = true;
  el("suf-answer-input").disabled = false; // opnieuw inschakelen zodat Enter (-> volgende) blijft werken
  if(hasLikelyPhysicalKeyboard()) el("suf-answer-input").focus();
}

// Vouwt Turkse diakritische tekens plat naar hun ASCII-basisletter (ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c), zodat
// bv. "yapabiliyorum" en "yapabiliyorüm" als hetzelfde gelden. Alleen gebruikt voor de suffixtrainer se
// lokale (niet-AI) vergelijking hieronder -- de globale normalize() blijft ongewijzigd, want elders in de
// app (losse woordoefeningen) is een fout accent wel degelijk relevant (bv. voor het vroege alfabet-doel).

// QWERTY-rijen (na het diakritische-tekens-plat-vouwen hierboven is alles al kale a-z, dus de Turkse
// toetsen ç/ğ/ı/ö/ş/ü hoeven hier niet apart in te staan). Gebruikt om te bepalen of twee letters
// fysiek naast elkaar liggen op een standaard toetsenbord (bv. "i" en "o").

 // i.p.v. de volle 1 voor een willekeurige, niet-naastgelegen vervanging



// Standaard Levenshtein-opzet (invoegingen/verwijderingen kosten 1), maar de vervangingskost is nu
// toetsenbord-gewogen i.p.v. altijd 1 -- een verwisseling tussen fysiek naastgelegen toetsen (zoals
// "i"/"o") weegt maar half zo zwaar als een willekeurige, niet-naastgelegen vervanging. Zo'n tikfout
// valt daardoor eerder binnen de typoTolerance-drempel dan een echt ander/fout woord.

// Hoeveel edits we als "typo" tolereren, geschaald op de lengte van het doelwoord. Een VASTE drempel
// (bv. altijd 1) zou bij lange, sterk-vervoegde Turkse vormen (agglutinatie -> vaak 10+ tekens) al snel
// te streng zijn; een vast PERCENTAGE zou bij een kort woord juist te soepel zijn (2 letters verschil op
// een woord van 3 is zomaar een ander, écht fout antwoord, geen tikfout). Vandaar een staffel:
// <4 tekens: geen tolerantie, 4-6: 1 edit, 7-11: 2 edits, 12+: 3 edits.

// Woordafstand wordt bepaald NA het accenten-plat-vouwen hierboven, zodat een tikfout en een fout accent
// niet dubbel tellen (en de aparte, specifieke accent-melding hierboven blijft de eerst-geprobeerde,
// preciezere verklaring als het antwoord ECHT alleen in accenten afwijkt).

async function handleCheckSuffixTab(){
  if(!currentSuffixItem || suffixAnswered) return;
  const answer = el("suf-answer-input").value.trim();
  el("suf-btn-check").disabled = true;
  el("suf-answer-input").disabled = true;
  const isTrEn = currentSuffixItem.direction === "tr-en";

  if(!answer){
    finalizeSuffixAnswer(false, `You left this blank — ${isTrEn ? `the correct translation is "${currentSuffixItem.correct}"` : `the correct form is "${currentSuffixItem.correct}"`}.`);
    return;
  }
  if(normalize(answer) === normalize(currentSuffixItem.correct)){
    finalizeSuffixAnswer(true, "");
    return;
  }
  // De onderstaande twee snelle, AI-loze controles (accentfoutjes en kleine tikfouten) zijn specifiek
  // gericht op Turkse tekst -- bij "tr-en" typt de gebruiker juist Engels, dus die slaan we over en
  // gaan we direct door naar de AI-beoordeling, die bij een vertaling toch al parafrasering moet
  // tolereren (zie gradeSuffixDrillAnswer) en dus de enige zinvolle manier is om dit te beoordelen.
  if(!isTrEn){
    // Accentfoutjes (bv. u i.p.v. ü) worden hier goedgekeurd zonder een AI-aanroep nodig te hebben --
    // maar wel met een melding van de correcte (geaccentueerde) spelling, zodat je die alsnog leert.
    if(foldTurkishDiacritics(normalize(answer)) === foldTurkishDiacritics(normalize(currentSuffixItem.correct))){
      finalizeSuffixAnswer(true, `Correct — just watch the accents: the correct spelling is "${currentSuffixItem.correct}".`);
      return;
    }
    // Kleine tikfouten (1 letter verschil op een kort woord, tot 3 op een lang vervoegd woord) worden ook
    // lokaal (zonder AI-aanroep) goedgekeurd, weer met de correcte spelling erbij zodat je 'm alsnog leert.
    if(isTypoOf(answer, currentSuffixItem.correct)){
      finalizeSuffixAnswer(true, `Correct (small typo tolerated) — the correct spelling is "${currentSuffixItem.correct}".`);
      return;
    }
  }
  // BUGFIX: dit gebruikte hasKeyFor("word"), maar gradeSuffixDrillAnswer/generateSuffixDrill hierboven
  // roepen intern altijd callAI("sentence", ...) aan -- dus deze sleutel-check keek naar de VERKEERDE
  // instelling. Als je bv. Anthropic alleen voor "sentence" hebt ingesteld (en geen DeepSeek-sleutel
  // hebt), werd de suffixtrainer hier ten onrechte geblokkeerd, terwijl de generatie zelf allang via
  // Anthropic liep. Nu consistent op dezelfde categorie ("sentence") als de rest van de suffixtrainer.
  if(!hasKeyFor("sentence")){
    finalizeSuffixAnswer(false, `Your answer was "${answer}" — ${isTrEn ? `the correct translation is "${currentSuffixItem.correct}"` : `the correct form is "${currentSuffixItem.correct}"`}. Set a ${keyNameFor("sentence")} API key to have other valid forms judged too.`);
    return;
  }
  el("suf-feedback-box").innerHTML = `<div class="feedback pending">🤖 AI is checking your answer…</div>`;
  try{
    const verdict = await gradeSuffixDrillAnswer(currentSuffixItem, answer);
    finalizeSuffixAnswer(!!verdict.correct, verdict.diff || "");
  }catch(e){
    el("suf-feedback-box").innerHTML = `<div class="feedback pending">⚠️ Could not reach the AI to check your answer after retrying. Nothing was scored — please try Check again.</div>`;
    el("suf-btn-check").disabled = false;
    el("suf-answer-input").disabled = false;
    if(hasLikelyPhysicalKeyboard()) el("suf-answer-input").focus();
  }
}

/* Voegt een Turks antwoord (bij een en-tr-oefening) permanent toe als extra geaccepteerde vertaling. */
function promptAddTranslation(item, answer){
  if(!custom[item.en]) custom[item.en] = {tr:[]};
  if(!custom[item.en].tr.includes(answer)) custom[item.en].tr.push(answer);
  saveJSON(LS_CUSTOM, custom);
}

/* ===================== "TYPE WHAT YOU HEAR" (luister-dictee, tweede modus van de Special-tab) =====================
   Speelt een Turks woord/zin af (TTS, geen tekst zichtbaar tot na het beoordelen) die de gebruiker naar
   het Engels moet vertalen. 7 lengte-niveaus, instelbaar op het scherm zelf (settings.dictationLevel):
   niveau 1 is GEEN AI-generatie maar een rechtstreeks uit de eigen woordenlijst getrokken, al beheerst
   (niveau 8+) woord -- sneller, goedkoper, en garandeert dat het woord ook echt bekend is. Niveau 2-7
   laat de AI een zin met ongeveer het gevraagde aantal woorden bouwen. */
export const DICTATION_LEVELS = [
  {n:1, label:"1 word (mastered)", min:1, max:1},
  {n:2, label:"2 words", min:2, max:2},
  {n:3, label:"3 words", min:3, max:3},
  {n:4, label:"4-5 words", min:4, max:5},
  {n:5, label:"6-8 words", min:6, max:8},
  {n:6, label:"9-12 words", min:9, max:12},
  {n:7, label:"12+ words", min:12, max:16},
];
let currentDictationItem = null;
let dictationAnswered = false;



// Niveau 1: rechtstreeks een al beheerst (niveau 8+) woord uit de eigen en-tr-lijst, geen AI-call nodig.


// Niveau 2-7: AI bouwt een zin van ongeveer het gevraagde aantal woorden, uit bekende woordenschat --
// dit is een LUISTEROEFENING (kunnen volgen/verstaan), geen woordenschat-uitbreiding, dus bewust geen
// nieuwe/moeilijke woorden erin.






function renderDictationLevelLabel(){
  const tier = dictationTierFor(settings.dictationLevel);
  el("dict-level-slider").value = tier.n;
  el("dict-level-label").textContent = tier.label;
}

async function renderDictationPractice(){
  dictationAnswered = false;
  currentDictationItem = null;
  el("dict-answer-input").value = "";
  el("dict-answer-input").disabled = true;
  el("dict-btn-check").disabled = true;
  el("dict-btn-check").textContent = "Check";
  el("dict-feedback-box").innerHTML = "";
  el("dict-tr-reveal").classList.add("hidden");
  el("dict-tr-reveal").textContent = "";
  el("dict-badge").textContent = "🤖 …";
  renderDictationLevelLabel();
  try{
    currentDictationItem = await generateDictationItem();
  }catch(e){
    el("dict-feedback-box").innerHTML = `<div class="feedback wrong">⚠️ Could not generate an exercise: ${escapeHtml(e.message)}</div>`;
    el("dict-badge").textContent = "🎧 listening";
    return;
  }
  el("dict-badge").textContent = "🎧 listening";
  if(!currentDictationItem){
    el("dict-feedback-box").innerHTML = `<div class="feedback wrong">⚠️ No mastered word (level 8+) available yet for "1 word" — practice some words first on the Practice tab, or pick a longer length above.</div>`;
    return;
  }
  el("dict-answer-input").disabled = false;
  el("dict-btn-check").disabled = false;
  if(hasLikelyPhysicalKeyboard()) el("dict-answer-input").focus();
  speakTurkish(currentDictationItem.tr);
}



function finalizeDictationAnswer(correct, extraNote){
  dictationAnswered = true;
  playFeedbackSound(correct ? "correct" : "wrong");
  el("dict-tr-reveal").textContent = currentDictationItem.tr;
  el("dict-tr-reveal").classList.remove("hidden");
  el("dict-feedback-box").innerHTML = `<div class="feedback ${correct ? "correct" : "wrong"}">${correct ? "✅" : "❌"}<br>` +
    `You heard: <b>${escapeHtml(currentDictationItem.tr)}</b><br>Reference translation: <b>${escapeHtml(currentDictationItem.en)}</b>` +
    (extraNote ? `<br><span class="muted">${extraNote}</span>` : "") + `</div>`;
  el("dict-btn-check").textContent = "Next ▶";
  el("dict-btn-check").disabled = false;
  el("dict-answer-input").disabled = false;
}

function dictationAnswerMatchesAlternateMeaning(item, answer){
  if(item.wordCount !== 1) return false; // dit soort ambiguïteit is alleen zinvol te checken bij één los woord, niet bij een hele zin
  const norm = normalize(answer);
  const shownTr = normalize(item.tr);
  const answerWordData = EN_WORDS_DATA.find(w => normalize(baseEnOf(w.en)) === norm);
  if(!answerWordData) return false;
  const trans = cachedTranslation(answerWordData.en) || [];
  return trans.some(t => normalize(stripTrClarifier(t)) === shownTr);
}

async function handleCheckDictation(){
  if(!currentDictationItem || dictationAnswered) return;
  const answer = el("dict-answer-input").value.trim();
  el("dict-btn-check").disabled = true;
  el("dict-answer-input").disabled = true;
  if(!answer){
    finalizeDictationAnswer(false);
    return;
  }
  if(normalize(answer) === normalize(currentDictationItem.en)){
    finalizeDictationAnswer(true);
    return;
  }
  if(dictationAnswerMatchesAlternateMeaning(currentDictationItem, answer)){
    finalizeDictationAnswer(true);
    return;
  }
  if(!hasKeyFor("sentence")){
    finalizeDictationAnswer(false, `Set a ${keyNameFor("sentence")} API key to have other phrasings judged too.`);
    return;
  }
  el("dict-feedback-box").innerHTML = `<div class="feedback pending">🤖 AI is checking your answer…</div>`;
  const verdict = await gradeDictationAnswer(currentDictationItem, answer);
  finalizeDictationAnswer(!!verdict.correct, verdict.error ? "⚠️ Could not reach the AI, counted as incorrect for now." : null);
}

// Dispatcher voor de Special-tab: toont/genereert suffix-oefeningen of de dictee-oefening, afhankelijk
// van settings.specialMode (zie de instelling "🧩 Special tab").
function renderSpecialTab(){
  const mode = settings.specialMode || "suffixes";
  el("special-suffixes-content").classList.toggle("hidden", mode !== "suffixes");
  el("special-dictation-content").classList.toggle("hidden", mode !== "dictation");
  if(mode === "suffixes"){
    if(!currentSuffixItem) renderSuffixPractice(); // niet opnieuw genereren als er al een opgave actief is
  } else {
    if(!currentDictationItem) renderDictationPractice();
  }
}

/* ===================== HANDMATIGE WOORDCORRECTIE ===================== */
// Laat de gebruiker een woordkaart (Engels<->Turks, beide richtingen) direct corrigeren als de AI/
// gecureerde data fout blijkt te zijn -- de correctie vervangt de vertaling volledig en heeft overal
// voorrang (zie cachedTranslation/buildTrWordsData), i.t.t. custom[] dat alleen een extra geaccepteerd
// antwoord toevoegt. Sinds stap 5 (module-unificatie) is dit ÉÉN functie per taak (openen/opslaan/
// wissen) voor beide richtingen, die intern alleen vertakt voor de weergave-specifieke velden (en-tr
// heeft een los Engels bronwoord + een komma-gescheiden Turkse vertaal-LIJST; tr-en heeft een vast Turks
// woord + één Engelse vertaling) -- de opslag zelf (overrides) is voor beide gelijk.
let editWordCurrentEn = null;
let editWordCurrentSource = "en"; // "en" of "tr" -- bepaalt alleen welke velden/labels getoond worden, niet welke opslag gebruikt wordt (die is nu altijd `overrides`)
function openEditWordModal(key, source){
  if(!key) return;
  source = source || "en";
  if(source === "tr"){
    const w = trWordDataOf(key);
    if(!w) return;
    el("edit-word-first-label").textContent = "Turkish word:";
    el("edit-word-second-label").textContent = "English translation:";
    el("edit-word-en-input").placeholder = "e.g. kitap";
    el("edit-word-tr-input").placeholder = "e.g. book";
    el("edit-word-en-input").value = w.tr;
    el("edit-word-tr-input").value = w.en;
  } else {
    el("edit-word-first-label").textContent = "English (source):";
    el("edit-word-second-label").textContent = "Turkish translation(s), comma-separated:";
    el("edit-word-en-input").placeholder = "e.g. to be born";
    el("edit-word-tr-input").placeholder = "e.g. kitap, kitabı";
    el("edit-word-en-input").value = displayEnglishWord(key);
    el("edit-word-tr-input").value = (overrides[key]?.tr || cachedTranslation(key) || []).join(", ");
  }
  editWordCurrentEn = key;
  editWordCurrentSource = source;
  el("btn-edit-word-clear").classList.toggle("hidden", !overrides[key]);
  el("modal-edit-word").classList.remove("hidden");
  setTimeout(()=> el("edit-word-en-input").focus(), 50);
}
function closeEditWordModal(){
  el("modal-edit-word").classList.add("hidden");
  editWordCurrentEn = null;
}
function refreshAfterWordEdit(key, source, trText, enText){
  // relevante schermen/de lopende oefening verversen zodat de correctie meteen zichtbaar is
  if(el("screen-words") && !el("screen-words").classList.contains("hidden")) renderWordsTab();
  if(!currentItem || currentItem.type !== "word") return;
  const matches = source === "tr" ? currentItem.progressKey === key : currentItem.en === key;
  if(!matches) return;
  currentItem.tr = trText;
  if(source === "tr"){
    currentItem.en = enText;
    if(currentItem.trData) currentItem.trData = trWordDataOf(key);
  }
  el("tr-word").textContent = currentItem.direction === "tr-en" ? currentItem.tr : displayEnglishWord(currentItem.en);
}
function saveEditWord(){
  if(!editWordCurrentEn) return;
  const key = editWordCurrentEn, source = editWordCurrentSource;
  if(source === "tr"){
    const trText = el("edit-word-en-input").value.trim();
    const enText = el("edit-word-tr-input").value.trim();
    if(!trText){ alert("Enter the Turkish word."); return; }
    if(!enText){ alert("Enter the English translation."); return; }
    // De key (dus de progress/level/due-koppeling) blijft ongewijzigd -- dit is puur een weergave/
    // matching-correctie, geen hernoeming van het onderliggende woord.
    overrides[key] = {tr: trText, en: enText};
    TR_WORDS_DATA = buildTrWordsData(); // herbouwen zodat de correctie meteen overal doorwerkt
    refreshAfterWordEdit(key, source, trText, enText);
  } else {
    const enText = el("edit-word-en-input").value.trim();
    const raw = el("edit-word-tr-input").value.trim();
    const trList = raw.split(",").map(s=>s.trim()).filter(Boolean);
    if(!enText){ alert("Enter the English (source) text."); return; }
    if(!trList.length){ alert("Enter at least one Turkish translation."); return; }
    // en blijft de SLEUTEL (voortgang/level/due-datum blijven gekoppeld aan het oorspronkelijke woord) --
    // enText is puur een weergave-correctie, geen hernoeming van het onderliggende woord.
    overrides[key] = {tr: trList, en: enText};
    refreshAfterWordEdit(key, source, trList[0], enText);
  }
  saveJSON(LS_OVERRIDES, overrides);
  closeEditWordModal();
}
function clearEditWord(){
  if(!editWordCurrentEn) return;
  const key = editWordCurrentEn, source = editWordCurrentSource;
  delete overrides[key];
  saveJSON(LS_OVERRIDES, overrides);
  if(source === "tr") TR_WORDS_DATA = buildTrWordsData();
  closeEditWordModal();
  if(el("screen-words") && !el("screen-words").classList.contains("hidden")) renderWordsTab();
}

async function disputeAnswer(){
  if(!currentItem) return;
  const answer = el("answer-input").value.trim();
  el("btn-dispute").disabled = true;

  if(currentItem.type === "sentence" || currentItem.type === "question"){
    const isQ = currentItem.type === "question";
    if(!hasKeyFor("sentence")){
      alert("A " + keyNameFor("sentence") + " API key is needed to re-check this (Settings).");
      el("btn-dispute").disabled = false;
      return;
    }
    showFeedback("pending", "🤖 AI is critically re-checking your " + (isQ ? "answer" : "sentence") + "…");
    try{
      const verdict = isQ
        ? await gradeQuestionAnswer(currentItem, answer, true)
        : await gradeSentenceTranslation(currentItem, answer, true);
      registerSentenceExplanation(currentItem, verdict.uitleg);
      currentItem.words.forEach((w, i)=>{
        const correct = revealedWords.has(w.en) ? false : !!verdict.words[i]; // opgezocht woord = altijd fout
        recordResult(w.en, correct);
      });
      saveJSON(LS_PROGRESS, progress);
      if(currentItem.grammarTopic && typeof verdict.grammar_correct === "boolean"){
        recordGrammarResult(currentItem.grammarTopic, verdict.grammar_correct);
      }
      const wordLines = currentItem.words.map((w, i)=>{
        const ok = revealedWords.has(w.en) ? false : !!verdict.words[i];
        return `${ok ? "✅" : "❌"} ${w.tr}`;
      }).join(" &nbsp; ");
      showFeedback(verdict.correct ? "correct" : "wrong",
        "🔁 " + (verdict.correct ? "✅" : "❌") +
        (verdict.referentie ? "<br>" + answerCompareLine(answer, verdict.referentie, !!verdict.correct) : "") +
        (isQ && (verdict.vraag_en || verdict.antwoord_en) ? "<br><span class='muted'>" +
          (verdict.vraag_en ? "Question: " + verdict.vraag_en : "") +
          (verdict.vraag_en && verdict.antwoord_en ? "<br>" : "") +
          (verdict.antwoord_en ? "Your answer: " + verdict.antwoord_en : "") +
          "</span>" : "") +
        (isQ ? "" : "<br><br><b>Word scores:</b><br>" + wordLines)); // vragen worden niet vertaald -> geen per-woord-score tonen
      el("btn-dispute").classList.add("hidden");
    }catch(e){
      showFeedback("pending", "⚠️ Could not reach the AI to re-check your answer after retrying. Your original result stands for now — you can try disputing again.");
      el("btn-dispute").disabled = false;
    }
    return;
  }

  if(!hasKeyFor("word")){
    alert("A " + keyNameFor("word") + " API key is needed to re-check an answer (Settings).");
    el("btn-dispute").disabled = false;
    return;
  }

  showFeedback("pending", "🤖 AI is critically re-checking your answer…");
  try{
    const verdict = await askDeepSeekJudge(currentItem, answer, true);
    setExplanation(verdict.uitleg);
    const pgKey = currentItem.progressKey || currentItem.en;
    if(verdict.correct){
      if(currentItem.direction === "en-tr") promptAddTranslation(currentItem, answer);
      const p = getProgress(pgKey);
      scheduleReview(p, GRADE_EASY); // dispuut geaccepteerd = sterkste positieve FSRS-update (analoog aan de oude ease²-bonus)
      saveJSON(LS_PROGRESS, progress);
      showFeedback("correct",
        "🔁 ✅<br>" +
        (currentItem.direction === "en-tr" ? "Added permanently as an accepted Turkish translation, and score restored." : "Score restored.") +
        (verdict.afwijking ? `<br><span class="muted">📝 ${escapeHtml(verdict.afwijking)}</span>` : ""));
      el("btn-dispute").classList.add("hidden");
      el("level-fill").style.width = (p.level*10) + "%";
      el("level-label").textContent = fmtLevel(p);
      // Dispuut geaccepteerd -- de AI bevestigt dat het antwoord toch klopte, dus de geforceerde
      // herkansing (indien actief) is niet meer nodig: rechtstreeks door naar "Next".
      retryPending = false;
      currentAnswered = true;
      el("btn-check").textContent = "Next ▶";
      el("btn-check").disabled = false;
      el("btn-skip").disabled = true;
      el("answer-input").disabled = false;
    } else {
      const correctAnswer = currentItem.direction === "tr-en" ? correctEnglishDisplayFor(currentItem) : (cachedTranslation(currentItem.en)||[]).join(", ");
      showFeedback("wrong",
        "🔁 ❌<br>" +
        (correctAnswer ? answerCompareLine(answer, correctAnswer, false, verdict.betekenis_antwoord) + "<br><br>" : "") +
        "<button class='btn-ghost btn-small' id='btn-force-add'>Add anyway</button>");
      el("btn-force-add").onclick = ()=>{
        if(!confirm('Are you sure "' + answer + '" is a correct translation, despite the AI\'s judgement?')) return;
        if(currentItem.direction === "en-tr") promptAddTranslation(currentItem, answer);
        const p = getProgress(pgKey);
        scheduleReview(p, GRADE_EASY); // dispuut geaccepteerd = sterkste positieve FSRS-update (analoog aan de oude ease²-bonus)
        saveJSON(LS_PROGRESS, progress);
        showFeedback("correct", "Added manually, score restored. ✅");
        el("btn-dispute").classList.add("hidden");
        el("level-fill").style.width = (p.level*10) + "%";
        el("level-label").textContent = fmtLevel(p);
        retryPending = false;
        currentAnswered = true;
        el("btn-check").textContent = "Next ▶";
        el("btn-check").disabled = false;
        el("btn-skip").disabled = true;
        el("answer-input").disabled = false;
      };
      el("btn-dispute").disabled = false;
      // Dispuut afgewezen: de geforceerde herkansing (indien actief) blijft gewoon staan -- de gebruiker
      // moet nog steeds het juiste antwoord typen om verder te kunnen, of alsnog "Add anyway" gebruiken.
    }
  }catch(e){
    showFeedback("pending", "⚠️ Could not reach the AI to re-check your answer after retrying. Your original result stands for now — you can try disputing again.");
    el("btn-dispute").disabled = false;
  }
}

/* ===================== CHAT MODAL (Vraag aan AI) ===================== */
let chatItem = null; // het item waar de "vraag aan AI"-chat momenteel context over heeft (regulier of skill-practice)
function openAiModal(){
  if(!currentItem){ alert("No active exercise to ask about right now — answer or start one first."); return; }
  if(!hasKeyFor("sentence")){ alert("Set a " + keyNameFor("sentence") + " API key in Settings first."); return; }
  chatItem = currentItem;
  el("modal-ai-word").textContent = chatItem.tr || baseEnOf(chatItem.en);
  el("chat-log").innerHTML = "";
  chatMsgs = [];
  el("modal-ai").classList.remove("hidden");
  el("chat-input").value = "";
  setTimeout(()=> el("chat-input").focus(), 50);
}
function closeAiModal(){ el("modal-ai").classList.add("hidden"); }

async function sendChat(){
  const q = el("chat-input").value.trim();
  if(!q || !chatItem) return;
  el("chat-input").value = "";
  const log = el("chat-log");
  log.innerHTML += `<div class="chatline user"><b>Jij:</b> ${escapeHtml(q)}</div>`;
  log.innerHTML += `<div class="chatline ai" id="chat-pending">🤖 …</div>`;
  log.scrollTop = log.scrollHeight;
  try{
    const answer = await askDeepSeekFree(chatItem, q, chatMsgs);
    chatMsgs.push({role:"user", content:q});
    chatMsgs.push({role:"assistant", content:answer});
    el("chat-pending").outerHTML = `<div class="chatline ai"><b>AI:</b> ${escapeHtml(answer)}</div>`;
  }catch(e){
    el("chat-pending").outerHTML = `<div class="chatline ai">⚠️ ${escapeHtml(e.message)}</div>`;
  }
  log.scrollTop = log.scrollHeight;
}


/* ===================== STATISTIEKEN ===================== */
function cefrBarColor(pct){
  if(pct === null) return "#2a3547";
  if(pct < 34) return "#e0333f";
  if(pct < 67) return "#e0a733";
  return "#2fae6a";
}

function cefrWordProgress(idx){
  const words = allWords().filter(w => (w.cefr ?? null) === idx);
  if(!words.length) return null;
  const avg = words.reduce((a,w)=>a+displayWordLevel(w.en), 0) / words.length;
  return Math.round(avg / 10 * 100);
}
function cefrGrammarProgress(idx){
  const topics = GRAMMAR_TOPICS.filter(t => t.minCefr === idx);
  if(!topics.length) return null;
  const avg = topics.reduce((a,t)=>a+displayTopicLevel(t), 0) / topics.length;
  return Math.round(avg / 10 * 100);
}

function renderCefrProgress(containerId, getPct){
  const container = el(containerId);
  if(!container) return;
  const macros = [
    {title:"A (A1 – A2)", subs:[0,1,2,3,4,5]},
    {title:"B (B1 – B2)", subs:[6,7,8,9,10,11]},
    {title:"C (C1 – C2)", subs:[12,13,14,15,16,17]},
  ];
  container.innerHTML = macros.map(m=>{
    const bars = m.subs.map(idx=>{
      const pct = getPct(idx);
      const h = pct === null ? 0 : pct;
      const color = cefrBarColor(pct);
      const label = cefrLabel(idx).replace(/^(A1|A2|B1|B2|C1|C2) /, "");
      const tooltip = `${cefrLabel(idx)}: ${pct===null?'no items':pct+'%'}`;
      return `<div class="cefr-bar" title="${tooltip}">
        <div class="cefr-track"><div class="cefr-fill" style="height:${h}%;background:${color};"></div></div>
        <div class="cefr-pct">${pct===null?"–":pct+"%"}</div>
        <div class="cefr-lbl">${label}</div>
      </div>`;
    }).join("");
    return `<div class="cefr-macro">
      <div class="cefr-macro-title">${m.title}</div>
      <div class="cefr-bars">${bars}</div>
    </div>`;
  }).join("");
}

function renderStats(){
  const words = allWords();
  let total=0, neverShown=0;
  const now = Date.now();
  for(const it of words){
    const p = getProgress(it.en);
    total++;
    // BUGFIX: dit gebruikte voorheen p.level>0 (resp. p.level===0) i.p.v. p.reps>0 (resp. ===0) -- de
    // taaltoets (skipLessonsToLevel) zet bij duizenden woorden alvast een niveau (7) zonder ze ooit
    // echt te tonen (reps blijft 0, due blijft op het moment van aanmaken staan). Daardoor telden die
    // woorden hier al als "getoond" én als "due" (want hun stokoude due-tijdstip lag allang in het
    // verleden), terwijl de daadwerkelijke oefenwachtrij (die wél reps>0 vereist) ze terecht negeert --
    // vandaar het grote verschil tussen deze teller en het echte aantal "due exercises".
    if(p.reps === 0){
      neverShown++;
    }
  }
  // Zelfde unie-aanpak als de "level 8+"-teller hieronder: due-woorden op het onderliggende Engelse woord
  // (via baseEnOf) samenvoegen over en-tr EN tr-en, gededupliceerd -- i.p.v. alleen en-tr te tellen (wat
  // due tr-en-woorden negeerde) of de twee richtingen los te tellen/optellen (wat dubbeltelt of een niet-
  // betekenisvol gemiddelde geeft, zie ook de toelichting bij mastered8Words).
  const dueWords = new Set();
  for(const it of words){
    const p = getProgress(it.en);
    if(p.reps > 0 && p.due <= now) dueWords.add(baseEnOf(it.en));
  }
  for(const w of TR_WORDS_DATA){
    const p = getProgress(w.key);
    if(p.reps > 0 && p.due <= now) dueWords.add(baseEnOf(w.en));
  }
  const dueUnion = dueWords.size;
  // en-tr en tr-en zijn twee APART gecureerde lijsten met elk hun eigen score voor hetzelfde onderliggende
  // Turkse vocabulaire (zie [[oxford5000-wordlist]]) -- een simpel gemiddelde van twee losse tellingen
  // (het vorige idee) is geen betekenisvolle maat: die loopt uiteen zodra de twee richtingen ongelijk ver
  // staan (heel plausibel, tr-en is later toegevoegd dan en-tr). In plaats daarvan: de ECHTE unie op het
  // onderliggende Engelse woord (via baseEnOf) -- elk woord dat in MINSTENS ÉÉN richting niveau 8+ heeft,
  // telt precies 1x mee, ongeacht of het ook (of alleen) in de andere richting beheerst wordt.
  const mastered8Words = new Set();
  for(const it of words){
    if(getProgress(it.en).level >= 8) mastered8Words.add(baseEnOf(it.en));
  }
  for(const w of TR_WORDS_DATA){
    if(getProgress(w.key).level >= 8) mastered8Words.add(baseEnOf(w.en));
  }
  const mastered8Union = mastered8Words.size;
  el("kpi-total").textContent = total;
  el("kpi-due").textContent = dueUnion;
  const neverEl = el("kpi-never");
  if(neverEl) neverEl.textContent = neverShown;
  const mastered8El = el("kpi-mastered8");
  if(mastered8El) mastered8El.textContent = mastered8Union;

  // Grammatica-KPI's: zelfde soort tellingen, maar dan voor de 46 grammatica-onderwerpen
  let gTotal=0, gDue=0;
  for(const t of GRAMMAR_TOPICS){
    const p = getTopicProgress(t);
    gTotal++;
    if(p.due <= now && p.reps > 0) gDue++;
  }
  el("kpi-gram-total").textContent = gTotal;
  el("kpi-gram-due").textContent = gDue;

  renderCefrProgress("cefr-progress-vocab", cefrWordProgress);
  renderCefrProgress("cefr-progress-grammar", cefrGrammarProgress);
  renderGrammarList();
}

function renderGrammarList(){
  const list = el("grammar-list");
  if(!list) return;
  const rows = GRAMMAR_TOPICS.map(t=>({t, p: getTopicProgress(t), level: displayTopicLevel(t)}))
    .sort((a,b)=> a.level - b.level); // zwakste eerst
  list.innerHTML = rows.map(({t,p,level})=>{
    const pct = level*10;
    const color = (p.reps===0 && level===0) ? "#4a5568" : (level<=3 ? "#e0333f" : level<=6 ? "#e0a733" : "#2fae6a");
    const statusTxt = p.reps===0
      ? (level>0 ? `level ${level}/10 (set manually)` : "not practised yet")
      : `level ${level}/10 · practised ${p.reps}x`;
    // Springt naar de bijbehorende les op de Course-tab (indien die bestaat -- bij een onderwerp met
    // meerdere varianten/lessen wordt de EERSTE genomen, precies genoeg voor een snelle sprong).
    const lesson = lessonsForBaseTopicKey(t.key)[0];
    const clickable = !!lesson;
    return `<div class="grammar-list-row${clickable ? " clickable" : ""}" data-topic-key="${t.key}" style="margin-bottom:10px;${clickable ? "cursor:pointer;" : ""}">
      <div class="row space-between" style="font-size:.85rem;margin-bottom:3px;">
        <span title="${escapeHtml(t.hint)}">${escapeHtml(t.label)} <span class="muted" style="font-size:.75rem;">· ${cefrLabel(t.minCefr)}</span></span>
        <span class="muted">${statusTxt}</span>
      </div>
      <div style="height:6px;border-radius:4px;background:#0d1720;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};"></div>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll(".grammar-list-row.clickable").forEach(row=>{
    row.addEventListener("click", ()=>{
      const lesson = lessonsForBaseTopicKey(row.dataset.topicKey)[0];
      if(!lesson) return;
      const idx = LESSONS.indexOf(lesson);
      if(idx === -1) return;
      switchTab("course");
      openLessonModal(idx);
    });
  });
}


function exportWordlist(){
  const words = allWords();
  const blob = new Blob([JSON.stringify(words, null, 1)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "turkish_words_bijgewerkt.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ===================== TABS ===================== */
/* ===================== WOORDEN-TAB (bladeren door de hele lijst) ===================== */

function renderWordsTab(){
  const sort = el("words-sort").value;
  const filter = el("words-filter").value;
  const cefrFilter = el("words-cefr-filter").value;
  const dirFilter = el("words-direction-filter").value;
  const search = el("words-search").value.trim().toLowerCase();

  // Combineert de en-tr-lijst (EN_WORDS_DATA) en/of de tr-en-lijst (TR_WORDS_DATA) tot rijen met een
  // gemeenschappelijke vorm, elk met hun EIGEN progress-sleutel/score -- zie practiceWordEntries() voor
  // dezelfde en/tr-scheiding zoals ook de daadwerkelijke oefening 'm gebruikt.
  let words = [];
  if(dirFilter !== "tr-en"){
    words.push(...EN_WORDS_DATA.map(w => {
      const p = getProgress(w.en);
      const trans = cachedTranslation(w.en);
      const hasOverride = !!(overrides[w.en] && ((overrides[w.en].tr && overrides[w.en].tr.length) || overrides[w.en].en));
      return {
        key: w.en, source: "en", cefr: w.cefr, level: p.level, reps: p.reps, ease: easeOf(w.en),
        sortKey: baseEnOf(w.en),
        displayWord: overrides[w.en]?.en || baseEnOf(w.en),
        displayTrans: trans ? trans.join(", ") : "(not yet translated)",
        pos: wordCategoryOf(w.en),
        hasOverride,
        editEn: w.en,
        searchText: (baseEnOf(w.en) + " " + (trans ? trans.join(" ") : "")).toLowerCase(),
      };
    }));
  }
  if(dirFilter !== "en-tr"){
    words.push(...TR_WORDS_DATA.map(w => {
      const p = getProgress(w.key);
      return {
        key: w.key, source: "tr", cefr: w.cefr, level: p.level, reps: p.reps, ease: easeOf(w.key),
        sortKey: w.tr,
        displayWord: w.tr,
        displayTrans: displayTrEntryGloss(w),
        pos: (WORD_CATEGORY_ABBR[w.pos] || w.pos || ""),
        hasOverride: !!overrides[w.key],
        editEn: w.key,
        searchText: (w.tr + " " + w.en).toLowerCase(),
      };
    }));
  }

  if(filter === "introduced") words = words.filter(w => w.reps > 0);

  if(cefrFilter !== "all"){
    // Cumulatief: "B1" selecteren toont B1 ÉN alles daarvoor (A1, A2) — niet uitsluitend B1 zelf.
    const MAJOR_ORDER = ["A1","A2","B1","B2","C1","C2"];
    const selectedIdx = MAJOR_ORDER.indexOf(cefrFilter);
    words = words.filter(w => MAJOR_ORDER.indexOf(CEFR_MAJOR[w.cefr]) <= selectedIdx);
  }

  if(search){
    words = words.filter(w => w.searchText.includes(search));
  }

  if(sort === "proficiency-asc") words.sort((a,b)=> a.level - b.level || a.sortKey.localeCompare(b.sortKey));
  else if(sort === "proficiency-desc") words.sort((a,b)=> b.level - a.level || a.sortKey.localeCompare(b.sortKey));
  // Laagste ease-factor eerst = het woord dat de SRS zelf (los van het 0-10 niveau) als moeilijkst
  // beschouwt, omdat het intervallen na foute antwoorden telkens weer laat inkrimpen.
  else if(sort === "ease-asc") words.sort((a,b)=> a.ease - b.ease || a.sortKey.localeCompare(b.sortKey));
  else words.sort((a,b)=> a.sortKey.localeCompare(b.sortKey));

  el("words-list").innerHTML = words.map(w=>{
    const color = w.reps===0 ? "#4a5568" : (w.level<=3 ? "#e0333f" : w.level<=6 ? "#e0a733" : "#2fae6a");
    const scoreLabel = w.reps===0 ? "new" : `${w.level}/10`;
    const easeLabel = w.reps===0 ? "" : ` <span class="muted" style="font-size:.65rem;" title="Individual ease-factor (steers repeat timing)">⚙️${w.ease.toFixed(2)}</span>`;
    const cefrTxt = typeof w.cefr === "number" ? cefrLabel(w.cefr) : "?";
    const dirTag = w.source === "tr" ? ` <span class="muted" style="font-size:.65rem;">TR→EN</span>` : ` <span class="muted" style="font-size:.65rem;">EN→TR</span>`;
    const fixBtn = `<button class="btn-ghost btn-small edit-word-btn" data-en="${w.editEn.replace(/"/g,'&quot;')}" data-source="${w.source}" style="margin-top:4px;padding:1px 6px;font-size:.68rem;">✏️ Fix</button>`;
    // Turks om uit te spreken: bij een tr-en-rij is dat het getoonde woord zelf, bij en-tr de vertaling.
    const speakTxt = w.source === "tr" ? w.displayWord : w.displayTrans;
    const speakBtn = speakTxt ? `<button class="btn-ghost btn-small speak-word-btn" data-tr="${escapeHtml(speakTxt)}" style="margin-top:0;padding:1px 6px;font-size:.85rem;" title="Pronounce">🔊</button>` : "";
    return `<div class="word-row">
      <div>
        <div class="word-row-tr">${escapeHtml(w.displayWord)}${w.pos ? ` <span class="muted" style="font-size:.7rem;font-weight:400;">${w.pos}</span>` : ""}${w.hasOverride ? ` <span class="muted" style="font-size:.68rem;" title="Manually corrected">✏️</span>` : ""}${dirTag} ${speakBtn}</div>
        <div class="word-row-trans">${escapeHtml(w.displayTrans)}</div>
      </div>
      <div style="text-align:right;">
        <div class="word-row-score" style="color:${color};">${scoreLabel}${easeLabel}</div>
        <div class="muted" style="font-size:.68rem;margin-top:2px;">${cefrTxt}</div>
        ${fixBtn}
      </div>
    </div>`;
  }).join("") || `<div class="muted" style="padding:12px 0;">No words found.</div>`;
  el("words-list").querySelectorAll(".speak-word-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> speakTurkish(btn.dataset.tr));
  });
  el("words-list").querySelectorAll(".edit-word-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> openEditWordModal(btn.dataset.en, btn.dataset.source));
  });
}

/* Levert de N zwakst-scorende woorden op, uitsluitend uit woorden die al minstens één keer geoefend
   zijn -- een nog-nooit-getoond woord (level 0, reps 0) is niet "zwak", het is simpelweg nog niet aan
   bod geweest, dus die tellen hier bewust niet mee. Alleen woorden binnen het ingestelde CEFR-bereik
   komen in aanmerking, net als bij de gewone woordoefening.
   "Zwakte" is een gewogen combinatie van drie afzonderlijke criteria, elk genormaliseerd naar een
   0-1-schaal binnen de huidige pool (zodat de gewichten onderling vergelijkbaar zijn, ongeacht hoe
   groot het aantal fouten of hoe recent "recent" in absolute zin is):
     - meest vaak fout (gewicht 10): w.wrong t.o.v. het hoogste aantal fouten in de pool
     - meest recent fout (gewicht 5): hoe korter geleden lastWrongAt, hoe hoger (nooit fout -> 0)
     - laagste score (gewicht 2): (10 - level) / 10
   Deze drie worden opgeteld tot één score; hoogste score = zwakste woord, komt bovenaan te staan. */
function weaknessScore(w, maxWrong, now){
  const wrongComponent = maxWrong > 0 ? (w.wrong / maxWrong) : 0;
  const recencyComponent = w.lastWrongAt ? Math.max(0, 1 - (now - w.lastWrongAt) / (7 * 24 * 60 * 60 * 1000)) : 0; // vervalt lineair over 7 dagen
  const levelComponent = (10 - w.level) / 10;
  return 10 * wrongComponent + 5 * recencyComponent + 2 * levelComponent;
}
function getWeakestWords(count){
  const now = Date.now();
  const enPool = EN_WORDS_DATA
    .filter(w => inCefrRangeEn(w.en))
    .map(w => { const p = getProgress(w.en); return {key:w.en, source:"en", cefr:w.cefr, level: p.level, reps: p.reps, correct: p.correct || 0, wrong: p.reps - (p.correct || 0), lastWrongAt: p.lastWrongAt || null}; });
  // tr-en-pool heeft zijn EIGEN cefr per Turkse term (zie TR_WORDS_DATA) i.p.v. het cefr van het
  // onderliggende Engelse woord -- vocabCefrBand-vergelijking i.p.v. inCefrRangeEn (dat alleen EN-
  // sleutels kent).
  const lo = vocabCefrBand(Math.min(settings.cefrMin, settings.cefrMax)), hi = vocabCefrBand(Math.max(settings.cefrMin, settings.cefrMax));
  const trPool = TR_WORDS_DATA
    .filter(w => typeof w.cefr !== "number" || (vocabCefrBand(w.cefr) >= lo && vocabCefrBand(w.cefr) <= hi))
    .map(w => { const p = getProgress(w.key); return {key:w.key, source:"tr", cefr:w.cefr, trData:w, level: p.level, reps: p.reps, correct: p.correct || 0, wrong: p.reps - (p.correct || 0), lastWrongAt: p.lastWrongAt || null}; });
  const practiced = [...enPool, ...trPool].filter(w => w.reps > 0);
  const maxWrong = practiced.reduce((m,w)=>Math.max(m,w.wrong), 0);
  const sorted = practiced.sort((a,b)=> weaknessScore(b,maxWrong,now) - weaknessScore(a,maxWrong,now));
  return sorted.slice(0, count);
}

function currentWeakWordsCount(){
  const sel = el("weak-words-count").value;
  if(sel === "custom"){
    const n = parseInt(el("weak-words-count-custom").value, 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
  }
  return parseInt(sel, 10);
}

function renderWeakWordsList(){
  const count = currentWeakWordsCount();
  const words = getWeakestWords(count);
  if(!words.length){
    el("weak-words-list").innerHTML = `<div class="muted" style="padding:8px 0;">No practiced words in your current CEFR range yet — this list fills up as soon as you start practising.</div>`;
    return;
  }
  const rows = words.map(w=>{
    if(w.source === "tr"){
      const color = w.level<=3 ? "#e0333f" : w.level<=6 ? "#e0a733" : "#2fae6a";
      const dirTag = ` <span class="muted" style="font-size:.65rem;">TR→EN</span>`;
      const speakBtn = `<button class="btn-ghost btn-small speak-word-btn" data-tr="${escapeHtml(w.trData.tr)}" style="margin-top:0;padding:1px 6px;font-size:.85rem;" title="Pronounce">🔊</button>`;
      return `<div class="word-row">
        <div>
          <div class="word-row-tr">${escapeHtml(w.trData.tr)}${w.trData.pos ? ` <span class="muted" style="font-size:.7rem;font-weight:400;">${WORD_CATEGORY_ABBR[w.trData.pos] || w.trData.pos}</span>` : ""}${dirTag} ${speakBtn}</div>
          <div class="word-row-trans">${escapeHtml(displayTrEntryGloss(w.trData))}</div>
        </div>
        <div style="text-align:right;">
          <div class="word-row-score" style="color:${color};">${w.level}/10</div>
          <div class="muted" style="font-size:.68rem;margin-top:2px;">${w.wrong} wrong</div>
        </div>
      </div>`;
    }
    // pickWordSense geeft de SPECIFIEKE, primaire betekenis (incl. gloss om te disambigueren bij een
    // woord met meerdere losstaande betekenissen) i.p.v. cachedTranslation's platgeslagen lijst van ALLE
    // betekenissen door elkaar -- zo is meteen duidelijk welke vertaling bij dit specifieke woord (en,
    // bij meerdere zelfstandige "en"-entries voor hetzelfde basiswoord, welke betekenis) precies zwak is.
    const sense = pickWordSense(w.key, "en-tr");
    const cached = cachedTranslation(w.key);
    const transTxt = (sense && sense.tr && sense.tr.length) ? sense.tr.join(", ") : (cached ? cached.join(", ") : "(not yet translated)");
    const glossTxt = (sense && sense.gloss) ? ` <span class="muted" style="font-size:.68rem;">(${escapeHtml(sense.gloss)})</span>` : "";
    const color = w.level<=3 ? "#e0333f" : w.level<=6 ? "#e0a733" : "#2fae6a";
    const displayEn = overrides[w.key]?.en || baseEnOf(w.key);
    const pos = wordCategoryOf(w.key);
    const dirTag = ` <span class="muted" style="font-size:.65rem;">EN→TR</span>`;
    const speakBtn = transTxt && transTxt !== "(not yet translated)" ? `<button class="btn-ghost btn-small speak-word-btn" data-tr="${escapeHtml(transTxt)}" style="margin-top:0;padding:1px 6px;font-size:.85rem;" title="Pronounce">🔊</button>` : "";
    return `<div class="word-row">
      <div>
        <div class="word-row-tr">${escapeHtml(displayEn)}${pos ? ` <span class="muted" style="font-size:.7rem;font-weight:400;">${pos}</span>` : ""}${dirTag} ${speakBtn}</div>
        <div class="word-row-trans">${escapeHtml(transTxt)}${glossTxt}</div>
      </div>
      <div style="text-align:right;">
        <div class="word-row-score" style="color:${color};">${w.level}/10</div>
        <div class="muted" style="font-size:.68rem;margin-top:2px;">${w.wrong} wrong</div>
      </div>
    </div>`;
  }).join("");
  // De "Practice"-sessieknop ondersteunt nu (net als het hoofd-oefenscherm) zowel en-tr- als
  // tr-en-items in dezelfde sessie -- via lesson.wordEntries (zie nextSkillPracticeQuestion), i.p.v.
  // de vroegere lesson.words die alleen kale Engelse sleutels kon verwerken en tr-en-woorden dus moest
  // uitsluiten.
  const practiceBtn = `<button id="btn-practice-weak-words" class="btn-primary" style="width:100%;margin-top:10px;">▶️ Practice these ${words.length} words</button>`;
  el("weak-words-list").innerHTML = rows + practiceBtn;
  el("weak-words-list").querySelectorAll(".speak-word-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> speakTurkish(btn.dataset.tr));
  });
  el("btn-practice-weak-words").addEventListener("click", ()=>{
    startSkillPractice({id:"weak-words-session", title:`${words.length} weakest words`, wordEntries: words});
  });
}

// Toont/verbergt de zwakste-woordenlijst met dezelfde knop -- "Show list" <-> "Hide list".
function toggleWeakWordsList(){
  const btn = el("btn-show-weak-words");
  const showing = btn.dataset.showing === "1";
  if(showing){
    el("weak-words-list").innerHTML = "";
    btn.textContent = "Show list";
    btn.dataset.showing = "0";
  } else {
    renderWeakWordsList();
    btn.textContent = "Hide list";
    btn.dataset.showing = "1";
  }
}

/* ===================== COURSE TAB ===================== */
let openLessonIdx = null;

const CEFR_MACRO_ORDER = ["Fundamentals","A1","A2","B1","B2","C1","C2"];
function macroCefrOfLesson(l){
  // Grammatica-basisbegrippen-hoofdstuk (znw/ww/lijdend voorwerp/etc.) -- geen Turks-specifiek niveau,
  // hoort altijd als eerste, aparte sectie vóór de Turkse cursus zelf.
  if(l.id && l.id.startsWith("gf_")) return "Fundamentals";
  let cefr18 = null;
  if(typeof l.cefr === "number") cefr18 = l.cefr; // vocabulaire-les
  else if(l.grammarTopics && l.grammarTopics.length) cefr18 = Math.max(...l.grammarTopics.map(k=>grammarTopicByKey(k).minCefr));
  if(cefr18 === null) return "A1"; // uitlegles zonder eigen niveau (bv. "How Turkish Works") -> bovenaan bij A1
  return CEFR_MAJOR[Math.max(0, Math.min(17, cefr18))];
}

// Proficiency (0-10, één decimaal) van een les -- voor grammaticalessen het gemiddelde over de
// gekoppelde onderwerpen, voor vocabulairelessen het gemiddelde over de woorden. Puur leeslessen
// zonder eigen oefenstof (bv. "How Turkish Works") hebben geen cijfer. Dit is het ECHTE, op de
// gegeven antwoorden gebaseerde niveau -- gebruikt om te bepalen of een les "done" is, niet om te
// tonen (zie displayLessonGrade hieronder).
function lessonProficiency(l){
  if(l.grammarTopics && l.grammarTopics.length){
    const avg = l.grammarTopics.reduce((s,k)=>s+getTopicProgress(grammarTopicByKey(k)).level, 0) / l.grammarTopics.length;
    return Math.round(avg*10)/10;
  }
  if(l.words && l.words.length){
    const avg = l.words.reduce((s,en)=>s+getProgress(en).level, 0) / l.words.length;
    return Math.round(avg*10)/10;
  }
  return null;
}

// Het GETOONDE lescijfer: normaal gewoon de echte, op je antwoorden gebaseerde proficiency. Via het
// potloodje bij een les (renderCourseLessonRow) kun je zelf een cijfer instellen voor een les die je
// vindt dat je al beheerst, ook al is er hier nog niet (genoeg) op geoefend -- dat werkt als een
// PERSOONLIJK MINIMUM voor precies die ene les, geen vaste waarde: je echte proficiency kan het gewoon
// overtreffen zodra je verder oefent. Puur lokaal (per browser), dus niet gesynct en niet van invloed
// op anderen die dezelfde app-link gebruiken.
let lessonGradeOverrides = loadJSON(LS_LESSON_GRADE_OVERRIDES, {});
function displayLessonGrade(l){
  const real = lessonProficiency(l);
  if(real === null) return null;
  const override = lessonGradeOverrides[l.id];
  return override !== undefined ? Math.max(real, override) : real;
}

// Zelfde "PERSOONLIJK MINIMUM"-idee als displayLessonGrade, maar dan doorgetrokken naar de
// onderliggende grammatica-onderwerpen/woorden zelf -- anders zou een les die je op een 10 hebt
// gezet wél als voltooid tellen in de cursus, maar de "mastered"-tellers en de losse
// onderwerpenlijst op de Statistieken-tab zouden nog steeds de kale, niet-overruled score tonen
// (precies het gerapporteerde probleem: die twee schermen "hangen samen" met de les-override, maar
// keken er voorheen helemaal niet naar). Een onderwerp/woord kan in meerdere lessen voorkomen; het
// hoogste override-cijfer van al die lessen geldt.
let _topicToLessonsMap = null;
function lessonsForTopicKey(key){
  if(!_topicToLessonsMap){
    _topicToLessonsMap = {};
    for(const l of LESSONS){
      if(l.grammarTopics) for(const k of l.grammarTopics){
        (_topicToLessonsMap[k] = _topicToLessonsMap[k] || []).push(l);
      }
    }
  }
  return _topicToLessonsMap[key] || [];
}
let _baseTopicToLessonsMap = null;
// Zelfde soort index als lessonsForTopicKey hierboven, maar dan op de KALE onderwerp-sleutel i.p.v.
// een eventueel variant-gescoopte sleutel (bv. "hitap_bicimleri" i.p.v. "hitap_bicimleri::titel") --
// nodig voor renderGrammarList hieronder, die met de kale GRAMMAR_TOPICS-onderwerpen werkt en bij een
// onderwerp met varianten anders geen enkele les zou vinden (die staan allemaal alleen variant-gescoopt
// in l.grammarTopics).
function lessonsForBaseTopicKey(baseKey){
  if(!_baseTopicToLessonsMap){
    _baseTopicToLessonsMap = {};
    for(const l of LESSONS){
      if(l.grammarTopics) for(const k of l.grammarTopics){
        const base = k.includes("::") ? k.split("::")[0] : k;
        (_baseTopicToLessonsMap[base] = _baseTopicToLessonsMap[base] || []).push(l);
      }
    }
  }
  return _baseTopicToLessonsMap[baseKey] || [];
}
function displayTopicLevel(t){
  const real = getTopicProgress(t).level;
  let best = real;
  for(const l of lessonsForTopicKey(t.key)){
    const ov = lessonGradeOverrides[l.id];
    if(ov !== undefined && ov > best) best = ov;
  }
  return best;
}
let _wordToLessonsMap = null;
function lessonsForWordEn(en){
  if(!_wordToLessonsMap){
    _wordToLessonsMap = {};
    for(const l of LESSONS){
      if(l.words) for(const w of l.words){
        (_wordToLessonsMap[w] = _wordToLessonsMap[w] || []).push(l);
      }
    }
  }
  return _wordToLessonsMap[en] || [];
}
function displayWordLevel(en){
  const real = getProgress(en).level;
  let best = real;
  for(const l of lessonsForWordEn(en)){
    const ov = lessonGradeOverrides[l.id];
    if(ov !== undefined && ov > best) best = ov;
  }
  return best;
}

// Of een les als "voltooid" telt -- gebruikt het GETOONDE cijfer (dus inclusief een eventueel
// handmatig ingesteld minimum via het potloodje), niet de kale praktijk-proficiency. Anders zou een
// les die je zelf op een 10 hebt gezet nergens als voltooid meetellen: niet in de voortgangstelling
// bovenaan de cursus, niet in de per-sectie "X/Y"-tellers, nergens -- exact het gerapporteerde
// probleem. isLessonCompleted (los begrip, voor leeslessen zonder eigen cijfer) blijft ongewijzigd.
function isLessonDone(l){
  const p = displayLessonGrade(l);
  return p !== null ? p >= CHECKUP_PASS_LEVEL : isLessonCompleted(l.id);
}

function renderCourseLessonRow(l, idx){
  const level = displayLessonGrade(l);
  const lastScore = lastSkillPracticeScore[l.id];
  const scoreTxt = lastScore ? ` · Last score: ${lastScore.correct}/${lastScore.total}` : "";
  let rightHtml, sub;
  if(level === null){
    rightHtml = `<div style="font-size:1.1rem;">📖</div>`;
    sub = isLessonCompleted(l.id) ? "✅ Read" : "Reference — tap to read";
  } else {
    const color = level<=3 ? "#e0333f" : level<=6 ? "#e0a733" : level<9 ? "#2fae6a" : "#4fd88a";
    const hasOverride = lessonGradeOverrides[l.id] !== undefined;
    rightHtml = `<div style="font-size:1rem;font-weight:700;color:${color};">${level}/10</div>
      <button class="btn-ghost btn-small grade-override-btn" data-id="${l.id}" style="padding:1px 6px;font-size:.68rem;margin-top:2px;" title="Set your own grade for this lesson">${hasOverride ? "✏️ own" : "✏️"}</button>`;
    sub = (level === 0 ? "Not tried yet" : level >= 9 ? "Well in hand" : "In progress") + scoreTxt;
  }
  return `<div class="word-row" style="cursor:pointer;" data-idx="${idx}">
    <div>
      <div class="word-row-tr">${l.icon} ${l.title}</div>
      <div class="word-row-trans">${sub}</div>
    </div>
    <div style="text-align:right;">
      ${rightHtml}
    </div>
  </div>`;
}

// Rendert één kolom (grammatica óf vocabulaire) als in-/uitklapbare A1-C2-secties, om te veel
// scrollen door 500+ lessen te voorkomen -- alleen de sectie waar de gebruiker nu daadwerkelijk
// zit staat standaard open, de rest is ingeklapt maar wel altijd bereikbaar.
let courseSectionOpen = loadJSON(LS_COURSE_SECTIONS, {grammar:{}, vocab:{}});
function isMacroOpen(track, macro, defaultVal){
  const trackState = courseSectionOpen[track];
  return (trackState && macro in trackState) ? trackState[macro] : defaultVal;
}
function setMacroOpen(track, macro, val){
  if(!courseSectionOpen[track]) courseSectionOpen[track] = {};
  courseSectionOpen[track][macro] = val;
  saveJSON(LS_COURSE_SECTIONS, courseSectionOpen);
}

// Splitst een lessenlijst in (max) 3 zo gelijk mogelijke opeenvolgende delen: start/mid/end. Een
// eventueel restant (n niet deelbaar door 3) gaat naar de eerste delen, niet naar het laatste, zodat
// "end" nooit onbedoeld het grootste stuk wordt.
function splitStartMidEnd(list){
  const n = list.length;
  const base = Math.floor(n/3);
  const rem = n % 3;
  const sizes = [base + (rem>0?1:0), base + (rem>1?1:0), base];
  let i = 0;
  return sizes.map(s=>{ const part = list.slice(i, i+s); i += s; return part; });
}
const SUB_LABELS = ["Start","Mid","End"];

function renderCourseColumn(containerEl, items, currentMacro, track){
  const groups = {};
  for(const item of items){
    const macro = macroCefrOfLesson(item.l);
    (groups[macro] = groups[macro] || []).push(item);
  }
  containerEl.innerHTML = CEFR_MACRO_ORDER.filter(m=>groups[m] && groups[m].length).map(macro=>{
    const list = groups[macro];
    const doneInGroup = list.filter(({l})=>isLessonDone(l)).length;
    const openAttr = isMacroOpen(track, macro, macro === currentMacro) ? " open" : "";
    const subHtml = splitStartMidEnd(list).map((subList, i)=>{
      if(!subList.length) return "";
      const subDone = subList.filter(({l})=>isLessonDone(l)).length;
      const subKey = `${macro}:${SUB_LABELS[i].toLowerCase()}`;
      const subOpenAttr = isMacroOpen(track, subKey, true) ? " open" : "";
      return `<details class="cefr-section cefr-subsection" data-macro="${macro}" data-sub="${SUB_LABELS[i].toLowerCase()}" style="margin-left:10px;"${subOpenAttr}>
        <summary style="font-size:.92em;">${SUB_LABELS[i]} <span class="muted" style="font-weight:400;">(${subDone}/${subList.length})</span></summary>
        <div class="cefr-section-body">${subList.map(({l,idx})=>renderCourseLessonRow(l, idx)).join("")}</div>
      </details>`;
    }).join("");
    return `<details class="cefr-section" data-macro="${macro}"${openAttr}>
      <summary>${macro} <span class="muted" style="font-weight:400;">(${doneInGroup}/${list.length} · ${list.length} lessons)</span></summary>
      <div class="cefr-section-body">${subHtml}</div>
    </details>`;
  }).join("");
  containerEl.querySelectorAll("[data-idx]").forEach(row=>{
    const idx = parseInt(row.dataset.idx, 10);
    row.addEventListener("click", ()=> openLessonModal(idx));
  });
  containerEl.querySelectorAll(".grade-override-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation(); // niet ook de les-modal openen
      openLessonGradeModal(btn.dataset.id);
    });
  });
  // Onthoud in-/uitklappen: de native <details>-"toggle"-event vuurt zowel bij open- als dichtklikken.
  // Sub-secties (start/mid/end) worden nu ook apart onthouden, onder hun eigen "macro:sub"-sleutel,
  // zodat een dichtgeklapte sub-sectie niet steeds opnieuw openspringt bij elke her-render (bv. na
  // het instellen van een eigen lescijfer).
  containerEl.querySelectorAll(".cefr-section:not(.cefr-subsection)").forEach(det=>{
    det.addEventListener("toggle", ()=> setMacroOpen(track, det.dataset.macro, det.open));
  });
  containerEl.querySelectorAll(".cefr-section.cefr-subsection").forEach(det=>{
    det.addEventListener("toggle", ()=> setMacroOpen(track, `${det.dataset.macro}:${det.dataset.sub}`, det.open));
  });
}

function renderCourseTab(){
  const doneCount = LESSONS.filter(l=>isLessonDone(l)).length;
  el("course-progress-count").textContent = `${doneCount} / ${LESSONS.length} lessons complete`;

  const curGrammarMacro = macroCefrOfLesson(currentGrammarLesson());
  const curVocabMacro = macroCefrOfLesson(currentVocabLesson());

  // links: grammatica-boom (incl. eventuele pure uitleglessen zonder eigen oefenstof) -- rechts: vocabulaire
  const grammarItems = [], vocabItems = [];
  LESSONS.forEach((l, idx)=>{
    if(l.words && l.words.length) vocabItems.push({l, idx});
    else grammarItems.push({l, idx});
  });

  renderCourseColumn(el("grammar-tree"), grammarItems, curGrammarMacro, "grammar");
  renderCourseColumn(el("vocab-tree"), vocabItems, curVocabMacro, "vocab");
}

/* ===== Persoonlijk lescijfer (potloodje) — handmatig ingesteld minimum voor precies één les ===== */
let gradeOverrideLessonId = null;
function openLessonGradeModal(lessonId){
  const l = LESSONS.find(x=>x.id===lessonId);
  if(!l) return;
  gradeOverrideLessonId = lessonId;
  el("lesson-grade-modal-title").textContent = `✏️ ${l.icon} ${l.title}`;
  const current = lessonGradeOverrides[lessonId];
  const real = lessonProficiency(l);
  el("lesson-grade-input").value = current !== undefined ? current : Math.round(real ?? 0);
  el("btn-lesson-grade-clear").classList.toggle("hidden", current === undefined);
  el("modal-lesson-grade").classList.remove("hidden");
  el("lesson-grade-input").focus();
}
function saveLessonGradeOverride(){
  if(!gradeOverrideLessonId) return;
  const v = parseFloat(el("lesson-grade-input").value);
  if(!Number.isFinite(v)){ el("modal-lesson-grade").classList.add("hidden"); return; }
  lessonGradeOverrides[gradeOverrideLessonId] = Math.max(0, Math.min(10, v));
  saveJSON(LS_LESSON_GRADE_OVERRIDES, lessonGradeOverrides);
  closeLessonGradeModal();
}
function clearLessonGradeOverride(){
  if(!gradeOverrideLessonId) return;
  delete lessonGradeOverrides[gradeOverrideLessonId];
  saveJSON(LS_LESSON_GRADE_OVERRIDES, lessonGradeOverrides);
  closeLessonGradeModal();
}
function closeLessonGradeModal(){
  el("modal-lesson-grade").classList.add("hidden");
  gradeOverrideLessonId = null;
  renderCourseTab();
  if(openLessonIdx !== null && !el("modal-lesson").classList.contains("hidden")) openLessonModal(openLessonIdx);
}

async function openLessonModal(idx){
  openLessonIdx = idx;
  const l = LESSONS[idx];
  el("lesson-modal-title").textContent = `${l.icon} ${l.title}`;
  el("lesson-modal-explanation").innerHTML = l.explanation;
  const needsPractice = l.grammarTopics.length > 0 || (l.words && l.words.length > 0);
  const level = displayLessonGrade(l);
  const lastScore = lastSkillPracticeScore[l.id];
  el("lesson-modal-progress").innerHTML = level !== null
    ? `<div class="muted">Current proficiency: <b>${level}/10</b>` + (lastScore ? ` · Last practice round: <b>${lastScore.correct}/${lastScore.total}</b>` : "") + ` · <button class="btn-ghost btn-small" id="btn-lesson-modal-grade" style="padding:1px 6px;font-size:.75rem;">✏️ ${lessonGradeOverrides[l.id] !== undefined ? "edit" : "set"} my own grade</button></div>`
    : (isLessonCompleted(l.id) ? `<div class="muted">✅ Marked as read.</div>` : "");
  if(level !== null) el("btn-lesson-modal-grade").onclick = ()=> openLessonGradeModal(l.id);
  if(needsPractice){
    el("btn-lesson-action").classList.add("hidden"); // "Practice this skill" hieronder is de weg
  } else {
    // zuivere leesles zonder eigen oefenstof (bv. "How Turkish Works") -- heeft geen cijfer, dus kan
    // alleen via een expliciete "gelezen"-markering meetellen als voltooid
    el("btn-lesson-action").textContent = isLessonCompleted(l.id) ? "Mark as unread" : "Got it — mark as read";
    el("btn-lesson-action").classList.remove("hidden");
  }
  el("btn-practice-skill").classList.toggle("hidden", !needsPractice);
  el("modal-lesson").classList.remove("hidden");

  if(l.words && l.words.length){
    const wordListEl = el("lesson-modal-explanation").querySelector(".vocab-word-list");
    if(!hasKeyFor("word")){
      if(wordListEl) wordListEl.insertAdjacentHTML("afterend", `<p class="muted">Set a ${keyNameFor("word")} API key in Settings to preview Turkish translations here.</p>`);
      return;
    }
    // vertalingen LIVE en SEQUENTIEEL ophalen (niet allemaal tegelijk) zodat het geen plotselinge
    // burst van AI-calls geeft — gecachede woorden (al eerder ergens getoond) zijn direct gratis.
    const rows = l.words.map(en => cachedTranslation(en) ? `<tr><td><code>${baseEnOf(en)}</code></td><td>${cachedTranslation(en)[0]}</td></tr>` : `<tr><td><code>${baseEnOf(en)}</code></td><td>…</td></tr>`);
    if(wordListEl) wordListEl.innerHTML = rows.join("");
    for(let i=0;i<l.words.length;i++){
      if(openLessonIdx !== idx || el("modal-lesson").classList.contains("hidden")) return; // gebruiker is al weg, stop met bijwerken
      if(cachedTranslation(l.words[i])) continue; // al gecached, geen call nodig
      try{
        const tr = await getOrFetchTranslation(l.words[i]);
        rows[i] = `<tr><td><code>${baseEnOf(l.words[i])}</code></td><td>${tr[0]}</td></tr>`;
      }catch(e){
        rows[i] = `<tr><td><code>${baseEnOf(l.words[i])}</code></td><td>—</td></tr>`; // vertaling ophalen mislukt
      }
      if(openLessonIdx === idx && !el("modal-lesson").classList.contains("hidden") && wordListEl){
        wordListEl.innerHTML = rows.join("");
      }
    }
  }
}

function startLessonAction(){
  const l = LESSONS[openLessonIdx];
  if(!l) return;
  // Alleen zuivere leeslessen (geen eigen oefenstof) hebben deze knop -- toggle gelezen/ongelezen
  if(isLessonCompleted(l.id)){
    lessonProgress[l.id] = {completed:false, done:0};
    saveJSON(LS_LESSONS, lessonProgress);
  } else {
    markLessonComplete(l.id);
  }
  openLessonModal(openLessonIdx); // ververst de knoptekst en het "✅ Marked as read"-label
  renderCourseTab();
}

/* ===================== READING TAB (leestekst + begripsvragen) =====================
   UI-laag voor generateReadingText/generateMoreReadingQuestions/gradeReadingAnswer (ai.js). De
   AI-functies zelf muteren niets aan readingTexts -- dat gebeurt hier, zodat opslaan/synchroniseren
   op dezelfde plek blijft als bij alle andere opslagsleutels. */
let readingState = null; // { item, queue: [indices in item.questions die nog niet gesteld zijn], pos }

// Ruwe prijsindicatie per gegenereerde ronde (1 tekst+vragen + de beoordeling van alle antwoorden) --
// gebaseerd op een schatting van ~1800 input- + ~1050 output-tokens per ronde, tegen de prijzen die de
// app zelf al gebruikt voor de kostenteller (MODEL_PRICING hierboven). Puur informatief, geen exacte
// afrekening -- de daadwerkelijke lengte van tekst/vragen/antwoorden varieert vanzelfsprekend.
function estimatedReadingCostPerRound(model){
  const p = MODEL_PRICING[model === "claude" ? "claude-sonnet-5" : "deepseek-v4-pro"];
  const cost = (1800/1e6)*p.miss + (1050/1e6)*p.output;
  return cost < 0.01 ? `~$${cost.toFixed(4)}/text` : `~$${cost.toFixed(3)}/text`;
}

function renderReadingModelButtons(){
  el("reading-model-cheap").classList.toggle("btn-primary", settings.readingModel !== "claude");
  el("reading-model-cheap").classList.toggle("btn-secondary", settings.readingModel === "claude");
  el("reading-model-best").classList.toggle("btn-primary", settings.readingModel === "claude");
  el("reading-model-best").classList.toggle("btn-secondary", settings.readingModel !== "claude");
  const hintModel = settings.readingModel === "claude" ? "claude" : "deepseek";
  el("reading-model-price-hint").textContent = `Selected: ${hintModel === "claude" ? "Claude (best quality)" : "DeepSeek (cheap)"} — ${estimatedReadingCostPerRound(hintModel)}`;
}

function renderReadingSourceButtons(){
  const isWiki = settings.readingSource === "wikipedia";
  el("reading-source-ai").classList.toggle("btn-primary", !isWiki);
  el("reading-source-ai").classList.toggle("btn-secondary", isWiki);
  el("reading-source-wiki").classList.toggle("btn-primary", isWiki);
  el("reading-source-wiki").classList.toggle("btn-secondary", !isWiki);
  el("reading-source-hint").textContent = isWiki
    ? "Real text from Turkish Wikipedia — AI only estimates its level and writes the questions, never the text itself."
    : "Text is written by AI, aimed at your chosen level.";
  // Op verzoek: bij Wikipedia als bron blijft de modelkeuze verborgen (settings.readingModel blijft
  // gewoon actief op de achtergrond -- bepaalt in die modus alleen de niveau-inschatting en de
  // begripsvragen, niet de tekst zelf -- alleen de KNOP ervoor wordt niet meer getoond).
  el("reading-model-block").classList.toggle("hidden", isWiki);
}

function renderReadingTab(){
  el("reading-level-select").value = settings.readingLevel;
  renderReadingModelButtons();
  renderReadingSourceButtons();
  el("reading-saved-list-card").classList.add("hidden");
  if(readingState){
    el("reading-session-card").classList.remove("hidden");
    renderReadingQuestion();
  } else {
    el("reading-session-card").classList.add("hidden");
  }
}

function unaskedIndices(item){
  const out = [];
  item.questions.forEach((q,i)=>{ if(!q.asked) out.push(i); });
  return out;
}

function saveNewReadingItem(item){
  readingTexts.push(item);
  saveJSON(LS_READING_TEXTS, readingTexts);
  readingState = { item, queue: unaskedIndices(item), pos: 0 };
  el("reading-session-card").classList.remove("hidden");
  renderReadingQuestion();
}

async function startNewReading(){
  if(!hasKeyFor("reading")){
    alert("A " + keyNameFor("reading") + " API key (or shared proxy) is needed for the reading exercise (Settings).");
    return;
  }
  const level = settings.readingLevel;
  el("btn-reading-new").disabled = true;

  if(settings.readingSource === "wikipedia"){
    el("btn-reading-new").textContent = "🌐 Searching Wikipedia…";
    try{
      const found = await findWikipediaReadingText(level, 5);
      if(found){
        el("btn-reading-new").textContent = "🤖 Writing questions…";
        // Hergebruikt dezelfde functie als "extra vragen bij een bestaande tekst" (zie hieronder),
        // met een lege bestaande-vragenlijst -- voor een net gevonden tekst is er nog niets om te
        // vermijden. Zo blijft de promptlogica op één plek (ai.js), geen aparte "eerste keer"-variant nodig.
        const questions = await generateMoreReadingQuestions({tr: found.tr, questions: []}, 4);
        const item = {
          id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2,7),
          tr: found.tr, level: found.level, createdAt: Date.now(),
          source: "wikipedia", sourceTitle: found.title, sourceUrl: found.url,
          questions: questions.map(q => ({q: q.q, answerHint: q.answerHint, asked: false, correct: null})),
        };
        saveNewReadingItem(item);
      } else {
        // Geen match binnen de pogingen: pas NA expliciete toestemming alsnog op AI-generatie
        // terugvallen -- zoals gevraagd, nooit stilzwijgend.
        const fallback = confirm(`Could not find a Wikipedia article matching level ${level} after 5 attempts. Generate an AI text instead?`);
        if(fallback){
          el("btn-reading-new").textContent = "🤖 Generating…";
          const { tr, questions } = await generateReadingText(level, 4);
          const item = {
            id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2,7),
            tr, level, createdAt: Date.now(), source: "ai",
            questions: questions.map(q => ({q: q.q, answerHint: q.answerHint, asked: false, correct: null})),
          };
          saveNewReadingItem(item);
        }
      }
    }catch(e){
      alert("⚠️ Could not fetch/generate a reading text: " + e.message);
    }
  } else {
    el("btn-reading-new").textContent = "🤖 Generating…";
    try{
      const { tr, questions } = await generateReadingText(level, 4);
      const item = {
        id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2,7),
        tr, level, createdAt: Date.now(), source: "ai",
        questions: questions.map(q => ({q: q.q, answerHint: q.answerHint, asked: false, correct: null})),
      };
      saveNewReadingItem(item);
    }catch(e){
      alert("⚠️ Could not generate a reading text: " + e.message);
    }
  }

  el("btn-reading-new").disabled = false;
  el("btn-reading-new").textContent = "📰 New text";
}

function renderReadingQuestion(){
  const { item, queue, pos } = readingState;
  el("reading-level-badge").textContent = item.level;
  el("reading-text-box").textContent = item.tr;
  if(item.source === "wikipedia" && item.sourceUrl){
    el("reading-attribution").innerHTML = `🌐 From Wikipedia: <a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(item.sourceTitle || "article")}</a> (CC BY-SA)`;
    el("reading-attribution").classList.remove("hidden");
  } else {
    el("reading-attribution").classList.add("hidden");
  }
  el("reading-feedback-box").innerHTML = "";
  el("reading-answer-input").value = "";
  if(pos >= queue.length){
    el("reading-question-text").textContent = "";
    el("reading-answer-input").classList.add("hidden");
    el("btn-reading-check").classList.add("hidden");
    el("btn-reading-skip").classList.add("hidden");
    el("reading-question-progress").textContent = "";
    el("reading-round-done-box").classList.remove("hidden");
    return;
  }
  el("reading-answer-input").classList.remove("hidden");
  el("btn-reading-check").classList.remove("hidden");
  el("btn-reading-check").disabled = false;
  el("btn-reading-check").textContent = "Check";
  el("btn-reading-skip").classList.remove("hidden");
  el("reading-round-done-box").classList.add("hidden");
  el("reading-answer-input").disabled = false;
  const q = item.questions[queue[pos]];
  el("reading-question-text").textContent = q.q;
  el("reading-question-progress").textContent = `Question ${pos+1} of ${queue.length}`;
  if(hasLikelyPhysicalKeyboard()) el("reading-answer-input").focus();
}

async function checkReadingAnswer(){
  const { item, queue, pos } = readingState;
  if(pos >= queue.length) return;
  const answer = el("reading-answer-input").value.trim();
  el("btn-reading-check").disabled = true;
  el("reading-answer-input").disabled = true;
  const q = item.questions[queue[pos]];
  if(!answer){
    el("reading-feedback-box").innerHTML = `<div class="feedback wrong">❌ No answer entered.<br>Reference: ${escapeHtml(q.answerHint)}</div>`;
    q.asked = true; q.correct = false;
    saveJSON(LS_READING_TEXTS, readingTexts);
    el("btn-reading-check").textContent = "Next ▶";
    el("btn-reading-check").disabled = false;
    return;
  }
  try{
    const verdict = await gradeReadingAnswer(item, q, answer);
    q.asked = true; q.correct = verdict.correct;
    saveJSON(LS_READING_TEXTS, readingTexts);
    el("reading-feedback-box").innerHTML = `<div class="feedback ${verdict.correct ? "correct" : "wrong"}">${verdict.correct ? "✅" : "❌"}${verdict.feedback ? "<br>" + escapeHtml(verdict.feedback) : ""}</div>`;
    el("btn-reading-check").textContent = "Next ▶";
    el("btn-reading-check").disabled = false;
  }catch(e){
    // Stap 6-patroon: een AI-infrastructuurfout telt niet mee, gewoon opnieuw proberen -- geen `asked`-mutatie.
    el("reading-feedback-box").innerHTML = `<div class="feedback pending">⚠️ Could not reach the AI to check your answer after retrying. Nothing was scored — please try Check again.</div>`;
    el("btn-reading-check").disabled = false;
    el("reading-answer-input").disabled = false;
  }
}

function advanceReadingQuestion(){
  if(!readingState) return;
  readingState.pos++;
  renderReadingQuestion();
}

async function generateMoreForCurrentReading(){
  const item = readingState.item;
  el("btn-reading-more-questions").disabled = true;
  el("btn-reading-more-questions").textContent = "🤖 Generating…";
  try{
    const newQs = await generateMoreReadingQuestions(item, 3);
    const startIdx = item.questions.length;
    newQs.forEach(q => item.questions.push({q: q.q, answerHint: q.answerHint, asked: false, correct: null}));
    saveJSON(LS_READING_TEXTS, readingTexts);
    readingState.queue = readingState.queue.concat(newQs.map((_,i)=>startIdx+i));
    renderReadingQuestion();
  }catch(e){
    alert("⚠️ Could not generate more questions: " + e.message);
  }
  el("btn-reading-more-questions").disabled = false;
  el("btn-reading-more-questions").textContent = "➕ Generate more questions for this text";
}

function closeReadingRound(){
  readingState = null;
  el("reading-session-card").classList.add("hidden");
}

function renderSavedReadingList(){
  const card = el("reading-saved-list-card");
  const showing = !card.classList.contains("hidden");
  if(showing){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  if(!readingTexts.length){
    el("reading-saved-list").innerHTML = `<div class="muted" style="padding:8px 0;">No saved texts yet — generate one with "New text" above.</div>`;
    return;
  }
  const rows = [...readingTexts].reverse().map(item => {
    const remaining = unaskedIndices(item).length;
    const snippet = escapeHtml(item.tr.slice(0, 70)) + (item.tr.length > 70 ? "…" : "");
    const sourceTag = item.source === "wikipedia" ? "🌐" : "🤖";
    return `<div class="word-row" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);">
      <div style="font-size:.78rem;" class="muted">${sourceTag} ${item.level} · ${item.questions.length} question${item.questions.length===1?"":"s"} · ${remaining} unasked</div>
      <div style="margin:4px 0;">${snippet}</div>
      <button class="btn-ghost btn-small resume-reading-btn" data-id="${item.id}">▶️ ${remaining ? "Continue" : "Open (all asked)"}</button>
    </div>`;
  }).join("");
  el("reading-saved-list").innerHTML = rows;
  el("reading-saved-list").querySelectorAll(".resume-reading-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const item = readingTexts.find(r => r.id === btn.dataset.id);
      if(!item) return;
      readingState = { item, queue: unaskedIndices(item), pos: 0 };
      card.classList.add("hidden");
      el("reading-session-card").classList.remove("hidden");
      renderReadingQuestion();
    });
  });
}

function switchTab(tab){
  localStorage.setItem(LS_ACTIVE_TAB, tab); // onthouden zodat een refresh niet terugspringt naar "practice"
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  el("screen-practice").classList.toggle("hidden", tab!=="practice");
  el("screen-suffixes").classList.toggle("hidden", tab!=="suffixes");
  el("screen-reading").classList.toggle("hidden", tab!=="reading");
  el("screen-course").classList.toggle("hidden", tab!=="course");
  el("screen-words").classList.toggle("hidden", tab!=="words");
  el("screen-stats").classList.toggle("hidden", tab!=="stats");
  el("screen-settings").classList.toggle("hidden", tab!=="settings");
  if(tab==="stats") renderStats();
  if(tab==="course") renderCourseTab();
  if(tab==="words") renderWordsTab();
  if(tab==="reading") renderReadingTab();
  if(tab==="suffixes"){
    renderSpecialTab();
  }
  if(tab==="practice"){
    if(!currentItem) renderPractice(); // niet opnieuw genereren als er al een opgave actief is
    else renderDueCount(); // due-telling kan intussen zijn veranderd (tijdsverloop, of via een andere tab geoefend)
  }
}

/* ===================== TAALTOETS (adaptief: 1 item tegelijk genereren, binaire zoekstrategie) ===================== */
let placementState = null; // {low, high, rounds, maxRounds, current}

async function startPlacementTest(){
  if(!hasKeyFor("sentence")){
    alert("Voor de taaltoets is een " + keyNameFor("sentence") + " API-sleutel nodig (hierboven).");
    return;
  }
  el("modal-test").classList.remove("hidden");
  el("test-question-box").classList.remove("hidden");
  el("test-result-box").classList.add("hidden");
  placementState = {low:0, high:17, rounds:0, maxRounds:6, current:null};
  await nextPlacementQuestion();
}

// Genereert en toont steeds maar 1 volgend item, op het niveau dat de binaire zoekstrategie nu het
// meest informatief acht -- i.p.v. altijd 20 items vooraf te genereren waarvan een groot deel
// achteraf overbodig blijkt (de toets stopt hier vanzelf zodra het niveau voldoende scherp is).
async function nextPlacementQuestion(){
  const {low, high, rounds, maxRounds} = placementState;
  if(low > high || rounds >= maxRounds){
    finishPlacementTest();
    return;
  }
  const mid = Math.round((low + high) / 2);
  el("test-progress").textContent = `Narrowing down your level… (question ${rounds + 1})`;
  el("test-word").textContent = "🤖 …";
  el("test-answer-input").value = "";
  el("test-answer-input").disabled = true;
  el("btn-test-next").disabled = true;
  try{
    const item = await generateSingleTestItem(mid);
    item.niveau_index = mid;
    placementState.current = item;
    el("test-badge").textContent = item.type === "sentence" ? "sentence" : "word";
    el("test-badge").className = "badge " + (item.type === "sentence" ? "badge-sentence" : "badge-word");
    el("test-word").textContent = item.tr;
    el("test-word").className = "tr-word" + (item.type === "sentence" ? " sentence" : "");
    el("test-answer-input").disabled = false;
    el("btn-test-next").disabled = false;
    el("btn-test-next").textContent = "Next";
    setTimeout(()=> el("test-answer-input").focus(), 50);
  }catch(e){
    el("test-progress").textContent = "";
    el("test-word").textContent = "⚠️ Could not load next question: " + e.message;
  }
}

/* Markeert alle lessen tot en met het punt dat bij het gegeven CEFR-niveau hoort als voltooid —
   gebruikt door de taaltoets om je meteen op het juiste punt in de cursus te zetten i.p.v. dat je
   alles vanaf A1 begin opnieuw moet doorlopen. Tussenliggende leeslessen worden op positie meegenomen. */
/* Zet, op basis van een geschat CEFR-niveau (taaltoets), het proficiency-cijfer van alle woorden en
   grammatica-onderwerpen tot en met dat niveau op 7 (indien nog lager) — puur een indicatie, geen
   vervanging van échte oefening tot een hoger cijfer. Vervangt de oude "lessen ontgrendelen"-aanpak,
   die zinloos is geworden nu niets meer vergrendeld is. */
function skipLessonsToLevel(cefrIdx){
  let vocabCount = 0, grammarCount = 0;
  for(const w of EN_WORDS_DATA){
    if(w.cefr <= cefrIdx){
      const p = getProgress(w.en);
      if(p.level < CHECKUP_PASS_LEVEL){ p.level = CHECKUP_PASS_LEVEL; vocabCount++; }
    }
  }
  for(const t of GRAMMAR_TOPICS){
    if(t.minCefr <= cefrIdx){
      // Idem als bij de checkup: elke variant apart op de vloer zetten, anders mist de oefenlogica dit.
      for(const v of getTopicVariants(t)){
        const gp = getGrammarProgress(variantProgressKey(t, v.id));
        if(gp.level < CHECKUP_PASS_LEVEL){ gp.level = CHECKUP_PASS_LEVEL; grammarCount++; }
      }
    }
  }
  if(vocabCount) saveJSON(LS_PROGRESS, progress);
  if(grammarCount) saveJSON(LS_GRAMMAR, grammar);
  return {vocab: vocabCount, grammar: grammarCount};
}

async function handleTestNext(){
  const answer = el("test-answer-input").value.trim();
  const item = placementState.current;
  el("btn-test-next").disabled = true;
  el("test-answer-input").disabled = true;
  el("test-progress").textContent = "🤖 Checking…";
  let correct = false;
  try{
    correct = await gradeSingleTestItem(item, answer);
  }catch(e){
    // Stap 6 van het verbeterplan ("AI-fouten fail-safe i.p.v. fail-closed"): dit is een binair-
    // zoekende plaatsingstoets -- een AI-hik als "fout" tellen zou het gezochte niveau-bereik verkeerd
    // insnoeren. Geen ronde-telling/niveau-aanpassing, gewoon dezelfde vraag opnieuw laten proberen.
    el("test-progress").textContent = "";
    el("btn-test-next").disabled = false;
    el("test-answer-input").disabled = false;
    if(hasLikelyPhysicalKeyboard()) el("test-answer-input").focus();
    alert("⚠️ Could not reach the AI to check your answer after retrying. This attempt doesn't count — please try again.");
    return;
  }
  placementState.rounds++;
  if(correct) placementState.low = item.niveau_index + 1;
  else placementState.high = item.niveau_index - 1;
  await nextPlacementQuestion();
}

function finishPlacementTest(){
  // schatting: het hoogste niveau waar de zoekstrategie nog aantoonbaar succes vond
  const estimated = Math.max(0, Math.min(17, placementState.high));
  const roundsUsed = placementState.rounds;
  settings.cefrMin = Math.max(0, estimated - 1);
  settings.cefrMax = Math.min(MAX_VOCAB_CEFR_IDX, estimated + 1);
  settings.cefrMin = Math.min(settings.cefrMin, settings.cefrMax); // estimated kan boven de cap liggen (grammatica/zinsniveau gaat door tot C2) -- min mag dan niet boven de gecapte max uitkomen
  saveJSON(LS_SETTINGS, settings);
  initSettingsUI();
  const skipped = skipLessonsToLevel(estimated);
  el("test-question-box").classList.add("hidden");
  el("test-progress").textContent = "";
  el("test-result-text").innerHTML = `<b>Estimated level: ${cefrLabel(estimated)}</b><br><br>Determined in just ${roundsUsed} question${roundsUsed===1?"":"s"} — no need to generate a full fixed-length test every time.` +
    (skipped.vocab || skipped.grammar ? `<br><br>📊 Rated ${skipped.vocab} word(s) and ${skipped.grammar} grammar topic(s) at ${CHECKUP_PASS_LEVEL}/10 as an indication.` : "");
  el("test-result-box").classList.remove("hidden");
  el("test-result").textContent = "Last determined level: " + cefrLabel(estimated);
  placementState = null;
}

function closeTestModal(){
  el("modal-test").classList.add("hidden");
  placementState = null;
}

function updateBulkTranslateStatus(){
  const statusEl = el("bulk-translate-status");
  const barEl = el("bulk-translate-bar");
  if(!statusEl || !barEl) return;
  const total = EN_WORDS_DATA.length;
  const done = EN_WORDS_DATA.filter(w=>curatedTr[w.en]).length;
  const pct = total ? Math.round(100*done/total) : 0;
  statusEl.textContent = bulkTranslateRunning
    ? `Running… ${done}/${total} words done (${pct}%)`
    : (done >= total ? `✅ Complete — all ${total} words reviewed.` : `${done}/${total} words done (${pct}%).`);
  barEl.style.width = pct + "%";
}

function updateCefrUnlockedInfo(){
  const elI = el("cefr-unlocked-info");
  if(!elI) return;
  elI.textContent = `${countNewWords()} new word(s) available in your current CEFR range.`;
}

function updateAdaptiveLabels(){
  const threshold = parseInt(el("adaptive-threshold").value, 10) || 60;
  el("adaptive-threshold-label").textContent = threshold + "%";
  el("adaptive-upper-label").textContent = Math.min(100, threshold + ADAPTIVE_HYSTERESIS) + "%";
  el("adaptive-lower-label").textContent = Math.max(0, threshold - ADAPTIVE_HYSTERESIS) + "%";
  const statusEl = el("adaptive-status");
  if(!statusEl) return;
  if(!settings.adaptiveEnabled){
    statusEl.textContent = "";
    return;
  }
  if(!adaptiveWindow.length){
    statusEl.textContent = "No regular-practice data yet in the current window.";
  } else {
    const correctCount = adaptiveWindow.filter(Boolean).length;
    const pct = Math.round(100 * correctCount / adaptiveWindow.length);
    statusEl.textContent = `Current window: ${correctCount}/${adaptiveWindow.length} correct (${pct}%)${adaptiveWindow.length < ADAPTIVE_WINDOW_SIZE ? ` — needs ${ADAPTIVE_WINDOW_SIZE - adaptiveWindow.length} more to evaluate` : ""}.`;
  }
}

/* ===================== INIT ===================== */
/* ===================== PRACTICE MIX-DRIEHOEK (woorden/zinnen/vragen) ===================== */
// Hoekpunten van de driehoek in SVG-coördinaten (zie de viewBox 0 0 300 260 in de HTML).
const MIX_TRIANGLE = {
  words:     {x: 20,  y: 240},
  sentences: {x: 280, y: 240},
  questions: {x: 150, y: 20},
};
// Magneetdoelen: UITSLUITEND 4 losse punten, geen lijnen/zijden meer. (1) het absolute middelpunt
// (33%/33%/33%), en (2) de drie punten waar de hulplijnen (zijde-midden -> middelpunt, zie de
// gestippelde lijnen in de SVG-markup hierboven) de buitenzijden van de driehoek snijden -- dat zijn
// exact de zijde-middens zelf (bv. 50% Woorden/50% Vragen/0% Zinnen). Eerder was ook het hele
// lijnstuk (elke hulplijn EN elke buitenzijde in de volle lengte) magnetisch; dat is losgelaten --
// nu trekt alleen deze 4 exacte punten nog aan.
const MIX_SNAP_POINTS = [
  {x: 150,  y: 166.7, kind: "center"},   // absoluut middelpunt (33/33/33)
  {x: 85,   y: 130,   kind: "edge-mid"}, // midden Woorden-Vragen-zijde (50/0/50)
  {x: 215,  y: 130,   kind: "edge-mid"}, // midden Vragen-Zinnen-zijde (0/50/50)
  {x: 150,  y: 240,   kind: "edge-mid"}, // midden Woorden-Zinnen-zijde (50/50/0)
];
// Magneetafstand in SVG-eenheden (viewBox 0 0 300 260). Twee drempels i.p.v. één: AANTREKKEN gebeurt
// pas heel dichtbij (MIX_SNAP_ACQUIRE), maar zodra je eenmaal vastzit, laat het pas los bij een grotere
// afstand (MIX_SNAP_RELEASE) -- die hysterese zorgt dat de dot op het punt "blijft plakken" zolang je in
// de buurt sleept, in plaats van bij elke kleine trilling van je vinger/cursor meteen weer los te laten
// en terug te vallen op de rauwe aanwijzerpositie (dat voelde uit als "geen magneet, gewoon volgen").
const MIX_SNAP_ACQUIRE = 8;
const MIX_SNAP_RELEASE = 16;
// Op een touchscreen zit je vinger precies op de bolletje-positie, waardoor je 'm niet meer ziet. Bij
// touch-input (pointerType "touch") tillen we het geraakte punt daarom een stuk omhoog t.o.v. de
// werkelijke vingerpositie -- de bolletje-positie schuift zo 1-op-1 mee met je vinger, maar blijft
// zichtbaar boven je vingertop i.p.v. eronder verdwenen. Met muis/pen (cursor blokkeert niets) blijft
// dit uit. 40 bleek in de praktijk nog te weinig (dot dook nog deels onder de vingertop weg) -> groter.
// Belangrijk: deze lift wordt VOOR de magneetdetectie toegepast (zie wireMixTriangle), zodat het
// magneeteffect het getilde/zichtbare bolletje aan een punt plakt, niet de rauwe vingerpositie eronder.
const MIX_TOUCH_LIFT = 64;
// Vindt het dichtstbijzijnde magneetpunt, met HYSTERESE: het doel waar je nu al aan vastzit (currentIdx)
// krijgt de ruimere MIX_SNAP_RELEASE-drempel, alle andere doelen (incl. een nieuw doel aantrekken)
// krijgen de krappere MIX_SNAP_ACQUIRE-drempel. Zonder dit verschil voelde het magneeteffect niet als
// "vasthouden" aan, maar als gewoon de rauwe aanwijzerpositie blijven volgen, omdat elke kleine
// trilling net buiten de (te krappe, symmetrische) drempel viel en de snap losliet.
function findMixSnapTarget(px, py, currentIdx){
  let best = null, bestIdx = -1;
  MIX_SNAP_POINTS.forEach((pt, i)=>{
    const dist = Math.hypot(px - pt.x, py - pt.y);
    const threshold = (i === currentIdx) ? MIX_SNAP_RELEASE : MIX_SNAP_ACQUIRE;
    if(dist <= threshold && (!best || dist < best.dist)){ best = {x: pt.x, y: pt.y, dist}; bestIdx = i; }
  });
  return best ? {x: best.x, y: best.y, idx: bestIdx, kind: MIX_SNAP_POINTS[bestIdx].kind} : null;
}
function vibrateLight(){
  // Stille no-op op apparaten/browsers zonder Vibration API (bv. iOS Safari) -- geen feature-detect-gedoe nodig
  try{ navigator.vibrate && navigator.vibrate(12); }catch(e){}
}
function mixWeightsToPoint(wordsPct, sentPct, questPct){
  const total = wordsPct + sentPct + questPct || 1;
  const w = wordsPct/total, s = sentPct/total, q = questPct/total;
  return {
    x: w*MIX_TRIANGLE.words.x + s*MIX_TRIANGLE.sentences.x + q*MIX_TRIANGLE.questions.x,
    y: w*MIX_TRIANGLE.words.y + s*MIX_TRIANGLE.sentences.y + q*MIX_TRIANGLE.questions.y,
  };
}
// Barycentrische coördinaten: een punt binnen (of buiten) de driehoek omzetten naar drie gewichten
// die optellen tot 1. Een punt buiten de driehoek (bv. buiten het scherm gesleept) levert een negatief
// gewicht op -- dat klemmen we op 0 en herverdelen we, zodat je altijd op de rand van de driehoek
// terechtkomt in plaats van een ongeldige (negatieve) verhouding.
function mixPointToWeights(px, py){
  const W = MIX_TRIANGLE.words, S = MIX_TRIANGLE.sentences, Q = MIX_TRIANGLE.questions;
  const denom = (S.y-Q.y)*(W.x-Q.x) + (Q.x-S.x)*(W.y-Q.y);
  let w = ((S.y-Q.y)*(px-Q.x) + (Q.x-S.x)*(py-Q.y)) / denom;
  let s = ((Q.y-W.y)*(px-Q.x) + (W.x-Q.x)*(py-Q.y)) / denom;
  let q = 1 - w - s;
  w = Math.max(0, w); s = Math.max(0, s); q = Math.max(0, q);
  const sum = w + s + q || 1;
  return {words: w/sum, sentences: s/sum, questions: q/sum};
}
function svgPointFromEvent(svg, evt){
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if(!ctm) return {x:150, y:166.7};
  return pt.matrixTransform(ctm.inverse());
}
function initMixTriangle(){
  const wordsPct = settings.wordsPercent ?? 60;
  const sentPct = settings.sentencePercent ?? 20;
  const questPct = settings.questionPercent ?? 20;
  const pt = mixWeightsToPoint(wordsPct, sentPct, questPct);
  el("mix-dot").setAttribute("cx", pt.x);
  el("mix-dot").setAttribute("cy", pt.y);
  el("mix-labels").textContent = `Words ${wordsPct}% · Sentences ${sentPct}% · Questions ${questPct}%`;
}
function setMixFromPoint(px, py){
  const w = mixPointToWeights(px, py);
  // Afronden op hele procenten, met een correctie zodat de som altijd exact 100 blijft (niet 99 of 101
  // door drie keer los af te ronden) -- questPct krijgt wat er na de andere twee overblijft.
  let wordsPct = Math.round(w.words*100);
  let sentPct = Math.round(w.sentences*100);
  let questPct = 100 - wordsPct - sentPct;
  if(questPct < 0){ questPct = 0; sentPct = 100 - wordsPct; } // veiligheidsnet bij afrondingsrandgevallen
  settings.wordsPercent = wordsPct;
  settings.sentencePercent = sentPct;
  settings.questionPercent = questPct;
  saveJSON(LS_SETTINGS, settings);
  const pt = mixWeightsToPoint(wordsPct, sentPct, questPct);
  el("mix-dot").setAttribute("cx", pt.x);
  el("mix-dot").setAttribute("cy", pt.y);
  el("mix-labels").textContent = `Words ${wordsPct}% · Sentences ${sentPct}% · Questions ${questPct}%`;
}
function wireMixTriangle(){
  const svg = el("mix-triangle");
  let dragging = false;
  let snappedIdx = -1; // index in MIX_SNAP_TARGETS waar we nu aan vastzitten, of -1 (zie hysterese hierboven)
  function handleMove(evt){
    if(!dragging) return;
    const raw = svgPointFromEvent(svg, evt); // werkelijke vinger-/cursorpositie
    const isTouch = evt.pointerType === "touch";
    // Bij touch werken we vanaf hier in "bolletje-coördinaten" (raw, al omhoog getild) i.p.v. de rauwe
    // vingerpositie. Het magneeteffect moet het ZICHTBARE bolletje aan de hulplijn/zijde laten plakken --
    // niet de onzichtbare vingerpositie eronder. Met de oude volgorde (eerst snappen op raw, dan pas
    // tillen) plakte de magneet aan je vinger terwijl het bolletje daarna alsnog 64 eenheden los van de
    // lijn kwam te zweven.
    const display = isTouch ? {x: raw.x, y: raw.y - MIX_TOUCH_LIFT} : raw;
    const snap = findMixSnapTarget(display.x, display.y, snappedIdx);
    // Trilling alleen bij het NIEUW raken van een zijde/hulplijn (niet continu terwijl je erop blijft
    // hangen), en alleen met muis/pen -- niet met de vinger (het touchscreen geeft daar al zijn eigen,
    // systeemeigen aanraakgevoel; dit JS-trilsignaal is specifiek de cursor-feedback).
    if(snap && snap.idx !== snappedIdx && !isTouch) vibrateLight();
    snappedIdx = snap ? snap.idx : -1;
    const logical = snap ? {x: snap.x, y: snap.y} : display;
    setMixFromPoint(logical.x, logical.y);
    evt.preventDefault();
  }
  svg.addEventListener("pointerdown", (evt)=>{
    dragging = true;
    snappedIdx = -1;
    svg.setPointerCapture(evt.pointerId);
    handleMove(evt);
  });
  svg.addEventListener("pointermove", handleMove);
  svg.addEventListener("pointerup", ()=>{ dragging = false; snappedIdx = -1; });
  svg.addEventListener("pointercancel", ()=>{ dragging = false; snappedIdx = -1; });
}

function initSettingsUI(){
  el("api-key-input").value = settings.apiKey || "";
  el("anthropic-key-input").value = settings.anthropicApiKey || "";
  el("word-model-select").value = settings.wordModel;
  el("sentence-model-select").value = settings.sentenceModel;
  initMixTriangle();
  // Gedeelde init voor elk van de drie CEFR-bereikcontrols (woord-oefening, zin-complexiteit,
  // zin-woordmoeilijkheid) -- zelfde opbouw (slider + dropdown, min+max), alleen andere id-prefix en
  // andere onderliggende settings-velden.
  function initCefrRangeDisplay(prefix, minKey, maxKey, maxIdx){
    el(`${prefix}-min-slider`).max = maxIdx;
    el(`${prefix}-max-slider`).max = maxIdx;
    if(!el(`${prefix}-min-select`).options.length){
      for(let i=0;i<=maxIdx;i++){
        el(`${prefix}-min-select`).add(new Option(cefrLabel(i), i));
        el(`${prefix}-max-select`).add(new Option(cefrLabel(i), i));
      }
    }
    el(`${prefix}-min-slider`).value = settings[minKey];
    el(`${prefix}-max-slider`).value = settings[maxKey];
    el(`${prefix}-min-select`).value = settings[minKey];
    el(`${prefix}-max-select`).value = settings[maxKey];
    el(`${prefix}-min-label`).textContent = cefrLabel(settings[minKey]);
    el(`${prefix}-max-label`).textContent = cefrLabel(settings[maxKey]);
  }
  initCefrRangeDisplay("cefr", "cefrMin", "cefrMax", MAX_VOCAB_CEFR_IDX);
  // Sentence complexity heeft (i.t.t. de CEFR-woordrange hierboven) maar 1 slider -- settings.sentenceComplexityMin
  // en -Max blijven intern wel allebei bestaan (o.a. pickLevelInRange/cefrCeiling elders lezen ze), maar
  // worden hier altijd gelijk aan elkaar gehouden: 1 vaste complexiteit i.p.v. een bereik.
  function initSentComplexityDisplay(){
    el("sent-complexity-slider").max = 17;
    if(!el("sent-complexity-select").options.length){
      for(let i=0;i<=17;i++) el("sent-complexity-select").add(new Option(cefrLabel(i), i));
    }
    const v = settings.sentenceComplexityMin;
    el("sent-complexity-slider").value = v;
    el("sent-complexity-select").value = v;
    el("sent-complexity-label").textContent = cefrLabel(v);
  }
  initSentComplexityDisplay();
  updateCefrUnlockedInfo();
  el("adaptive-enabled").checked = !!settings.adaptiveEnabled;
  el("sound-effects-toggle").checked = !!settings.soundEffects;
  el("special-mode-select").value = settings.specialMode;
  el("adaptive-threshold").value = settings.adaptiveThreshold ?? 60;
  updateAdaptiveLabels();
  el("key-status").textContent = settings.apiKey ? "✅ Key is set." : "No key set yet.";
  el("anthropic-key-status").textContent = settings.anthropicApiKey ? "✅ Key is set." : "No key set yet.";
  el("proxy-url-input").value = settings.proxyUrl || "";
  el("proxy-token-input").value = settings.proxyToken || "";
  el("proxy-status").textContent = proxyConfigured() ? "✅ Using shared proxy — no personal API keys needed." : "Not set up — using your own API keys below (if any).";
  updateBulkTranslateStatus();
  const bal = loadJSON(LS_BALANCE, null);
  if(bal){
    const sym = bal.currency === "CNY" ? "¥" : "$";
    el("balance-status").textContent = `Laatst opgehaald: ${sym}${bal.total} resterend (${new Date(bal.fetchedAt).toLocaleString()})`;
  }
  el("sync-api-key").value = settings.syncApiKey || "";
  el("sync-bin-id").value = settings.syncBinId || "";
  el("sync-status").textContent = syncConfigured() ? "" : "Not set up yet — progress stays local to this device.";
}

/* ===================== PIEK/DAL-INDICATOR (DeepSeek verwachte piekuren, UTC) ===================== */
function updatePeakIndicator(){
  const el2 = document.getElementById("peak-indicator");
  if(!el2) return;
  const h = new Date().getUTCHours();
  const isPeak = (h >= 1 && h < 4) || (h >= 6 && h < 10);
  el2.textContent = isPeak ? "● peak" : "● off-peak";
  el2.className = "peak-tab " + (isPeak ? "peak" : "dal");
  el2.title = isPeak
    ? "Expected DeepSeek peak hours (1:00-4:00 and 6:00-10:00 UTC) — once peak/off-peak pricing takes effect, this is 2x the price."
    : "Off-peak hours per DeepSeek (outside 1:00-4:00 and 6:00-10:00 UTC) — normal pricing.";
}

document.addEventListener("DOMContentLoaded", async ()=>{
  // Databestanden (words.json, vocab-lessons.json, vocab-data.json, reverse-tr-index.json,
  // lessons.json) worden nu async opgehaald i.p.v. via een pagina-blokkerende synchrone XHR.
  // Het laadscherm (#loading-overlay, zie vlak na <body>) blijft zichtbaar totdat dit klaar is;
  // bij een netwerkfout krijgt de gebruiker een duidelijke melding + "Try again"-knop i.p.v. een
  // pagina die stil blijft hangen of halverwege een crash geeft door ontbrekende data.
  try{
    await loadAllData();
  }catch(e){
    el("loading-overlay-text").textContent = "⚠️ Couldn't load the app data: " + e.message;
    el("loading-spinner").classList.add("hidden");
    const retryBtn = el("loading-retry-btn");
    retryBtn.classList.remove("hidden");
    retryBtn.addEventListener("click", ()=> location.reload());
    return; // rest van de initialisatie hangt allemaal af van de zojuist mislukte data-load
  }

  document.querySelectorAll(".tab-btn").forEach(b=>{
    b.addEventListener("click", ()=> switchTab(b.dataset.tab));
  });
  el("btn-check").addEventListener("click", ()=>{
    if(!currentAnswered) handleCheck(); else renderPractice();
  });
  el("btn-expand-range-yes").addEventListener("click", ()=>{
    bumpMaxCefrRangeByOne();
    renderPractice();
  });
  el("btn-expand-range-no").addEventListener("click", ()=>{
    el("range-exhausted-notice").classList.add("hidden");
  });
  el("mix-new-words-toggle").addEventListener("change", ()=>{
    settings.mixNewWords = el("mix-new-words-toggle").checked;
    saveJSON(LS_SETTINGS, settings);
    el("mix-new-words-dial-row").classList.toggle("hidden", !settings.mixNewWords);
  });
  el("word-direction-select").value = settings.wordDirection || "random";
  el("word-direction-select").addEventListener("change", ()=>{
    settings.wordDirection = el("word-direction-select").value;
    saveJSON(LS_SETTINGS, settings);
  });
  el("mix-new-words-dial").addEventListener("input", ()=>{
    settings.newWordsPer5 = parseInt(el("mix-new-words-dial").value, 10) || 2;
    saveJSON(LS_SETTINGS, settings);
    el("mix-new-words-dial-label").textContent = `${settings.newWordsPer5} / 5`;
  });
  el("answer-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      e.preventDefault();
      if(!currentAnswered) handleCheck(); else renderPractice();
    }
  });
  el("btn-skip").addEventListener("click", ()=>{
    if(!currentItem) return;
    if(retryPending){
      // Er is bij het starten van de geforceerde herkansing al 1x fout geregistreerd (zie enterWordRetry)
      // -- skip is hier puur een ontsnappingsroute uit die herkansing, geen nieuwe score-registratie.
      retryPending = false;
      renderPractice();
      return;
    }
    if(currentItem.type === "sentence" || currentItem.type === "question"){
      recordHistory(currentItem.type);
      for(const w of currentItem.words) recordResult(w.en, false);
    } else {
      recordHistory("word");
      recordResult(currentItem.progressKey || currentItem.en, false);
    }
    const lessonNote = advanceLessonSession();
    const adaptiveNote = recordAdaptiveResult(false);
    if(lessonNote.includes("Lesson complete") || adaptiveNote){
      // een les rondde net af, of de moeilijkheidsgraad paste net aan, door dit overslaan
      // -> niet stilletjes doorgaan, eerst tonen
      currentAnswered = true;
      showFeedback("wrong", "⏭️ Skipped." + lessonNote + adaptiveNote);
      el("post-actions").classList.remove("hidden");
      el("btn-check").textContent = "Next ▶";
      el("btn-check").disabled = false;
      el("btn-dispute").classList.add("hidden");
      el("answer-input").disabled = true;
      return;
    }
    renderPractice();
  });
  el("btn-dispute").addEventListener("click", disputeAnswer);
  el("btn-reveal-word").addEventListener("click", revealWordHint);
  el("btn-show-explanation").addEventListener("click", toggleExplanation);

  // Eén knop voor Check ÉN Continue: kijkt bij elke klik naar suffixAnswered om te bepalen welke van
  // de twee acties nu bedoeld is -- zelfde patroon als de Enter-key-handler hieronder al gebruikte.
  el("suf-btn-check").addEventListener("click", ()=>{
    if(!suffixAnswered) handleCheckSuffixTab(); else renderSuffixPractice();
  });
  el("suf-btn-skip").addEventListener("click", ()=>{
    if(!currentSuffixItem || suffixAnswered) return;
    renderSuffixPractice();
  });
  el("suf-answer-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      e.preventDefault();
      if(!suffixAnswered) handleCheckSuffixTab(); else renderSuffixPractice();
    }
  });

  el("dict-level-slider").addEventListener("input", ()=>{
    settings.dictationLevel = parseInt(el("dict-level-slider").value, 10);
    saveJSON(LS_SETTINGS, settings);
    renderDictationLevelLabel();
  });
  el("dict-level-slider").addEventListener("change", renderDictationPractice); // pas na loslaten een nieuwe opgave laden, niet bij elke tussenstap
  el("btn-dict-speak").addEventListener("click", ()=> currentDictationItem && speakTurkish(currentDictationItem.tr));
  el("btn-dict-speak-slow").addEventListener("click", ()=> currentDictationItem && speakTurkish(currentDictationItem.tr, 0.5));
  el("dict-btn-check").addEventListener("click", ()=>{
    if(!dictationAnswered) handleCheckDictation(); else renderDictationPractice();
  });
  el("dict-btn-skip").addEventListener("click", ()=>{
    if(!currentDictationItem || dictationAnswered) return;
    renderDictationPractice();
  });
  el("dict-answer-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      e.preventDefault();
      if(!dictationAnswered) handleCheckDictation(); else renderDictationPractice();
    }
  });

  el("words-sort").addEventListener("change", renderWordsTab);
  el("words-filter").addEventListener("change", renderWordsTab);
  el("words-cefr-filter").addEventListener("change", renderWordsTab);
  el("words-direction-filter").addEventListener("change", renderWordsTab);
  el("words-search").addEventListener("input", renderWordsTab);
  el("btn-ask-ai").addEventListener("click", openAiModal);
  el("btn-speak-word").addEventListener("click", ()=> speakTurkish(currentSpeakableTr));
  el("btn-speak-word-slow").addEventListener("click", ()=> speakTurkish(currentSpeakableTr, 0.5));
  el("btn-checkup-speak-word").addEventListener("click", ()=> speakTurkish(currentCheckupSpeakableTr));
  el("btn-edit-flashcard").addEventListener("click", ()=>{
    if(!currentItem || currentItem.type !== "word") return;
    if(currentItem.wordSource === "tr") openEditWordModal(currentItem.progressKey, "tr");
    else openEditWordModal(currentItem.en, "en");
  });
  el("btn-edit-word-save").addEventListener("click", saveEditWord);
  el("btn-edit-word-close").addEventListener("click", closeEditWordModal);
  el("btn-edit-word-clear").addEventListener("click", clearEditWord);
  el("btn-lesson-grade-save").addEventListener("click", saveLessonGradeOverride);
  el("btn-lesson-grade-close").addEventListener("click", closeLessonGradeModal);
  el("btn-lesson-grade-clear").addEventListener("click", clearLessonGradeOverride);
  el("edit-word-en-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){ e.preventDefault(); saveEditWord(); }
  });
  el("edit-word-tr-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){ e.preventDefault(); saveEditWord(); }
  });
  el("btn-chat-close").addEventListener("click", closeAiModal);
  el("btn-chat-send").addEventListener("click", sendChat);
  el("chat-input").addEventListener("keydown", e=>{
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); sendChat(); }
  });

  document.querySelectorAll(".settings-subtab-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".settings-subtab-btn").forEach(b=>b.classList.toggle("active", b===btn));
      el("settings-subtab-practice").classList.toggle("hidden", btn.dataset.subtab !== "practice");
      el("settings-subtab-technical").classList.toggle("hidden", btn.dataset.subtab !== "technical");
    });
  });
  el("btn-save-proxy").addEventListener("click", ()=>{
    settings.proxyUrl = el("proxy-url-input").value.trim();
    settings.proxyToken = el("proxy-token-input").value.trim();
    saveJSON(LS_SETTINGS, settings);
    initSettingsUI();
  });
  el("btn-save-key").addEventListener("click", ()=>{
    settings.apiKey = el("api-key-input").value.trim();
    saveJSON(LS_SETTINGS, settings);
    initSettingsUI();
  });
  el("btn-save-anthropic-key").addEventListener("click", ()=>{
    settings.anthropicApiKey = el("anthropic-key-input").value.trim();
    saveJSON(LS_SETTINGS, settings);
    initSettingsUI();
  });
  el("word-model-select").addEventListener("change", ()=>{
    settings.wordModel = el("word-model-select").value;
    saveJSON(LS_SETTINGS, settings);
  });
  el("sentence-model-select").addEventListener("change", ()=>{
    settings.sentenceModel = el("sentence-model-select").value;
    saveJSON(LS_SETTINGS, settings);
  });
  el("btn-fetch-balance").addEventListener("click", ()=> fetchDeepSeekBalance(false));
  wireMixTriangle();
  function applyCefrRange(prefix, minKey, maxKey, newMin, newMax, source, onChange){
    // min mag nooit boven max uitkomen en andersom -- duw de andere kant mee als dat gebeurt
    if(newMin > newMax){ if(source === "min") newMax = newMin; else newMin = newMax; }
    settings[minKey] = newMin;
    settings[maxKey] = newMax;
    saveJSON(LS_SETTINGS, settings);
    el(`${prefix}-min-slider`).value = newMin; el(`${prefix}-max-slider`).value = newMax;
    el(`${prefix}-min-select`).value = newMin; el(`${prefix}-max-select`).value = newMax;
    el(`${prefix}-min-label`).textContent = cefrLabel(newMin);
    el(`${prefix}-max-label`).textContent = cefrLabel(newMax);
    if(onChange) onChange();
  }
  function wireCefrRangeControl(prefix, minKey, maxKey, onChange){
    el(`${prefix}-min-slider`).addEventListener("input", ()=> applyCefrRange(prefix, minKey, maxKey, parseInt(el(`${prefix}-min-slider`).value,10), settings[maxKey], "min", onChange));
    el(`${prefix}-max-slider`).addEventListener("input", ()=> applyCefrRange(prefix, minKey, maxKey, settings[minKey], parseInt(el(`${prefix}-max-slider`).value,10), "max", onChange));
    el(`${prefix}-min-select`).addEventListener("change", ()=> applyCefrRange(prefix, minKey, maxKey, parseInt(el(`${prefix}-min-select`).value,10), settings[maxKey], "min", onChange));
    el(`${prefix}-max-select`).addEventListener("change", ()=> applyCefrRange(prefix, minKey, maxKey, settings[minKey], parseInt(el(`${prefix}-max-select`).value,10), "max", onChange));
  }
  wireCefrRangeControl("cefr", "cefrMin", "cefrMax", ()=>{ updateCefrUnlockedInfo(); renderDueCount(); });
  function applySentComplexity(v){
    settings.sentenceComplexityMin = v;
    settings.sentenceComplexityMax = v;
    saveJSON(LS_SETTINGS, settings);
    el("sent-complexity-slider").value = v;
    el("sent-complexity-select").value = v;
    el("sent-complexity-label").textContent = cefrLabel(v);
  }
  el("sent-complexity-slider").addEventListener("input", ()=> applySentComplexity(parseInt(el("sent-complexity-slider").value,10)));
  el("sent-complexity-select").addEventListener("change", ()=> applySentComplexity(parseInt(el("sent-complexity-select").value,10)));
  el("special-mode-select").addEventListener("change", ()=>{
    settings.specialMode = el("special-mode-select").value;
    saveJSON(LS_SETTINGS, settings);
    if(el("screen-suffixes") && !el("screen-suffixes").classList.contains("hidden")) renderSpecialTab();
  });
  el("adaptive-enabled").addEventListener("change", ()=>{
    settings.adaptiveEnabled = el("adaptive-enabled").checked;
    settings.soundEffects = el("sound-effects-toggle").checked;
    saveJSON(LS_SETTINGS, settings);
    updateAdaptiveLabels();
  });
  el("adaptive-threshold").addEventListener("input", updateAdaptiveLabels);
  el("adaptive-threshold").addEventListener("change", ()=>{
    settings.adaptiveThreshold = parseInt(el("adaptive-threshold").value, 10) || 60;
    saveJSON(LS_SETTINGS, settings);
    updateAdaptiveLabels();
  });
  el("btn-export").addEventListener("click", exportWordlist);
  el("btn-reset-progress").addEventListener("click", ()=>{
    if(confirm("Are you sure you want to reset all progress? This cannot be undone.")){
      progress = {}; saveJSON(LS_PROGRESS, progress);
      grammar = {}; saveJSON(LS_GRAMMAR, grammar);
      history = []; saveJSON(LS_HISTORY, history);
      renderPractice();
    }
  });
  el("btn-clear-trcache").addEventListener("click", ()=>{
    if(confirm("Clear all cached Turkish translations? Every word will be re-translated (using tokens) the next time it comes up. Your progress/levels stay untouched.")){
      trCache = {}; saveJSON(LS_TRCACHE, trCache);
      alert("Translation cache cleared.");
    }
  });
  el("btn-clear-explanation-cache").addEventListener("click", ()=>{
    if(confirm("Clear all cached word explanations? Every explanation will be regenerated (using tokens) the next time you open it. Your progress/levels stay untouched.")){
      explanationCache = {}; saveJSON(LS_EXPLANATION_CACHE, explanationCache);
      alert("Explanation cache cleared.");
    }
  });
  el("btn-add-to-home").addEventListener("click", ()=> el("modal-home").classList.remove("hidden"));
  el("btn-sync-save").addEventListener("click", ()=>{
    settings.syncApiKey = el("sync-api-key").value.trim();
    settings.syncBinId = el("sync-bin-id").value.trim();
    saveJSON(LS_SETTINGS, settings);
    el("sync-status").textContent = syncConfigured() ? "Saved. Click \"Fetch now\" to pull your existing cloud progress." : "Saved (still incomplete).";
  });
  el("btn-sync-create").addEventListener("click", async ()=>{
    settings.syncApiKey = el("sync-api-key").value.trim();
    saveJSON(LS_SETTINGS, settings);
    await syncCreateBin();
  });
  el("btn-sync-pull").addEventListener("click", async ()=>{
    settings.syncApiKey = el("sync-api-key").value.trim();
    settings.syncBinId = el("sync-bin-id").value.trim();
    saveJSON(LS_SETTINGS, settings);
    await syncPullNow(true);
    renderPractice();
  });
  el("btn-sync-push").addEventListener("click", async ()=>{
    settings.syncApiKey = el("sync-api-key").value.trim();
    settings.syncBinId = el("sync-bin-id").value.trim();
    saveJSON(LS_SETTINGS, settings);
    await syncPushNow();
  });
  el("btn-home-close").addEventListener("click", ()=> el("modal-home").classList.add("hidden"));
  el("btn-lesson-action").addEventListener("click", startLessonAction);
  el("btn-lesson-close").addEventListener("click", ()=> el("modal-lesson").classList.add("hidden"));
  el("btn-practice-skill").addEventListener("click", ()=> startSkillPractice(LESSONS[openLessonIdx]));
  el("btn-start-test").addEventListener("click", startPlacementTest);
  el("btn-start-checkup").addEventListener("click", startCheckup);
  el("weak-words-count").addEventListener("change", ()=>{
    el("weak-words-count-custom").classList.toggle("hidden", el("weak-words-count").value !== "custom");
  });
  el("btn-show-weak-words").addEventListener("click", toggleWeakWordsList);
  el("reading-level-select").addEventListener("change", ()=>{
    settings.readingLevel = el("reading-level-select").value;
    saveJSON(LS_SETTINGS, settings);
  });
  el("reading-model-cheap").addEventListener("click", ()=>{
    settings.readingModel = "deepseek";
    saveJSON(LS_SETTINGS, settings);
    renderReadingModelButtons();
  });
  el("reading-model-best").addEventListener("click", ()=>{
    settings.readingModel = "claude";
    saveJSON(LS_SETTINGS, settings);
    renderReadingModelButtons();
  });
  el("reading-source-ai").addEventListener("click", ()=>{
    settings.readingSource = "ai";
    saveJSON(LS_SETTINGS, settings);
    renderReadingSourceButtons();
  });
  el("reading-source-wiki").addEventListener("click", ()=>{
    settings.readingSource = "wikipedia";
    saveJSON(LS_SETTINGS, settings);
    renderReadingSourceButtons();
  });
  el("btn-reading-new").addEventListener("click", startNewReading);
  el("btn-reading-saved").addEventListener("click", renderSavedReadingList);
  el("btn-reading-check").addEventListener("click", ()=>{
    if(!readingState) return;
    const { queue, pos } = readingState;
    if(pos < queue.length && el("btn-reading-check").textContent === "Check") checkReadingAnswer();
    else advanceReadingQuestion();
  });
  el("btn-reading-skip").addEventListener("click", advanceReadingQuestion);
  el("reading-answer-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      e.preventDefault();
      if(!el("btn-reading-check").disabled) el("btn-reading-check").click();
    }
  });
  el("btn-reading-more-questions").addEventListener("click", generateMoreForCurrentReading);
  el("btn-reading-done").addEventListener("click", closeReadingRound);
  el("btn-checkup-next").addEventListener("click", ()=> skillPracticeState ? submitSkillPracticeAnswer() : submitCheckupAnswer());
  el("btn-checkup-reveal").addEventListener("click", revealCheckupHint);
  el("checkup-answer-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      e.preventDefault();
      // Twee losse fasen met elk hun eigen knop: tijdens het beantwoorden is btn-checkup-next de
      // relevante actie (antwoord indienen); zodra de feedback getoond wordt (checkup-result-box
      // zichtbaar) is btn-checkup-close de zichtbare "Continue"-knop -- de oude listener keek altijd
      // naar btn-checkup-next, die tijdens de feedback-fase juist disabled blijft, dus Enter deed daar
      // niets (naast dat het invoerveld zelf ook disabled was -- zie de fix in submit*Answer hierboven).
      const feedbackShown = !el("checkup-result-box").classList.contains("hidden");
      if(feedbackShown){
        if(!el("btn-checkup-close").disabled) el("btn-checkup-close").click();
      } else {
        if(!el("btn-checkup-next").disabled) el("btn-checkup-next").click();
      }
    }
  });
  el("btn-checkup-skip").addEventListener("click", ()=>{ if(skillPracticeState) skipSkillPracticeQuestion(); });
  el("btn-checkup-show-explanation").addEventListener("click", toggleSkillPracticeExplanation);
  el("btn-checkup-ask-ai").addEventListener("click", ()=>{
    if(!chatItem){ alert("No active exercise to ask about right now — answer it first."); return; }
    if(!hasKeyFor("sentence")){ alert("Set a " + keyNameFor("sentence") + " API key in Settings first."); return; }
    el("modal-ai-word").textContent = chatItem.tr || baseEnOf(chatItem.en);
    el("chat-log").innerHTML = "";
    chatMsgs = [];
    el("modal-ai").classList.remove("hidden");
    el("chat-input").value = "";
    setTimeout(()=> el("chat-input").focus(), 50);
  });
  el("btn-checkup-dispute").addEventListener("click", ()=>{ if(skillPracticeState) disputeSkillPracticeAnswer(); });
  el("btn-checkup-close").addEventListener("click", ()=>{
    if(skillPracticeState){ skillPracticeContinueOrClose(); return; }
    if(!checkupState){ el("modal-checkup").classList.add("hidden"); }
    else checkupContinue();
  });
  el("btn-checkup-cancel").addEventListener("click", ()=>{
    if(skillPracticeState){ skillPracticeState = null; el("modal-checkup").classList.add("hidden"); renderCourseTab(); return; }
    cancelCheckup();
  });
  el("btn-test-next").addEventListener("click", handleTestNext);
  el("btn-test-cancel").addEventListener("click", closeTestModal);
  el("btn-test-close").addEventListener("click", closeTestModal);
  el("test-answer-input").addEventListener("keydown", e=>{
    if(e.key === "Enter"){ e.preventDefault(); handleTestNext(); }
  });

  initSettingsUI();
  restoreActiveSessions();
  // Herstel het laatst geopende tabblad i.p.v. altijd op "practice" te starten (bv. na een refresh).
  const savedTab = localStorage.getItem(LS_ACTIVE_TAB);
  const initialTab = ["practice","suffixes","reading","course","words","stats","settings"].includes(savedTab) ? savedTab : "practice";
  if(syncConfigured()){
    syncPullNow(false).then(()=> switchTab(initialTab));
  } else {
    switchTab(initialTab);
  }
  el("loading-overlay").classList.add("hidden");
  updatePeakIndicator();
  setInterval(updatePeakIndicator, 60000);
  setInterval(()=>{ if(settings.apiKey) fetchDeepSeekBalance(true); }, 60000);
  updateCostDisplay();
});

