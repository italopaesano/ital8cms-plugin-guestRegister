'use strict';

// Script di test standalone per il pipeline OCR.
// Non richiede il CMS in esecuzione.
//
// Uso:
//   node test/testOcr.js <percorso-immagine> [--debug]
//
// --debug: mostra il testo grezzo estratto da Tesseract

const fs   = require('fs');
const path = require('path');

const { process: processDocument } = require('../processors');

const args      = process.argv.slice(2);
const debug     = args.includes('--debug');
const imagePath = args.find(a => !a.startsWith('--'));

if (!imagePath) {
  console.error('Uso: node test/testOcr.js <percorso-immagine> [--debug]');
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

processDocument(buffer, { debug })
  .then((result) => {
    if (debug && result._rawText) {
      console.log('\nTESTO GREZZO OCR (Tesseract):');
      console.log('─'.repeat(50));
      console.log(result._rawText);
      console.log('─'.repeat(50));
    }

    const { _rawText, ...printable } = result;
    console.log('\nRisultato JSON:\n');
    console.log(JSON.stringify(printable, null, 2));

    console.log('\n' + '─'.repeat(50));
    console.log(`Processor usato : ${result.processor}`);
    console.log(`Risultato       : ${result.partial ? 'PARZIALE' : 'COMPLETO'}`);

    const required       = ['cognome', 'nome', 'sesso', 'dataNascita', 'tipoDocumento', 'numeroDocumento'];
    const missingRequired = required.filter(f => !result.data[f]);

    if (result.partial) {
      console.log('\nCAMPI OBBLIGATORI MANCANTI (da inserire manualmente):');
      missingRequired.forEach(f => console.log(`  - ${f}`));
    }

    if (result.warnings.length) {
      const filteredWarnings = result.warnings.filter(
        w => !missingRequired.some(f => w.startsWith(f + ':'))
      );
      if (filteredWarnings.length) {
        console.log('\nWarnings (campi da completare manualmente):');
        filteredWarnings.forEach(w => console.log(`  - ${w}`));
      }
    }
  })
  .catch((err) => {
    console.error('\nErrore durante l\'elaborazione:', err.message);
    if (debug) console.error(err.stack);
    process.exit(1);
  });
