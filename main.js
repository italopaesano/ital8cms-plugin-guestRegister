'use strict';

const fs        = require('fs');
const path      = require('path');
const multer    = require('multer');
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

// ─── Dati portale alloggiati (caricati all'avvio) ────────────────────────────
// Generati da scripts/buildData.js a partire dai CSV ufficiali in
// data/alloggiatiweb/. Rieseguire lo script se i CSV vengono aggiornati.

function loadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

const comuni          = loadJsonFile(path.join(__dirname, 'data/comuni.json'));
const stati           = loadJsonFile(path.join(__dirname, 'data/stati.json'));
const documenti       = loadJsonFile(path.join(__dirname, 'data/documenti.json'));
const tipoAlloggiato  = loadJsonFile(path.join(__dirname, 'data/tipo_alloggiato.json'));

// ─── Lifecycle ───────────────────────────────────────────────────────────────

async function loadPlugin(pluginSys, pathPluginFolder) {
  myPluginSys  = pluginSys;
  pluginConfig = loadJson5(path.join(pathPluginFolder, 'pluginConfig.json5'));
}

async function installPlugin(pluginSys, pathPluginFolder) {}
async function uninstallPlugin(pluginSys, pathPluginFolder) {}
async function upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {}

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
          ctx.status = 200;
          ctx.body   = await processDocument(file.buffer);
        } catch (err) {
          ctx.status = 500;
          ctx.body   = { error: err.message };
        }
      },
    },

    // Autocomplete comuni italiani (attivi + cessati)
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

    // Autocomplete stati (attivi + cessati)
    {
      method: 'GET',
      path: '/stati',
      handler: async (ctx) => {
        const q = (ctx.query.q || '').toUpperCase().trim();
        if (q.length < 2) { ctx.body = []; return; }
        ctx.body = stati
          .filter(s => s.nome.toUpperCase().startsWith(q))
          .slice(0, 20);
      },
    },

    // Lista completa tipi documento (per dropdown "Altro tipo…")
    {
      method: 'GET',
      path: '/documenti',
      handler: async (ctx) => {
        ctx.body = documenti;
      },
    },

    // Genera file .txt per portale alloggiati (download)
    {
      method: 'POST',
      path: '/exportTxt',
      handler: async (ctx) => {
        const { guests } = ctx.request.body || {};

        if (!Array.isArray(guests) || guests.length === 0) {
          ctx.status = 400;
          ctx.body   = { error: 'Nessun ospite da esportare.' };
          return;
        }

        try {
          const txt = generateTxt(guests, comuni, stati);
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

// ─── Hook, middleware e condivisione ─────────────────────────────────────────

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

// Dati esposti alle pagine EJS tramite passData.plugin
function getObjectToShareToWebPages() {
  const codiciComuni = (pluginConfig.custom && pluginConfig.custom.documentiComuni) || [];
  return {
    // Tipi documento comuni con codice + descrizione (per dropdown EJS)
    documentiComuni: codiciComuni.map(codice => {
      const found = documenti.find(d => d.codice === codice);
      return found || { codice, descrizione: codice };
    }),
    // Lista completa per confronto lato server (es. validazione futura)
    tipoAlloggiato,
  };
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
