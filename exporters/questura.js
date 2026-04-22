'use strict';

// Genera il file fixed-width per il portale alloggiati Web (Questura/Turismo5).
//
// Formato record (175 caratteri per riga):
//   pos  1-2  : tipo alloggiato      16/17/18/19/20  ( 2)
//   pos  3-12 : data arrivo          DD/MM/YYYY       (10)
//   pos 13-14 : tipo ospite          01=IT 03=estero  ( 2)
//   pos 15-64 : cognome                               (50)
//   pos 65-94 : nome                                  (30)
//   pos 95    : sesso                M/F              ( 1)
//   pos 96-105: data nascita         DD/MM/YYYY       (10)
//   pos106-114: comune nascita ISTAT                  ( 9)
//   pos115-123: stato nascita ISTAT                   ( 9)
//   pos124-132: cittadinanza ISTAT                    ( 9)
//   pos133-137: tipo documento       codice portale   ( 5)
//   pos138-157: numero documento                      (20)
//   pos158-166: comune rilascio ISTAT                 ( 9)
//   pos167-175: stato rilascio ISTAT                  ( 9)
//
// tipoDocumento: usa direttamente il codice portale (IDENT, PASOR, PATEN …)
// tipoAlloggiato per guest: 16=singolo, 17=capoFamiglia, 18=capoGruppo,
//                            19=familiare, 20=membroGruppo

function pad(value, length) {
  return String(value || '').padEnd(length, ' ').substring(0, length);
}

// Converte YYYY-MM-DD (input HTML date) o DD/MM/YYYY (OCR) → DD/MM/YYYY
function toItDate(dateStr) {
  if (!dateStr) return '          ';
  if (dateStr.includes('/')) return pad(dateStr, 10);
  const parts = dateStr.split('-');
  if (parts.length !== 3) return '          ';
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// 01 = italiano, 03 = estero (semplificato; TODO: 02 = UE)
function tipoOspite(cittadinanza) {
  if (!cittadinanza) return '01';
  return cittadinanza.toUpperCase() === 'ITALIA' ? '01' : '03';
}

function buildLookups(comuni, stati) {
  const BLANK9 = '         ';
  const cMap = new Map(comuni.map(c => [c.nome.toUpperCase(), c.codice]));
  const sMap = new Map(stati.map(s => [s.nome.toUpperCase(), s.codice]));
  return {
    comune: (n) => (n && cMap.get(n.toUpperCase())) || BLANK9,
    stato:  (n) => (n && sMap.get(n.toUpperCase()))  || BLANK9,
  };
}

function formatRecord(g, lookup) {
  return [
    g.tipoAlloggiato || '16',           //  2: tipo alloggiato
    toItDate(g.dataArrivo),             // 10: data arrivo
    tipoOspite(g.cittadinanza),         //  2: tipo ospite
    pad(g.cognome, 50),                 // 50: cognome
    pad(g.nome, 30),                    // 30: nome
    (g.sesso || ' ').charAt(0),         //  1: sesso
    toItDate(g.dataNascita),            // 10: data nascita
    lookup.comune(g.luogoNascita),      //  9: comune nascita
    lookup.stato(g.statoNascita),       //  9: stato nascita
    lookup.stato(g.cittadinanza),       //  9: cittadinanza
    pad(g.tipoDocumento || '', 5),      //  5: tipo documento (codice portale)
    pad(g.numeroDocumento, 20),         // 20: numero documento
    lookup.comune(g.luogoRilascio),     //  9: comune rilascio
    lookup.stato(g.statoRilascio),      //  9: stato rilascio
  ].join('');
}

function generateTxt(guests, comuni, stati) {
  const lookup = buildLookups(comuni, stati);
  return guests.map(g => formatRecord(g, lookup)).join('\r\n') + '\r\n';
}

module.exports = { generateTxt };
