'use strict';

const path = require('path');
const fs   = require('fs');
const { createWorker } = require('tesseract.js');

// ─── Path locali (zero downloads runtime) ───────────────────────────────────
//
// tesseract.js, di default, scarica modelli linguistici e moduli WASM da CDN
// esterni (tessdata.projectnaptha.com, unpkg.com). In ambienti senza accesso
// a quei domini (sandbox, container con whitelist) il primo OCR resta in
// attesa indefinita. Qui pre-bundliamo:
//   - i .traineddata in processors/tesseract-data/ (variante "fast")
//   - worker.min.js e tesseract-core* dai node_modules locali
// e li passiamo esplicitamente a createWorker così non viene mai contattato
// alcun CDN.

const TESSDATA_DIR = path.join(__dirname, 'tesseract-data');

// Risolti lazy una sola volta. require.resolve usa la stessa logica di require,
// quindi rispetta gli npm hoist e funziona sia con npm install locale al
// plugin sia con i moduli al root del CMS.
let _workerPath, _corePath;
function getWorkerPath() {
  if (!_workerPath) {
    _workerPath = require.resolve('tesseract.js/dist/worker.min.js');
  }
  return _workerPath;
}
function getCorePath() {
  if (!_corePath) {
    // tesseract.js v7 vuole la directory contenente i tesseract-core*.{js,wasm}.
    const wasmJs = require.resolve('tesseract.js-core/tesseract-core.wasm.js');
    _corePath = path.dirname(wasmJs);
  }
  return _corePath;
}

// ─── Lingue OCR ─────────────────────────────────────────────────────────────
//
// Default: 'ita+eng+osd' (italiano + inglese + Orientation & Script Detection
// per documenti fotografati ruotati). Il valore viene sovrascritto da main.js
// in loadPlugin() se pluginConfig.json5 → custom.ocrLangs è valorizzato.

let _langs = 'ita+eng+osd';

function setLangs(langs) {
  if (typeof langs !== 'string' || !langs.trim()) return;
  if (_workerPromise) {
    console.warn('[guestRegister/tesseract] setLangs() ignorato: il worker è già stato inizializzato.');
    return;
  }
  _langs = langs.trim();
}

// ─── Pre-flight check ───────────────────────────────────────────────────────
//
// Controllo all'init del worker: la cartella tesseract-data esiste e contiene
// un .traineddata per ogni lingua richiesta. Se manca qualcosa esploriamo
// fast con messaggio diagnostico, invece di un blocco silenzioso al primo
// /scan-document.

function preflightCheck(langs) {
  if (!fs.existsSync(TESSDATA_DIR)) {
    throw new Error(
      `[guestRegister] Cartella tesseract-data non trovata: ${TESSDATA_DIR}\n` +
      `Eseguire: node scripts/downloadTessdata.js\n` +
      `Vedi processors/tesseract-data/README.md per dettagli.`
    );
  }
  const required = langs.split('+').map(s => s.trim()).filter(Boolean);
  const missing  = required.filter(l =>
    !fs.existsSync(path.join(TESSDATA_DIR, `${l}.traineddata`))
  );
  if (missing.length) {
    throw new Error(
      `[guestRegister] Lingue mancanti in ${TESSDATA_DIR}: ${missing.join(', ')}\n` +
      `Eseguire: node scripts/downloadTessdata.js --langs=${missing.join(',')}\n` +
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

let _workerPromise = null;

function getWorker() {
  if (!_workerPromise) {
    preflightCheck(_langs);
    _workerPromise = createWorker(_langs, 1, {
      langPath:    TESSDATA_DIR,
      cachePath:   TESSDATA_DIR,
      cacheMethod: 'readOnly',  // niente scritture: i file sono già pronti
      gzip:        false,        // i .traineddata bundlati sono non compressi
      workerPath:  getWorkerPath(),
      corePath:    getCorePath(),
      logger:       () => {},
      errorHandler: () => {},
    }).catch(err => {
      // Reset cache: il prossimo tentativo può ricreare il worker invece di
      // restare bloccato su una Promise rifiutata.
      _workerPromise = null;
      throw err;
    });
  }
  return _workerPromise;
}

async function ocrImage(buffer) {
  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(buffer);
  return text;
}

module.exports = { ocrImage, setLangs };
