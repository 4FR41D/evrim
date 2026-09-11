#!/usr/bin/env node
/* katalog-sync.js — awesome-agent-apis kataloğunun YEREL YEDEĞİNİ üretir.
   Neden:上游 repo silinir/ad değiştirir/GitHub rate-limit'e takılırsa EVRIM
   kendi repo kopyasından (GitHub Pages, aynı origin) okumaya devam etsin.
   Kullanım:  node scripts/katalog-sync.js
   Çıktı:    web/data/katalog.json  (commit'lenir, SW ile önbelleklenir) */
import fs from 'fs';
import path from 'path';

const REPO = 'Anil-matcha/awesome-agent-apis';
const OUT = path.join(process.cwd(), 'web', 'data', 'katalog.json');

const get = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EVRIM-katalog-sync' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json().catch(async () => r.text());
};

const field = (yaml, key) => {
  const m = yaml.match(new RegExp(`^${key}:\\s*"?([^"#\\n]*)"?`, 'm'));
  return m ? m[1].trim() : '';
};

console.log('1/3 ağaç indiriliyor…');
const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`);
const slugs = (tree.tree || [])
  .filter((x) => x.path.startsWith('models/') && x.path.endsWith('.yaml'))
  .map((x) => x.path.slice(7, -5));
console.log(`   ${slugs.length} model bulundu`);

console.log('2/3 yaml başlıkları okunuyor…');
const items = [];
for (let i = 0; i < slugs.length; i++) {
  const slug = slugs[i];
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/models/${slug}.yaml`);
    if (!r.ok) continue;
    const y = await r.text();
    items.push({
      m: slug,
      a: field(y, 'title') || slug,
      c: field(y, 'capability'),
      d: field(y, 'description').slice(0, 140),
      u: field(y, 'cost'),
      l: field(y, 'docs_url'),
    });
  } catch { /* tek dosya ölürse devam */ }
  if (i % 100 === 99) console.log(`   ${i + 1}/${slugs.length}`);
  await new Promise((r) => setTimeout(r, 15));   // rate-limit nezaketi
}

console.log('3/3 yazılıyor…');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = {
  kaynak: `github.com/${REPO} (MIT)`,
  lisans: 'MIT',
  senkron: new Date().toISOString(),
  adet: items.length,
  not: 'Bu dosya EVRIM tarafından üretilmiş bir YEDEKTİR. modeller muapi.ai üzerinden ÜCRETLİ çağrılır; EVRIM yalnızca bilgi verir.',
  items,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`✅ ${OUT} — ${items.length} giriş, ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
