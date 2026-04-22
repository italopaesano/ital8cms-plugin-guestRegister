'use strict';

// Genera il file fixed-width per il portale alloggiati Web (Questura/Turismo5).
//
// Formato record tipo "16" (persona fisica alloggiata) — 175 caratteri:
//   pos  1-2  : tipo record         "16"
//   pos  3-12 : data arrivo         DD/MM/YYYY  (10)
//   pos 13-14 : tipo ospite         01/02/03    ( 2)
//   pos 15-64 : cognome                         (50)
//   pos 65-94 : nome                            (30)
//   pos 95    : sesso               M/F         ( 1)
//   pos 96-105: data nascita        DD/MM/YYYY  (10)
//   pos106-114: comune nascita ISTAT            ( 9)
//   pos115-123: stato nascita ISTAT             ( 9)
//   pos124-132: cittadinanza ISTAT              ( 9)
//   pos133-137: tipo documento                  ( 5)
//   pos138-157: numero documento                (20)
//   pos158-166: comune rilascio ISTAT           ( 9)
//   pos167-175: stato rilascio ISTAT            ( 9)
//
// Nota: il file non include il record di testata (tipo "18") che viene
// generato da Turismo5 / portale alloggiati in base ai dati della struttura.

const DOC_TYPE_MAP = {
  IDE: 'IDENT',
  PAS: 'PASSO',
  PAT: 'PATEN',
};

function pad(value, length) {
  return String(value || '').padEnd(length, ' ').substring(0, length);
}

// Converte YYYY-MM-DD (HTML date input) o DD/MM/YYYY (OCR) → DD/MM/YYYY
function toItDate(dateStr) {
  if (!dateStr) return '          ';
  if (dateStr.includes('/')) return pad(dateStr, 10);
  const parts = dateStr.split('-');
  if (parts.length !== 3) return '          ';
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// '01' italiano, '02' UE, '03' extra-UE
// V1: semplificato — tutto ciò che non è ITALIA → '03'
function tipoOspite(cittadinanza) {
  if (!cittadinanza) return '01';
  return cittadinanza.toUpperCase() === 'ITALIA' ? '01' : '03';
}

function buildLookups(comuni, paesi) {
  const BLANK9   = '         ';
  const cMap = new Map(comuni.map(c => [c.nome.toUpperCase(), c.codice]));
  const pMap = new Map(paesi.map(p => [p.nome.toUpperCase(), p.codice]));
  return {
    comune: (n) => (n && cMap.get(n.toUpperCase())) || BLANK9,
    paese:  (n) => (n && pMap.get(n.toUpperCase()))  || BLANK9,
  };
}

function formatRecord(g, lookup) {
  const tipoDoc = DOC_TYPE_MAP[g.tipoDocumento] || '     ';
  return [
    '16',
    toItDate(g.dataArrivo),             // 10
    tipoOspite(g.cittadinanza),          //  2
    pad(g.cognome, 50),                  // 50
    pad(g.nome, 30),                     // 30
    (g.sesso || ' ').charAt(0),          //  1
    toItDate(g.dataNascita),             // 10
    lookup.comune(g.luogoNascita),       //  9
    lookup.paese(g.statoNascita),        //  9
    lookup.paese(g.cittadinanza),        //  9
    pad(tipoDoc, 5),                     //  5
    pad(g.numeroDocumento, 20),          // 20
    lookup.comune(g.luogoRilascio),      //  9
    lookup.paese(g.statoRilascio),       //  9
  ].join('');
}

function generateTxt(guests, comuni, paesi) {
  const lookup = buildLookups(comuni, paesi);
  return guests.map(g => formatRecord(g, lookup)).join('\r\n') + '\r\n';
}

module.exports = { generateTxt };
