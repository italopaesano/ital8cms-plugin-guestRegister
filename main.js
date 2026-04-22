'use strict';

const path    = require('path');
const multer  = require('multer');
const loadJson5 = require('../../core/loadJson5');
const { process: processDocument } = require('./processors');

let pluginConfig        = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const pluginDescription = loadJson5(path.join(__dirname, 'pluginDescription.json5'));
const pluginName        = path.basename(__dirname);

let myPluginSys = null;

// In-memory storage: nessun file scritto su disco (privacy)
const upload       = multer({ storage: multer.memoryStorage() });
const multerSingle = upload.single('document');

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
