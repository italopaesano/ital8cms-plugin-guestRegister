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
  if (upper.includes('PATENTE DI GUIDA'))                                    return 'PATEN';
  if (upper.includes('CARTA DI IDENTITA') || upper.includes('IDENTITY CARD')) return 'IDENT';
  if (upper.includes('PASSAPORTO') || upper.includes('PASSPORT'))            return 'PASOR';
  return null;
}

// ─── Estrattore Patente di Guida (formato EU) ─────────────────────────────────
//
// Campi standard EU sulla patente:
//   1. Cognome   2. Nome   3. Data e luogo nascita
//   4a. Data rilascio   4b. Data scadenza   4c. Autorità
//   5. Numero patente
//
// I regex sono volutamente tolleranti agli errori OCR osservati sui specimen
// PRADO italiani:
//   - Il punto dopo il numero campo (`1.`) può diventare virgola `1,` o
//     mancare del tutto (`1 BIANCHI`). Pattern: `1[.,]?\s+`
//   - I campi possono stare sulla stessa riga di Tesseract (no `^...$/m`).
//     Per fermare il match al campo successivo uso lookahead `(?=\s+\b2[.,]?)`.
//   - I separatori data possono essere `/`, `.` o `-` (specimen 254658 ha
//     "25/12/1965ROMA" senza spazio dopo, gestito da regex \d{2,4}\b).
//   - Cognomi/nomi italiani possono includere apostrofi e accenti
//     (es. "DELL'AGNELLO", "BÒ"): ammessi in [A-ZÀ-Ý'\s-].

const PATENTE_RE = {
  cognome:    /\b1[.,]?\s+([A-ZÀ-Ý][A-ZÀ-Ý'\s-]*?)(?=\s+\b2[.,]?\s|\s*$|\n)/m,
  nome:       /\b2[.,]?\s+([A-ZÀ-Ý][A-ZÀ-Ý'\s-]*?)(?=\s+\b3[.,]?\s|\s*$|\n)/m,
  campo3:     /\b3[.,]?\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s*([A-ZÀ-Ý][A-ZÀ-Ý\s'-]+?)\s*(?:\(([A-Z]{2})\))?(?=\s+\b4|\s*$|\n)/m,
  numero:     /\b5[.,]?\s+([A-Z0-9]{6,12})/,
};

function extractPatente(text) {
  const warnings = [];

  // Campo 1 — Cognome
  const cognome = extract(text, PATENTE_RE.cognome);

  // Campo 2 — Nome
  const nome = extract(text, PATENTE_RE.nome);

  // Campo 3 — Data nascita + Luogo (PV)
  const campo3 = text.match(PATENTE_RE.campo3);
  const dataNascita      = campo3 ? expandYear(campo3[1]) : null;
  const luogoNascita     = campo3 ? campo3[2].trim()      : null;
  const provinciaNascita = campo3 ? (campo3[3] || null)   : null;

  // Campo 5 — Numero patente
  const numeroDocumento = extract(text, PATENTE_RE.numero);

  const data = {
    cognome,
    nome,
    sesso:             null,   // Non presente sulla patente fronte
    dataNascita,
    luogoNascita,
    provinciaNascita,
    statoNascita:      null,   // Non estraibile dalla patente
    cittadinanza:      null,   // Non estraibile dalla patente
    tipoDocumento:     'PATEN',
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

  if (docType === 'PATEN') return extractPatente(rawText);

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
