/* js/github.js — GitHub okuma (tarayıcıdan, CORS destekli)
   Not: Bu sunucusuz sürümde GitHub'a YAZMA (commit) yok — o sunucu gerektirir.
   Public repolar token'sız okunabilir; kendi özel repoların için Ayarlar'a token gir. */
import { getSettings } from './store.js';
import { chat, isReady } from './llm.js';
import { buildSystemPrompt } from './evolve.js';

const API = 'https://api.github.com';

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const t = (getSettings().githubToken || '').trim();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function gh(path) {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `HTTP ${res.status}`;
    if (res.status === 403 && /rate limit/i.test(msg)) {
      throw new Error('GitHub istek limiti doldu (token’sız saatte 60). Ayarlar’a token gir veya biraz bekle.');
    }
    if (res.status === 401) throw new Error('GitHub token geçersiz.');
    throw new Error(`GitHub: ${msg}`);
  }
  return data;
}

export function parseRepo(input) {
  const s = String(input || '').trim();
  let m = s.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (m) return `${m[1]}/${m[2]}`;
  m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? s : null;
}

export async function repoInfo(full) {
  const d = await gh(`/repos/${full}`);
  return {
    full: d.full_name, description: d.description, stars: d.stargazers_count,
    forks: d.forks_count, openIssues: d.open_issues_count, language: d.language,
    defaultBranch: d.default_branch, private: d.private, htmlUrl: d.html_url, updatedAt: d.updated_at,
  };
}

export async function fileTree(full, branch) {
  const ref = branch || (await repoInfo(full)).defaultBranch;
  const d = await gh(`/repos/${full}/git/trees/${ref}?recursive=1`);
  return {
    branch: ref,
    files: (d.tree || []).filter((t) => t.type === 'blob').map((t) => ({ path: t.path, size: t.size })).slice(0, 2000),
  };
}

export async function readFile(full, path, branch) {
  const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const d = await gh(`/repos/${full}/contents/${encodeURI(path)}${q}`);
  if (Array.isArray(d)) throw new Error('Bu bir klasör, dosya seç.');
  const content = d.encoding === 'base64' ? atob(d.content || '').split('').map((c) => c.charCodeAt(0)).reduce((a, b) => a + String.fromCharCode(b), '') : (d.content || '');
  return { path: d.path, size: d.size, content: decodeURIComponent(escape(content)) };
}

export async function recentCommits(full, limit = 10, branch) {
  const q = new URLSearchParams({ per_page: String(limit) });
  if (branch) q.set('sha', branch);
  const d = await gh(`/repos/${full}/commits?${q}`);
  return d.map((c) => ({
    sha: c.sha.slice(0, 7), message: (c.commit?.message || '').split('\n')[0],
    author: c.commit?.author?.name || c.author?.login || '?', date: c.commit?.author?.date, url: c.html_url,
  }));
}

export async function listIssues(full, limit = 15) {
  const d = await gh(`/repos/${full}/issues?state=open&per_page=${limit}`);
  return d.filter((i) => !i.pull_request).map((i) => ({
    number: i.number, title: i.title, labels: i.labels.map((l) => l.name), url: i.html_url,
  }));
}

export async function searchMyRepos(q = '') {
  if (!getSettings().githubToken) return [];
  const d = await gh(`/user/repos?per_page=100&sort=updated`);
  return d
    .map((r) => ({ full: r.full_name, description: r.description, private: r.private, language: r.language, stars: r.stargazers_count }))
    .filter((r) => !q || r.full.toLowerCase().includes(q.toLowerCase()));
}

// ---------- AI analiz ----------
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|py|go|rs|java|rb|php|html|css|md|yml|yaml|sh|sql|vue|svelte)$/i;
const MAX_FILE = 6000, MAX_TOTAL = 22000;

export async function repoContext(full, maxFiles = 7) {
  const info = await repoInfo(full);
  const tree = await fileTree(full, info.defaultBranch);
  const pick = tree.files
    .filter((f) => CODE_EXT.test(f.path) && !/(node_modules|dist|build|\.min\.|lock)/.test(f.path))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, maxFiles);

  const chunks = [];
  let total = 0;
  for (const f of pick) {
    try {
      const file = await readFile(full, f.path, tree.branch);
      const piece = `--- ${f.path} ---\n${file.content.slice(0, MAX_FILE)}\n`;
      if (total + piece.length > MAX_TOTAL) break;
      chunks.push(piece);
      total += piece.length;
    } catch {}
  }
  const commits = await recentCommits(full, 10, tree.branch).catch(() => []);
  const issues = await listIssues(full, 10).catch(() => []);
  return { info, branch: tree.branch, fileCount: tree.files.length, code: chunks.join('\n'), commits, issues };
}

export async function analyzeRepo(full) {
  const ctx = await repoContext(full);
  if (!isReady()) {
    return { report: 'Repo okundu ama AI analizi için Ayarlar’dan ücretsiz anahtar gerekiyor.', ctx };
  }
  const report = await chat(
    [
      {
        role: 'system',
        content: `${buildSystemPrompt()}

Şu an GELİŞTİRİCİ MODUNDASIN. Bir GitHub reposunun içeriği verilecek.
Türkçe, şu başlıklarla kısa ve somut bir rapor yaz:
1) Proje özeti (2-3 cümle)
2) Güçlü yönler
3) Riskler / eksikler
4) Öncelik sıralı 5 geliştirme önerisi
Lafla kalabalık yapma.`,
      },
      {
        role: 'user',
        content: `REPO: ${ctx.info.full}\nAÇIKLAMA: ${ctx.info.description || '-'}\nDİL: ${ctx.info.language || '-'}\n` +
          `SON COMMİTLER:\n${ctx.commits.map((c) => `- ${c.sha} ${c.message}`).join('\n') || '-'}\n` +
          `AÇIK ISSUE'LAR:\n${ctx.issues.map((i) => `- #${i.number} ${i.title}`).join('\n') || '-'}\n\n` +
          `DOSYALAR:\n${ctx.code || '(okunamadı)'}`,
      },
    ],
    { temperature: 0.4, maxTokens: 1400 }
  );
  return { report, ctx };
}

export async function dailySummary(full) {
  const commits = await recentCommits(full, 20).catch(() => []);
  const issues = await listIssues(full, 15).catch(() => []);
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const recent = commits.filter((c) => new Date(c.date).getTime() >= cutoff);
  if (!isReady()) {
    return { summary: `Son 24 saatte ${recent.length} commit, ${issues.length} açık issue. (AI özeti için anahtar gerekli.)`, counts: { commitsToday: recent.length, openIssues: issues.length } };
  }
  const summary = await chat(
    [
      { role: 'system', content: 'Sen proje yöneticisi asistanısın. Türkçe, 4-6 maddelik kısa günlük özet yaz.' },
      {
        role: 'user',
        content: `BUGÜNKÜ COMMİTLER:\n${recent.map((c) => `- ${c.author}: ${c.message}`).join('\n') || '(yok)'}\n` +
          `AÇIK ISSUE'LAR:\n${issues.map((i) => `- #${i.number} ${i.title}`).join('\n') || '(yok)'}`,
      },
    ],
    { temperature: 0.5, maxTokens: 600 }
  );
  return { summary, counts: { commitsToday: recent.length, openIssues: issues.length } };
}

/* ---------------- v71: 🌍 SİTE YAYINLAMA (GitHub Pages, sunucusuz) ----------------
   Kullanıcının KENDİ token'ıyla (yalnız onun cihazında durur) çalışır:
   1) evrim-siteler reposu yoksa oluşturur (public, auto_init)  2) <slug>.html yükler/günceller
   3) Pages'i açar  4) canlı adresi döner. Owner token'ı GEREKMEZ, app'e gömülü anahtar YOKTUR. */
function b64(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}
async function ghSend(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}
export async function publishSite(slug, html) {
  if (!(getSettings().githubToken || '').trim()) throw new Error('Ayarlar → GitHub token gir (kendi tokenın; github.com/settings/tokens, repo yetkisi)');
  const me = await ghSend('GET', '/user');
  const repoName = 'evrim-siteler';
  let repo;
  try { repo = await ghSend('GET', `/repos/${me.login}/${repoName}`); }
  catch (e) {
    if (e.status !== 404) throw e;
    repo = await ghSend('POST', '/user/repos', { name: repoName, public: true, description: 'EVRIM ile ürettiğim siteler — canlı adresler', auto_init: true });
    await new Promise((z) => setTimeout(z, 2500));   // ilk commit/branch oluşsun
  }
  const branch = repo?.default_branch || 'main';
  const path = `${String(slug).replace(/[^A-Za-z0-9_-]/g, '-')}.html`;
  const full = `/repos/${me.login}/${repoName}/contents/${path}`;
  let sha;
  try { sha = (await ghSend('GET', `${full}?ref=${branch}`)).sha; } catch (e) { if (e.status !== 404) throw e; }
  await ghSend('PUT', full, { message: `🌍 ${path} (EVRIM ile üretildi)`, content: b64(html), branch, ...(sha ? { sha } : {}) });
  try { await ghSend('GET', `/repos/${me.login}/${repoName}/pages`); }
  catch (e) { if (e.status === 404) { try { await ghSend('POST', `/repos/${me.login}/${repoName}/pages`, { source: { branch, path: '/' } }); } catch { /* ilk push'ta Pages sonra da açılabilir */ } } }
  return `https://${String(me.login).toLowerCase()}.github.io/${repoName}/${path}`;
}

// v76: ÇOK DOSYALI PROJE yayını — her dosya <slug>/<yol> altına; klasör adresi döner
export async function publishProject(slug, files) {
  if (!(getSettings().githubToken || '').trim()) throw new Error("Ayarlar → GitHub token gir (kendi tokenın; github.com/settings/tokens, repo yetkisi)");
  const me = await ghSend('GET', '/user');
  const repoName = 'evrim-siteler';
  let repo;
  try { repo = await ghSend('GET', `/repos/${me.login}/${repoName}`); }
  catch (e) {
    if (e.status !== 404) throw e;
    repo = await ghSend('POST', '/user/repos', { name: repoName, public: true, description: 'EVRIM ile ürettiğim siteler ve projeler — canlı adresler', auto_init: true });
    await new Promise((z) => setTimeout(z, 2500));
  }
  const branch = repo?.default_branch || 'main';
  const folder = String(slug).replace(/[^A-Za-z0-9_-]/g, '-');
  for (const [p, content] of Object.entries(files || {})) {
    const clean = String(p).replace(/^\/+/, '').replace(/\.\./g, '');
    if (!clean) continue;
    const full = `/repos/${me.login}/${repoName}/contents/${folder}/${clean}`;
    let sha;
    try { sha = (await ghSend('GET', `${full}?ref=${branch}`)).sha; } catch (e) { if (e.status !== 404) throw e; }
    // eslint-disable-next-line no-await-in-loop
    await ghSend('PUT', full, { message: `📦 ${folder}/${clean} (EVRIM projesi)`, content: b64(String(content)), branch, ...(sha ? { sha } : {}) });
  }
  try { await ghSend('GET', `/repos/${me.login}/${repoName}/pages`); }
  catch (e) { if (e.status === 404) { try { await ghSend('POST', `/repos/${me.login}/${repoName}/pages`, { source: { branch, path: '/' } }); } catch { /* sonraki push'ta açılır */ } } }
  return `https://${String(me.login).toLowerCase()}.github.io/${repoName}/${folder}/`;
}
