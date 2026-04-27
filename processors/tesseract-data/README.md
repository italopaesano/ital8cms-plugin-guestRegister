# tesseract-data

Modelli linguistici Tesseract pre-bundlati (variante **fast**), letti
localmente da `processors/tesseract.js` per evitare il download runtime
da CDN esterni.

## Origine

I file provengono da
[`github.com/tesseract-ocr/tessdata_fast`](https://github.com/tesseract-ocr/tessdata_fast)
(branch `main`). Variante "fast": LSTM-only quantizzata, precisione
media, dimensioni ridotte (~150 MB per le sole lingue, ~660 MB con la
sotto-cartella `script/`).

Le altre due varianti possibili (qualità più alta, dimensioni maggiori):
- `tessdata` standard — `github.com/tesseract-ocr/tessdata` (~1.4 GB)
- `tessdata_best` — `github.com/tesseract-ocr/tessdata_best` (~1.5 GB)

## Contenuto

- 124 lingue principali in formato `<LANG>.traineddata` (codici ISO 639-2)
- `osd.traineddata` — Orientation & Script Detection (auto-rotazione foto)
- 37 file in `script/` per riconoscimento basato sull'alfabeto

## Ricostruzione

I file NON sono scaricati da `npm install`: sono committati direttamente
nel repository. Per riscaricare/aggiornare:

    node scripts/downloadTessdata.js                       # tutte le lingue
    node scripts/downloadTessdata.js --langs=ita,eng,osd   # solo subset
    node scripts/downloadTessdata.js --variant=best        # variante diversa
    node scripts/downloadTessdata.js --force               # forza ri-download

Lo script è idempotente: i file già presenti vengono saltati.

## Configurazione

Le lingue caricate da Tesseract a runtime sono definite in
`pluginConfig.json5` → `custom.ocrLangs` (default `"ita+eng+osd"`). Il
pre-flight check di `processors/tesseract.js` verifica all'avvio che ogni
lingua richiesta abbia il proprio `.traineddata` qui dentro, e fallisce
con messaggio diagnostico se manca qualcosa.
