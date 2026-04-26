# guestRegister — plugin ital8cms

Plugin per la registrazione degli ospiti in una struttura ricettiva.
Espone una pagina web (EJS) in cui l'operatore può scansionare la foto di un
documento di identità, ottenere i dati estratti via OCR/MRZ, completarli
manualmente e generare il file `.txt` fixed-width richiesto dal portale
alloggiati (Turismo5 / Questura).

---

## Indice

1. [Installazione](#1-installazione)
2. [Configurazione](#2-configurazione)
3. [Rotte API esposte](#3-rotte-api-esposte)
4. [Pagina EJS](#4-pagina-ejs)
5. [Build dei dati del portale alloggiati](#5-build-dei-dati-del-portale-alloggiati)
6. [Privacy e access control](#6-privacy-e-access-control)
7. [Test OCR standalone](#7-test-ocr-standalone)
8. [Struttura del codice](#8-struttura-del-codice)
9. [Known issue upstream — `apiPrefix`](#9-known-issue-upstream--apiprefix)
10. [Body parser e middleware ordering — requisiti upstream](#10-body-parser-e-middleware-ordering--requisiti-upstream)

---

## 1. Installazione

+++ ATTENZIONE +++
La cartella di install dentro `plugins/` del CMS **deve chiamarsi `guestRegister`**.
Il core di ital8cms (`core/pluginSys.js`) ricava `pluginName` dal nome della
cartella e lo usa per costruire sia le rotte API (`/api/guestRegister/...`) sia
il namespace dei dati esposti alle pagine EJS (`passData.plugin.guestRegister`).
Se la cartella viene nominata diversamente (es. `ital8cms-plugin-guestRegister`
come nel repository git), le chiamate dall'EJS non troveranno gli endpoint e il
dropdown "Tipo documento" resterà vuoto.

Passi:

```
cd plugins/
git clone https://github.com/italopaesano/ital8cms-plugin-guestRegister.git guestRegister
cd guestRegister
npm install
```

`npm install` scarica le dipendenze native (`@koa/multer`, `tesseract.js`, `mrz`)
dichiarate in `pluginConfig.json5 → nodeModuleDependency`.

Al primo avvio, se `pluginConfig.isInstalled` è `0`, il core invoca
`installPlugin()` che:

- Richiede (soft) il modulo `adminUsers/roleManagement` del plugin omonimo.
- Se disponibile, crea (idempotente) il ruolo custom `host` e salva il suo
  `roleId` in `pluginConfig.custom.hostRoleId`.
- Se `adminUsers` non è installato, il plugin continua a funzionare ma l'accesso
  alle rotte resta limitato ai soli `root` (0) e `admin` (1).

### Dipendenze plugin

| Plugin      | Tipo | Uso |
|-------------|------|-----|
| `adminUsers` | Soft dependency | creazione del ruolo `host` e autenticazione via `ctx.session` |

### Dipendenze npm

| Pacchetto      | Versione | Uso |
|----------------|----------|-----|
| `@koa/multer`  | `^3.0.2` | Upload multipart in-memory (endpoint `/scan-document`). Binding Koa ufficiale di `multer` (NON usare il pacchetto `multer` direttamente: la sua API è Express-only e in Koa funziona solo dietro wrapper artigianali, fragili) |
| `tesseract.js` | `^7.0.0` | OCR immagini documento |
| `mrz`          | `^5.0.0` | Parsing righe MRZ (TD1/TD2/TD3). ESM-only, caricato con `dynamic import()` |

---

## 2. Configurazione

`pluginConfig.json5`:

```json5
{
  active: 1,
  isInstalled: 1,
  weight: 100,

  dependency: {},

  nodeModuleDependency: {
    "tesseract.js": "^7.0.0",
    mrz:            "^5.0.0",
    "@koa/multer":  "^3.0.2",
  },

  custom: {
    // Tipi documento mostrati direttamente nel dropdown principale del form.
    // Tutti gli altri 90+ tipi restano accessibili tramite "Altro tipo…".
    // Valori: codici portale alloggiati (vedi data/documenti.json).
    documentiComuni: [
      "IDENT",   // Carta d'Identità
      "IDELE",   // Carta Identità Elettronica
      "PASOR",   // Passaporto Ordinario
      "PATEN",   // Patente di Guida
      "PATNA",   // Patente Nautica
      "RIFUG",   // Titolo di Viaggio Rifugiato Politico
    ],

    // Scritto automaticamente da installPlugin() dopo la creazione del ruolo host
    // nel plugin adminUsers. Non modificare a mano: deve coincidere con l'id
    // assegnato in plugins/adminUsers/userRole.json5.
    hostRoleId: 100,
  },
}
```

+++ ATTENZIONE +++
La scrittura di `hostRoleId` durante `installPlugin()` è fatta con
`JSON.stringify` e **perde i commenti JSON5** del file. Questo è coerente con il
comportamento del core su `userRole.json5`. Dopo la prima install conviene
rigenerare i commenti manualmente, una volta per installazione.

---

## 3. Rotte API esposte

Tutte le rotte sono montate su `/{apiPrefix}/guestRegister/...`
(default `/api/guestRegister/...`).

Tutte richiedono autenticazione e sono riservate ai ruoli `root` (0), `admin`
(1) e `host` (id dinamico, salvato in `pluginConfig.custom.hostRoleId`).

| Metodo | Path             | Descrizione |
|--------|------------------|-------------|
| POST   | `/scan-document` | Riceve un'immagine (`multipart/form-data`, campo `document`), esegue OCR + parsing MRZ / fallback testuale, restituisce JSON con i dati estratti e un array di `warnings` per i campi da completare manualmente |
| GET    | `/comuni?q=XXX`  | Autocomplete comuni italiani (attivi + cessati); richiede almeno 2 caratteri |
| GET    | `/stati?q=XXX`   | Autocomplete stati esteri (attivi + cessati); richiede almeno 2 caratteri |
| GET    | `/documenti`     | Restituisce la lista completa dei tipi documento (per dropdown "Altro tipo…") |
| POST   | `/export-txt`    | Riceve `{ guests: [...] }`, genera il file `.txt` fixed-width (175 caratteri/riga) per il portale alloggiati e lo restituisce come download |

### Limiti upload `/scan-document`

- Dimensione massima file: **10 MB**
- Tipi file accettati: **qualsiasi immagine** (MIME `image/*`)
- Errori: `400` con messaggio dedicato
  - `LIMIT_FILE_SIZE` → "File troppo grande. Dimensione massima: 10 MB."
  - `INVALID_MIME` → "Tipo file non supportato: \<mime\>. Sono accettate solo immagini."

### Esempio risposta `/scan-document`

```json
{
  "success": true,
  "partial": false,
  "processor": "mrz",
  "data": {
    "cognome": "ROSSI",
    "nome":    "MARIO",
    "sesso":   "M",
    "dataNascita":     "15/03/1980",
    "cittadinanza":    "ITA",
    "tipoDocumento":   "PASOR",
    "numeroDocumento": "YA1234567",
    "luogoNascita":    null,
    "provinciaNascita": null,
    "statoNascita":    null,
    "luogoRilascio":   null,
    "provinciaRilascio": null,
    "statoRilascio":   null
  },
  "warnings": [
    "luogoNascita: non rilevabile dalla MRZ, inserire manualmente",
    "..."
  ]
}
```

`partial: true` quando uno dei campi obbligatori (`cognome`, `nome`, `sesso`,
`dataNascita`, `tipoDocumento`, `numeroDocumento`) non è stato estratto.

### Worker Tesseract

Il worker Tesseract viene creato in modalità lazy al primo OCR e poi riusato
per tutte le richieste successive. Lingue caricate: `ita+eng` (per documenti
italiani e passaporti stranieri).

+++ ATTENZIONE +++
La **prima** chiamata a `/scan-document` scarica i modelli linguistici
(~15 MB) e può richiedere diversi secondi; le chiamate successive operano
direttamente sul worker già pronto. Tesseract.js serializza internamente le
`recognize()` sullo stesso worker: due richieste contemporanee vengono
processate in sequenza, non in parallelo.

---

## 4. Pagina EJS

Unica pagina esposta:

```
/pluginPages/guestRegister/registraOspiti.ejs
```

La pagina (`webPages/registraOspiti.ejs`):

- Permette di aggiungere dinamicamente una o più card ospite.
- Supporta tre modalità: "Ospite singolo", "Nucleo familiare", "Gruppo".
  Il tipoAlloggiato viene calcolato lato client in base alla modalità e al
  flag `isCapogruppo` (16/17/18/19/20).
- Per ogni ospite consente la scansione documento (input file con
  `capture="environment"` → fotocamera su mobile), mostra un'anteprima
  immediata, invoca `/scan-document` e applica i dati estratti.
- Autocomplete per comuni, stati e cittadinanza.
- Due-select per il tipo documento: i tipi comuni nel primo dropdown, tutti
  gli altri accessibili tramite "Altro tipo…" (lazy-load di `/documenti`).
- Modal di riepilogo che valida i campi obbligatori e, tramite `/export-txt`,
  scarica il file `.txt` per il portale alloggiati.

### Dati passati dal plugin

`getObjectToShareToWebPages()` espone:

```js
{
  documentiComuni: [/* oggetti { codice, descrizione } */],
  tipoAlloggiato:  [/* lista completa dei tipi alloggiato */]
}
```

Accessibili nell'EJS come `passData.plugin.guestRegister.documentiComuni` e
`passData.plugin.guestRegister.tipoAlloggiato`.

+++ ATTENZIONE +++
Il namespace `guestRegister` è il nome cartella di install. Se la cartella
non si chiama esattamente `guestRegister`, questi riferimenti **non
funzioneranno**.

---

## 5. Build dei dati del portale alloggiati

I file in `data/*.json` sono generati dai CSV ufficiali del portale alloggiati
in `data/alloggiatiweb/*.csv` tramite:

```
node scripts/buildData.js
```

File generati:

| File                      | Origine                        | Contenuto |
|---------------------------|--------------------------------|-----------|
| `data/comuni.json`        | `alloggiatiweb/comuni.csv`     | Codice ISTAT, nome, provincia, flag cessato |
| `data/stati.json`         | `alloggiatiweb/stati.csv`      | Codice ISTAT, nome, flag cessato |
| `data/documenti.json`     | `alloggiatiweb/documenti.csv`  | Codice portale, descrizione |
| `data/tipo_alloggiato.json` | `alloggiatiweb/tipo_alloggiato.csv` | Codice (16–20), descrizione |

+++ ATTENZIONE +++
Il portale alloggiati aggiorna periodicamente i CSV (nuovi stati, comuni
cessati, ecc.). Rigenerare i JSON dopo ogni aggiornamento scaricando i CSV
dalla sezione "Scarica tabelle" del portale.

---

## 6. Privacy e access control

**Privacy**: il plugin non scrive mai su disco i file delle immagini o i dati
estratti. L'upload avviene in `@koa/multer` con `memoryStorage()`, l'OCR lavora sul
buffer in RAM e il file `.txt` viene generato on-the-fly e restituito come
risposta senza essere mai persistito. L'unica persistenza lato server è il
`pluginConfig.custom.hostRoleId` (identificativo numerico, non contiene dati
personali).

**Access control**: tutte le rotte hanno il campo `access` con
`requiresAuth: true` e `allowedRoles: [0, 1, hostRoleId]` (root + admin +
host). Le chiamate senza sessione autenticata ricevono `401`; le chiamate
con ruolo non autorizzato ricevono `403`.

Il ruolo `host` viene creato automaticamente al primo install tramite il
plugin `adminUsers` (soft dependency). Se `adminUsers` non è installato, il
plugin continua a funzionare ma solo root/admin possono accedervi.

---

## 7. Test OCR standalone

Per testare la pipeline OCR senza avviare il CMS:

```
npm install
node test/testOcr.js path/to/documento.jpg
node test/testOcr.js path/to/documento.jpg --debug   # mostra il testo grezzo
```

Output:

- Processor usato (`mrz` / `tesseract`)
- Flag `partial` e lista dei campi obbligatori mancanti
- Warnings per i campi da completare manualmente

---

## 8. Struttura del codice

```
guestRegister/
├── main.js                    # Entry-point plugin (lifecycle, routes, sharing)
├── pluginConfig.json5         # Config: active/isInstalled/weight/deps/custom
├── pluginDescription.json5    # Metadata (name, version, author, license)
├── package.json               # Dipendenze npm locali + script test
├── EXPLAIN.md                 # Questo file
├── data/                      # JSON generati dai CSV portale alloggiati
│   ├── comuni.json
│   ├── stati.json
│   ├── documenti.json
│   ├── tipo_alloggiato.json
│   └── alloggiatiweb/         # CSV sorgenti del portale alloggiati
├── docs/                      # Documentazione aggiuntiva, PDF tabelle, esempi
├── exporters/
│   └── questura.js            # Genera il .txt fixed-width per il portale
├── processors/
│   ├── index.js               # Dispatcher OCR: MRZ → fallback testuale
│   ├── tesseract.js           # Wrapper Tesseract.js
│   ├── mrzParser.js           # Parsing MRZ (TD1/TD2/TD3)
│   └── fieldExtractor.js      # Estrazione testuale (patente EU per ora)
├── scripts/
│   └── buildData.js           # CSV → JSON builder
├── test/
│   └── testOcr.js             # Test standalone della pipeline OCR
└── webPages/
    └── registraOspiti.ejs     # Pagina di registrazione ospiti
```

### Ordine di esecuzione dei lifecycle

1. `require('./main.js')` — vengono letti i JSON di dati e caricata la
   configurazione iniziale.
2. `installPlugin(pluginSys, pathPluginFolder)` — solo se `isInstalled === 0`:
   creazione ruolo `host` e scrittura `hostRoleId` in `pluginConfig.json5`.
3. `getRouteArray()` — registrazione delle 5 rotte con `access`.
4. `getHooksPage()`, `getMiddlewareToAdd()`, `getObjectToShareToWebPages()`.
5. `loadPlugin(pluginSys, pathPluginFolder)` — ricarica `pluginConfig` con
   il path canonico e memorizza il riferimento a `pluginSys`.

---

## 9. Known issue upstream — `apiPrefix`

> **Repo upstream**: <https://github.com/italopaesano/ital8cms>

Il valore `passData.apiPrefix` esposto dal core di ital8cms alle pagine EJS può
arrivare **con o senza `/` iniziale** (es. `api` invece di `/api`), a seconda
della versione del core. Senza `/` iniziale, una stringa come
`'<%= passData.apiPrefix %>/guestRegister'` viene interpretata da `fetch()`
come **URL relativa** rispetto alla pagina corrente, producendo URL del tipo:

```
http://localhost:3000/pluginPages/guestRegister/api/guestRegister/scan-document
                       └── path della pagina ──┘  └── relative path ──┘
```

invece di quello corretto:

```
http://localhost:3000/api/guestRegister/scan-document
```

Tutte le rotte tornano quindi `404` con HTML, e lato client `await res.json()`
esplode con il messaggio (Firefox):

```
JSON.parse: unexpected character at line 1 column 1 of the JSON data
```

### Workaround applicato

In `webPages/registraOspiti.ejs` `apiPrefix` viene normalizzato a render-time
forzando il leading `/`:

```ejs
<%
  const _apiPrefix = passData.apiPrefix.startsWith('/')
    ? passData.apiPrefix
    : '/' + passData.apiPrefix;
%>
const API_BASE = '<%= _apiPrefix %>/guestRegister';
```

In aggiunta, lato client le chiamate `fetch()` passano per `parseJsonResponse()`
che intercetta risposte non-JSON (404 HTML, redirect login, error page del
reverse proxy) e mostra un errore leggibile con HTTP status e snippet del body.

### Fix upstream raccomandato

Nel core di ital8cms ([italopaesano/ital8cms](https://github.com/italopaesano/ital8cms),
`core/pluginSys.js` o equivalente), normalizzare `apiPrefix` **una volta sola**
quando viene esposto in `passData`, garantendo che inizi sempre con `/` (e non
termini con `/`). In alternativa, documentare esplicitamente il contratto e
aggiornare tutti i plugin esistenti.

---

## 10. Body parser e middleware ordering — requisiti upstream

> **Repo upstream**: <https://github.com/italopaesano/ital8cms>

In Koa, lo stream del body di una request può essere letto **una sola volta**.
Se un middleware globale del core consuma il body multipart prima che il
plugin invochi `@koa/multer`, multer trova lo stream esaurito e fallisce con
errori non classificati (codice `undefined` o "Boundary not found"). Il
risultato per l'utente: `400 Upload non valido.` senza ulteriori dettagli.

### Trip-wire applicata nel plugin

L'endpoint `/scan-document` controlla, prima di passare il body a `@koa/multer`,
se `Content-Type: multipart/form-data` e `ctx.request.body` risulta già
popolato. In quel caso risponde con:

```json
{
  "error": "Body multipart già parsato da un middleware del core. … Vedi EXPLAIN.md sezione 10.",
  "code":  "BODY_PRECONSUMED"
}
```

e logga `[guestRegister] BODY_PRECONSUMED su /scan-document — …`. È una guard
di diagnostica: quando scatta, il fix non sta nel plugin ma nel core.

### Migrazione a `@koa/multer`

Il plugin **non** dipende più dal pacchetto `multer` (Express-only). Usa
`@koa/multer`, il binding ufficiale per Koa. La handler invoca direttamente il
middleware `(ctx, next) => Promise` ritornato da `upload.single('document')`,
senza più wrapper artigianali. Questo elimina una classe intera di errori
borderline dovuti al passaggio scorretto di `ctx` a multer Express-style.

### Requisiti che il core deve garantire

1. **Body parser globale safe per multipart**. Opzioni in ordine di
   preferenza:
   - **(a) Best**: usare `@koa/bodyparser` (o `koa-bodyparser`), che NON
     parsa multipart — i plugin che gestiscono upload usano `@koa/multer`
     per-route. Zero conflitti, separation of concerns netta.
   - **(b) OK**: se il core ha bisogno di `koa-body` per altri motivi,
     configurarlo con `multipart: false` esplicito e demandare il multipart
     ai plugin.
   - **(c) Workaround**: se serve retrocompatibilità, esporre dal core
     un'API tipo `pluginSys.skipBodyParser(routePath)` che il plugin chiama
     per dichiarare i suoi route di upload; il middleware globale consulta la
     lista e lascia passare quei path senza parsarli.
2. **Middleware ordering deterministico**:
   ```
   [body parser globale] → [router del core] → [handler plugin (con eventuale @koa/multer per-route)]
   ```
   Nessun middleware "dietro le quinte" deve toccare `ctx.req` tra il body
   parser e la handler. I middleware dei plugin esposti via
   `getMiddlewareToAdd()` vanno mantati **dopo** il body parser globale ma
   **prima** del router, con priorità documentata.
3. **Test di non-regressione lato core**: una rotta finta che riceve
   `multipart/form-data` con un file binario ≥ 1 MB e verifica che
   `ctx.req` sia ancora leggibile dal plugin. Se lo è, il middleware
   ordering è sano.
