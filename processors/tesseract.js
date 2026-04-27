'use strict';

const path = require('path');
const fs   = require('fs');
const { createWorker } = require('tesseract.js');

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

const TESSDATA_DIR = path.join(__dirname, 'tesseract-data');

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

// OEM (OCR Engine Mode): 3 = LSTM + Legacy combined (default Tesseract).
// Necessario quando le lingue includono osd, perché osd.traineddata della
// variante "fast" è solo legacy (no LSTM): con oem=1 (LSTM_ONLY) il worker
// fallisce con "LSTM requested, but not present" e degrada l'OCR di tutte
// le altre lingue del set. oem=3 lascia caricare osd in modalità legacy e
// le lingue LSTM nella loro modalità nativa.
const OEM = 3;

function getWorker() {
  if (!_workerPromise) {
    preflightCheck(_langs);
    _workerPromise = createWorker(_langs, OEM, {
      langPath:    TESSDATA_DIR,
      cachePath:   TESSDATA_DIR,
      cacheMethod: 'readOnly',  // niente scritture: i file sono già pronti
      gzip:        false,       // i .traineddata bundlati sono non compressi
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
