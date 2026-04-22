'use strict';

// Stub — verrà implementato nella fase 3 della roadmap.
// Gestisce i documenti senza MRZ (es. Patente di guida) estraendo
// i campi tramite pattern regex sul testo OCR grezzo.
async function extractFields(/* rawText */) {
  return {
    data: {
      cognome:           null,
      nome:              null,
      sesso:             null,
      dataNascita:       null,
      luogoNascita:      null,
      provinciaNascita:  null,
      statoNascita:      null,
      cittadinanza:      null,
      tipoDocumento:     null,
      numeroDocumento:   null,
      luogoRilascio:     null,
      provinciaRilascio: null,
      statoRilascio:     null,
    },
    warnings: [
      'Nessuna MRZ rilevata. Estrazione testuale da documento senza MRZ non ancora implementata.',
    ],
  };
}

module.exports = { extractFields };
