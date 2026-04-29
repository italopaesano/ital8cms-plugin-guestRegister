'use strict';

const path = require('path');
const fs   = require('fs');
const { createWorker, PSM } = require('tesseract.js');

// ─── Path locali (zero downloads runtime) ───────────────────────────────────
//
// tesseract.js, di default, scarica i modelli linguistici da CDN esterno
// (tessdata.projectnaptha.com). In ambienti senza accesso a quel dominio
// (sandbox, container con whitelist) il primo OCR resta in attesa
// indefinita. Pre-bundliamo i .traineddata in processors/tesseract-data/
// (variante "fast") e passiamo langPath esplicito a createWorker.
//
// NB: workerPath e corePath NON vengono passati. In Node tesseract.js usa
// di default il proprio worker-script/node/index.js (passare il file
// dist/worker.min.js, che è la build per browser, causa errori del tipo
// "addEventListener is not a function"). Il core WASM viene caricato dai
// require() diretti in worker-script/node/getCore.js, che risolvono
// tesseract.js-core via npm — non passa da corePath.

// Tre varianti supportate: fast (default, committata in repo), standard
// (~1.4 GB) e best (~1.5 GB) scaricabili in cartelle separate via
// scripts/downloadTessdata.js. Vedi processors/tesseract-data/README.md.
const VARIANT_DIRS = {
  fast:     'tesseract-data',
  standard: 'tesseract-data-standard',
  best:     'tesseract-data-best',
};

let _variant = 'fast';
let _tessdataDir = path.join(__dirname, VARIANT_DIRS.fast);

// ─── Lingue OCR ─────────────────────────────────────────────────────────────
//
// Default: 'ita+eng+osd' (italiano + inglese + Orientation & Script Detection
// per documenti fotografati ruotati). Il valore viene sovrascritto da main.js
// in loadPlugin() se pluginConfig.json5 → custom.ocrLangs è valorizzato.

let _langs = 'ita+eng+osd';

function setLangs(langs) {
  if (typeof langs !== 'string' || !langs.trim()) return;
  if (_workerFullPromise || _workerMrzPromise) {
    console.warn('[guestRegister/tesseract] setLangs() ignorato: i worker sono già stati inizializzati.');
    return;
  }
  _langs = langs.trim();
}

// Imposta la variante tessdata da usare. Va chiamata da main.js loadPlugin()
// prima del primo OCR (quando _workerFullPromise/_workerMrzPromise sono null).
// Dopo l'init dei worker la variante è frozen — un setVariant successivo viene
// ignorato con warning, perché i worker hanno già caricato i .traineddata
// della variante corrente in RAM.
function setVariant(variant) {
  if (!variant) return;
  if (!Object.prototype.hasOwnProperty.call(VARIANT_DIRS, variant)) {
    console.warn(`[guestRegister/tesseract] setVariant(${JSON.stringify(variant)}) ignorato: variante sconosciuta. Usa fast | standard | best.`);
    return;
  }
  if (_workerFullPromise || _workerMrzPromise) {
    console.warn('[guestRegister/tesseract] setVariant() ignorato: i worker sono già stati inizializzati.');
    return;
  }
  _variant = variant;
  _tessdataDir = path.join(__dirname, VARIANT_DIRS[variant]);
}

// ─── Pre-flight check ───────────────────────────────────────────────────────
//
// Controllo all'init del worker: la cartella tesseract-data esiste e contiene
// un .traineddata per ogni lingua richiesta. Se manca qualcosa esploriamo
// fast con messaggio diagnostico, invece di un blocco silenzioso al primo
// /scan-document.

function preflightCheck(langs) {
  if (!fs.existsSync(_tessdataDir)) {
    const variantHint = _variant === 'fast' ? '' : ` --variant=${_variant}`;
    throw new Error(
      `[guestRegister] Cartella tessdata non trovata: ${_tessdataDir}\n` +
      `Variante richiesta: "${_variant}".\n` +
      `Eseguire: node scripts/downloadTessdata.js${variantHint}\n` +
      `Vedi processors/tesseract-data/README.md per dettagli.`
    );
  }
  const required = langs.split('+').map(s => s.trim()).filter(Boolean);
  const missing  = required.filter(l =>
    !fs.existsSync(path.join(_tessdataDir, `${l}.traineddata`))
  );
  if (missing.length) {
    const variantHint = _variant === 'fast' ? '' : ` --variant=${_variant}`;
    throw new Error(
      `[guestRegister] Lingue mancanti in ${_tessdataDir}: ${missing.join(', ')}\n` +
      `Eseguire: node scripts/downloadTessdata.js${variantHint} --langs=${missing.join(',')}\n` +
      `Oppure modificare pluginConfig.json5 → custom.ocrLangs.`
    );
  }
}

// ─── Worker persistente ─────────────────────────────────────────────────────
//
// Creato al primo OCR e riusato. Tesseract.js serializza internamente le
// recognize() sullo stesso worker, quindi è safe per uso concorrente (una
// recognize per volta; le altre aspettano in coda).
//
// Non chiamiamo terminate() per tutta la vita del processo: rigenerarlo ha
// un costo di ~300 ms e ~60 MB di RAM (lingue caricate). Costo ammortizzato
// trascurabile rispetto alla memoria persa.

// OEM (OCR Engine Mode): 3 = LSTM + Legacy combined (default Tesseract).
// Necessario quando le lingue includono osd, perché osd.traineddata della
// variante "fast" è solo legacy (no LSTM): con oem=1 (LSTM_ONLY) il worker
// fallisce con "LSTM requested, but not present" e degrada l'OCR di tutte
// le altre lingue del set. oem=3 lascia caricare osd in modalità legacy e
// le lingue LSTM nella loro modalità nativa.
const OEM = 3;

// Due worker dedicati anziché uno solo:
//   - _workerFull   → OCR generale (pass-1, default params)
//   - _workerMrz    → OCR MRZ-specific (pass-2, whitelist + PSM SINGLE_BLOCK
//                     impostati una volta sola alla creazione)
//
// Motivo: tesseract.js v7 NON resetta `tessedit_char_whitelist` quando lo
// si rimette a stringa vuota — la whitelist precedente resta attiva e
// inquina i pass successivi. Tenere i parametri immutabili in due worker
// separati elimina questa classe di bug a costo di ~150 MB extra (il
// secondo worker carica le stesse lingue del primo). Trascurabile rispetto
// al downside di un single-worker con stato corrotto.
let _workerFullPromise = null;
let _workerMrzPromise  = null;

function _newWorker(initOpts = {}) {
  return createWorker(_langs, OEM, {
    langPath:    _tessdataDir,
    cachePath:   _tessdataDir,
    cacheMethod: 'readOnly',  // niente scritture: i file sono già pronti
    gzip:        false,       // i .traineddata bundlati sono non compressi
    logger:       () => {},
    errorHandler: () => {},
    ...initOpts,
  });
}

function getWorkerFull() {
  if (!_workerFullPromise) {
    preflightCheck(_langs);
    _workerFullPromise = _newWorker().catch(err => {
      _workerFullPromise = null;
      throw err;
    });
  }
  return _workerFullPromise;
}

function getWorkerMrz() {
  if (!_workerMrzPromise) {
    preflightCheck(_langs);
    _workerMrzPromise = (async () => {
      const w = await _newWorker();
      // Parametri MRZ impostati una volta sola, mai modificati. Niente
      // try/finally restoration → niente leak di stato fra chiamate.
      await w.setParameters({
        tessedit_char_whitelist: MRZ_WHITELIST,
        tessedit_pageseg_mode:   String(PSM.SINGLE_BLOCK),
      });
      return w;
    })().catch(err => {
      _workerMrzPromise = null;
      throw err;
    });
  }
  return _workerMrzPromise;
}

async function ocrImage(buffer) {
  const worker = await getWorkerFull();
  // Output flag `blocks: true` per ottenere l'albero blocks→paragraphs→lines
  // con bbox per riga: necessario al chiamante per identificare la zona MRZ
  // e ri-OCR-arla con whitelist (vedi ocrMrzRegion).
  const r = await worker.recognize(buffer, {}, { text: true, blocks: true });
  return { text: r.data.text, lines: extractLines(r.data.blocks) };
}

// Aplana l'albero blocks→paragraphs→lines in un array { text, bbox }, in
// ordine di lettura (top-to-bottom, left-to-right come restituito da Tesseract).
function extractLines(blocks) {
  const out = [];
  for (const b of blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        out.push({ text: (l.text || '').trim(), bbox: l.bbox });
      }
    }
  }
  return out;
}

// ─── OCR pass-2 mirato sulla zona MRZ ───────────────────────────────────────
//
// Worker dedicato (getWorkerMrz) con character whitelist `<0123456789A-Z`
// (alfabeto MRZ ICAO Doc 9303) e PSM SINGLE_BLOCK preimpostati: elimina alla
// radice le confusioni più comuni dell'OCR multi-lingua sui filler `<` (letti
// come `£`, «K», «S»). Il rectangle restringe l'inferenza alla zona MRZ.
const MRZ_WHITELIST = '<0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function ocrMrzRegion(buffer, rectangle) {
  const worker = await getWorkerMrz();
  const opts = rectangle ? { rectangle } : {};
  const r = await worker.recognize(buffer, opts);
  return r.data.text;
}

module.exports = { ocrImage, ocrMrzRegion, setLangs, setVariant };
