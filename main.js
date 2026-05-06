'use strict';

const fs        = require('fs');
const path      = require('path');
const koaMulter = require('@koa/multer');
const loadJson5 = require('../../core/loadJson5');
const { setNestedField } = require('./lib/json5Writer');
const { process: processDocument } = require('./processors');
const { setLangs: setOcrLangs, setVariant: setOcrVariant } = require('./processors/tesseract');
const { generateTxt }              = require('./exporters/questura');

// let: pluginConfig viene ricaricato in loadPlugin() dal path ufficiale del core
let pluginConfig        = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const pluginDescription = loadJson5(path.join(__dirname, 'pluginDescription.json5'));

// Nota: il core (pluginSys.js) imposta plugin.pluginName = nome cartella dopo il
// require del modulo, quindi non serve dichiararlo qui. La cartella di install
// deve chiamarsi "guestRegister" per coerenza con pluginDescription.name e con
// l'API_BASE usato nella pagina EJS.

let myPluginSys = null;

// In-memory storage: nessun file scritto su disco (privacy).
// Limiti: 10 MB per file, un solo file per richiesta.
// fileFilter: accetta solo immagini (image/*); OCR su altri formati sarebbe inutile.
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const upload        = koaMulter({
  storage: koaMulter.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    // Errore segnalato al chiamante: va distinto dagli altri per tornare 400
    const err  = new Error(`Tipo file non supportato: ${file.mimetype || 'sconosciuto'}. Sono accettate solo immagini.`);
    err.code   = 'INVALID_MIME';
    cb(err);
  },
});

// @koa/multer è il binding Koa ufficiale: `upload.single('document')` restituisce
// direttamente un middleware Koa `(ctx, next) => Promise`. Lo invochiamo passando
// un `next` no-op così l'await termina al completamento del parsing, senza
// proseguire la catena dei middleware (la handler successiva ne ha già il
// controllo). Eventuali errori (limits, fileFilter, body esaurito) vengono
// rigettati dalla Promise e gestiti nel try/catch del route handler.
const uploadSingle = upload.single('document');

function parseUpload(ctx) {
  return uploadSingle(ctx, async () => {});
}

// ─── Access control ──────────────────────────────────────────────────────────
// Ruoli abilitati ad operare sul plugin: root (0), admin (1) e ruolo custom
// 'host' creato in installPlugin() (id dinamico >= 100, salvato in
// pluginConfig.custom.hostRoleId). Se adminUsers non è installato o la
// creazione fallisce, hostRoleId resta undefined e solo root/admin accedono.
function allowedRoles() {
  const roles     = [0, 1];
  const hostRoleId = pluginConfig.custom && pluginConfig.custom.hostRoleId;
  if (typeof hostRoleId === 'number') roles.push(hostRoleId);
  return roles;
}

function accessHost() {
  return { requiresAuth: true, allowedRoles: allowedRoles() };
}

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
  if (pluginConfig.custom && pluginConfig.custom.ocrTessdataVariant) {
    setOcrVariant(pluginConfig.custom.ocrTessdataVariant);
  }
  if (pluginConfig.custom && pluginConfig.custom.ocrLangs) {
    setOcrLangs(pluginConfig.custom.ocrLangs);
  }
}

// Crea (se non esiste) il ruolo custom 'host' tramite il plugin adminUsers e
// salva il roleId in pluginConfig.custom.hostRoleId per l'uso in getRouteArray.
// Soft dependency: se adminUsers non è disponibile, il plugin funziona comunque
// ma le rotte restano accessibili solo a root e admin.
async function installPlugin(pluginSys, pathPluginFolder) {
  let roleManagement;
  try {
    roleManagement = require('../adminUsers/roleManagement');
  } catch {
    console.warn('[guestRegister] adminUsers non disponibile: ruolo "host" non creato, accesso limitato a root/admin.');
    return;
  }

  // Idempotente: se il ruolo 'host' esiste già (es. reinstall) ne riuso l'id.
  const existing = roleManagement
    .getCustomRoles()
    .find(r => r.name.toLowerCase() === 'host');

  let hostRoleId;
  if (existing) {
    hostRoleId = existing.id;
  } else {
    const res = roleManagement.createCustomRole(
      'host',
      'Gestore di una struttura ricettiva — accede al plugin guestRegister per registrare gli ospiti.',
    );
    if (res.error) {
      console.warn(`[guestRegister] Creazione ruolo "host" fallita: ${res.error}`);
      return;
    }
    hostRoleId = res.roleId;
  }

  // Persiste il roleId in pluginConfig.json5 → custom.hostRoleId con write
  // surgical (vedi lib/json5Writer.js): aggiorna solo la riga interessata
  // preservando commenti, indentazione, virgole trailing e chiavi non quotate
  // del file. Niente più round-trip JSON.stringify.
  //
  // Aggiorniamo anche l'oggetto in memoria (pluginConfig.custom.hostRoleId)
  // così è disponibile immediatamente per allowedRoles() senza bisogno di
  // ricaricare il file.
  if (!pluginConfig.custom) pluginConfig.custom = {};
  pluginConfig.custom.hostRoleId = hostRoleId;
  const configPath = path.join(pathPluginFolder, 'pluginConfig.json5');
  const ok = setNestedField(configPath, 'custom', 'hostRoleId', hostRoleId);
  if (!ok) {
    // Fallback difensivo: il blocco `custom` non esiste nel file (caso
    // inatteso, la config bundlata l'ha sempre). Cadiamo su JSON.stringify
    // — perderemo i commenti ma il plugin continua a funzionare.
    console.warn('[guestRegister] custom block non trovato in pluginConfig.json5, uso JSON.stringify (commenti persi)');
    fs.writeFileSync(configPath, JSON.stringify(pluginConfig, null, 2));
  }
}

async function uninstallPlugin(pluginSys, pathPluginFolder) {}
async function upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {}

// ─── Routes ──────────────────────────────────────────────────────────────────

function getRouteArray() {
  return [
    // OCR: riceve immagine documento, restituisce dati estratti
    {
      method: 'POST',
      path: '/scan-document',
      access: accessHost(),
      handler: async (ctx) => {
        // Trip-wire body-parser-aware: se un middleware globale del core ha
        // già parsato il multipart, @koa/multer riceverebbe uno stream
        // esaurito e fallirebbe con un errore opaco. Inoltre i limiti/
        // fileFilter di @koa/multer non sarebbero applicati, quindi non
        // possiamo "fidarci" del body pre-parsato. Meglio fallire fast con
        // codice diagnostico.
        // Vedi EXPLAIN.md sezione 10 → "Body parser e middleware ordering —
        // requisiti upstream".
        const contentType = (ctx.get('content-type') || '').toLowerCase();
        const isMultipart = contentType.startsWith('multipart/form-data');
        const preParsed   = ctx.request.body
          && typeof ctx.request.body === 'object'
          && Object.keys(ctx.request.body).length > 0;
        if (isMultipart && preParsed) {
          console.error('[guestRegister] BODY_PRECONSUMED su /scan-document — body multipart già parsato a monte. Verificare middleware ordering nel core di ital8cms.');
          ctx.status = 500;
          ctx.body   = {
            error: 'Body multipart già parsato da un middleware del core. Configurare il body parser globale per non gestire multipart, oppure escludere questa rotta. Vedi EXPLAIN.md sezione 10.',
            code:  'BODY_PRECONSUMED',
          };
          return;
        }

        // Parsing upload: errori di limits/mimetype → 400 con messaggio dedicato
        try {
          await parseUpload(ctx);
        } catch (err) {
          ctx.status = 400;
          if (err.code === 'LIMIT_FILE_SIZE') {
            ctx.body = { error: `File troppo grande. Dimensione massima: ${MAX_FILE_SIZE / (1024 * 1024)} MB.` };
          } else if (err.code === 'INVALID_MIME') {
            ctx.body = { error: err.message };
          } else {
            // Errore @koa/multer non classificato. Logghiamo i dettagli lato
            // server ed esponiamo solo `code` nella risposta per diagnosticare
            // dal Network tab del browser senza far trapelare stack/interni.
            // Code tipici da indagare:
            //  - LIMIT_UNEXPECTED_FILE → nome campo diverso da "document"
            //  - "Multipart: Boundary not found" → boundary non valido
            //  - errore generico senza code → spesso indica stream del body
            //    già consumato (vedi anche il trip-wire BODY_PRECONSUMED sopra
            //    e la sezione 9 di EXPLAIN.md).
            console.error('[guestRegister] Errore upload @koa/multer:', {
              code:    err.code,
              message: err.message,
              field:   err.field,
            });
            ctx.body = {
              error: 'Upload non valido.',
              code:  err.code || 'UNKNOWN',
            };
          }
          return;
        }

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
          // err.message può contenere dettagli interni di Tesseract/MRZ
          console.error('[guestRegister] Errore OCR:', err);
          ctx.status = 500;
          ctx.body   = { error: 'Errore durante l\'elaborazione del documento.' };
        }
      },
    },

    // Autocomplete comuni italiani (attivi + cessati)
    {
      method: 'GET',
      path: '/comuni',
      access: accessHost(),
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
      access: accessHost(),
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
      access: accessHost(),
      handler: async (ctx) => {
        ctx.body = documenti;
      },
    },

    // Genera file .txt per portale alloggiati (download)
    {
      method: 'POST',
      path: '/export-txt',
      access: accessHost(),
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
          console.error('[guestRegister] Errore export:', err);
          ctx.status = 500;
          ctx.body   = { error: 'Errore durante la generazione del file di export.' };
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
  pluginConfig,
};
