// scripts/push.js — Proje dosyalarını GitHub reposuna API üzerinden push eder.
// Kullanım:  npm run push -- kullanici/repo main
// Token'ı data/settings.json (githubToken) ya da GITHUB_TOKEN ortam değişkeninden okur.
// (Kod zaten sandbox'ta olduğu için git clone/push'a gerek yok — doğrudan Contents/Git Data API.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitFiles } from '../src/github.js';
import { getSettings, updateSettings } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'dist', 'build', '.cache', '.arena']);
const SKIP_FILES = new Set(['.DS_Store']);

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name), rel));
    } else {
      if (SKIP_FILES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const size = fs.statSync(full).size;
      if (size > 900_000) { console.log(`  atlandı (çok büyük): ${rel}`); continue; }
      const binary = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|woff2?|ttf|mp3|wav)$/i.test(entry.name);
      out.push(binary
        ? { path: rel, content: fs.readFileSync(full).toString('base64'), encoding: 'base64' }
        : { path: rel, content: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}

const target = process.argv[2] || getSettings().githubRepo;
const branch = process.argv[3] || getSettings().githubBranch || 'main';
const token = process.env.GITHUB_TOKEN || getSettings().githubToken;

if (!target) {
  console.error('❌ Hedef repo belirtilmedi. Kullanım: npm run push -- kullanici/repo main');
  process.exit(1);
}
if (!token) {
  console.error('❌ GitHub token bulunamadı.');
  console.error('   1) https://github.com/settings/personal-access-tokens/new');
  console.error('   2) Repository access → Only select repositories → ' + target);
  console.error('   3) Permissions → Contents: Read and write');
  console.error('   4) Token\'ı EVRIM → Ayarlar → GitHub alanına yapıştır ve Kaydet');
  process.exit(1);
}

const files = walk(ROOT);
console.log(`📦 ${files.length} dosya hazırlanıyor → ${target} (${branch})`);
files.forEach((f) => console.log(`   + ${f.path}`));

try {
  const res = await commitFiles({
    full: target,
    token,
    branch,
    message: 'feat: EVRIM — kendini geliştiren, hafızalı, GitHub bağlantılı AI uygulaması',
    files,
  });
  updateSettings({ githubRepo: res.branch ? target : target, githubBranch: res.branch });
  console.log(`\n✅ Push tamam: ${res.sha}${res.firstCommit ? ' (ilk commit)' : ''}`);
  console.log(`   https://github.com/${target}/commit/${res.sha}`);
} catch (err) {
  console.error('\n❌ Push başarısız:', err.message);
  if (/404/.test(err.message)) console.error('   → Token yetkisi eksik olabilir: Contents = Read and write, ve doğru repo seçili olmalı.');
  if (/401/.test(err.message)) console.error('   → Token geçersiz veya süresi dolmuş.');
  process.exit(1);
}
