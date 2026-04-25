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

Esistono **due flussi di installazione distinti**: quello dell'utente che
installa il plugin dentro un'istanza ital8cms in produzione, e quello del
developer che vuole far girare i test/script standalone fuori dal CMS.

### 1.a Flusso utente CMS (produzione)

L'utente del CMS **non** deve lanciare `npm install` nella cartella del plugin:
delle dipendenze npm si occupa il core ital8cms.

Passi:

```
cd plugins/
git clone https://github.com/italopaesano/ital8cms-plugin-guestRegister.git guestRegister
```

Al caricamento del plugin, il core ital8cms legge
`pluginConfig.json5 → nodeModuleDependency` e provvede a installare i pacchetti
elencati (`multer`, `tesseract.js`, `mrz`). Questo è il meccanismo standard
di ital8cms per le dipendenze npm dei plugin.

Al primo avvio, se `pluginConfig.isInstalled` è `0`, il core invoca anche
`installPlugin()` che:

- Richiede (soft) il modulo `adminUsers/roleManagement` del plugin omonimo.
- Se disponibile, crea (idempotente) il ruolo custom `host` e salva il suo
  `roleId` in `pluginConfig.custom.hostRoleId`.
- Se `adminUsers` non è installato, il plugin continua a funzionare ma l'accesso
  alle rotte resta limitato ai soli `root` (0) e `admin` (1).

### 1.b Flusso developer (test/script standalone)

Solo se vuoi far girare la pipeline OCR fuori dal CMS (vedi §7) o eseguire
`scripts/buildData.js` (vedi §5) come processo Node a sé stante, ti serve un
`node_modules` locale dentro la cartella del plugin:

```
cd plugins/guestRegister
npm install
```

In questo caso `npm` legge `package.json → dependencies` e popola
`./node_modules`, in modo che `node test/testOcr.js …` o
`node scripts/buildData.js` possano risolvere i moduli senza passare dal CMS.
**Questo passo non serve** in produzione e non va eseguito sull'istanza CMS.

### 1.c Perché esistono due elenchi di dipendenze npm?

Le tre dipendenze native (`multer`, `tesseract.js`, `mrz`) sono dichiarate
**due volte**, ed è voluto:

| File                                    | Letto da              | A cosa serve |
|-----------------------------------------|-----------------------|--------------|
| `pluginConfig.json5 → nodeModuleDependency` | core ital8cms     | Manifest delle deps del plugin nel CMS. Il core le installa al caricamento del plugin. |
| `package.json → dependencies`           | `npm` / `node`        | Permette agli script standalone (`test/testOcr.js`, `scripts/buildData.js`) di risolvere i moduli con un `npm install` locale, senza dover avviare il CMS. |

⚠️ **Rischio di drift**: i due elenchi sono mantenuti **a mano**, non c'è
sincronizzazione automatica. Se aggiorni una versione in
`pluginConfig.json5 → nodeModuleDependency`, devi aggiornare la stessa
versione in `package.json → dependencies` (e viceversa). Una divergenza può
generare bug subdoli e difficili da diagnosticare: il plugin gira
correttamente nel CMS ma i test/script standalone falliscono o producono
risultati diversi (o l'opposto). Prima di un release controllare sempre che
le tre versioni di `multer`, `tesseract.js`, `mrz` coincidano fra i due file.

### Dipendenze plugin

| Plugin      | Tipo | Uso |
|-------------|------|-----|
| `adminUsers` | Soft dependency | creazione del ruolo `host` e autenticazione via `ctx.session` |

### Dipendenze npm

| Pacchetto      | Versione | Uso |
|----------------|----------|-----|
| `multer`       | `^2.0.0` | Upload multipart in-memory (endpoint `/scan-document`) |
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
    multer:         "^2.0.0",
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
estratti. L'upload avviene in `multer.memoryStorage()`, l'OCR lavora sul
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

Per testare la pipeline OCR senza avviare il CMS (flusso developer, vedi
§1.b — l'utente CMS non deve eseguire questo `npm install`):

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
