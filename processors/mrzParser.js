'use strict';

// mrz@5 è ESM-only: si carica con dynamic import() anche da file CJS
let _parseMrz = null;
async function getParseMrz() {
  if (!_parseMrz) {
    const { parse } = await import('mrz');
    _parseMrz = parse;
  }
  return _parseMrz;
}

// Formati MRZ supportati (righe × caratteri per riga)
const MRZ_FORMATS = [
  { lines: 3, length: 30 },  // TD1  — Carta d'Identità (formato 3 righe)
  { lines: 2, length: 36 },  // TD2  — documenti istituzionali
  { lines: 2, length: 44 },  // TD3  — Passaporto
];

const MRZ_STRICT_RE = /^[A-Z0-9<]+$/;

// ─── Strategy 1: lenient line detection ─────────────────────────────────────
//
// L'OCR multi-lingua su immagini fotografiche tende a scambiare il filler `<`
// con caratteri visivamente simili (`£`, «K», «S», `«`). Questo blocco di
// normalizzazione recupera tali caratteri PRIMA di passare al regex strict,
// così la riga MRZ non viene scartata in fase di detection.
//
// La normalizzazione è euristica e applicata solo al passo di RICERCA delle
// righe MRZ. Per il parse vero (controllo dei check digit) si lavora poi sulla
// riga normalizzata; se i check digit non quadrano si tenta il pass-2 con
// whitelist Tesseract o, in ultima istanza, il loose parse.

const FILLER_CONFUSABLES_RE = /[£«‹]/g;

function normalizeMrzLine(raw) {
  let s = (raw || '').replace(/\s/g, '').toUpperCase();
  // Sostituzione diretta: glifi Latin-1 con tratto verticale, sempre filler
  s = s.replace(FILLER_CONFUSABLES_RE, '<');
  // Run di K/S consecutivi (≥3): tipicamente in coda riga, dove la MRZ è solo
  // filler. La sostituzione è limitata ai run lunghi per evitare di rompere
  // nomi tipo "MUSTERMANN" → "MUSTERMANN<".
  s = s.replace(/K{3,}/g, m => '<'.repeat(m.length));
  s = s.replace(/S{3,}/g, m => '<'.repeat(m.length));
  return s;
}

// Estrae da una singola riga normalizzata una sotto-stringa di lunghezza
// canonica MRZ. Tre casi gestiti:
//   1. La riga è già di lunghezza canonica (±3) e tutta MRZ-alphabet → trim/pad
//   2. La riga è lunga ≥ canonica e i primi N caratteri sono MRZ-alphabet
//      (junk in coda, comune con OCR che incappa in icone/UI dopo la MRZ)
//      → si prende il prefisso lungo N
//   3. Niente di sopra → null (la riga non è MRZ)
//
// In aggiunta, la sotto-stringa estratta deve contenere almeno 3 caratteri
// `<`. Altrimenti righe come "BUNDESREPUBLIKDEUTSCHLAND..." (pure A-Z)
// passerebbero come MRZ candidate. Il filler `<` è un marker univoco delle
// MRZ ICAO Doc 9303: ogni formato (TD1/TD2/TD3) ne contiene almeno 3.
function extractCanonicalMrz(line, target) {
  let candidate = null;
  if (Math.abs(line.length - target) <= 3 && MRZ_STRICT_RE.test(line)) {
    candidate = normalizeLength(line, target);
  } else if (line.length >= target) {
    const head = line.substring(0, target);
    if (MRZ_STRICT_RE.test(head)) candidate = head;
  }
  if (!candidate) return null;
  const fillerCount = (candidate.match(/</g) || []).length;
  if (fillerCount < 3) return null;
  return candidate;
}

function findMrzLines(rawText) {
  const lines = (rawText || '').split('\n')
    .map(normalizeMrzLine)
    .filter(l => l.length >= 28);

  for (const { lines: count, length } of MRZ_FORMATS) {
    for (let i = 0; i <= lines.length - count; i++) {
      const slice = lines.slice(i, i + count);
      const canon = slice.map(l => extractCanonicalMrz(l, length));
      if (canon.every(Boolean)) return canon;
    }
  }
  return null;
}

function normalizeLength(line, target) {
  if (line.length === target) return line;
  if (line.length > target) {
    // Trim dalla fine: la coda di una riga MRZ è praticamente sempre filler
    // `<`. Per i nostri test (TD3 letto a 46 char invece di 44) tronchiamo
    // gli ultimi 2 caratteri di filler.
    return line.substring(0, target);
  }
  // Riga corta: pad con `<` (filler) in fondo per arrivare alla lunghezza
  // canonica. Se mancano caratteri "veri" il check digit fallirà comunque,
  // e si scenderà al loose parse.
  return line.padEnd(target, '<');
}

// ─── Normalizzazione valori MRZ ───────────────────────────────────────────────

// YYMMDD → DD/MM/YYYY
function mrzDateToDisplay(yymmdd) {
  if (!yymmdd || yymmdd.length !== 6) return null;
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  if (Number.isNaN(yy)) return null;
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);
  const currentYY = new Date().getFullYear() % 100;
  const fullYear = yy > currentYY
    ? `19${String(yy).padStart(2, '0')}`
    : `20${String(yy).padStart(2, '0')}`;
  return `${dd}/${mm}/${fullYear}`;
}

// Codice MRZ documento → codice portale alloggiati (5 caratteri)
function mapDocumentType(raw) {
  if (!raw) return null;
  const t = raw.replace(/</g, '').toUpperCase();
  if (t.startsWith('P')) return 'PASOR';  // Passaporto ordinario
  if (t.startsWith('I')) return 'IDENT';  // Carta d'identità
  if (t.startsWith('D')) return 'PATEN';  // Patente (driving licence)
  return t.substring(0, 5) || null;       // Altri tipi: primi 5 caratteri
}

// Rimuove i filler '<' e normalizza gli spazi
function cleanMrzString(val) {
  return val ? val.replace(/</g, ' ').trim().replace(/\s+/g, ' ') : null;
}

// 'male'/'female' o 'M'/'F' → 'M'/'F'
function mapSex(val) {
  if (!val) return null;
  const v = String(val).toLowerCase();
  if (v === 'male'   || v === 'm') return 'M';
  if (v === 'female' || v === 'f') return 'F';
  return null;
}

// ─── Strategy 6: loose parse fallback (no check digit) ──────────────────────
//
// Quando l'MRZ è strutturalmente riconoscibile (numero righe + lunghezze
// canoniche ok) ma i check digit non quadrano per residui errori OCR, leggiamo
// comunque i campi posizionali e ritorniamo dati con un warning esplicito che
// invita l'operatore a verificarli a mano.
//
// Layout posizionale (ICAO Doc 9303, parte 4 e 5):
//   TD1 (CI europea, 3×30):
//     line1[0..1]   tipo doc        line1[2..4]   stato emittente
//     line1[5..13]  numero documento line1[14]    check digit
//     line1[15..29] dato opzionale 1
//     line2[0..5]   data nascita YYMMDD  line2[6] check
//     line2[7]      sesso             line2[8..13] scadenza YYMMDD  line2[14] check
//     line2[15..17] nazionalità       line2[18..28] dato opzionale 2  line2[29] check composito
//     line3         cognome<<nome (filler `<`)
//   TD2 (2×36) e TD3 (2×44):
//     line1: tipo(2) + stato(3) + cognome<<nome (resto)
//     line2: numero(9) + check(1) + nat(3) + dob(6) + check(1) + sesso(1)
//             + scadenza(6) + check(1) + opzionale + check composito
//
// Per ora estraiamo i campi necessari al portale alloggiati: cognome, nome,
// sesso, dataNascita, cittadinanza, tipoDocumento, numeroDocumento.

function looseSex(c) {
  if (c === 'M') return 'male';
  if (c === 'F') return 'female';
  return null;
}

function splitNames(namesPart) {
  // namesPart parte dal "primary identifier": SURNAME<<GIVEN<NAMES<<<...
  const parts = namesPart.split(/<<+/);
  const surname    = (parts[0] || '').replace(/</g, ' ').trim();
  const firstNames = parts.slice(1).join(' ').replace(/</g, ' ').trim();
  return { surname, firstNames };
}

// Coerente con la convenzione del package mrz: il campo è omesso (undefined)
// se non estraibile, oppure { value: '...' } se presente. Così il consumer
// principale (extractMrzData) può usare il pattern `f.X ? f.X.value : null`
// senza dover distinguere tra { value: null } e undefined.
function looseField(value) {
  return value ? { value } : undefined;
}

function parseTd3Loose([line1, line2]) {
  const { surname, firstNames } = splitNames(line1.substring(5));
  return {
    valid: false,
    fields: {
      lastName:       looseField(surname),
      firstName:      looseField(firstNames),
      documentType:   looseField(line1.substring(0, 2).replace(/</g, '')),
      issuingState:   looseField(line1.substring(2, 5).replace(/</g, '')),
      documentNumber: looseField(line2.substring(0, 9).replace(/</g, '')),
      nationality:    looseField(line2.substring(10, 13).replace(/</g, '')),
      birthDate:      looseField(line2.substring(13, 19)),
      sex:            looseField(looseSex(line2.substring(20, 21))),
    },
  };
}

function parseTd2Loose([line1, line2]) {
  const { surname, firstNames } = splitNames(line1.substring(5));
  return {
    valid: false,
    fields: {
      lastName:       looseField(surname),
      firstName:      looseField(firstNames),
      documentType:   looseField(line1.substring(0, 2).replace(/</g, '')),
      issuingState:   looseField(line1.substring(2, 5).replace(/</g, '')),
      documentNumber: looseField(line2.substring(0, 9).replace(/</g, '')),
      nationality:    looseField(line2.substring(10, 13).replace(/</g, '')),
      birthDate:      looseField(line2.substring(13, 19)),
      sex:            looseField(looseSex(line2.substring(20, 21))),
    },
  };
}

function parseTd1Loose([line1, line2, line3]) {
  const { surname, firstNames } = splitNames(line3);
  return {
    valid: false,
    fields: {
      lastName:       looseField(surname),
      firstName:      looseField(firstNames),
      documentType:   looseField(line1.substring(0, 2).replace(/</g, '')),
      issuingState:   looseField(line1.substring(2, 5).replace(/</g, '')),
      documentNumber: looseField(line1.substring(5, 14).replace(/</g, '')),
      nationality:    looseField(line2.substring(15, 18).replace(/</g, '')),
      birthDate:      looseField(line2.substring(0, 6)),
      sex:            looseField(looseSex(line2.substring(7, 8))),
    },
  };
}

function looseMrzParse(lines) {
  if (lines.length === 2 && lines[0].length === 44 && lines[1].length === 44) return parseTd3Loose(lines);
  if (lines.length === 2 && lines[0].length === 36 && lines[1].length === 36) return parseTd2Loose(lines);
  if (lines.length === 3 && lines.every(l => l.length === 30))                return parseTd1Loose(lines);
  return null;
}

// ─── Strategy 4: position-aware repair ──────────────────────────────────────
//
// Tesseract sull'alfabeto MRZ (anche con whitelist `<0123456789A-Z`) confonde
// caratteri visivamente simili (`O`/`0`, `I`/`1`/`L`/`T`, `Z`/`2`, `S`/`5`,
// `G`/`6`, `B`/`8`). Senza contesto la confusione è irrisolvibile.
//
// Con il layout posizionale ICAO Doc 9303 invece sì: ogni posizione di una
// MRZ ha un tipo determinato (digit / alpha / alphanumeric / filler). Se la
// posizione X di TD3 line 2 deve essere un digit (es. check digit della data
// di nascita) e Tesseract ha messo `S`, sostituiamo con `5` con alta
// confidenza. Lo stesso al contrario nelle posizioni alfabetiche.
//
// La repair viene applicata SOLO a linee di lunghezza canonica esatta
// (no tolerance ±3): se la lunghezza è sbagliata, le mask si disallineano e
// la repair guasta più di quanto sistema. La caduta a loose parse continua a
// gestire quei casi senza repair.
//
// Posizioni 'X' (alphanumeric, es. numero documento) NON vengono toccate:
// sono ambigue per definizione.

// Mask per i 3 formati MRZ. Convenzioni:
//   'A' = alpha + `<`
//   'N' = numeric + `<`
//   'X' = alphanumeric + `<` (mai modificato)
const MRZ_MASKS = {
  // TD3 — Passaporto (2 × 44)
  // L1 [0-1] tipo | [2-4] stato | [5-43] nome
  // L2 [0-8] docnum | [9] check | [10-12] nat | [13-18] dob | [19] check
  //    | [20] sesso | [21-26] expiry | [27] check | [28-41] optional
  //    | [42] check | [43] composite check
  TD3: {
    line1: 'AA' + 'AAA' + 'A'.repeat(39),
    line2: 'X'.repeat(9) + 'N' + 'AAA' + 'N'.repeat(6) + 'N' + 'A'
         + 'N'.repeat(6) + 'N' + 'X'.repeat(14) + 'N' + 'N',
  },
  // TD2 — Documento istituzionale (2 × 36)
  TD2: {
    line1: 'AA' + 'AAA' + 'A'.repeat(31),
    line2: 'X'.repeat(9) + 'N' + 'AAA' + 'N'.repeat(6) + 'N' + 'A'
         + 'N'.repeat(6) + 'N' + 'X'.repeat(7) + 'N',
  },
  // TD1 — Carta d'identità (3 × 30)
  // L1 [0-1] tipo | [2-4] stato | [5-13] docnum | [14] check | [15-29] optional1
  // L2 [0-5] dob | [6] check | [7] sesso | [8-13] expiry | [14] check
  //    | [15-17] nat | [18-28] optional2 | [29] composite check
  // L3 [0-29] cognome<<nome
  TD1: {
    line1: 'AA' + 'AAA' + 'X'.repeat(9) + 'N' + 'X'.repeat(15),
    line2: 'N'.repeat(6) + 'N' + 'A' + 'N'.repeat(6) + 'N' + 'AAA'
         + 'X'.repeat(11) + 'N',
    line3: 'A'.repeat(30),
  },
};

// Sostituzioni alpha→digit nelle posizioni 'N'. Lista volutamente conservativa:
// `A→4` escluso perché può rompere nomi/codici-stato dove `A` è legittimo se
// il mask è disallineato per un caso di lunghezza imprevisto.
const TO_DIGIT = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1', T: '1',
  Z: '2',
  S: '5',
  G: '6',
  B: '8',
};

// Sostituzioni digit→alpha nelle posizioni 'A'. Speculare a TO_DIGIT.
const TO_ALPHA = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
};

function repairLineByMask(line, mask) {
  // Safety: applico la repair solo se la linea è di lunghezza canonica
  // ESATTA. Se è ±1/±3 la mask si disallineerebbe e finiremmo per guastare
  // posizioni successive. Quei casi cadono al loose parse senza repair.
  if (line.length !== mask.length) return line;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const m = mask[i];
    if (c === '<') { out += c; continue; }
    if (m === 'N' && TO_DIGIT[c]) { out += TO_DIGIT[c]; continue; }
    if (m === 'A' && TO_ALPHA[c]) { out += TO_ALPHA[c]; continue; }
    out += c;  // 'X' (alphanum) o carattere già coerente con la posizione
  }
  return out;
}

function repairMrzLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return lines;
  if (lines.length === 2 && lines[0].length === 44 && lines[1].length === 44) {
    return [
      repairLineByMask(lines[0], MRZ_MASKS.TD3.line1),
      repairLineByMask(lines[1], MRZ_MASKS.TD3.line2),
    ];
  }
  if (lines.length === 2 && lines[0].length === 36 && lines[1].length === 36) {
    return [
      repairLineByMask(lines[0], MRZ_MASKS.TD2.line1),
      repairLineByMask(lines[1], MRZ_MASKS.TD2.line2),
    ];
  }
  if (lines.length === 3 && lines.every(l => l.length === 30)) {
    return [
      repairLineByMask(lines[0], MRZ_MASKS.TD1.line1),
      repairLineByMask(lines[1], MRZ_MASKS.TD1.line2),
      repairLineByMask(lines[2], MRZ_MASKS.TD1.line3),
    ];
  }
  // Lunghezza non canonica: la repair sarebbe troppo rischiosa, le linee
  // vanno a loose senza modifiche.
  return lines;
}

// ─── Parsing principale ───────────────────────────────────────────────────────

async function extractMrzData(mrzLines, opts = {}) {
  const { allowLoose = false } = opts;
  const parseMrz = await getParseMrz();
  let parsed;
  try {
    parsed = parseMrz(mrzLines, { autocorrect: true });
  } catch {
    parsed = null;
  }

  let isLoose = false;
  if (!parsed || !parsed.valid) {
    if (!allowLoose) return null;
    parsed = looseMrzParse(mrzLines);
    if (!parsed) return null;
    isLoose = true;
  }

  const f = parsed.fields;
  // Helper: estrae .value solo se l'intero path è valorizzato. Difensivo
  // perché il package mrz, su MRZ parziali, ritorna `{ value: undefined }`
  // invece di omettere il campo, e il loose parse può fare lo stesso. Senza
  // questa guardia .replace/.toLowerCase in coda esplodono.
  const v = key => (f[key] && f[key].value) ? f[key].value : null;

  const data = {
    cognome:           cleanMrzString(v('lastName')),
    nome:              cleanMrzString(v('firstName')),
    sesso:             mapSex(v('sex')),
    dataNascita:       mrzDateToDisplay(v('birthDate')),
    cittadinanza:      v('nationality'),
    tipoDocumento:     mapDocumentType(v('documentType')),
    numeroDocumento:   v('documentNumber') ? v('documentNumber').replace(/</g, '') : null,
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

  if (isLoose) {
    warnings.unshift(
      'MRZ: estrazione parziale senza verifica check digit. Controllare numero documento, data nascita e altri campi prima di salvare.'
    );
  }

  return { data, warnings, loose: isLoose };
}

module.exports = { findMrzLines, extractMrzData, repairMrzLines };
