# guestRegister — plugin ital8cms

Plugin per la registrazione degli ospiti in una struttura ricettiva.
Espone una pagina web (EJS) in cui l'operatore scansiona la foto di un
documento di identità, i dati vengono estratti via OCR/MRZ, completati
manualmente e infine generato il file `.txt` fixed-width richiesto dal
portale alloggiati (Turismo5 / Questura).

Documentazione completa: [`EXPLAIN.md`](./EXPLAIN.md).

## Quick start

    cd plugins/                                       # nella root del CMS
    git clone <repo-url> guestRegister                # nome cartella OBBLIGATORIO
    cd guestRegister
    npm install
    # i .traineddata sono già nel repo, niente download a runtime

Attivare il plugin in `pluginConfig.json5` (`active: 1`) e riavviare il
CMS. Le rotte API saranno disponibili su `/api/guestRegister/*` e la
pagina web su `/pluginPages/guestRegister/registraOspiti.ejs`.

## Tesseract data files

Il plugin usa Tesseract.js per l'OCR. I modelli linguistici (~660 MB,
variante `tessdata_fast`) sono **pre-bundlati** in
`processors/tesseract-data/`, così il plugin funziona offline senza
contattare CDN esterni (`tessdata.projectnaptha.com`, `unpkg.com`).

Per riscaricarli o cambiare variante:

    node scripts/downloadTessdata.js                       # default: fast
    node scripts/downloadTessdata.js --variant=best        # qualità massima, ~1.5 GB
    node scripts/downloadTessdata.js --langs=ita,eng,osd   # solo subset
    node scripts/downloadTessdata.js --force               # forza ri-download

Lo script è idempotente. Vedi
[`processors/tesseract-data/README.md`](./processors/tesseract-data/README.md)
per dettagli sulla provenienza dei file.

Le lingue caricate dal worker sono configurabili in `pluginConfig.json5`
→ `custom.ocrLangs` (default `"ita+eng+osd"`). Modificandole, assicurarsi
che i `.traineddata` corrispondenti esistano in `processors/tesseract-data/`
(altrimenti il plugin si rifiuta di avviare l'OCR con messaggio diagnostico).

## Test OCR standalone

    node test/testOcr.js test/dummy_id_documents/passport_germany.jpeg
    node test/testOcr.js test/dummy_id_documents/sample_generated_front.png --debug

Non richiede il CMS in esecuzione. Vedi `EXPLAIN.md` §7.

## License

ISC — autore: Italo Paesano.
