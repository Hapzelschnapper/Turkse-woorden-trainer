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

// Lichte markdown-naar-HTML-omzetting voor AI-gegenereerde feedback/uitleg-tekst: de app toont zulke
// tekst als opgemaakte HTML (niet als platte tekst), dus **vet**/*cursief*/#koppen/opsommingen die de
// AI gebruikt worden nu daadwerkelijk als opmaak weergegeven i.p.v. dat de sterretjes/hekjes letterlijk
// zichtbaar blijven. ALTIJD eerst escapeHtml() (veilig tegen HTML-injectie vanuit AI-tekst) en pas
// DAARNA de eigen, beperkte set bekende markdown-patronen vervangen door vaste, veilige tags -- nooit
// andersom, want dat zou de escaping weer kunnen omzeilen.
export function renderMarkdownLite(raw){
  if(!raw) return "";
  let html = escapeHtml(raw);
  // Vet: **tekst** -> <strong>tekst</strong> (vóór cursief, anders "eet" de cursief-regex al een van de twee sterretjes op)
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  // Cursief: *tekst* -> <em>tekst</em>
  html = html.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  // Koppen ("# Tekst" t/m "###### Tekst") -> vetgedrukt: voor korte feedbackfragmenten is een aparte
  // kopgrootte overkill, vet valt al genoeg op en blijft visueel consistent met de rest van de tekst.
  html = html.replace(/^#{1,6}[ \t]+(.+)$/gm, "<strong>$1</strong>");
  // Opsommingslijst: aaneengesloten regels die met "- " of "* " beginnen
  html = html.replace(/(^|\n)((?:[-*][ \t]+.*(?:\n|$))+)/g, (m, lead, block) => {
    const items = block.trim().split("\n").map(line => line.replace(/^[-*][ \t]+/, "").trim()).filter(Boolean);
    if(!items.length) return m;
    return lead + '<ul style="margin:4px 0 4px 18px;padding:0;">' + items.map(i => `<li>${i}</li>`).join("") + "</ul>";
  });
  // Genummerde lijst: "1. ", "2. " enz.
  html = html.replace(/(^|\n)((?:\d+\.[ \t]+.*(?:\n|$))+)/g, (m, lead, block) => {
    const items = block.trim().split("\n").map(line => line.replace(/^\d+\.[ \t]+/, "").trim()).filter(Boolean);
    if(!items.length) return m;
    return lead + '<ol style="margin:4px 0 4px 18px;padding:0;">' + items.map(i => `<li>${i}</li>`).join("") + "</ol>";
  });
  // Overgebleven regeleindes -> <br>
  html = html.replace(/\n/g, "<br>");
  return html;
}
