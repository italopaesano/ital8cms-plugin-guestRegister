'use strict';

const { ocrImage }                     = require('./tesseract');
const { findMrzLines, extractMrzData } = require('./mrzParser');
const { extractFields }                = require('./fieldExtractor');

// Campi obbligatori: se uno manca il risultato è parziale
const REQUIRED_FIELDS = [
  'cognome', 'nome', 'sesso', 'dataNascita', 'tipoDocumento', 'numeroDocumento',
];

function computePartial(data) {
  return REQUIRED_FIELDS.some(f => !data[f]);
}

// ─── Dispatcher principale ────────────────────────────────────────────────────
//
// Flusso:
//   1. OCR dell'immagine con Tesseract
//   2. Ricerca righe MRZ nel testo → parsing strutturato
//   3. Se MRZ non trovata o non valida → fallback estrazione testuale

async function process(buffer, { debug = false } = {}) {
  const rawText = await ocrImage(buffer);

  // Tentativo MRZ
  const mrzLines = findMrzLines(rawText);
  if (mrzLines) {
    const mrzResult = await extractMrzData(mrzLines);
    if (mrzResult) {
      return {
        success:   true,
        partial:   computePartial(mrzResult.data),
        processor: 'mrz',
        data:      mrzResult.data,
        warnings:  mrzResult.warnings,
        ...(debug && { _rawText: rawText }),
      };
    }
  }

  // Fallback: estrazione testuale (stub fase 3)
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

module.exports = { process };
