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

- [ ] Commenti JSON5 in `pluginConfig.json5` persi a ogni install
- [x] ~~Migliorare MRZ parsing con preprocessing immagine~~ → fatto via two-pass + whitelist (commit `d92fbcf`); preprocessing immagine vero (sharp/jimp) **non** introdotto, riservato per fase successiva se i casi attuali non bastano
- [x] ~~Whitelist Tesseract per MRZ: `<0123456789A-Z`~~ → fatto in commit `d92fbcf`
- [ ] Position-aware repair sui campi MRZ (digit vs alpha): correggere `0↔O`, `1↔I` nelle posizioni numeriche del MRZ per ottenere `numeroDocumento` perfetti
- [ ] Espandere fieldExtractor per IDENT, IDELE, PASOR, PATEN, PATNA
- [ ] Fix testOcr.js (one-liner)

---

Branch `claude/setup-plugin-testing-8zg0M` ora a `68cd066`, allineata con il remote. La pipeline OCR è funzionante end-to-end senza dipendenze runtime da CDN esterni.
