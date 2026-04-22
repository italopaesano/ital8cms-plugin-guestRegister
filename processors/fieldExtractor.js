'use strict';

// ─── Utility ─────────────────────────────────────────────────────────────────

// Converte data con anno a 2 cifre (DD/MM/YY) in DD/MM/YYYY
function expandYear(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const [dd, mm, yy] = parts;
  if (yy.length === 4) return `${dd.padStart(2, '0')}/${mm}/${yy}`;
  const currentYY = new Date().getFullYear() % 100;
  const fullYear  = parseInt(yy, 10) > currentYY ? `19${yy}` : `20${yy}`;
  return `${dd.padStart(2, '0')}/${mm}/${fullYear}`;
}

// Restituisce il primo gruppo catturato da regex, o null
function extract(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : null;
}

// ─── Detector tipo documento ──────────────────────────────────────────────────

function detectDocumentType(text) {
  const upper = text.toUpperCase();
  if (upper.includes('PATENTE DI GUIDA'))                              return 'PAT';
  if (upper.includes('CARTA DI IDENTITA') || upper.includes('IDENTITY CARD')) return 'IDE';
  if (upper.includes('PASSAPORTO') || upper.includes('PASSPORT'))     return 'PAS';
  return null;
}

// ─── Estrattore Patente di Guida (formato EU) ─────────────────────────────────
//
// Campi standard EU sulla patente:
//   1. Cognome   2. Nome   3. Data e luogo nascita
//   4a. Data rilascio   4b. Data scadenza   4c. Autorità
//   5. Numero patente

function extractPatente(text) {
  const warnings = [];

  // Campo 1 — Cognome
  const cognome = extract(text, /\b1\.\s+([A-Z][A-Z '-]*)$/m);

  // Campo 2 — Nome
  const nome = extract(text, /\b2\.\s+([A-Z][A-Z '-]*)$/m);

  // Campo 3 — Data nascita + Luogo (PV)
  const campo3 = text.match(/\b3\.\s+(\d{1,2}\/\d{2}\/\d{2,4})\s+([A-Z][A-Z\s]+?)\s*\(([A-Z]{2})\)/);
  const dataNascita      = campo3 ? expandYear(campo3[1]) : null;
  const luogoNascita     = campo3 ? campo3[2].trim()      : null;
  const provinciaNascita = campo3 ? campo3[3]             : null;

  // Campo 5 — Numero patente
  const numeroDocumento = extract(text, /\b5\.\s+([A-Z0-9]+)/);

  const data = {
    cognome,
    nome,
    sesso:             null,   // Non presente sulla patente fronte
    dataNascita,
    luogoNascita,
    provinciaNascita,
    statoNascita:      null,   // Non estraibile dalla patente
    cittadinanza:      null,   // Non estraibile dalla patente
    tipoDocumento:     'PAT',
    numeroDocumento,
    luogoRilascio:     null,   // MIT-UCO non è un comune
    provinciaRilascio: null,
    statoRilascio:     'ITALIA',
  };

  if (!data.sesso)         warnings.push('sesso: non presente sulla patente, inserire manualmente');
  if (!data.statoNascita)  warnings.push('statoNascita: non estraibile dalla patente, inserire manualmente');
  if (!data.cittadinanza)  warnings.push('cittadinanza: non estraibile dalla patente, inserire manualmente');
  if (!data.luogoRilascio) warnings.push('luogoRilascio: non estraibile dalla patente, inserire manualmente');

  return { data, warnings };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function extractFields(rawText) {
  const docType = detectDocumentType(rawText);

  if (docType === 'PAT') return extractPatente(rawText);

  return {
    data: {
      cognome: null, nome: null, sesso: null, dataNascita: null,
      luogoNascita: null, provinciaNascita: null, statoNascita: null,
      cittadinanza: null, tipoDocumento: docType, numeroDocumento: null,
      luogoRilascio: null, provinciaRilascio: null, statoRilascio: null,
    },
    warnings: [
      `Tipo documento non riconosciuto (rilevato: ${docType || 'sconosciuto'}). Inserire i dati manualmente.`,
    ],
  };
}

module.exports = { extractFields };
