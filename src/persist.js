// src/persist.js — Veri kalıcılığı
// Problem: Render/Koyeb gibi ücretsiz platformlarda disk GEÇİCİDİR (spin-down + deploy = veri kaybı).
// Çözüm: data/ klasörünü GitHub'daki ÖZEL bir repoda yedekle ve açılışta geri yükle.
// Böylece bellek, beyin sürümleri ve öğrenme kartları yeniden başlatmalarda kaybolmaz.
//
// Ortam değişkenleri:
//   PERSIST=1            -> kalıcılık açık (bulutta zorunlu, lokalde kapalı olabilir)
//   DATA_REPO=sahip/repo -> veri reposu (boşsa: önce özel repo oluşturulur, olmazsa bağlı repo)
//   DATA_BRANCH=evrim-data
//   DATA_KEY             -> yedekleri şifrelemek için parola (önerilir)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, getSettings, reloadAll } from './db.js';

const API = 'https://api.github.com';
const UA = { 'User-Agent': 'EVRIM-persist', Accept: 'application/vnd.github+json' };
const BRANCH = process.env.DATA_BRANCH || 'evrim-data';
// İlk başarılı geri yüklemeden sonra yazılır. Yoksa -> disk taze (ör. yeni deploy),
// bu durumda UZAK yedek koşulsuz kazanır; yerel varsayılanlar veriyi ezmesin.
const MARKER = () => path.join(DATA_DIR, '.restored');
const ALGO = 'aes-256-gcm';

const state = {
  enabled: false,
  repo: null,
  token: null,
  lastSync: null,
  lastError: null,
  syncing: false,
  timer: null,
  dirty: false,
  remote: new Map(), // path -> blob sha
};

const isWin = () => process.platform === 'win32';

function gh(pathname, { token, method = 'GET', body } = {}) {
  return fetch(`${API}${pathname}`, {
    method,
    headers: { ...UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data?.message || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return data;
  });
}

// ---------- şifreleme (DATA_KEY verilirse) ----------
function cipherKey() {
  const k = process.env.DATA_KEY;
  if (!k) return null;
  return crypto.createHash('sha256').update(String(k)).digest();
}

function encrypt(text) {
  // Çıktı her zaman base64 (GitHub blob "base64" encoding ile gönderiliyor).
  // Şifreli biçim: "enc1:" + base64(iv|tag|ciphertext) -> hepsi tek base64 katmanında.
  const key = cipherKey();
  if (!key) return Buffer.from(text, 'utf8').toString('base64');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  const inner = Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  return Buffer.concat([Buffer.from('enc2:'), Buffer.from(inner, 'ascii')]).toString('base64');
}

function decrypt(b64) {
  // GitHub blob içeriği base64 -> bir kez çöz, SONRA biçime bak.
  // (İki kez base64 çözmek IV'yi bozuyordu.)
  const outer = Buffer.from(b64 || '', 'base64');
  const key = cipherKey();
  const head = outer.subarray(0, 5).toString('ascii');
  if (head !== 'enc1:' && head !== 'enc2:') {
    return outer.toString('utf8'); // şifrelenmemiş yedek
  }
  if (!key) throw new Error('Yedek şifreli ama DATA_KEY tanımlı değil (DATA_KEY ortam değişkenini aynı değerle ayarla)');
  // İki biçim desteklenir:
  //   enc2: = base64(iv|tag|ct)   (güncel, sağlam)
  //   enc1: = ham iv|tag|ct       (eski sürüm yedekleri)
  const marker = outer.subarray(0, 5).toString('ascii');
  const rest = outer.subarray(5);
  const buf = marker === 'enc2:' ? Buffer.from(rest.toString('ascii'), 'base64') : rest;
  if (buf.length < 29) throw new Error('Yedek bozuk veya DATA_KEY farklı');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = crypto.createDecipheriv(ALGO, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// ---------- kurulum ----------
export async function initPersist() {
  const on = process.env.PERSIST === '1' || process.env.PERSIST === 'true';
  if (!on) {
    state.enabled = false;
    return { enabled: false, reason: 'PERSIST kapalı (yerel mod)' };
  }
  const s = getSettings();
  // Disk sıfırlanırsa settings.json de gider -> token'ı ortam değişkeninden de oku.
  // (Bulutta bu yüzden GITHUB_TOKEN env var'ı tanımlamak şart.)
  const token = (process.env.GITHUB_TOKEN || '').trim() || s.githubToken;
  if (!token) {
    state.lastError = 'Kalıcılık için GitHub token gerekiyor (Ayarlar → GitHub)';
    return { enabled: false, reason: state.lastError };
  }
  state.token = token;

  let repo = process.env.DATA_REPO || s.dataRepo;
  if (!repo) {
    try {
      const me = await gh('/user', { token });
      const name = 'evrim-data';
      await gh('/user/repos', { token, method: 'POST', body: { name, private: true, description: 'EVRIM uygulama verisi (otomatik yedek)' } })
        .catch((e) => { if (e.status !== 422) throw e; }); // 422 = zaten var
      repo = `${me.login}/${name}`;
      console.log(`[persist] özel veri reposu hazır: ${repo}`);
    } catch (e) {
      // Token'da repo oluşturma yetkisi yoksa bağlı repoya düş
      repo = s.githubRepo;
      console.log(`[persist] özel repo oluşturulamadı (${e.message}), dal olarak yedeklenecek: ${repo}`);
    }
  }
  if (!repo) {
    state.lastError = 'Veri reposu belirlenemedi. DATA_REPO ortam değişkenini ayarla.';
    return { enabled: false, reason: state.lastError };
  }

  state.repo = repo;
  state.enabled = true;

  // Dal yoksa oluştur (boş repoda ilk commit gerekir)
  try {
    await gh(`/repos/${repo}/git/ref/heads/${BRANCH}`, { token });
  } catch (e) {
    if (e.status === 404 || e.status === 409) {
      const file = await gh(`/repos/${repo}/contents/README.md`, {
        token, method: 'PUT',
        body: {
          message: 'chore: EVRIM veri deposu başlatma',
          content: Buffer.from(`# EVRIM veri yedeği\n\nBu depo EVRIM uygulamasının ${BRANCH} dalında otomatik yedek tutar.\n`).toString('base64'),
          branch: BRANCH,
        },
      }).catch(() => null);
      if (file) {
        console.log(`[persist] ${repo}@${BRANCH} dalı oluşturuldu`);
      } else {
        state.lastError = `Veri dalı oluşturulamadı (${repo}@${BRANCH})`;
        state.enabled = false;
        return { enabled: false, reason: state.lastError };
      }
    } else {
      state.lastError = e.message;
      state.enabled = false;
      return { enabled: false, reason: state.lastError };
    }
  }

  try {
    const r = await pull();
    reloadAll(); // diskten geri yüklenen veriyi belleğe al
    console.log(`[persist] geri yükleme tamam: ${r.restored || 0} dosya`);
    // Ortam değişkenindeki token settings.json'a da yazılsın (arayüzde görünsün)
    if (process.env.GITHUB_TOKEN && !getSettings().githubToken) {
      const { updateSettings } = await import('./db.js');
      updateSettings({ githubToken: process.env.GITHUB_TOKEN });
    }
  } catch (e) {
    state.lastError = `pull: ${e.message}`;
    console.error('[persist]', state.lastError);
  }

  // Otomatik kaydetme: 3 dakikada bir (sadece değişiklik varsa)
  const intervalMs = Number(process.env.PERSIST_INTERVAL_MS || 180000);
  if (intervalMs > 0) {
    state.timer = setInterval(() => { if (state.dirty) push().catch(() => {}); }, intervalMs);
    state.timer.unref?.();
  }
  return { enabled: true, repo, branch: BRANCH, encrypted: !!cipherKey() };
}

/** Bir veri dosyasının "doluluğunu" puanla: varsayılan/boş dosya düşük puan alır. */
function richness(v) {
  if (v == null) return -1;
  if (Array.isArray(v)) return v.length;
  let score = 0;
  if (v.apiKey) score += 3;
  if (v.githubToken) score += 2;
  if (v.githubRepo) score += 1;
  if (v.userName) score += 1;
  if (v.model) score += 1;
  if (v.text) score += 2;            // prompts
  if (v.content) score += 2;         // memories
  score += Object.keys(v).filter((k) => k !== '__updatedAt' && v[k] !== '' && v[k] != null).length * 0.01;
  return score;
}
let sawFresh = false;
function freshDiskNote(n) {
  return sawFresh && n ? ' (taze disk → uzak yedek öncelikli)' : '';
}

function localFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
}

/** Uzak yedeği yerel diske indir. Çakışırsa "en yeni olan kazanır". */
export async function pull() {
  if (!state.enabled) return { skipped: true };
  let tree;
  try {
    tree = await gh(`/repos/${state.repo}/git/trees/${BRANCH}?recursive=1`, { token: state.token });
  } catch (e) {
    if (e.status === 404) return { files: 0, note: 'uzakta yedek yok' };
    throw e;
  }
  const blobs = (tree.tree || []).filter((t) => t.type === 'blob' && t.path.startsWith('data/'));
  sawFresh = !fs.existsSync(MARKER());
  let restored = 0;
  for (const b of blobs) {
    const name = path.basename(b.path);
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await gh(`/repos/${state.repo}/git/blobs/${b.sha}`, { token: state.token });
      const text = decrypt(raw.content);
      const parsed = JSON.parse(text); // bozuk dosyayı geri yükleme
      const local = path.join(DATA_DIR, name);
      const freshDisk = !fs.existsSync(MARKER());
      let keepRemote = true;
      if (!freshDisk && fs.existsSync(local)) {
        try {
          const localParsed = JSON.parse(fs.readFileSync(local, 'utf8'));
          keepRemote = richness(parsed) > richness(localParsed);
        } catch {
          keepRemote = true; // yerel bozuksa uzak kazanır
        }
      }
      if (keepRemote) {
        fs.writeFileSync(local, JSON.stringify(parsed, null, 2));
        restored++;
      }
      state.remote.set(name, b.sha);
    } catch (e) {
      console.error(`[persist] ${name} geri yüklenemedi: ${e.message}${/DATA_KEY/.test(e.message) ? ' (DATA_KEY farklı olabilir)' : ''}`);
    }
  }
  if (blobs.length) fs.writeFileSync(MARKER(), new Date().toISOString());
  console.log(`[persist] pull: ${restored}/${blobs.length} dosya geri yüklendi${freshDiskNote(blobs.length)}`);
  return { files: blobs.length, restored };
}

/** Yerel data/ klasörünü uzak dala yedekle (sadece değişen dosyalar). */
export async function push() {
  if (!state.enabled || state.syncing) return { skipped: true };
  state.syncing = true;
  try {
    const files = localFiles();
    const treeItems = [];
    for (const name of files) {
      let text;
      try {
        text = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
        JSON.parse(text); // geçerli JSON olmayanı gönderme
      } catch { continue; }
      // __updatedAt damgası ekle (çakışma çözümünde kullanılıyor)
      const stamp = Date.now();
      let stamped = text;
      try {
        const obj = JSON.parse(text);
        if (obj && !Array.isArray(obj)) { obj.__updatedAt = stamp; stamped = JSON.stringify(obj, null, 2); }
      } catch {}
      const content = encrypt(stamped);
      const sha = crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content, 'base64')}\0`).digest();
      void sha;
      const blob = await gh(`/repos/${state.repo}/git/blobs`, {
        token: state.token, method: 'POST',
        body: { content, encoding: 'base64' },
      });
      if (blob.sha === state.remote.get(name)) continue; // değişmemiş
      state.remote.set(name, blob.sha);
      treeItems.push({ path: `data/${name}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (!treeItems.length) { state.dirty = false; return { files: 0 }; }

    let parentSha = null;
    let baseTree = null;
    try {
      const ref = await gh(`/repos/${state.repo}/git/ref/heads/${BRANCH}`, { token: state.token });
      parentSha = ref.object.sha;
      const commit = await gh(`/repos/${state.repo}/git/commits/${parentSha}`, { token: state.token });
      baseTree = commit.tree.sha;
    } catch {}

    const tree = await gh(`/repos/${state.repo}/git/trees`, {
      token: state.token, method: 'POST',
      body: baseTree ? { base_tree: baseTree, tree: treeItems } : { tree: treeItems },
    });
    const commit = await gh(`/repos/${state.repo}/git/commits`, {
      token: state.token, method: 'POST',
      body: {
        message: `chore(data): ${treeItems.length} dosya yedeklendi`,
        tree: tree.sha,
        ...(parentSha ? { parents: [parentSha] } : {}),
      },
    });
    if (parentSha) {
      await gh(`/repos/${state.repo}/git/refs/heads/${BRANCH}`, { token: state.token, method: 'PATCH', body: { sha: commit.sha } });
    } else {
      await gh(`/repos/${state.repo}/git/refs`, { token: state.token, method: 'POST', body: { ref: `refs/heads/${BRANCH}`, sha: commit.sha } });
    }
    state.lastSync = new Date().toISOString();
    state.lastError = null;
    state.dirty = false;
    return { files: treeItems.length, sha: commit.sha.slice(0, 7), at: state.lastSync };
  } catch (e) {
    state.lastError = e.message;
    console.error('[persist] push:', e.message);
    return { error: e.message };
  } finally {
    state.syncing = false;
  }
}

export function markDirty() { state.dirty = true; }

export function persistStatus() {
  return {
    enabled: state.enabled,
    repo: state.repo,
    branch: state.enabled ? BRANCH : null,
    encrypted: !!cipherKey(),
    lastSync: state.lastSync,
    lastError: state.lastError,
    pending: state.dirty,
    files: localFiles().length,
  };
}
