# STEP FOR V1

Roadmap verso la prima versione stabile del plugin `guestRegister`.

---

## Indice

1. [Scelta della libreria OCR](#1-scelta-della-libreria-ocr)
2. [Definizione documenti supportati e campi estratti](#2-definizione-documenti-supportati-e-campi-estratti)
3. [Implementazione del processore OCR](#3-implementazione-del-processore-ocr)
4. [Mapping al formato portale alloggiati](#4-mapping-al-formato-portale-alloggiati)
5. [Frontend: form EJS per upload documento](#5-frontend-form-ejs-per-upload-documento)
6. [Ruolo host e access control](#6-ruolo-host-e-access-control)
7. [Test e validazione](#7-test-e-validazione)

---

## 1. Scelta della libreria OCR

- [x] Valutare le opzioni disponibili (libreria locale vs API esterna)
- [x] Scegliere la libreria/soluzione OCR
  - `tesseract.js` v5 per OCR immagini (approccio semplice, un'unica libreria)
  - `mrz` v4 per parsing righe MRZ (nessuna dipendenza runtime, CommonJS)
  - Architettura modulare: `processors/` con dispatcher, mrzParser, fieldExtractor
- [x] Aggiornare `pluginConfig.json5` con le `nodeModuleDependency` necessarie
- [x] Documentare la scelta e la motivazione

## 2. Definizione documenti supportati e campi estratti

- [x] Analizzare il formato del file `.txt` del portale alloggiati (Turismo5 / Questura)
  - Formato fixed-width; cognome 50 ch, nome 30 ch, sesso 1 ch, date DD/MM/YYYY, codici ISTAT 9 ch
  - Il plugin produce JSON leggibile; la conversione in codici ISTAT è a carico del form
  - Per gruppi/famiglie: documento obbligatorio solo per capogruppo/capofamiglia
- [x] Definire la struttura dell'oggetto JSON di risposta dell'endpoint
  - Campi: `cognome`, `nome`, `sesso`, `dataNascita`, `luogoNascita`, `provinciaNascita`,
    `statoNascita`, `cittadinanza`, `tipoDocumento` (IDE/PAS/PAT), `numeroDocumento`,
    `luogoRilascio`, `provinciaRilascio`, `statoRilascio`
  - Date in formato `DD/MM/YYYY`
  - `partial: true` se campi obbligatori mancanti, `warnings[]` per campi facoltativi non estratti
- [ ] Definire i tipi di documento da supportare (carta d'identità, passaporto, patente, permesso di soggiorno)

## 3. Implementazione del processore OCR

- [x] Architettura modulare `processors/` implementata:
  - `processors/tesseract.js` — OCR immagine → testo grezzo
  - `processors/mrzParser.js` — ricerca e parsing MRZ (TD1/TD2/TD3)
  - `processors/fieldExtractor.js` — stub per documenti senza MRZ (fase successiva)
  - `processors/index.js` — dispatcher: tenta MRZ → fallback estrazione testuale
- [x] Setup test standalone: `package.json` + `test/testOcr.js`
  - `npm install` nella cartella plugin installa `tesseract.js` e `mrz`
  - `node test/testOcr.js <immagine>` testa il pipeline senza il CMS
- [ ] Test su documenti reali italiani e calibrazione Tesseract
- [ ] Implementare `processors/fieldExtractor.js` per documenti senza MRZ (es. Patente)
- [ ] Gestire gli errori di riconoscimento (immagine sfocata, documento non riconosciuto)

## 4. Mapping al formato portale alloggiati

- [x] Decidere: il mapping avviene lato frontend (il plugin restituisce dati leggibili)
- [ ] Verificare la corrispondenza dei campi JSON con i campi del form Turismo5 / portale alloggiati

## 5. Frontend: form EJS per upload documento

- [ ] Creare `webPages/scanDocument.ejs` con form di upload
- [ ] Gestire la preview dell'immagine caricata
- [ ] Mostrare i dati estratti nel form pre-compilato
- [ ] Evidenziare visivamente il risultato `partial: true` (richiesto: ben visibile in UI)
- [ ] Gestire gli errori lato UI

## 6. Ruolo host e access control

- [ ] Definire il ruolo `host` nel sistema ital8cms
- [ ] Aggiungere il campo `access` alla route `/scanDocument` per limitarla al ruolo `host`
- [ ] Gestire la creazione del ruolo durante `installPlugin()`

## 7. Test e validazione

- [ ] Testare il riconoscimento su campioni reali di documenti italiani
- [ ] Verificare la correttezza del mapping al formato portale alloggiati
- [ ] Testare i casi limite (foto ruotata, bassa risoluzione, documento parziale)
- [ ] Revisione finale sicurezza (nessun dato persistito su disco)
