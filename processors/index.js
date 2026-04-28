'use strict';

const { ocrImage, ocrMrzRegion }                       = require('./tesseract');
const { findMrzLines, extractMrzData, repairMrzLines } = require('./mrzParser');
const { extractFields }                                = require('./fieldExtractor');

// Campi obbligatori: se uno manca il risultato è parziale
const REQUIRED_FIELDS = [
  'cognome', 'nome', 'sesso', 'dataNascita', 'tipoDocumento', 'numeroDocumento',
];

function computePartial(data) {
  return REQUIRED_FIELDS.some(f => !data[f]);
}

// ─── Bounding box della zona MRZ candidata ───────────────────────────────────
//
// Cerca tra le righe OCR del pass-1 quelle "MRZ-like": alta proporzione di
// caratteri dell'alfabeto MRZ (A-Z, 0-9, <) e lunghezza ≥ 25. Restituisce il
// rettangolo che racchiude il cluster trovato. Più robusto di un semplice
// "ultime N righe" perché Tesseract può catturare elementi UI (icone,
// scritte di overlay) sotto la MRZ in screenshot di documenti.

const MRZ_CHAR_RE = /[A-Z0-9<£«‹]/g;

function mrzLikeScore(text) {
  if (!text) return 0;
  const upper = text.toUpperCase();
  const matches = upper.match(MRZ_CHAR_RE);
  if (!matches) return 0;
  return matches.length / upper.length;
}

function computeMrzBbox(ocrLines) {
  if (!ocrLines || ocrLines.length === 0) return null;
  const candidates = ocrLines.filter(l =>
    l.text && l.text.replace(/\s/g, '').length >= 25 && mrzLikeScore(l.text) >= 0.7
  );
  if (candidates.length === 0) {
    // Niente di chiaramente MRZ-like: fallback alle ultime righe (passport
    // con MRZ in fondo, foto pulite). Limita a 3 per evitare di includere
    // troppa pagina.
    const tail = ocrLines.slice(-3);
    return bboxOf(tail);
  }
  return bboxOf(candidates);
}

function bboxOf(lines) {
  const x0 = Math.min(...lines.map(l => l.bbox.x0));
  const y0 = Math.min(...lines.map(l => l.bbox.y0));
  const x1 = Math.max(...lines.map(l => l.bbox.x1));
  const y1 = Math.max(...lines.map(l => l.bbox.y1));
  return {
    left:   Math.max(0, x0 - 5),
    top:    Math.max(0, y0 - 5),
    width:  (x1 - x0) + 10,
    height: (y1 - y0) + 10,
  };
}

// ─── Dispatcher principale ────────────────────────────────────────────────────
//
// Flusso:
//   1. Pass-1 OCR: full image, lingue ita+eng+osd
//   2. Tentativo parsing MRZ strict sulle righe del pass-1 (autocorrect del
//      package `mrz` può sistemare singoli check digit su OCR pulita)
//   3. Se MRZ pass-1 fallisce → Pass-2 OCR mirato sulla zona MRZ con character
//      whitelist `<0-9A-Z` (rimuove confusabili Latin-1) e PSM SINGLE_BLOCK
//   4. Tentativo MRZ strict sul testo del pass-2
//   5. Se ancora fallisce → loose parse: estrazione posizionale senza
//      validazione dei check digit (warning esplicito al chiamante)
//   6. Tutto fallito → fieldExtractor (estrazione testuale stub)
//
// La distinzione tra pass-1 e pass-2 è esposta via il campo `processor` nella
// risposta (`mrz`, `mrz-pass2`, `mrz-loose`, `tesseract`) per diagnostica.

// Un risultato MRZ è "utile" se ha cognome + almeno uno fra nome,
// dataNascita, numeroDocumento. Necessario perché parseMrz con autocorrect
// può ritornare `valid: true` su righe foneticamente MRZ ma con i caratteri
// "veri" mangiati dal lenient: in quei casi i check digit tornano per
// caso, ma i campi sono filler. Se il pass-1 non è utile, scendiamo a pass-2.
function isUsefulMrz(data) {
  if (!data || !data.cognome) return false;
  return Boolean(data.nome || data.dataNascita || data.numeroDocumento);
}

async function process(buffer, { debug = false } = {}) {
  const ocr = await ocrImage(buffer);
  const rawText = ocr.text;

  // Pass-1: cerca righe MRZ nel testo del primo OCR
  let mrzLines = findMrzLines(rawText);
  if (mrzLines) {
    const r = await extractMrzData(mrzLines);
    if (r && isUsefulMrz(r.data)) return makeResult(r, 'mrz', rawText, debug);
  }

  // Pass-2: ri-OCR della zona MRZ con whitelist Tesseract
  const bbox = computeMrzBbox(ocr.lines);
  if (bbox) {
    let pass2Text = null;
    try {
      pass2Text = await ocrMrzRegion(buffer, bbox);
    } catch (e) {
      // Pass-2 best-effort: errori non bloccanti, cadiamo al fallback testuale
      console.warn('[guestRegister/mrz] pass-2 OCR fallito:', e.message);
    }
    if (pass2Text) {
      mrzLines = findMrzLines(pass2Text);
      if (mrzLines) {
        // Position-aware repair (Strategy 4): sostituisce digit↔alpha sui
        // residui di confusione OCR (`O→0`, `I→1`, `S→5` nelle posizioni
        // numeriche; `0→O`, `1→I`, `5→S` nelle posizioni alfabetiche),
        // sfruttando il layout posizionale ICAO Doc 9303. Solo righe di
        // lunghezza canonica esatta vengono modificate (le altre passano
        // intatte, vedi repairMrzLines).
        mrzLines = repairMrzLines(mrzLines);

        // Strict parse sul testo del pass-2 ripulito: dopo la repair i check
        // digit hanno una chance reale di tornare validi.
        const rStrict = await extractMrzData(mrzLines);
        if (rStrict) return makeResult(rStrict, 'mrz-pass2', rawText, debug);

        // Loose parse: posizionale senza validazione check digit, ma sulle
        // stesse righe già ripulite dalla repair → campi (data nascita,
        // cittadinanza, sesso) più affidabili di prima.
        const rLoose = await extractMrzData(mrzLines, { allowLoose: true });
        if (rLoose) return makeResult(rLoose, 'mrz-loose', rawText, debug);
      }
    }
  }

  // Fallback finale: estrazione testuale (stub fase 3 in fieldExtractor)
  const textResult = await extractFields(rawText);
  return {
    success:   true,
    partial:   computePartial(textResult.data),
    processor: 'tesseract',
    data:      textResult.data,
    warnings:  textResult.warnings,
    ...(debug && { _rawText: rawText }),
  };
}

function makeResult(r, processor, rawText, debug) {
  return {
    success:   true,
    partial:   computePartial(r.data),
    processor,
    data:      r.data,
    warnings:  r.warnings,
    ...(debug && { _rawText: rawText }),
  };
}

module.exports = { process };
