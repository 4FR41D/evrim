// src/db.js — Basit, bağımlılıksız JSON tabanlı veri katmanı.
// Her "tablo" ayrı bir .json dosyası olarak data/ altında saklanır.
// (İleride SQLite/Supabase'e geçmek istersek sadece bu dosyayı değiştirmemiz yeterli.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map();

function fileFor(table) {
  return path.join(DATA_DIR, `${table}.json`);
}

function emptyShape(table) {
  // settings tekil nesne, geri kalanı dizi
  return table === 'settings' ? {} : [];
}

export function load(table) {
  if (cache.has(table)) return cache.get(table);
  const file = fileFor(table);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = emptyShape(table);
  }
  cache.set(table, data);
  return data;
}

let writeQueue = Promise.resolve();
export function save(table) {
  const data = load(table);
  // Yazmaları sıraya al -> bozuk JSON riskini azalt
  writeQueue = writeQueue.then(() => {
    const tmp = fileFor(table) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, fileFor(table));
  }).catch((err) => console.error('[db] yazma hatası', table, err.message));
  return writeQueue;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const now = () => new Date().toISOString();

// ---------- Ayarlar (tekil nesne) ----------
const SETTINGS_DEFAULTS = {
  provider: 'auto',          // auto | groq | openrouter | gemini | demo
  apiKey: '',
  model: '',                 // boşsa sağlayıcı varsayılanı
  githubToken: '',
  githubRepo: '',            // "kullanici/repo"
  githubBranch: 'main',
  userName: '',
  language: 'tr',
  selfEvolution: true,       // öz-gelişim döngüsü açık mı
  autoCommit: false,         // AI kodu otomatik commit etsin mi (varsayılan: kapalı, güvenli)
  evolveThreshold: 0.6,      // yamaların uygulanması için gereken güven eşiği
  createdAt: null,
};

export function getSettings() {
  const s = load('settings');
  const merged = { ...SETTINGS_DEFAULTS, ...s };
  if (!merged.createdAt) {
    merged.createdAt = now();
    Object.assign(s, merged);
    save('settings');
  }
  return merged;
}

export function updateSettings(patch) {
  const s = load('settings');
  Object.assign(s, { ...getSettings(), ...patch });
  save('settings');
  return getSettings();
}

// ---------- Genel dizi yardımcıları ----------
export function all(table) {
  return load(table);
}

export function insert(table, row) {
  const rows = load(table);
  const full = { id: row.id || uid(table.slice(0, 3)), createdAt: row.createdAt || now(), ...row };
  rows.push(full);
  save(table);
  return full;
}

export function update(table, id, patch) {
  const rows = load(table);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: now() });
  save(table);
  return row;
}

export function remove(table, id) {
  const rows = load(table);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  rows.splice(idx, 1);
  save(table);
  return true;
}

export function find(table, id) {
  return load(table).find((r) => r.id === id) || null;
}

// ---------- Prompt sürüm geçmişi (kendini geliştirme kayıtları) ----------
export const DEFAULT_BASE_PROMPT = `Sen EVRİM'sin: kullanıcısına yardım eden, onu tanıdıkça daha iyi hale gelen bir yapay zekâ asistanı.

TEMEL İLKELER
1) Türkçe yanıt ver (kullanıcı başka dilde yazarsa o dilde yanıt ver).
2) Kısa, net ve uygulanabilir ol. Gereksiz giriş cümlelerinden kaçın.
3) Bilmediğin şeyi uydurma; "bilmiyorum" de ve nasıl öğrenebileceğini söyle.
4) Kullanıcının hedeflerini, tercihlerini ve geçmiş hatalarını hatırla; yanıtlarını bunlara göre kişiselleştir.
5) Kod verirken çalışır, kopyala-yapıştır edilebilir örnekler ver.
6) Adım adım talimat istendiğinde numaralı liste kullan.

GÖREVLERİN
- Kişisel asistan: soruları cevapla, plan yap, özetle, kod yaz.
- Öğrenme koçu: kullanıcının zayıf olduğu konularda soru sor, seviyesine göre zorluk ayarla.
- GitHub yardımcısı: repoyu analiz et, commit/issue özetle, geliştirme önerisi üret, kod değişikliği hazırla.
- Kendini geliştirme: her etkileşimden sonra öğrendiklerini hafızaya yaz ve kurallarını iyileştir.`;

export function currentPrompt() {
  const rows = load('prompts');
  if (!rows.length) {
    const first = {
      id: 'prompt_base',
      version: 1,
      text: DEFAULT_BASE_PROMPT,
      reason: 'Başlangıç kişiliği',
      source: 'base',
      createdAt: now(),
    };
    rows.push(first);
    save('prompts');
    return first;
  }
  return rows[rows.length - 1];
}

export function pushPromptVersion({ text, reason, source = 'self', patch = null }) {
  const rows = load('prompts');
  const last = currentPrompt();
  const next = {
    id: uid('prompt'),
    version: (last.version || 1) + 1,
    text,
    reason,
    source,
    patch,
    createdAt: now(),
  };
  rows.push(next);
  save('prompts');
  return next;
}

export function rollbackPrompt(id) {
  const rows = load('prompts');
  const target = rows.find((r) => r.id === id);
  if (!target) return null;
  const last = rows[rows.length - 1];
  const next = {
    id: uid('prompt'),
    version: (last.version || 1) + 1,
    text: target.text,
    reason: `v${target.version} sürümüne geri alındı`,
    source: 'rollback',
    createdAt: now(),
  };
  rows.push(next);
  save('prompts');
  return next;
}
