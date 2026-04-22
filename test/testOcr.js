'use strict';

// Script di test standalone per il pipeline OCR.
// Non richiede il CMS in esecuzione.
//
// Uso:
//   node test/testOcr.js <percorso-immagine>
//
// Esempio:
//   node test/testOcr.js ./test/samples/carta_identita.jpg

const fs   = require('fs');
const path = require('path');

const { process: processDocument } = require('../processors');

const imagePath = process.argv[2];

if (!imagePath) {
  console.error('Uso: node test/testOcr.js <percorso-immagine>');
  process.exit(1);
}

const absPath = path.resolve(imagePath);
if (!fs.existsSync(absPath)) {
  console.error(`File non trovato: ${absPath}`);
  process.exit(1);
}

const buffer = fs.readFileSync(absPath);

console.log(`\nElaborazione: ${path.basename(absPath)}`);
console.log('─'.repeat(50));

processDocument(buffer)
  .then((result) => {
    // Risultato grezzo
    console.log('\nRisultato JSON:\n');
    console.log(JSON.stringify(result, null, 2));

    // Riepilogo leggibile
    console.log('\n' + '─'.repeat(50));
    console.log(`Processor usato : ${result.processor}`);
    console.log(`Risultato       : ${result.partial ? 'PARZIALE' : 'COMPLETO'}`);

    if (result.partial) {
      console.log('\nCAMPI OBBLIGATORI MANCANTI (da inserire manualmente):');
      const required = ['cognome', 'nome', 'sesso', 'dataNascita', 'tipoDocumento', 'numeroDocumento'];
      required
        .filter(f => !result.data[f])
        .forEach(f => console.log(`  - ${f}`));
    }

    if (result.warnings.length) {
      console.log('\nWarnings (campi da completare manualmente):');
      result.warnings.forEach(w => console.log(`  - ${w}`));
    }
  })
  .catch((err) => {
    console.error('\nErrore durante l\'elaborazione:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
