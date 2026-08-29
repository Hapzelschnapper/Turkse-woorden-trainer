// ===================== srs.js =====================
// De spaced-repetition-scheduling-kern: interval/ease-berekening (nextWordIntervalMinutes, met
// hint-severity-schaling voor gedeeltelijke terugval) en de twee eerder losgetrokken, pure
// beslisfuncties voor de nieuw/herhaling-mix en de word/sentence/question-type-keuze
// (resolveWordMixSlot, pickBestPracticeType) -- zie /tests/srs.test.js en /tests/mixing.test.js.

export const MIN_MIN = 15;

export const MAX_MIN = 60 * 24 * 365;

export const RATIO = MAX_MIN / MIN_MIN;

export function intervalMinutes(level){
  const l = Math.max(0, Math.min(10, level));
  return MIN_MIN * Math.pow(RATIO, l/10);
}

export const EASE_START = 2.3;

export const EASE_MIN = 1.3;

export const EASE_MAX = 2.8;

export const EASE_STEP_UP = 0.04;

export const EASE_STEP_DOWN = 0.25;

export const WRONG_INTERVAL_FACTOR = 0.3;

export const WRONG_INTERVAL_CAP_MIN = 60 * 24;

export function ensureEase(p){
  if(typeof p.ease !== "number") p.ease = EASE_START;
  else if(p.ease > EASE_MAX) p.ease = EASE_MAX; // bestaande woorden die onder de oude (hogere) bovengrens
                                                  // zaten meteen terugbrengen naar het nieuwe, strakkere plafond
  return p.ease;
}

export function nextWordIntervalMinutes(p, outcome, severity){
  ensureEase(p);
  const current = p.intervalMin || intervalMinutes(p.level);
  let next;
  if(outcome === "correct"){
    p.ease = Math.min(EASE_MAX, p.ease + EASE_STEP_UP);
    next = current * p.ease;
  } else if(outcome === "dispute"){
    // Een geaccepteerd dispuut telt extra zwaar: interval x ease^2 (geen ease-mutatie, want er was
    // geen "gewone" beurt -- het dispuut herstelt/versterkt alleen het interval zelf).
    next = current * p.ease * p.ease;
  } else {
    // severity (0-1) schaalt de zwaarte van de terugval -- standaard 1 (volledig), maar bij een
    // hint-met-schaalverdeling (zie hintPenaltySeverity) kan dit lager liggen. Bij severity=1 is dit
    // exact het oude gedrag; bij severity<1 wordt zowel de ease-daling als de interval-krimp naar rato
    // verzacht (het interval schuift dan minder ver richting het volle-fout-doel).
    const sev = (typeof severity === "number") ? Math.max(0, Math.min(1, severity)) : 1;
    p.ease = Math.max(EASE_MIN, p.ease - EASE_STEP_DOWN * sev);
    const fullWrongTarget = Math.min(current * WRONG_INTERVAL_FACTOR, WRONG_INTERVAL_CAP_MIN);
    next = current - sev * (current - fullWrongTarget);
  }
  p.intervalMin = Math.max(MIN_MIN, Math.min(MAX_MIN, next));
  return p.intervalMin;
}

export function resolveWordMixSlot({hasWordsInRange, alwaysNew, dueCount, newCount, reviewCount, mixNewWords, newWordsPer5, wordMixCounter}){
  if(!hasWordsInRange) return "all"; // niets binnen bereik -> toch iets tonen
  if(alwaysNew) return "new"; // 5/5: uitsluitend nieuwe woorden (leeg -> "empty" hieronder afgehandeld door de aanroeper)
  if(dueCount === 0 && newCount > 0) return "new"; // niets due -> expliciete terugval op nieuwe woorden
  if(dueCount === 0) return "empty"; // niets due EN niets nieuws
  if(!mixNewWords) return "reviewOrNew"; // nieuwe woorden bewust niet aanbieden, tenzij er ECHT niets anders is
  if(!newCount || !reviewCount) return "review"; // niets te mixen -> gewoon due-woorden
  // Exacte kwotering i.p.v. een schattend gemiddelde: van elke opeenvolgende 5 woordoefeningen zijn de
  // eerste newWordsPer5 "nieuw" en de rest "herhaling", gebaseerd op een oplopende teller (wordMixCounter
  // % 5) -- zo krijg je gegarandeerd precies X op de 5, niet slechts gemiddeld ongeveer X op de 5.
  const slot = wordMixCounter % 5;
  return (slot < newWordsPer5) ? "quotaNew" : "quotaReview";
}

export function pickBestPracticeType(history, wordsPct, sentPct, questPct){
  const totalPct = wordsPct + sentPct + questPct;
  const recent = history.slice(-10);
  const recentWordShare = recent.length ? recent.filter(t=>t==="word").length / recent.length : 0;
  const recentSentenceShare = recent.length ? recent.filter(t=>t==="sentence").length / recent.length : 0;
  const recentQuestionShare = recent.length ? recent.filter(t=>t==="question").length / recent.length : 0;
  const deficits = totalPct > 0 ? {
    word: (wordsPct/totalPct) - recentWordShare,
    sentence: (sentPct/totalPct) - recentSentenceShare,
    question: (questPct/totalPct) - recentQuestionShare,
  } : {word:1, sentence:0, question:0};
  const targetShare = {word: wordsPct/(totalPct||1), sentence: sentPct/(totalPct||1), question: questPct/(totalPct||1)};
  // BUGFIX: een type met 0% streefaandeel (bv. questionPercent op 0, of geen AI-key beschikbaar) had
  // toch nog deficit 0 zodra het recent ook 0 keer voorkwam ("0 - 0 = 0") -- dat kon de NEGATIEVE
  // deficits van andere, wél gewenste types (die toevallig al iets boven hun streefaandeel zaten)
  // gewoon verslaan, waardoor een op 0% gezet type soms toch verscheen. Zulke types eerst volledig
  // uitsluiten, voordat er een "beste" gekozen wordt.
  const ranked = Object.entries(deficits).filter(([type])=>targetShare[type] > 0).sort((a,b)=>b[1]-a[1]);
  // Voorkom twee keer ACHTER ELKAAR hetzelfde type: bij een klein streefaandeel (bv. 15% zinnen = 1,5 op
  // een venster van 10) blijft dat type na precies 1 voorkomen nog altijd een positief deficit houden
  // (1 < 1,5), waardoor het pure deficit-algoritme het gewoon meteen weer kiest -- geen toeval, een
  // voorspelbaar gevolg van kleine streefaandelen op een venster van 10. Is er een tweede-beste type met
  // een niet te veel lager deficit (binnen 0,15), kies die in plaats daarvan; is het verschil groot (bv.
  // woorden staan écht ver achter), dan mag het type alsnog een keer herhalen -- dat is dan terecht.
  const lastType = history.length ? history[history.length-1] : null;
  let bestType = ranked.length ? ranked[0][0] : "word";
  if(bestType === lastType && ranked.length > 1 && (ranked[0][1] - ranked[1][1]) < 0.15){
    bestType = ranked[1][0];
  }
  return bestType;
}
