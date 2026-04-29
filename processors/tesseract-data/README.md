# tesseract-data

Modelli linguistici Tesseract pre-bundlati (variante **fast**), letti
localmente da `processors/tesseract.js` per evitare il download runtime
da CDN esterni.

## Tre varianti supportate

Il plugin supporta tre varianti di trained data, equivalenti per coverage
linguistica ma diverse per qualità OCR e dimensioni. La cartella
`tesseract-data/` (questa) ospita la variante "fast" ed è committata nel
repository. Le altre due si scaricano localmente in cartelle separate
(gitignored, non finiscono nel repo):

| Variante | Sorgente | Cartella | Disk | Recognize | Accuratezza | Stato |
|---|---|---|---|---|---|---|
| **fast** | [`tesseract-ocr/tessdata_fast`](https://github.com/tesseract-ocr/tessdata_fast) | `processors/tesseract-data/` | ~660 MB | 2-4 s | media | committata ✓ |
| **standard** | [`tesseract-ocr/tessdata`](https://github.com/tesseract-ocr/tessdata) | `processors/tesseract-data-standard/` | ~1.4 GB | 4-7 s | alta | scaricabile |
| **best** | [`tesseract-ocr/tessdata_best`](https://github.com/tesseract-ocr/tessdata_best) | `processors/tesseract-data-best/` | ~1.5 GB | 6-10 s | massima | scaricabile |

Tempi e dimensioni indicativi. La RAM del worker dipende dalle sole lingue
richieste in `ocrLangs`, non dalla totalità della cartella.

## Quando vale la pena passare a standard / best

Tipicamente solo se l'OCR su MRZ fotografica continua a produrre errori
residui di confusione `0↔O`, `1↔I` ecc. dopo la position-aware repair —
oppure per documenti con stampa molto degradata. Per il caso d'uso
"struttura ricettiva italiana" la `fast` è quasi sempre sufficiente.

## Scaricare una variante

```
node scripts/downloadTessdata.js                     # fast (default)
node scripts/downloadTessdata.js --variant=standard  # ~1.4 GB
node scripts/downloadTessdata.js --variant=best      # ~1.5 GB
node scripts/downloadTessdata.js --langs=ita,eng,osd # solo subset (qualunque variante)
node scripts/downloadTessdata.js --force             # forza ri-download dei presenti
```

Lo script scrive in `processors/tesseract-data-<variante>/` (per `fast`
direttamente in `processors/tesseract-data/`). È idempotente: i file già
presenti vengono saltati. Se la variante richiesta esiste già parzialmente,
solo i file mancanti vengono scaricati.

## Attivare una variante

La sola presenza dei file non basta: il plugin legge la variante attiva
da `pluginConfig.json5`:

```json5
"custom": {
  "ocrLangs": "ita+eng+osd",
  "ocrTessdataVariant": "fast"   // "fast" | "standard" | "best"
}
```

Modificare il valore e **riavviare il CMS**: i due worker Tesseract
(general + MRZ) vengono creati lazy alla prima `/scan-document`, leggendo
la variante impostata via `setVariant()` da `main.js loadPlugin()`.

Pre-flight check: se la variante scelta non è scaricata, il primo OCR
fallisce con un messaggio che indica esattamente il comando per scaricarla.

## Rimuovere una variante

```
rm -rf processors/tesseract-data-standard/
rm -rf processors/tesseract-data-best/
```

(La variante `fast`, in `tesseract-data/`, **non rimuoverla**: è quella
committata di default e fa da fallback se il config punta a una variante
non disponibile sul filesystem.)

## Origine dei file

Per ogni variante, il repository upstream è linkato in tabella sopra
(branch `main`). I tre repository sono mantenuti dal progetto Tesseract OCR
e contengono lo stesso elenco di lingue (~124 + 37 script files), differenziati
solo per il modo di addestramento del modello LSTM:

- `tessdata_fast`: LSTM-only, quantizzato a interi → file più piccoli e
  inferenza più veloce, accuracy media.
- `tessdata` (standard): legacy + LSTM nello stesso file → backward
  compatible con Tesseract 3.x, dimensione media.
- `tessdata_best`: LSTM-only, full-precision float → file grossi e
  inferenza più lenta, accuracy massima.

## Contenuto di ciascuna variante

- 124 lingue principali in formato `<LANG>.traineddata` (codici ISO 639-2)
- `osd.traineddata` — Orientation & Script Detection (auto-rotazione foto)
- 37 file in `script/` per riconoscimento basato sull'alfabeto
