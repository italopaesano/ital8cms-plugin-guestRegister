# TODO — guestRegister: stato testing e prossimi passi

## Bilancio finale

### `/scan-document` ora funziona

| Immagine | HTTP | Tempo | Processor | Note |
|---|---|---|---|---|
| `passport_germany.jpeg` | **200** | 2 s | `tesseract` | OCR pulito, MRZ TD3 visibile nel testo grezzo (`P<D<<MUSTERMANNS<ERIKA…`) ma non parsata: `<` letti come `S`/`£`/`K` per la qualità foto |
| `id_card_front_france.jpeg` | **200** | 1 s | `tesseract` | OCR funziona, fields nulli — fieldExtractor è ancora stub |
| `sample_generated_front.png` | **200** | 2 s | `tesseract` | OCR perfetto su immagine sintetica (estrae nome, cognome, document no.); `tipoDocumento: PASOR` rilevato; altri fields nulli |

Confermato anche standalone (`node test/testOcr.js …`): l'OCR completa in ~3 s e produce output corretto. Pre-existing quirk: lo script non termina (worker_thread tiene vivo l'event loop, manca `process.exit(0)` in `test/testOcr.js`); va in timeout ma l'output è già stato stampato.

### Bug trovati e fixati lungo la strada (in 2 commit)

- [x] **Commit `3ce62de`** — bundling locale + setLangs + pre-flight + README. Le 5 modifiche pre-approvate.
- [x] **Commit `68cd066`** — fix di due bug emersi solo eseguendo davvero la pipeline:
  - [x] Avevo passato `workerPath: dist/worker.min.js` (la build per browser) → `r.g.addEventListener is not a function` in Node. Tolto: in Node tesseract.js usa il proprio `worker-script/node/index.js` di default.
  - [x] `osd.traineddata` di tessdata_fast è solo legacy (no LSTM). Con `OEM=1` (LSTM_ONLY) il worker stampava "LSTM requested, but not present" e degradava l'OCR di TUTTE le lingue → tutti fields nulli con OCR corrotto. Cambiato a `OEM=3` (LSTM + Legacy combinati, default Tesseract): osd carica legacy, ita/eng usano LSTM.

### Cosa NON è stato risolto (limiti del codice esistente, non del bundling)

- [x] **MRZ parser** — affrontato in commit `d92fbcf`: lenient detection, two-pass OCR con whitelist su worker dedicato, loose parse fallback. Risultati su `test/dummy_id_documents/`: prima 0/10 producevano dati MRZ, ora 7/10. I 3 falliti (`id_card_front_france`, `sample_front3`, ecc.) non hanno MRZ visibile sul lato fotografato — non è un problema del parser. Residue OCR confusion sui digit (`0↔O`, `1↔I`) nel `numeroDocumento` — affrontabile con position-aware repair (Strategia 4) in fase successiva.
- [ ] **Field extractor** (`processors/fieldExtractor.js`) è stub per fase 3 (per ora solo patente EU), come documentato in `EXPLAIN.md` §8. Va espanso documento per documento.
- [ ] **`test/testOcr.js`** non chiama `process.exit(0)` né termina il worker → script hangs dopo aver stampato (issue pre-esistente, una riga di fix).

### Cose da fare in fase successiva

- [x] ~~Commenti JSON5 in `pluginConfig.json5` persi a ogni install~~ → risolto su entrambi i punti di scrittura: (1) il core di `ital8cms` (flip `isInstalled`, update `installedVersion`) aggiornato upstream dall'autore; (2) il nostro `installPlugin()` ora usa `lib/json5Writer.js` (surgical write: legge testo, sostituisce/inserisce solo la riga `hostRoleId` nel blocco `custom`, preserva commenti/indent/virgole trailing). 9/9 test fixture passano in `test/testJson5Writer.js`.
- [x] ~~Migliorare MRZ parsing con preprocessing immagine~~ → fatto via two-pass + whitelist (commit `d92fbcf`); preprocessing immagine vero (sharp/jimp) **non** introdotto, riservato per fase successiva se i casi attuali non bastano
- [x] ~~Whitelist Tesseract per MRZ: `<0123456789A-Z`~~ → fatto in commit `d92fbcf`
- [x] ~~Position-aware repair sui campi MRZ (digit vs alpha)~~ → fatto in commit successivo: mask posizionali per TD1/TD2/TD3 (ICAO Doc 9303), `O→0`/`I→1`/`S→5` ecc nelle posizioni numeriche e speculare nelle alpha. Applicata solo dopo pass-2 (whitelist OCR già attiva) su righe di lunghezza canonica esatta. Risultati: `cittadinanza` recuperata in più immagini (`6PI→GPI`, `1VA→IVA`), `dataNascita` estratta su 2 nuove immagini (`sample_front2`, `sample_generated_front1`). 7/10 → **8/10** estrazioni MRZ utili. `numeroDocumento` resta in posizioni alphanumeric (non recuperabile per design)
- [x] ~~Bug `mapDocumentType` per TD1 italiani~~ → commit `bfa3a9c`: estesa la mappa per gestire i prefissi `CI`/`CL`/`CK`/`C<` (variante codice italiano CIE → IDELE), `CR` (residence card → null, non in elenco portale), `IR` → RIFUG, `IP` → IDENT, `PD`/`PS`/`P` → PASDI/PASSE/PASOR, `D` → PATEN.
- [x] ~~Bug `extractPatente` regex troppo stretto~~ → commit `bfa3a9c`: regex tolleranti a `1.`/`1,`/`1 ` (separatore opzionale), separatori data `[/.-]`, lookahead invece di `^...$/m`, alfabeto esteso a accenti italiani. Risultato: patente BIANCHI da 1/7 → 5/7 campi estratti.
- [x] ~~Rinomina specimen PRADO + mapping.txt~~ → commit `bfa3a9c`: 16 file rinominati con convenzione `<nazione>_<tipodoc>_<lato>_<variante>`, `prova.txt` → `mapping.txt` documentato.
- [x] ~~Tessdata configurabile per variante (fast/standard/best)~~ → commit `0bc3c14`: `pluginConfig.json5` → `custom.ocrTessdataVariant`, cartelle separate per variante (`tesseract-data-standard/`, `tesseract-data-best/`) gitignored, script `downloadTessdata.js` con destinazione per-variante e hint di attivazione.
- [ ] Espandere fieldExtractor per IDENT, IDELE, PASOR, PATEN, PATNA
- [ ] Fix testOcr.js (one-liner)

### Tessdata varianti — cose NON incluse (potenziali estensioni future)

- [ ] **Cambio variante a runtime senza restart**: i due worker Tesseract caricano i `.traineddata` in RAM al primo OCR. Cambiare `pluginConfig.json5 → custom.ocrTessdataVariant` richiede restart del CMS (i `setVariant()` post-init vengono ignorati con warning). Possibile estensione: API admin per terminare e ricreare i worker on-the-fly.
- [ ] **Variante diversa per pass-1 vs pass-2**: idea bonus dal brainstorm. Pass-1 (full OCR) potrebbe usare `fast` per velocità, pass-2 (MRZ region) potrebbe usare `best` per accuratezza massima sul testo critico. Costo: +130 MB RAM (terzo worker) e complessità di lifecycle. Da valutare empiricamente solo se la variante singola `best` non basta.
- [ ] **Modifica automatica del `pluginConfig.json5` da script** (decisione di design chiusa, non azionabile): `scripts/downloadTessdata.js` stampa solo l'istruzione di attivazione, non tocca il file. Motivo: scrivere via `JSON.stringify` perderebbe i commenti JSON5 (vedi voce sopra) e introdurrebbe race condition se il CMS sta riscrivendo il file. Tenere la modifica manuale è la scelta più sicura.

---

Branch `claude/setup-plugin-testing-8zg0M` ora a `0bc3c14`, allineata con il remote. La pipeline OCR è funzionante end-to-end senza dipendenze runtime da CDN esterni; tre varianti tessdata configurabili (fast committata, standard/best scaricabili).
