'use strict';

const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const loadJson5 = require('../../core/loadJson5');
const { process: processDocument } = require('./processors');
const { generateTxt }              = require('./exporters/questura');

let pluginConfig        = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const pluginDescription = loadJson5(path.join(__dirname, 'pluginDescription.json5'));
const pluginName        = path.basename(__dirname);

let myPluginSys = null;

// In-memory storage: nessun file scritto su disco (privacy)
const upload       = multer({ storage: multer.memoryStorage() });
const multerSingle = upload.single('document');

// ─── ISTAT data ───────────────────────────────────────────────────────────────
// comuni.json e paesi.json devono seguire il formato:
//   comuni: [{ "nome": "ROMA", "provincia": "RM", "codice": "058091000" }, ...]
//   paesi:  [{ "nome": "ITALIA", "codice": "100000100" }, ...]

function loadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

const comuni = loadJsonFile(path.join(__dirname, 'data/comuni.json'));
const paesi  = loadJsonFile(path.join(__dirname, 'data/paesi.json'));

// ─── Lifecycle ───────────────────────────────────────────────────────────────

async function loadPlugin(pluginSys, pathPluginFolder) {
  myPluginSys  = pluginSys;
  pluginConfig = loadJson5(path.join(pathPluginFolder, 'pluginConfig.json5'));
}

async function installPlugin(pluginSys, pathPluginFolder) {
  // Il plugin non persiste dati: nessuna installazione richiesta
}

async function uninstallPlugin(pluginSys, pathPluginFolder) {
  // Nessuna risorsa da rimuovere
}

async function upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {
  // Nessuna migrazione dati richiesta
}

// ─── Routes ──────────────────────────────────────────────────────────────────

function getRouteArray() {
  return [
    // OCR: riceve immagine documento, restituisce dati estratti
    {
      method: 'POST',
      path: '/scanDocument',
      handler: async (ctx) => {
        await multerSingle(ctx, async () => {});

        const file = ctx.request.file;
        if (!file) {
          ctx.status = 400;
          ctx.body   = { error: 'Nessun file ricevuto. Campo atteso: "document" (multipart/form-data).' };
          return;
        }

        try {
          const result = await processDocument(file.buffer);
          ctx.status = 200;
          ctx.body   = result;
        } catch (err) {
          ctx.status = 500;
          ctx.body   = { error: err.message };
        }
      },
    },

    // Autocomplete comuni italiani
    {
      method: 'GET',
      path: '/comuni',
      handler: async (ctx) => {
        const q = (ctx.query.q || '').toUpperCase().trim();
        if (q.length < 2) { ctx.body = []; return; }
        ctx.body = comuni
          .filter(c => c.nome.toUpperCase().startsWith(q))
          .slice(0, 20);
      },
    },

    // Autocomplete paesi esteri
    {
      method: 'GET',
      path: '/paesi',
      handler: async (ctx) => {
        const q = (ctx.query.q || '').toUpperCase().trim();
        if (q.length < 2) { ctx.body = []; return; }
        ctx.body = paesi
          .filter(p => p.nome.toUpperCase().startsWith(q))
          .slice(0, 20);
      },
    },

    // Genera file .txt per portale alloggiati (download)
    {
      method: 'POST',
      path: '/exportTxt',
      handler: async (ctx) => {
        const body = ctx.request.body || {};
        const guests = body.guests;

        if (!Array.isArray(guests) || guests.length === 0) {
          ctx.status = 400;
          ctx.body   = { error: 'Nessun ospite da esportare.' };
          return;
        }

        try {
          const txt = generateTxt(guests, comuni, paesi);
          ctx.set('Content-Type', 'text/plain; charset=utf-8');
          ctx.set('Content-Disposition', 'attachment; filename="alloggiati.txt"');
          ctx.body = txt;
        } catch (err) {
          ctx.status = 500;
          ctx.body   = { error: err.message };
        }
      },
    },
  ];
}

// ─── Hook, middleware e condivisione (non utilizzati in questa fase) ──────────

function getHooksPage() {
  return new Map();
}

function getMiddlewareToAdd() {
  return [];
}

function getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
  return null;
}

function setSharedObject(fromPlugin, sharedObject) {}

function getObjectToShareToWebPages() {
  return null;
}

function getGlobalFunctionsForTemplates() {
  return null;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  loadPlugin,
  installPlugin,
  uninstallPlugin,
  upgradePlugin,
  getRouteArray,
  getHooksPage,
  getMiddlewareToAdd,
  getObjectToShareToOthersPlugin,
  setSharedObject,
  getObjectToShareToWebPages,
  getGlobalFunctionsForTemplates,
  pluginName,
  pluginConfig,
};
