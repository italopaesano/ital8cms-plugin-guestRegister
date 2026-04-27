'use strict';

// Scarica tutti i modelli Tesseract (variante "fast", non compressi) nella
// cartella processors/tesseract-data/. Bundling locale per evitare il download
// runtime da CDN esterni (richiesto in ambienti senza accesso a
// tessdata.projectnaptha.com / unpkg.com).
//
// Uso:
//   node scripts/downloadTessdata.js                # tessdata_fast (default)
//   node scripts/downloadTessdata.js --variant=standard   # ~1.4 GB
//   node scripts/downloadTessdata.js --variant=best       # ~1.5 GB
//   node scripts/downloadTessdata.js --force         # ri-scarica anche i file presenti
//   node scripts/downloadTessdata.js --langs=ita,eng,osd  # solo un sottoinsieme
//
// Richiede Node.js >= 18 (usa il fetch globale).
//
// Sorgenti:
//   fast     → github.com/tesseract-ocr/tessdata_fast
//   standard → github.com/tesseract-ocr/tessdata
//   best     → github.com/tesseract-ocr/tessdata_best

const fs   = require('fs');
const path = require('path');

// ── Parsing argomenti ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

function getArg(name, fallback) {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const VARIANT = getArg('variant', 'fast');
const LANG_FILTER = getArg('langs', null);  // CSV opzionale, es. "ita,eng,osd"

const REPO_BY_VARIANT = {
  fast:     'tesseract-ocr/tessdata_fast',
  standard: 'tesseract-ocr/tessdata',
  best:     'tesseract-ocr/tessdata_best',
};

const REPO = REPO_BY_VARIANT[VARIANT];
if (!REPO) {
  console.error(`Variante non valida: "${VARIANT}". Usa fast | standard | best.`);
  process.exit(1);
}

const BASE = `https://raw.githubusercontent.com/${REPO}/main`;
const DEST = path.resolve(__dirname, '..', 'processors', 'tesseract-data');

// ── Liste ────────────────────────────────────────────────────────────────────
//
// Lista canonica delle lingue Tesseract 4.x (124 voci, incluso osd).
// Se in futuro upstream aggiunge lingue, basta aggiornarle qui.

const LANGS = [
  'afr', 'amh', 'ara', 'asm', 'aze', 'aze_cyrl', 'bel', 'ben', 'bod', 'bos',
  'bre', 'bul', 'cat', 'ceb', 'ces', 'chi_sim', 'chi_sim_vert', 'chi_tra',
  'chi_tra_vert', 'chr', 'cos', 'cym', 'dan', 'deu', 'div', 'dzo', 'ell',
  'eng', 'enm', 'epo', 'equ', 'est', 'eus', 'fao', 'fas', 'fil', 'fin',
  'fra', 'frk', 'frm', 'fry', 'gla', 'gle', 'glg', 'grc', 'guj', 'hat',
  'heb', 'hin', 'hrv', 'hun', 'hye', 'iku', 'ind', 'isl', 'ita', 'ita_old',
  'jav', 'jpn', 'jpn_vert', 'kan', 'kat', 'kat_old', 'kaz', 'khm', 'kir',
  'kmr', 'kor', 'kor_vert', 'lao', 'lat', 'lav', 'lit', 'ltz', 'mal', 'mar',
  'mkd', 'mlt', 'mon', 'mri', 'msa', 'mya', 'nep', 'nld', 'nor', 'oci',
  'ori', 'osd', 'pan', 'pol', 'por', 'pus', 'que', 'ron', 'rus', 'san',
  'sin', 'slk', 'slv', 'snd', 'spa', 'spa_old', 'sqi', 'srp', 'srp_latn',
  'sun', 'swa', 'swe', 'syr', 'tam', 'tat', 'tel', 'tgk', 'tha', 'tir',
  'ton', 'tur', 'uig', 'ukr', 'urd', 'uzb', 'uzb_cyrl', 'vie', 'yid', 'yor',
];

// File "script" per riconoscimento basato su alfabeto/scrittura (sotto-cartella
// script/ nei tre repo upstream). Utili quando la lingua è ignota.

const SCRIPTS = [
  'Arabic', 'Armenian', 'Bengali', 'Canadian_Aboriginal', 'Cherokee',
  'Cyrillic', 'Devanagari', 'Ethiopic', 'Fraktur', 'Georgian', 'Greek',
  'Gujarati', 'Gurmukhi', 'HanS', 'HanS_vert', 'HanT', 'HanT_vert',
  'Hangul', 'Hangul_vert', 'Hebrew', 'Japanese', 'Japanese_vert',
  'Kannada', 'Khmer', 'Lao', 'Latin', 'Malayalam', 'Myanmar', 'Oriya',
  'Sinhala', 'Syriac', 'Tamil', 'Telugu', 'Thaana', 'Thai', 'Tibetan',
  'Vietnamese',
];

// ── Filtro opzionale ─────────────────────────────────────────────────────────

let langsToDownload = LANGS;
let scriptsToDownload = SCRIPTS;
if (LANG_FILTER) {
  const requested = new Set(LANG_FILTER.split(',').map(s => s.trim()).filter(Boolean));
  langsToDownload = LANGS.filter(l => requested.has(l));
  scriptsToDownload = SCRIPTS.filter(s => requested.has(s) || requested.has(`script/${s}`));
  const unknown = [...requested].filter(r =>
    !LANGS.includes(r) && !SCRIPTS.includes(r) && !SCRIPTS.includes(r.replace(/^script\//, ''))
  );
  if (unknown.length) {
    console.warn(`Codici non riconosciuti (ignorati): ${unknown.join(', ')}`);
  }
}

// ── Download ─────────────────────────────────────────────────────────────────

async function downloadOne(url, destPath) {
  if (!FORCE && fs.existsSync(destPath)) {
    const size = fs.statSync(destPath).size;
    if (size > 100_000) {
      return { skipped: true, size };
    }
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return { skipped: false, size: buf.length };
}

async function main() {
  fs.mkdirSync(DEST, { recursive: true });
  fs.mkdirSync(path.join(DEST, 'script'), { recursive: true });

  console.log(`Variante     : ${VARIANT}  (${REPO})`);
  console.log(`Destinazione : ${DEST}`);
  console.log(`Lingue       : ${langsToDownload.length}`);
  console.log(`Script       : ${scriptsToDownload.length}`);
  console.log(`Force        : ${FORCE}`);
  console.log('');

  const targets = [
    ...langsToDownload.map(l => ({
      url:   `${BASE}/${l}.traineddata`,
      dest:  path.join(DEST, `${l}.traineddata`),
      label: l,
    })),
    ...scriptsToDownload.map(s => ({
      url:   `${BASE}/script/${s}.traineddata`,
      dest:  path.join(DEST, 'script', `${s}.traineddata`),
      label: `script/${s}`,
    })),
  ];

  const total = targets.length;
  let ok = 0, skip = 0, fail = 0, totalBytes = 0;
  const failures = [];

  for (let i = 0; i < total; i++) {
    const t = targets[i];
    const prefix = `[${String(i + 1).padStart(3)}/${total}]`;
    try {
      const r = await downloadOne(t.url, t.dest);
      totalBytes += r.size;
      const mb = (r.size / 1024 / 1024).toFixed(2);
      if (r.skipped) {
        skip++;
        console.log(`${prefix} ${t.label.padEnd(28)} skip   (${mb} MB)`);
      } else {
        ok++;
        console.log(`${prefix} ${t.label.padEnd(28)} ok     (${mb} MB)`);
      }
    } catch (e) {
      fail++;
      failures.push({ label: t.label, error: e.message });
      console.log(`${prefix} ${t.label.padEnd(28)} FAIL   ${e.message}`);
    }
  }

  console.log('');
  console.log(`Scaricati : ${ok}`);
  console.log(`Già presenti : ${skip}`);
  console.log(`Falliti : ${fail}`);
  console.log(`Spazio totale : ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  if (fail) {
    console.log('');
    console.log('Lista falliti:');
    for (const f of failures) console.log(`  - ${f.label}: ${f.error}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Errore fatale:', e);
  process.exit(1);
});
