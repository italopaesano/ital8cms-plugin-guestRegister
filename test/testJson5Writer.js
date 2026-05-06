'use strict';

// Test text-based di lib/json5Writer.js. Scrive fixture su file temporanei,
// applica setNestedField, confronta l'output con la stringa attesa.
//
// Uso:  node test/testJson5Writer.js
//
// Nessuna dipendenza esterna (no jest/mocha). Output: una riga per test.
// Exit code 0 se tutti pass, 1 se almeno uno fallisce.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { setNestedField } = require('../lib/json5Writer');

let pass = 0, fail = 0;

function runTest(name, input, parentKey, fieldName, value, expected) {
  const tmp = path.join(os.tmpdir(), `json5writer-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json5`);
  fs.writeFileSync(tmp, input);
  setNestedField(tmp, parentKey, fieldName, value);
  const got = fs.readFileSync(tmp, 'utf8');
  fs.unlinkSync(tmp);

  if (got === expected) {
    console.log(`  ok    ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log('  ── expected ──');
    console.log(expected);
    console.log('  ── got ──');
    console.log(got);
    console.log('  ──');
    fail++;
  }
}

console.log('lib/json5Writer.js — setNestedField()');

// ─── Update di field esistente ───────────────────────────────────────────────

runTest(
  'update field esistente con quoted keys',
  '{\n  "custom": {\n    "hostRoleId": 100\n  }\n}\n',
  'custom', 'hostRoleId', 200,
  '{\n  "custom": {\n    "hostRoleId": 200\n  }\n}\n',
);

runTest(
  'update field esistente con unquoted keys (JSON5)',
  '{\n  custom: {\n    hostRoleId: 100,\n  },\n}\n',
  'custom', 'hostRoleId', 42,
  '{\n  custom: {\n    hostRoleId: 42,\n  },\n}\n',
);

// ─── Inserimento in blocco non vuoto ─────────────────────────────────────────

runTest(
  'insert in blocco custom con array sibling — preserva tutto',
  '// File header comment\n{\n  "active": 1,\n  "custom": {\n    "documentiComuni": [\n      "IDENT",\n      "PASOR"\n    ]\n  }\n}\n',
  'custom', 'hostRoleId', 100,
  '// File header comment\n{\n  "active": 1,\n  "custom": {\n    "documentiComuni": [\n      "IDENT",\n      "PASOR"\n    ],\n    "hostRoleId": 100\n  }\n}\n',
);

runTest(
  'insert con commenti inline preservati',
  '{\n  "custom": {\n    "active": 1,  // attivo\n    "weight": 100  // priorità\n  }\n}\n',
  'custom', 'hostRoleId', 7,
  '{\n  "custom": {\n    "active": 1,  // attivo\n    "weight": 100,  // priorità\n    "hostRoleId": 7\n  }\n}\n',
);

// ─── Inserimento in blocco vuoto ─────────────────────────────────────────────

runTest(
  'insert in blocco custom vuoto',
  '{\n  "custom": {\n  }\n}\n',
  'custom', 'hostRoleId', 100,
  '{\n  "custom": {\n    "hostRoleId": 100\n  }\n}\n',
);

// ─── Tipi di valore ──────────────────────────────────────────────────────────

runTest(
  'valore stringa quotato correttamente',
  '{\n  "custom": {\n    "active": 1\n  }\n}\n',
  'custom', 'name', 'host with "quote" and \\backslash',
  '{\n  "custom": {\n    "active": 1,\n    "name": "host with \\"quote\\" and \\\\backslash"\n  }\n}\n',
);

runTest(
  'valore boolean',
  '{\n  "custom": {\n    "active": 1\n  }\n}\n',
  'custom', 'enabled', true,
  '{\n  "custom": {\n    "active": 1,\n    "enabled": true\n  }\n}\n',
);

// ─── Edge cases ──────────────────────────────────────────────────────────────

runTest(
  'preserva commenti JSON5 multi-riga e header',
  '// This file follows the JSON5 standard\n// Modificarlo a runtime preserva i commenti.\n{\n  /* Configurazione plugin */\n  "active": 1,\n  "custom": {\n    "weight": 100\n  }\n}\n',
  'custom', 'hostRoleId', 999,
  '// This file follows the JSON5 standard\n// Modificarlo a runtime preserva i commenti.\n{\n  /* Configurazione plugin */\n  "active": 1,\n  "custom": {\n    "weight": 100,\n    "hostRoleId": 999\n  }\n}\n',
);

runTest(
  'parentKey assente → false (file invariato)',
  // Caso "parent block non trovato": setNestedField torna false e il file resta invariato.
  // Il test verifica che il file NON sia stato modificato.
  '{\n  "active": 1\n}\n',
  'custom', 'hostRoleId', 100,
  '{\n  "active": 1\n}\n',
);

// ─── Riepilogo ───────────────────────────────────────────────────────────────

console.log('');
console.log(`Totale: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
