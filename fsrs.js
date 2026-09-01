// ===================== fsrs.js =====================
// FSRS (Free Spaced Repetition Scheduler), de sinds 2023 in Anki gestandaardiseerde opvolger van SM-2 --
// zie stap 4 van het verbeterplan ("de handgerolde SM-2-variant vervangen door FSRS"). Gebruikt de
// gepubliceerde FSRS-4.5-standaardgewichten (er is geen per-gebruiker geoptimaliseerde trainingsdata
// beschikbaar in deze app, dus de default-gewichten -- die zijn getraind op miljoenen Anki-reviews en
// werken doorgaans al beter dan een handgerolde SM-2-variant zonder per-woord tuning).
//
// KERNIDEE, in het kort: i.p.v. één vast "ease"-getal dat met kleine, vaste stapjes op/af beweegt (de
// oude aanpak in srs.js), houdt FSRS twee onafhankelijke grootheden bij per woord:
//   - stability (S)   : hoe lang het duurt voordat de kans op goed onthouden (retrievability) daalt
//                       van 100% naar 90% -- hoe hoger, hoe "vaster" het geheugenspoor.
//                       Bepaalt rechtstreeks het volgende interval.
//                       Wordt bij elke beurt bijgewerkt op basis van hoe VERRASSEND het resultaat was:
//                       een goed antwoord op een woord dat al bijna vergeten was (lage retrievability)
//                       geeft een grotere stability-sprong dan een goed antwoord op een woord dat toch
//                       al vers in het geheugen zat.
//   - difficulty (D)  : hoe moeilijk dit specifieke woord voor déze gebruiker is (1-10), onafhankelijk
//                       van hoe lang geleden het geoefend is. Beïnvloedt hoe snel stability kan groeien.
//
// Dit bestand kent geen "hint"-grade (5); de bestaande hint-severity-schaling (zie hintPenaltySeverity
// in app.js) wordt vóór het aanroepen van dit bestand al vertaald naar een van de 3 gebruikte grades
// (again/hard/good) -- zie gradeFromResult() hieronder.

// ---------- Standaard FSRS-4.5-gewichten (w0..w18), zoals gepubliceerd door het FSRS-project ----------
export const FSRS_WEIGHTS = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544,
  1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466, 0.5034, 0.6567,
];

// "Gevraagde retentie": het doel-slagingspercentage waarop de intervallen gemikt worden. 0.9 is de
// FSRS-standaardwaarde (en ook wat "stability" per definitie meet: tijd tot retrievability 90% is).
export const REQUEST_RETENTION = 0.9;

// FSRS-eigen constanten voor de macht-vergetelijkheidscurve (power forgetting curve) -- afgeleid zodat
// retrievability(t=S) exact 0.9 oplevert, per de FSRS-specificatie.
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // = 19/81 ≈ 0.2345679

// Grenzen op de stability (in DAGEN), consistent met de oude MIN_MIN (15 min)/MAX_MIN (1 jaar) grenzen
// in srs.js -- zodat het bereik van intervallen niet ineens drastisch anders aanvoelt.
export const FSRS_MIN_STABILITY_DAYS = 15 / (60 * 24);      // 15 minuten
export const FSRS_MAX_STABILITY_DAYS = 365;                  // 1 jaar

// Grades: FSRS gebruikt van oudsher 4 grades (1=Again/fout, 2=Hard, 3=Good, 4=Easy). Deze app heeft geen
// aparte "Easy"-knop; grade 4 wordt alleen intern gebruikt voor een geaccepteerd dispuut (zie app.js).
export const GRADE_AGAIN = 1;
export const GRADE_HARD = 2;
export const GRADE_GOOD = 3;
export const GRADE_EASY = 4;

function clampDifficulty(D) {
  return Math.min(10, Math.max(1, D));
}
function clampStability(S) {
  return Math.min(FSRS_MAX_STABILITY_DAYS, Math.max(FSRS_MIN_STABILITY_DAYS, S));
}

// Retrievability: geschatte kans op goed onthouden na `elapsedDays` sinds de laatste beurt, gegeven een
// stability van `stabilityDays`. Per constructie: retrievability(S, S) === 0.9.
export function retrievability(elapsedDays, stabilityDays) {
  if (stabilityDays <= 0) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stabilityDays, DECAY);
}

export function initStability(grade) {
  return clampStability(Math.max(FSRS_WEIGHTS[grade - 1], 0.1));
}

export function initDifficulty(grade) {
  return clampDifficulty(FSRS_WEIGHTS[4] - FSRS_WEIGHTS[5] * (grade - 3));
}

export function nextDifficulty(D, grade) {
  const shifted = D - FSRS_WEIGHTS[6] * (grade - 3);
  const reverted = FSRS_WEIGHTS[7] * initDifficulty(GRADE_GOOD) + (1 - FSRS_WEIGHTS[7]) * shifted;
  return clampDifficulty(reverted);
}

// Stability na een GOED onthouden beurt (grade Hard/Good/Easy) -- hoe lager de retrievability was op
// het moment van de beurt (hoe "verrassender" het goede antwoord dus was), hoe groter de sprong.
function nextRecallStability(D, S, R, grade) {
  const hardPenalty = grade === GRADE_HARD ? FSRS_WEIGHTS[15] : 1;
  const easyBonus = grade === GRADE_EASY ? FSRS_WEIGHTS[16] : 1;
  const growth =
    Math.exp(FSRS_WEIGHTS[8]) *
    (11 - D) *
    Math.pow(S, -FSRS_WEIGHTS[9]) *
    (Math.exp((1 - R) * FSRS_WEIGHTS[10]) - 1) *
    hardPenalty *
    easyBonus;
  return S * (1 + growth);
}

// Stability na een VERGETEN beurt (grade Again) -- FSRS herstart hier niet vanaf 0, maar berekent een
// nieuwe (kleinere) stability als functie van de oude stability, difficulty en retrievability.
function nextForgetStability(D, S, R) {
  return (
    FSRS_WEIGHTS[11] *
    Math.pow(D, -FSRS_WEIGHTS[12]) *
    (Math.pow(S + 1, FSRS_WEIGHTS[13]) - 1) *
    Math.exp((1 - R) * FSRS_WEIGHTS[14])
  );
}

export function nextStability(D, S, R, grade) {
  const next = grade === GRADE_AGAIN ? nextForgetStability(D, S, R) : nextRecallStability(D, S, R, grade);
  return clampStability(next);
}

// Volgend interval (in dagen) voor een gegeven stability, gemikt op REQUEST_RETENTION.
export function nextIntervalDays(stabilityDays, requestRetention) {
  const rr = requestRetention ?? REQUEST_RETENTION;
  return (stabilityDays / FACTOR) * (Math.pow(rr, 1 / DECAY) - 1);
}

// ---------- UI-compatibiliteitslagen ----------
// De rest van de app (Words-tab, Stats, dictee "niveau 8+", weak-words-sortering, ...) leest overal
// p.level (0-10) en p.ease -- honderden call-sites, verspreid over de hele UI-laag. I.p.v. die allemaal
// aan te passen, wordt hier een DERIVED level/ease berekend uit stability/difficulty, zodat al die
// bestaande logica ongewijzigd blijft werken terwijl de daadwerkelijke SCHEDULING nu door FSRS gestuurd
// wordt. Dit is dezelfde soort logaritmische schaal die de oude intervalMinutes(level) ook al gebruikte
// (15 min -> niveau 0, 1 jaar -> niveau 10), nu toegepast op stability i.p.v. interval.
export function stabilityToLevel(stabilityDays) {
  const ratio = FSRS_MAX_STABILITY_DAYS / FSRS_MIN_STABILITY_DAYS;
  const raw = (10 * Math.log(stabilityDays / FSRS_MIN_STABILITY_DAYS)) / Math.log(ratio);
  return Math.round(Math.min(10, Math.max(0, raw)));
}

// Ease-achtig getal voor het bestaande "⚙️X.XX"-label/de ease-sortering in de Words-tab -- géén
// onderdeel van de FSRS-scheduling zelf, puur een leesbare afgeleide van difficulty (FSRS 1=makkelijkst,
// 10=moeilijkst) omgerekend naar hetzelfde 1.3-2.8-bereik als de oude ease, zodat het label vergelijkbaar
// blijft aanvoelen (hoger = makkelijker/gunstiger, net als voorheen).
export function difficultyToDisplayEase(D) {
  const EASE_MIN = 1.3, EASE_MAX = 2.8;
  return EASE_MAX - ((D - 1) / 9) * (EASE_MAX - EASE_MIN);
}

// Vertaalt het bestaande binaire correct/fout + optionele hint-severity (0.5-1.0, zie
// hintPenaltySeverity in app.js) naar een FSRS-grade. Er is geen "Easy"-knop in deze app; grade 4 wordt
// uitsluitend los, expliciet gebruikt bij een geaccepteerd dispuut (zie app.js).
export function gradeFromResult(correct, severity) {
  if (correct) return GRADE_GOOD;
  // Een "fout" met severity<1 is het bestaande hint-scenario (antwoord zelf was goed, maar telt door de
  // gebruikte hint als gedeeltelijke terugval) -- dat verdient een mildere FSRS-grade (Hard) dan een
  // volledige black-out (Again).
  return typeof severity === "number" && severity < 1 ? GRADE_HARD : GRADE_AGAIN;
}

// Kernfunctie: past één beurt toe op een progress-object `p` en muteert (en retourneert) 'm. Werkt zowel
// voor een woord dat al eerder FSRS-gepland is (heeft al p.stability/p.difficulty) als voor de allereerste
// beurt ooit (initStability/initDifficulty).
export function scheduleReview(p, grade, now) {
  const nowTs = now ?? Date.now();
  const hasHistory = typeof p.stability === "number" && typeof p.difficulty === "number";
  let D, S;
  if (!hasHistory) {
    D = initDifficulty(grade);
    S = initStability(grade);
  } else {
    const lastReviewTs = p.lastReviewAt ?? nowTs;
    const elapsedDays = Math.max(0, (nowTs - lastReviewTs) / (1000 * 60 * 60 * 24));
    const R = retrievability(elapsedDays, p.stability);
    D = nextDifficulty(p.difficulty, grade);
    S = nextStability(D, p.stability, R, grade);
  }
  p.difficulty = D;
  p.stability = S;
  p.lastReviewAt = nowTs;
  const intervalDays = Math.min(FSRS_MAX_STABILITY_DAYS, Math.max(FSRS_MIN_STABILITY_DAYS, nextIntervalDays(S, REQUEST_RETENTION)));
  p.due = nowTs + intervalDays * 24 * 60 * 60 * 1000;
  // UI-compatibiliteitslaag (zie toelichting hierboven) -- alle bestaande code die p.level/p.ease leest
  // blijft zo werken zonder wijziging.
  p.level = stabilityToLevel(S);
  p.ease = difficultyToDisplayEase(D);
  return p;
}

// ---------- Migratie van bestaande (pre-FSRS) voortgang ----------
// Bestaande progress-entries hebben p.level/p.ease/p.intervalMin (de oude SM-2-achtige velden), maar nog
// geen p.stability/p.difficulty. Wordt precies ÉÉN keer per entry aangeroepen (zie migrateLegacyProgress
// hieronder herkent zijn eigen resultaat via de aanwezigheid van p.stability en doet dan niets meer) --
// de oude velden blijven staan (nooit verwijderd), puur ter observatie/rollback-veiligheid; alleen de
// SCHEDULING zelf stapt over naar de nieuwe p.stability/p.difficulty/p.due.
// Legacy-niveau (0-10) -> interval in dagen, exact dezelfde logaritmische formule als de oude
// intervalMinutes(level) in srs.js (15 min -> niveau 0, 1 jaar -> niveau 10). Nodig als migratie-
// terugval voor entries zonder eigen intervalMin (bv. grammatica-voortgang, die alleen level bijhield).
function levelToLegacyIntervalDays(level) {
  const ratio = FSRS_MAX_STABILITY_DAYS / FSRS_MIN_STABILITY_DAYS;
  return FSRS_MIN_STABILITY_DAYS * Math.pow(ratio, Math.max(0, Math.min(10, level || 0)) / 10);
}

export function migrateLegacyProgress(p) {
  if (typeof p.stability === "number") return p; // al gemigreerd (of al FSRS-natief aangemaakt)
  if (!p.reps || p.reps === 0) return p; // nooit geoefend -> niets te migreren, wordt straks gewoon FSRS-natief geïnitialiseerd bij de eerste beurt
  // Stability bootstrappen vanuit het bestaande interval: intervalMin benaderde immers ook al "hoe lang
  // tot de volgende herhaling", wat conceptueel dicht bij stability ligt. Woord-voortgang heeft een eigen
  // intervalMin; grammatica-voortgang (recordGrammarResult) had dat nooit en alleen een level -- daarvoor
  // dezelfde niveau-naar-interval-formule als voorheen gebruiken.
  const legacyIntervalDays = typeof p.intervalMin === "number"
    ? p.intervalMin / (60 * 24)
    : levelToLegacyIntervalDays(p.level);
  p.stability = clampStability(legacyIntervalDays);
  // Difficulty bootstrappen vanuit de oude ease (1.3-2.8, hoger = makkelijker) -- omgekeerd evenredig
  // omgerekend naar FSRS' 1-10-schaal (hoger = moeilijker). Geen eigen ease (grammatica-voortgang) ->
  // een neutrale middenwaarde aannemen.
  const legacyEase = typeof p.ease === "number" ? p.ease : 2.05;
  const EASE_MIN = 1.3, EASE_MAX = 2.8;
  const t = Math.min(1, Math.max(0, (EASE_MAX - legacyEase) / (EASE_MAX - EASE_MIN)));
  p.difficulty = clampDifficulty(1 + t * 9);
  p.lastReviewAt = typeof p.due === "number" ? p.due - legacyIntervalDays * 24 * 60 * 60 * 1000 : Date.now();
  // Het weergegeven niveau/ease meteen bijwerken naar de eerlijke FSRS-positie die net gebootstrapt is,
  // i.p.v. het oude (pre-migratie) getal te laten staan tot de eerstvolgende beurt dat toevallig
  // overschrijft -- anders kan een normale volgende beurt een schijnbaar grote niveausprong tonen die in
  // werkelijkheid grotendeels de eenmalige systeemovergang zelf was, niet de uitkomst van die ene beurt.
  p.level = stabilityToLevel(p.stability);
  p.ease = difficultyToDisplayEase(p.difficulty);
  return p;
}
