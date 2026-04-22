'use strict';

// Converte i CSV ufficiali del portale alloggiati (data/alloggiatiweb/)
// nei file JSON usati dal plugin a runtime (data/).
//
// Uso: node scripts/buildData.js

const fs   = require('fs');
const path = require('path');

const CSV_DIR  = path.join(__dirname, '..', 'data', 'alloggiatiweb');
const JSON_DIR = path.join(__dirname, '..', 'data');

// ── Parser CSV ────────────────────────────────────────────────────────────────
// Tutti i file del portale usano il formato semplice (nessun campo quotato,
// nessuna virgola nei valori). Separatore: virgola. Line endings: CRLF.

function readCSV(filename) {
  const content = fs.readFileSync(path.join(CSV_DIR, filename), 'utf8');
  return content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .slice(1); // salta intestazione
}

// ── comuni.csv  →  data/comuni.json ──────────────────────────────────────────
// Formato: Codice,Descrizione,Provincia,DataFineVal

function buildComuni() {
  const rows = readCSV('comuni.csv');
  const result = [];

  for (const line of rows) {
    const [codice, nome, provincia, dataFineVal] = line.split(',');
    if (!codice || !nome) continue;
    result.push({
      codice:   codice.trim(),
      nome:     nome.trim(),
      provincia: (provincia || '').trim(),
      cessato:  !!(dataFineVal && dataFineVal.trim()),
    });
  }

  write('comuni.json', result);

  const attivi   = result.filter(r => !r.cessato).length;
  const cessati  = result.filter(r =>  r.cessato).length;
  log('comuni.json', result.length, `${attivi} attivi, ${cessati} cessati`);
}

// ── stati.csv  →  data/stati.json ────────────────────────────────────────────
// Formato: Codice,Descrizione,Provincia,DataFineVal
// La colonna Provincia è sempre "ES" (estero): viene scartata.

function buildStati() {
  const rows = readCSV('stati.csv');
  const result = [];

  for (const line of rows) {
    const parts      = line.split(',');
    const codice     = parts[0].trim();
    const nome       = parts[1].trim();
    const dataFineVal = parts[3] ? parts[3].trim() : '';
    if (!codice || !nome) continue;
    result.push({
      codice,
      nome,
      cessato: !!dataFineVal,
    });
  }

  write('stati.json', result);

  const attivi  = result.filter(r => !r.cessato).length;
  const cessati = result.filter(r =>  r.cessato).length;
  log('stati.json', result.length, `${attivi} attivi, ${cessati} cessati`);
}

// ── documenti.csv  →  data/documenti.json ────────────────────────────────────
// Formato: Codice,Descrizione

function buildDocumenti() {
  const rows = readCSV('documenti.csv');
  const result = [];

  for (const line of rows) {
    const idx = line.indexOf(',');
    if (idx === -1) continue;
    result.push({
      codice:     line.substring(0, idx).trim(),
      descrizione: line.substring(idx + 1).trim(),
    });
  }

  write('documenti.json', result);
  log('documenti.json', result.length);
}

// ── tipo_alloggiato.csv  →  data/tipo_alloggiato.json ────────────────────────
// Formato: Codice,Descrizione

function buildTipoAlloggiato() {
  const rows = readCSV('tipo_alloggiato.csv');
  const result = [];

  for (const line of rows) {
    const idx = line.indexOf(',');
    if (idx === -1) continue;
    result.push({
      codice:     line.substring(0, idx).trim(),
      descrizione: line.substring(idx + 1).trim(),
    });
  }

  write('tipo_alloggiato.json', result);
  log('tipo_alloggiato.json', result.length);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function write(filename, data) {
  fs.writeFileSync(
    path.join(JSON_DIR, filename),
    JSON.stringify(data),
  );
}

function log(filename, total, extra) {
  const msg = extra ? `${total} voci (${extra})` : `${total} voci`;
  console.log(`  ✓  ${filename.padEnd(22)} ${msg}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('\nGenerazione file JSON dal portale alloggiati...\n');
buildComuni();
buildStati();
buildDocumenti();
buildTipoAlloggiato();
console.log('\nFatto. File salvati in data/\n');
