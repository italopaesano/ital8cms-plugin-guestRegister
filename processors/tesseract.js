'use strict';

const { createWorker } = require('tesseract.js');

// Crea worker, esegue OCR sul buffer, termina il worker.
// Per le prime prove è accettabile. In produzione ottimizzare
// con un worker persistente inizializzato in loadPlugin().
async function ocrImage(buffer) {
  const worker = await createWorker('ita+eng', 1, { logger: () => {} });
  try {
    const { data: { text } } = await worker.recognize(buffer);
    return text;
  } finally {
    await worker.terminate();
  }
}

module.exports = { ocrImage };
