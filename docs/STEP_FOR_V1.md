# STEP FOR V1

Roadmap verso la prima versione stabile del plugin `guestRegister`.

---

## Indice

1. [Scelta della libreria OCR](#1-scelta-della-libreria-ocr)
2. [Definizione documenti supportati e campi estratti](#2-definizione-documenti-supportati-e-campi-estratti)
3. [Implementazione del processore OCR](#3-implementazione-del-processore-ocr)
4. [Mapping al formato portale allogiati](#4-mapping-al-formato-portale-allogiati)
5. [Frontend: form EJS per upload documento](#5-frontend-form-ejs-per-upload-documento)
6. [Ruolo host e access control](#6-ruolo-host-e-access-control)
7. [Test e validazione](#7-test-e-validazione)

---

## 1. Scelta della libreria OCR

- [ ] Valutare le opzioni disponibili (libreria locale vs API esterna)
- [ ] Scegliere la libreria/soluzione OCR
- [ ] Aggiornare `pluginConfig.json5` con le `nodeModuleDependency` necessarie
- [ ] Documentare la scelta e la motivazione

## 2. Definizione documenti supportati e campi estratti

- [ ] Definire i tipi di documento da supportare (carta d'identità, passaporto, patente, permesso di soggiorno)
- [ ] Analizzare il formato del file `.txt` del portale allogiati della Polizia di Stato
- [ ] Definire i campi da estrarre (es. cognome, nome, data di nascita, luogo di nascita, nazionalità, numero documento, data scadenza)
- [ ] Definire la struttura dell'oggetto JSON di risposta dell'endpoint

## 3. Implementazione del processore OCR

- [ ] Implementare `extractDataFromDocument(fileBuffer, mimetype)` in `main.js`
- [ ] Gestire i diversi tipi di documento
- [ ] Gestire gli errori di riconoscimento (immagine sfocata, documento non riconosciuto, ecc.)
- [ ] Validare i dati estratti prima di restituirli

## 4. Mapping al formato portale allogiati

- [ ] Studiare la struttura del file `.txt` richiesto dal portale allogiati
- [ ] Implementare la funzione di mapping dai dati OCR al formato portale allogiati
- [ ] Decidere se il mapping avviene lato plugin (endpoint restituisce dati già formattati) o lato frontend

## 5. Frontend: form EJS per upload documento

- [ ] Creare `webPages/scanDocument.ejs` con form di upload
- [ ] Gestire la preview dell'immagine caricata
- [ ] Mostrare i dati estratti nel form pre-compilato
- [ ] Gestire gli errori lato UI

## 6. Ruolo host e access control

- [ ] Definire il ruolo `host` nel sistema ital8cms
- [ ] Aggiungere il campo `access` alla route `/scanDocument` per limitarla al ruolo `host`
- [ ] Gestire la creazione del ruolo durante `installPlugin()`

## 7. Test e validazione

- [ ] Testare il riconoscimento su campioni reali di documenti italiani
- [ ] Verificare la correttezza del mapping al formato portale allogiati
- [ ] Testare i casi limite (foto ruotata, bassa risoluzione, documento parziale)
- [ ] Revisione finale sicurezza (nessun dato persistito su disco)
