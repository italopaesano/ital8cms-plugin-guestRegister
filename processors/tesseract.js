'use strict';

const { createWorker } = require('tesseract.js');

// Lingue caricate da Tesseract. `ita+eng` copre documenti italiani (compresi
// accenti e caratteri tipici delle patenti EU) e passaporti stranieri.
const LANGS = 'ita+eng';

// Worker persistente: creato al primo uso e riusato per tutte le richieste
// successive. Tesseract.js serializza internamente le chiamate a `recognize()`
// sullo stesso worker, quindi è safe per uso concorrente (una recognize per
// volta; le altre aspettano in coda).
//
// Non chiamiamo `terminate()` per tutta la vita del processo: rigenerarlo ha
// un costo di ~300 ms e ~60 MB di RAM (lingue caricate). Il costo ammortizzato
// è trascurabile rispetto alla memoria persa.
let _workerPromise = null;

function getWorker() {
  if (!_workerPromise) {
    _workerPromise = createWorker(LANGS, 1, {
      logger:       () => {},
      errorHandler: () => {},
    }).catch(err => {
      // Se l'inizializzazione fallisce, resetto la cache in modo che il
      // prossimo tentativo possa ricreare il worker invece di restare bloccato
      // su una Promise rifiutata.
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

module.exports = { ocrImage };
