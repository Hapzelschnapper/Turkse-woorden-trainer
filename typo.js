// ===================== typo.js =====================
// Tikfout-tolerantie voor het beoordelen van antwoorden: een toetsenbord-gewogen editafstand (een
// vervanging tussen fysiek naastgelegen QWERTY-toetsen, zoals i/o, weegt lichter dan een willekeurige
// vervanging) plus de op woordlengte geschaalde tolerantie-drempel.

import { normalize, foldTurkishDiacritics } from './utils.js';

export const QWERTY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export const ADJACENT_KEY_COST = 0.5;

export const _qwertyNeighborCache = new Map();

export function qwertyNeighbors(ch){
  if(_qwertyNeighborCache.has(ch)) return _qwertyNeighborCache.get(ch);
  const neighbors = new Set();
  for(let r = 0; r < QWERTY_ROWS.length; r++){
    const idx = QWERTY_ROWS[r].indexOf(ch);
    if(idx === -1) continue;
    // buren op dezelfde rij (links/rechts)...
    if(idx > 0) neighbors.add(QWERTY_ROWS[r][idx-1]);
    if(idx < QWERTY_ROWS[r].length - 1) neighbors.add(QWERTY_ROWS[r][idx+1]);
    // ...en, bij benadering, dezelfde kolom op de rij erboven/eronder (QWERTY-rijen liggen een halve
    // toets verschoven, dus zowel dezelfde index als één ernaast tellen als "fysiek dichtbij").
    [r-1, r+1].forEach(nr=>{
      const nrow = QWERTY_ROWS[nr];
      if(!nrow) return;
      [idx-1, idx, idx+1].forEach(ni=>{ if(nrow[ni]) neighbors.add(nrow[ni]); });
    });
    break;
  }
  _qwertyNeighborCache.set(ch, neighbors);
  return neighbors;
}

export function substitutionCost(a, b){
  if(a === b) return 0;
  return qwertyNeighbors(a).has(b) ? ADJACENT_KEY_COST : 1;
}

export function levenshteinDistance(a, b){
  if(a === b) return 0;
  if(!a.length) return b.length;
  if(!b.length) return a.length;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for(let i = 1; i <= a.length; i++){
    const cur = [i];
    for(let j = 1; j <= b.length; j++){
      const cost = substitutionCost(a[i-1], b[j-1]);
      cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function typoTolerance(len){
  if(len < 4) return 0;
  if(len <= 6) return 1;
  if(len <= 11) return 2;
  return 3;
}

export function isTypoOf(answer, correct){
  const a = foldTurkishDiacritics(normalize(answer));
  const b = foldTurkishDiacritics(normalize(correct));
  if(a === b) return false;
  const dist = levenshteinDistance(a, b);
  return dist > 0 && dist <= typoTolerance(b.length);
}
