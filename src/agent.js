// src/agent.js — GitHub repounu analiz edip geliştirme önerisi + kod üreten "kendini geliştiren" ajan.
import { chat, chatJSON, activeProvider } from './llm.js';
import { getSettings, insert } from './db.js';
import * as gh from './github.js';
import { buildSystemPrompt } from './evolve.js';

const MAX_FILE_CHARS = 6000;
const MAX_TOTAL_CHARS = 24000;

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|py|go|rs|java|kt|swift|rb|php|html|css|scss|md|yml|yaml|sh|sql|vue|svelte)$/i;

export async function repoContext(full, token, { branch, maxFiles = 8 } = {}) {
  const info = await gh.repoInfo(full, token);
  const tree = await gh.fileTree(full, token, branch || info.defaultBranch);
  const interesting = tree.files
    .filter((f) => CODE_EXT.test(f.path))
    .filter((f) => !/(node_modules|dist|build|\.min\.|lock)/.test(f.path))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, maxFiles);

  const chunks = [];
  let total = 0;
  for (const f of interesting) {
    try {
      const file = await gh.readFile(full, f.path, token, tree.branch);
      const body = file.content.slice(0, MAX_FILE_CHARS);
      const piece = `--- ${f.path} ---\n${body}\n`;
      if (total + piece.length > MAX_TOTAL_CHARS) break;
      chunks.push(piece);
      total += piece.length;
    } catch {
      /* dosya okunamadıysa atla */
    }
  }

  const commits = await gh.recentCommits(full, token, { branch: tree.branch, limit: 10 }).catch(() => []);
  const issues = await gh.listIssues(full, token, { limit: 10 }).catch(() => []);

  return {
    info,
    branch: tree.branch,
    fileCount: tree.files.length,
    filesRead: chunks.length,
    code: chunks.join('\n'),
    commits,
    issues,
  };
}

/** Repoya bakıp iyileştirme yol haritası çıkarır */
export async function analyzeRepo(full, token, opts = {}) {
  const ctx = await repoContext(full, token, opts);
  if (activeProvider().id === 'demo') {
    return {
      demo: true,
      ctx: { info: ctx.info, fileCount: ctx.fileCount, filesRead: ctx.filesRead, commits: ctx.commits, issues: ctx.issues },
      report: 'Demo modu: repo içeriği okundu ama AI analizi için ücretsiz anahtar gerekiyor.',
    };
  }
  const report = await chat(
    [
      {
        role: 'system',
        content: `${buildSystemPrompt()}

Şu an GELİŞTİRİCİ MODUNDASIN. Sana bir GitHub reposunun içeriği verilecek.
Türkçe olarak şu başlıklarla kısa ama somut bir rapor yaz:
1) Proje özeti (2-3 cümle)
2) Güçlü yönler
3) Riskler / eksikler (test, güvenlik, hata yönetimi, dokümantasyon)
4) Öncelik sıralı 5 geliştirme önerisi (her biri tek cümle + neden)
Gereksiz laf kalabalığı yapma.`,
      },
      {
        role: 'user',
        content: `REPO: ${ctx.info.full}\nAÇIKLAMA: ${ctx.info.description || '-'}\nDİL: ${ctx.info.language || '-'}\n` +
          `SON COMMİTLER:\n${ctx.commits.map((c) => `- ${c.sha} ${c.message}`).join('\n') || '-'}\n` +
          `AÇIK ISSUE'LAR:\n${ctx.issues.map((i) => `- #${i.number} ${i.title}`).join('\n') || '-'}\n\n` +
          `DOSYA İÇERİKLERİ (${ctx.filesRead} dosya):\n${ctx.code || '(kod okunamadı)'}`,
      },
    ],
    { temperature: 0.4, maxTokens: 1200 }
  );
  insert('evolutions', {
    type: 'repo-analysis',
    summary: `Repo analizi: ${ctx.info.full}`,
    detail: report.slice(0, 400),
    applied: true,
    confidence: 1,
  });
  return { report, ctx: { info: ctx.info, fileCount: ctx.fileCount, filesRead: ctx.filesRead, branch: ctx.branch } };
}

/**
 * AI'ın KENDİ KODUNU yazması: bir görev verilir, repodaki ilgili dosyaları okur,
 * yeni/ güncellenmiş dosya içerikleri üretir. autoCommit açıksa doğrudan commit atar.
 */
export async function implementTask({ task, full, token, branch, targetPaths = [], autoCommit = null, commitMessage }) {
  const s = getSettings();
  const repo = full || s.githubRepo;
  if (!repo) throw new Error('Önce bir repo bağla (Ayarlar → GitHub).');
  if (activeProvider().id === 'demo') {
    return { demo: true, message: 'Kod üretmek için ücretsiz bir AI anahtarı gerekiyor (Ayarlar).' };
  }

  // İlgili dosyaları topla
  const tree = await gh.fileTree(repo, token, branch);
  const wanted = targetPaths.length ? tree.files.filter((f) => targetPaths.includes(f.path)) : [];
  let files = wanted;
  if (!files.length) {
    files = tree.files
      .filter((f) => CODE_EXT.test(f.path) && !/(node_modules|dist|lock)/.test(f.path))
      .slice(0, 6);
  }
  const chunks = [];
  let total = 0;
  for (const f of files) {
    try {
      const file = await gh.readFile(repo, f.path, token, tree.branch);
      const piece = `--- ${f.path} ---\n${file.content.slice(0, MAX_FILE_CHARS)}\n`;
      if (total + piece.length > MAX_TOTAL_CHARS) break;
      chunks.push(piece);
      total += piece.length;
    } catch {}
  }

  const out = await chatJSON(
    [
      {
        role: 'system',
        content: `Sen deneyimli bir yazılımcısın ve bu repoya katkı yapıyorsun.
SADECE JSON döndür:
{
  "plan": "2-3 cümlelik Türkçe açıklama: ne yaptın, neden",
  "files": [{"path":"repo/içinde/yol","content":"dosyanın TAM yeni içeriği","isNew":true|false}],
  "commitMessage": "conventional commit formatında İngilizce mesaj"
}
KURALLAR:
- content alanı dosyanın TAMAMINI içermeli (parça değil).
- Sadece gerçekten değiştirmen gereken dosyaları listele (maks 3).
- Mevcut kod stiline uy. Yorum satırlarını Türkçe yazma, kodun diline uygun bırak.
- Yeni dosya ekliyorsan isNew: true.`,
      },
      {
        role: 'user',
        content: `GÖREV: ${task}\n\nMEVCUT DOSYALAR:\n${chunks.join('\n') || '(okunamadı)'}`,
      },
    ],
    { temperature: 0.3, maxTokens: 3000 }
  );

  if (!out?.files?.length) {
    return { plan: out?.plan || 'Model dosya üretmedi.', files: [], committed: null };
  }

  const doCommit = autoCommit ?? s.autoCommit;
  let committed = null;
  if (doCommit) {
    if (!token) throw new Error('Otomatik commit için GitHub token gerekiyor.');
    committed = await gh.commitFiles({
      full: repo,
      token,
      branch: branch || s.githubBranch || tree.branch,
      message: commitMessage || out.commitMessage || `feat: ${task.slice(0, 60)}`,
      files: out.files.map((f) => ({ path: f.path, content: f.content })),
    });
  }

  insert('evolutions', {
    type: 'code-change',
    summary: `Kod üretildi: ${task.slice(0, 80)}`,
    detail: `${out.plan || ''} | dosyalar: ${out.files.map((f) => f.path).join(', ')}${committed ? ` | commit ${committed.sha}` : ''}`,
    applied: !!committed,
    confidence: 1,
  });

  return { plan: out.plan, files: out.files, commitMessage: out.commitMessage, committed };
}

export async function commitFile({ full, token, branch, path, content, message }) {
  const res = await gh.commitFiles({
    full,
    token,
    branch,
    message: message || `chore: update ${path} via EVRIM`,
    files: [{ path, content }],
  });
  insert('evolutions', {
    type: 'code-change',
    summary: `Commit atıldı: ${path}`,
    detail: `commit ${res.sha} (${res.branch})`,
    applied: true,
    confidence: 1,
  });
  return res;
}

/** Son 24 saatin GitHub özeti */
export async function dailySummary(full, token) {
  const commits = await gh.recentCommits(full, token, { limit: 20 }).catch(() => []);
  const issues = await gh.listIssues(full, token, { limit: 15 }).catch(() => []);
  const pulls = await gh.listPulls(full, token, { limit: 15 }).catch(() => []);
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const recent = commits.filter((c) => new Date(c.date).getTime() >= cutoff);

  if (activeProvider().id === 'demo') {
    return {
      demo: true,
      counts: { commitsToday: recent.length, openIssues: issues.length, openPRs: pulls.length },
      summary: `Son 24 saatte ${recent.length} commit. Açık issue: ${issues.length}, açık PR: ${pulls.length}. (AI özeti için anahtar gerekli.)`,
    };
  }
  const summary = await chat(
    [
      { role: 'system', content: 'Sen bir proje yöneticisi asistanısın. Türkçe, 4-6 maddelik kısa günlük özet yaz.' },
      {
        role: 'user',
        content: `BUGÜNKÜ COMMİTLER:\n${recent.map((c) => `- ${c.author}: ${c.message}`).join('\n') || '(yok)'}\n` +
          `AÇIK ISSUE'LAR:\n${issues.map((i) => `- #${i.number} ${i.title}`).join('\n') || '(yok)'}\n` +
          `AÇIK PR'LAR:\n${pulls.map((p) => `- #${p.number} ${p.title}`).join('\n') || '(yok)'}`,
      },
    ],
    { temperature: 0.5, maxTokens: 500 }
  );
  return { summary, counts: { commitsToday: recent.length, openIssues: issues.length, openPRs: pulls.length } };
}
