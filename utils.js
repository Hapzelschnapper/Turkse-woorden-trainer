// ===================== utils.js =====================
// Algemene, afhankelijkheidsloze hulpfuncties: CEFR-labels en -banden, tekstnormalisatie voor het
// vergelijken van antwoorden, en HTML-escaping. Wordt door de rest van de app (en door typo.js) gebruikt.
// Onderdeel van de module-opsplitsing (stap 3 van het verbeterplan) -- zie /tests voor de bijbehorende tests.

export const CEFR_MAJOR = ["A1","A1","A1","A2","A2","A2","B1","B1","B1","B2","B2","B2","C1","C1","C1","C2","C2","C2"];

export const CEFR_SUB   = ["start","mid","end","start","mid","end","start","mid","end","start","mid","end","start","mid","end","start","mid","end"];

export function cefrLabel(idx){ return CEFR_MAJOR[idx] + " " + CEFR_SUB[idx]; }

export function vocabCefrBand(idx){ return idx >= 12 ? 12 : idx; }

export function normalize(s){
  return (s||"").toLowerCase().trim()
    .replace(/[.,!?;:'"“”‘’]/g,"")
    .replace(/\s+/g," ")
    .replace(/^to /,""); // "to meet" en "meet" moeten als hetzelfde antwoord gelden
}

export function foldTurkishDiacritics(s){
  return String(s || "")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
}

export function escapeHtml(s){
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}
