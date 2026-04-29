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

Tre varianti supportate (fast committata, le altre due scaricabili in
cartelle separate gitignored):

| Variante | Disk | Recognize | Accuratezza | Stato |
|---|---|---|---|---|
| `fast` (default) | ~660 MB | 2-4 s | media | committata |
| `standard` | ~1.4 GB | 4-7 s | alta | scaricabile |
| `best` | ~1.5 GB | 6-10 s | massima | scaricabile |

Per scaricare una variante diversa:

    node scripts/downloadTessdata.js --variant=standard    # in tesseract-data-standard/
    node scripts/downloadTessdata.js --variant=best        # in tesseract-data-best/
    node scripts/downloadTessdata.js --langs=ita,eng,osd   # solo subset
    node scripts/downloadTessdata.js --force               # forza ri-download

Per **attivare** la variante scaricata, modificare `pluginConfig.json5`:

```json5
"custom": {
  "ocrLangs": "ita+eng+osd",
  "ocrTessdataVariant": "best"   // "fast" | "standard" | "best"
}
```

e riavviare il CMS. Le lingue effettivamente caricate dal worker sono
quelle in `ocrLangs`; il pre-flight check verifica che ogni lingua abbia
il proprio `.traineddata` nella cartella della variante scelta, altrimenti
il primo OCR fallisce con un errore diagnostico.

Per rimuovere una variante scaricata: `rm -rf processors/tesseract-data-<variante>/`.

Lo script è idempotente. Vedi
[`processors/tesseract-data/README.md`](./processors/tesseract-data/README.md)
per dettagli completi.

## Test OCR standalone

    node test/testOcr.js test/dummy_id_documents/passport_germany.jpeg
    node test/testOcr.js test/dummy_id_documents/sample_generated_front.png --debug

Non richiede il CMS in esecuzione. Vedi `EXPLAIN.md` §7.

## License

ISC — autore: Italo Paesano.
