'use strict';

const { parse: parseMrz } = require('mrz');

// Formati MRZ supportati (righe × caratteri per riga)
const MRZ_FORMATS = [
  { lines: 3, length: 30 },  // TD1  — Carta d'Identità italiana
  { lines: 2, length: 36 },  // TD2  — documenti istituzionali
  { lines: 2, length: 44 },  // TD3  — Passaporto
];

const MRZ_CHAR_RE = /^[A-Z0-9<]+$/;

// ─── Ricerca delle righe MRZ nel testo grezzo OCR ────────────────────────────

function findMrzLines(rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim().replace(/\s/g, '').toUpperCase())
    .filter(l => l.length >= 28 && MRZ_CHAR_RE.test(l));

  for (const { lines: count, length } of MRZ_FORMATS) {
    for (let i = 0; i <= lines.length - count; i++) {
      const slice = lines.slice(i, i + count);
      if (slice.every(l => l.length === length)) {
        return slice;
      }
    }
  }
  return null;
}

// ─── Normalizzazione valori MRZ ───────────────────────────────────────────────

// YYMMDD → DD/MM/YYYY
function mrzDateToDisplay(yymmdd) {
  if (!yymmdd || yymmdd.length !== 6) return null;
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);
  const currentYY = new Date().getFullYear() % 100;
  const fullYear = yy > currentYY
    ? `19${String(yy).padStart(2, '0')}`
    : `20${String(yy).padStart(2, '0')}`;
  return `${dd}/${mm}/${fullYear}`;
}

// Codice MRZ documento → codice a 3 lettere portale alloggiati
function mapDocumentType(raw) {
  if (!raw) return null;
  const t = raw.replace(/</g, '').toUpperCase();
  if (t.startsWith('P')) return 'PAS';
  if (t.startsWith('I')) return 'IDE';
  if (t.startsWith('D')) return 'PAT';
  return t.substring(0, 3) || null;
}

// Rimuove i filler '<' e normalizza gli spazi
function cleanMrzString(val) {
  return val ? val.replace(/</g, ' ').trim().replace(/\s+/g, ' ') : null;
}

// 'male'/'female' o 'M'/'F' → 'M'/'F'
function mapSex(val) {
  if (!val) return null;
  const v = val.toLowerCase();
  if (v === 'male'   || v === 'm') return 'M';
  if (v === 'female' || v === 'f') return 'F';
  return null;
}

// ─── Parsing principale ───────────────────────────────────────────────────────

function extractMrzData(mrzLines) {
  let parsed;
  try {
    parsed = parseMrz(mrzLines, { autocorrect: true });
  } catch {
    return null;
  }
  if (!parsed || !parsed.valid) return null;

  const f = parsed.fields;

  const data = {
    cognome:           f.lastName       ? cleanMrzString(f.lastName.value)        : null,
    nome:              f.firstName      ? cleanMrzString(f.firstName.value)        : null,
    sesso:             f.sex            ? mapSex(f.sex.value)                      : null,
    dataNascita:       f.birthDate      ? mrzDateToDisplay(f.birthDate.value)      : null,
    cittadinanza:      f.nationality    ? f.nationality.value                      : null,
    tipoDocumento:     f.documentType   ? mapDocumentType(f.documentType.value)    : null,
    numeroDocumento:   f.documentNumber ? f.documentNumber.value.replace(/</g, '') : null,
    // Campi non codificati nella MRZ → da inserire manualmente
    luogoNascita:      null,
    provinciaNascita:  null,
    statoNascita:      null,
    luogoRilascio:     null,
    provinciaRilascio: null,
    statoRilascio:     null,
  };

  const warnings = [
    'luogoNascita: non rilevabile dalla MRZ, inserire manualmente',
    'provinciaNascita: non rilevabile dalla MRZ, inserire manualmente',
    'statoNascita: non rilevabile dalla MRZ, inserire manualmente',
    'luogoRilascio: non rilevabile dalla MRZ, inserire manualmente',
    'provinciaRilascio: non rilevabile dalla MRZ, inserire manualmente',
    'statoRilascio: non rilevabile dalla MRZ, inserire manualmente',
  ];

  return { data, warnings };
}

module.exports = { findMrzLines, extractMrzData };
