// src/github.js — GitHub entegrasyonu
// - Token OLMADAN: public repo okuma (dosya ağacı, içerik, commit, issue, PR)
// - Token İLE: repolarını listeleme + AI'ın ürettiği kodu doğrudan repoya commit atma
const API = 'https://api.github.com';
const UA = { 'User-Agent': 'EVRIM-app', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

function headers(token) {
  const h = { ...UA };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...headers(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data?.message || `HTTP ${res.status}`;
    // Yazma işlemi 403 veriyorsa sorun neredeyse her zaman token yetkisidir
    const isWrite = options?.method && options.method !== 'GET';
    if (res.status === 403 && isWrite && !/rate limit/i.test(msg)) {
      msg = `Token'ın YAZMA yetkisi yok (${path.split('?')[0]}). ` +
        `Çözüm: GitHub → Settings → Developer settings → "Tokens (classic)" → Generate new token (classic) → ` +
        `sadece "repo" kutusunu işaretle → oluştur ve Ayarlar'a yapıştır.`;
    } else if (res.status === 403 && /not accessible by personal access token/i.test(msg)) {
      msg = `Token yetkisi eksik: "${path.split('?')[0]}" için izin yok.`;
    }
    const err = new Error(`GitHub: ${msg}`);
    err.status = res.status;
    err.rateLimited = res.status === 403 || res.status === 429;
    err.permission = /yetkisi eksik/.test(msg);
    throw err;
  }
  return data;
}

export function parseRepo(input) {
  // "user/repo", "https://github.com/user/repo", "git@github.com:user/repo.git" hepsini kabul et
  const s = String(input || '').trim();
  let m = s.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (m) return { owner: m[1], repo: m[2], full: `${m[1]}/${m[2]}` };
  m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) return { owner: m[1], repo: m[2], full: s };
  return null;
}

export async function repoInfo(full, token) {
  const r = parseRepo(full);
  if (!r) throw new Error('Repo biçimi hatalı. Örnek: kullanici/repo');
  const data = await gh(`/repos/${r.full}`, { token });
  return {
    full: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    language: data.language,
    defaultBranch: data.default_branch,
    private: data.private,
    updatedAt: data.updated_at,
    htmlUrl: data.html_url,
  };
}

export async function fileTree(full, token, ref) {
  const r = parseRepo(full);
  const branch = ref || (await gh(`/repos/${r.full}`, { token })).default_branch;
  const data = await gh(`/repos/${r.full}/git/trees/${branch}?recursive=1`, { token });
  return {
    branch,
    truncated: !!data.truncated,
    files: (data.tree || [])
      .filter((t) => t.type === 'blob')
      .map((t) => ({ path: t.path, size: t.size }))
      .slice(0, 2000),
  };
}

export async function readFile(full, path, token, ref) {
  const r = parseRepo(full);
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await gh(`/repos/${r.full}/contents/${encodeURI(path)}${q}`, { token });
  if (Array.isArray(data)) throw new Error('Bu bir klasör, dosya seç.');
  const content = data.encoding === 'base64'
    ? Buffer.from(data.content || '', 'base64').toString('utf8')
    : (data.content || '');
  return { path: data.path, sha: data.sha, size: data.size, content };
}

export async function recentCommits(full, token, { branch, limit = 10 } = {}) {
  const r = parseRepo(full);
  const q = new URLSearchParams({ per_page: String(limit) });
  if (branch) q.set('sha', branch);
  const data = await gh(`/repos/${r.full}/commits?${q}`, { token });
  return data.map((c) => ({
    sha: c.sha.slice(0, 7),
    fullSha: c.sha,
    message: (c.commit?.message || '').split('\n')[0],
    author: c.commit?.author?.name || c.author?.login || 'bilinmiyor',
    date: c.commit?.author?.date,
    url: c.html_url,
  }));
}

export async function listIssues(full, token, { state = 'open', limit = 20 } = {}) {
  const r = parseRepo(full);
  const data = await gh(`/repos/${r.full}/issues?state=${state}&per_page=${limit}`, { token });
  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title, state: i.state, labels: i.labels.map((l) => l.name), url: i.html_url, updatedAt: i.updated_at }));
}

export async function listPulls(full, token, { state = 'open', limit = 20 } = {}) {
  const r = parseRepo(full);
  const data = await gh(`/repos/${r.full}/pulls?state=${state}&per_page=${limit}`, { token });
  return data.map((p) => ({ number: p.number, title: p.title, state: p.state, user: p.user?.login, url: p.html_url, draft: p.draft }));
}

export async function myRepos(token) {
  if (!token) throw new Error('Repo listelemek için GitHub token gerekiyor (Ayarlar).');
  const data = await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', { token });
  return data.map((r) => ({
    full: r.full_name,
    description: r.description,
    private: r.private,
    language: r.language,
    updatedAt: r.updated_at,
    stars: r.stargazers_count,
    defaultBranch: r.default_branch,
  }));
}

export async function checkToken(token) {
  if (!token) return { ok: false, reason: 'Token boş' };
  try {
    const me = await gh('/user', { token });
    return { ok: true, login: me.login, name: me.name, avatar: me.avatar_url };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * AI'ın ürettiği dosya(ları) doğrudan repoya commit eder.
 * @param {Array<{path:string, content:string}>} files
 */
export async function commitFiles({ full, token, branch = 'main', message, files }) {
  const r = parseRepo(full);
  if (!token) throw new Error('Commit atmak için GitHub token gerekiyor (Ayarlar → GitHub).');
  if (!files?.length) throw new Error('Commit edilecek dosya yok.');

  // 1) Dal referansı. Boş repoda GitHub 404 VEYA 409 ("Git Repository is empty") döndürür.
  const isEmptyRepoError = (err) =>
    err.status === 404 || err.status === 409 || /empty/i.test(err.message || '');

  let parentSha = null;
  try {
    const refData = await gh(`/repos/${r.full}/git/ref/heads/${branch}`, { token });
    parentSha = refData.object.sha;
  } catch (err) {
    if (!isEmptyRepoError(err)) throw err;
    // Belki başka bir dal var (örn. master) -> onu dene
    try {
      const def = await gh(`/repos/${r.full}`, { token });
      if (def.default_branch && def.default_branch !== branch) {
        const alt = await gh(`/repos/${r.full}/git/ref/heads/${def.default_branch}`, { token });
        parentSha = alt.object.sha;
        branch = def.default_branch;
      }
    } catch (e2) {
      if (!isEmptyRepoError(e2)) throw e2;
      /* repo tamamen boş -> ilk commit'i biz oluşturacağız */
    }
  }

  // 2) Blob'lar
  const treeItems = [];
  for (const f of files) {
    // Binary içerik (ör. png) base64 ile gönderilmeli
    const isBinary = f.encoding === 'base64' ||
      (typeof f.content === 'string' && /[\uFFFD]/.test(f.content.slice(0, 2000)));
    const blob = await gh(`/repos/${r.full}/git/blobs`, {
      token,
      method: 'POST',
      body: isBinary
        ? { content: f.content, encoding: 'base64' }
        : { content: f.content, encoding: 'utf-8' },
    });
    treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3) Yeni tree (boş repoda base_tree yok). base_tree bir TREE sha'sı olmalı.
  let baseTreeSha = null;
  if (parentSha) {
    const parentCommit = await gh(`/repos/${r.full}/git/commits/${parentSha}`, { token });
    baseTreeSha = parentCommit.tree.sha;
  }
  const newTree = await gh(`/repos/${r.full}/git/trees`, {
    token,
    method: 'POST',
    body: baseTreeSha ? { base_tree: baseTreeSha, tree: treeItems } : { tree: treeItems },
  });

  // 4) Commit
  const commit = await gh(`/repos/${r.full}/git/commits`, {
    token,
    method: 'POST',
    body: {
      message: message || 'EVRIM: otomatik güncelleme',
      tree: newTree.sha,
      ...(parentSha ? { parents: [parentSha] } : {}),
    },
  });

  // 5) Ref güncelle ya da ilk kez oluştur
  if (parentSha) {
    await gh(`/repos/${r.full}/git/refs/heads/${branch}`, {
      token, method: 'PATCH', body: { sha: commit.sha, force: false },
    });
  } else {
    await gh(`/repos/${r.full}/git/refs`, {
      token, method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
  }

  return { sha: commit.sha.slice(0, 7), url: commit.html_url, branch, files: files.map((f) => f.path), firstCommit: !parentSha };
}

export async function createIssue({ full, token, title, body }) {
  const r = parseRepo(full);
  if (!token) throw new Error('Issue açmak için GitHub token gerekiyor.');
  const data = await gh(`/repos/${r.full}/issues`, { token, method: 'POST', body: { title, body } });
  return { number: data.number, url: data.html_url };
}

export async function rateLimit(token) {
  const data = await gh('/rate_limit', { token });
  const core = data.resources?.core;
  return { limit: core?.limit, remaining: core?.remaining, resetAt: core ? new Date(core.reset * 1000).toISOString() : null };
}
