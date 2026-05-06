'use strict';

// Utility per modificare un singolo campo dentro un file JSON5 senza fare
// round-trip parse → stringify (che eliminerebbe commenti, virgole trailing,
// chiavi non quotate). Usata da main.js installPlugin() per persistere
// `hostRoleId` in pluginConfig.json5 conservando i commenti dell'utente.
//
// Approccio "surgical write": leggiamo il file come testo, troviamo il
// blocco `parentKey: { ... }` con un parser leggero (gestisce stringhe e
// commenti per non confondersi su `}` interni), e dentro quel blocco
//   - se il fieldName esiste, sostituiamo solo il valore
//   - se non esiste, inseriamo la nuova entry prima del closing brace,
//     rispettando l'indentazione dei sibling esistenti
//
// Limiti consapevoli (sufficienti per il nostro caso d'uso):
//   - parentKey deve essere top-level (un livello sotto la root)
//   - il valore è uno scalare JSON-compatibile (number/string/boolean)
//   - se il parentKey non esiste, l'helper torna false e il caller decide
//     se cadere su un fallback (es. JSON.stringify completo)

const fs = require('fs');

// ─── Helpers di parsing leggero ──────────────────────────────────────────────

// Trova il `}` che chiude il `{` a position `openIdx`. Salta string literals
// (single/double quote, escapes) e commenti JSON5 (line `//` e block `/* */`)
// così le graffe dentro stringhe/commenti non corrompono il bracket count.
function findClosingBrace(text, openIdx) {
  if (text[openIdx] !== '{') return -1;
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length && depth > 0) {
    const c = text[i];
    // String literal
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;  // skip carattere escape-ato
        i++;
      }
      i++;
      continue;
    }
    // Line comment
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Cerca l'apertura del blocco `parentKey: { ... }` in tutto il file. La chiave
// può essere quotata ("key") o no (key). Restituisce { startKey, openBrace,
// closeBrace } oppure null se non trovato.
function findBlock(text, parentKey) {
  // Match: optional quote, key letterale, optional quote, colon, optional ws, {
  const escaped = parentKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(["']?)${escaped}\\1\\s*:\\s*\\{`, 'g');
  const m = re.exec(text);
  if (!m) return null;
  const openBrace = m.index + m[0].length - 1;  // index of `{`
  const closeBrace = findClosingBrace(text, openBrace);
  if (closeBrace < 0) return null;
  return { startKey: m.index, openBrace, closeBrace };
}

// Cerca un field per nome dentro la sezione [openBrace+1, closeBrace) di un
// oggetto. Restituisce { valueStart, valueEnd } oppure null. Considera quoted
// e unquoted keys. Non scansiona dentro nested objects/arrays/strings.
function findFieldValue(text, openBrace, closeBrace, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchor: a inizio "lessicale" (newline o `{` o `,`); poi key + colon
  const re = new RegExp(`(^|[\\n{,])\\s*(["']?)${escaped}\\2\\s*:\\s*`, 'gm');
  re.lastIndex = openBrace;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > closeBrace) break;
    // Verifica che siamo a depth 0 dentro il blocco (non nested)
    if (depthAt(text, openBrace, match.index) !== 0) continue;
    const valueStart = match.index + match[0].length;
    const valueEnd = findValueEnd(text, valueStart);
    return { matchStart: match.index + match[1].length, valueStart, valueEnd };
  }
  return null;
}

// Calcola la profondità di nesting (object/array) tra `from` (incluso) e
// `to` (escluso). 0 = stesso livello del blocco aperto in `from`.
function depthAt(text, from, to) {
  let depth = 0;
  let i = from + 1;  // skip the opening { at `from`
  while (i < to) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < to && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < to && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < to - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    i++;
  }
  return depth;
}

// Trova la fine del valore di un field: cerca il prossimo separatore (`,` o
// `}` o `\n` se nessuno dei precedenti). Gestisce stringhe e nested
// object/array (li salta intatti).
function findValueEnd(text, start) {
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        const cc = text[i];
        if (cc === '"' || cc === "'") {
          const q = cc;
          i++;
          while (i < text.length && text[i] !== q) {
            if (text[i] === '\\') i++;
            i++;
          }
        } else if (cc === '{' || cc === '[') depth++;
        else if (cc === '}' || cc === ']') depth--;
        i++;
      }
      continue;
    }
    if (c === ',' || c === '}' || c === '\n') return i;
    i++;
  }
  return text.length;
}

// Scansiona il body del blocco [openBrace+1, closeBrace) come tokenizer
// minimale per individuare:
//   - endOfLastValue: posizione subito DOPO l'ultimo carattere "valore" letto
//     (è qui che va piazzata la virgola di separazione, prima di eventuali
//     commenti inline che seguono sullo stesso rigo)
//   - lastWasComma: true se l'ultimo token significativo è già una virgola
//   - isEmpty: true se il blocco non contiene alcun field
//
// Il tokenizer salta correttamente line-comments (`//`), block-comments
// (`/* */`), stringhe (con escape) e oggetti/array nested, così non si
// confonde su `}`, `,`, `\n` interni a uno di questi.
function scanBlockForInsertion(text, openBrace, closeBrace) {
  let i = openBrace + 1;
  let endOfLastValue = -1;
  let lastWasComma = true;  // virtualmente "comma" all'inizio: il primo
                             // field non vuole una virgola davanti

  while (i < closeBrace) {
    const c = text[i];

    if (c === '/' && text[i + 1] === '/') {
      while (i < closeBrace && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < closeBrace - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === ',') {
      lastWasComma = true;
      i++;
      continue;
    }

    // Inizio di un field: skip della key (string literal o identifier)
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < closeBrace && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
    } else {
      while (i < closeBrace && /[\w$]/.test(text[i])) i++;
    }
    while (i < closeBrace && /\s/.test(text[i])) i++;
    if (text[i] === ':') i++;
    while (i < closeBrace && /\s/.test(text[i])) i++;

    // Skip del valore
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i];
      i++;
      while (i < closeBrace && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
    } else if (text[i] === '{' || text[i] === '[') {
      const open = text[i];
      const close = open === '{' ? '}' : ']';
      let depth = 1;
      i++;
      while (i < closeBrace && depth > 0) {
        const cc = text[i];
        if (cc === '"' || cc === "'") {
          const q = cc;
          i++;
          while (i < closeBrace && text[i] !== q) {
            if (text[i] === '\\') i++;
            i++;
          }
        } else if (cc === '{' || cc === '[') depth++;
        else if (cc === '}' || cc === ']') depth--;
        i++;
      }
    } else {
      // Scalare: si ferma a ws, virgola, `}` o inizio commento
      while (
        i < closeBrace
        && !/[,\s}]/.test(text[i])
        && !(text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*'))
      ) i++;
    }

    endOfLastValue = i;
    lastWasComma = false;
  }

  return {
    endOfLastValue,
    lastWasComma,
    isEmpty: endOfLastValue === -1,
  };
}

// Indentazione della riga che contiene `pos` (whitespace prima del primo
// carattere non-ws). Se la riga ha già contenuto prima di pos, torna ''.
function getLineIndent(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const indent = text.slice(lineStart, pos);
  return /^\s*$/.test(indent) ? indent : '';
}

// ─── API pubblica ────────────────────────────────────────────────────────────

// Aggiorna o inserisce `fieldName: value` dentro il blocco top-level
// `parentKey: { ... }` di un file JSON5. Preserva commenti, indentazione e
// virgole trailing dell'esistente. Restituisce true se il file è stato
// modificato, false se il parentKey non è stato trovato (il caller può
// decidere il fallback).
//
// `value` può essere string | number | boolean. Per stringhe viene
// automaticamente quotato con doppi apici e gli `\` e `"` interni
// escape-ati.
function setNestedField(filePath, parentKey, fieldName, value) {
  const text = fs.readFileSync(filePath, 'utf8');
  const block = findBlock(text, parentKey);
  if (!block) return false;

  const formatted = formatValue(value);

  // Caso 1: field già presente → sostituzione del solo valore
  const existing = findFieldValue(text, block.openBrace, block.closeBrace, fieldName);
  if (existing) {
    const newText =
      text.slice(0, existing.valueStart)
      + formatted
      + text.slice(existing.valueEnd);
    fs.writeFileSync(filePath, newText);
    return true;
  }

  // Caso 2: inserimento di un nuovo field
  const scan = scanBlockForInsertion(text, block.openBrace, block.closeBrace);
  const formattedField = `"${fieldName}": ${formatted}`;

  if (scan.isEmpty) {
    // Blocco vuoto: rimpiazzo l'intero contenuto fra `{` e `}`. L'indentazione
    // del field si calcola come parentLineIndent + 2 spazi (step di nesting
    // standard, in mancanza di sibling esistenti come riferimento). Il
    // closing `}` viene riposizionato sulla parentLineIndent così l'output
    // è ben annidato.
    const parentIndent = getLineIndent(text, block.startKey);
    const fieldIndent = parentIndent + '  ';
    const replacement = `\n${fieldIndent}${formattedField}\n${parentIndent}`;
    const newText =
      text.slice(0, block.openBrace + 1)
      + replacement
      + text.slice(block.closeBrace);
    fs.writeFileSync(filePath, newText);
    return true;
  }

  // Blocco non vuoto: la virgola di separazione va piazzata IMMEDIATAMENTE
  // dopo l'ultimo carattere del valore precedente (non a fine riga), così
  // un eventuale line-comment inline (`// nota`) resta legato al suo valore
  // originario. La nuova entry va invece su un nuovo rigo, dopo la fine
  // della riga corrente (che può contenere il commento inline da preservare).
  const blockBody = text.slice(block.openBrace + 1, block.closeBrace);
  const indentMatch = blockBody.match(/\n([ \t]+)\S/);
  const fieldIndent = indentMatch
    ? indentMatch[1]
    : (getLineIndent(text, block.startKey) + '  ');

  const valuePos = scan.endOfLastValue;
  const needsComma = !scan.lastWasComma;

  let lineEnd = text.indexOf('\n', valuePos);
  if (lineEnd === -1 || lineEnd > block.closeBrace) lineEnd = valuePos;
  const restOfLine = text.slice(valuePos, lineEnd);

  const newText =
    text.slice(0, valuePos)
    + (needsComma ? ',' : '')
    + restOfLine
    + '\n' + fieldIndent + formattedField
    + text.slice(lineEnd);

  fs.writeFileSync(filePath, newText);
  return true;
}

function formatValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  throw new Error(`json5Writer: tipo non supportato per il valore: ${typeof v}`);
}

module.exports = { setNestedField };
