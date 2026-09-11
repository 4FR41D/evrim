/* js/store.js — tarayıcı yerel deposu (localStorage)
   Sunucusuz sürümde tüm veriler kullanıcının kendi cihazında durur. */
const NS = 'evrim:';

const DEFAULT_SETTINGS = {
  provider: 'auto',        // auto | groq | openrouter | gemini
  apiKey: '',
  model: '',
  userName: '',
  selfEvolution: true,
  evolveThreshold: 0.6,
  autoApply: true,         // yamaları otomatik uygula (kapalıysa hep onay bekler)
  githubToken: '',         // isteğe bağlı: sadece kendi repolarını okumak için
  githubRepo: '',
  createdAt: null,
};

export const store = {
  read(table, fallback) {
    try {
      const raw = localStorage.getItem(NS + table);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  write(table, value) {
    try { localStorage.setItem(NS + table, JSON.stringify(value)); }
    catch (e) { console.error('localStorage yazılamadı', e); }
    return value;
  },
  remove(table) { localStorage.removeItem(NS + table); },
};

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const now = () => new Date().toISOString();

// ---------- tekil tablolar ----------
export function getSettings() {
  const s = store.read('settings', {});
  const merged = { ...DEFAULT_SETTINGS, ...s };
  if (!merged.createdAt) { merged.createdAt = now(); store.write('settings', merged); }
  return merged;
}
export function setSettings(patch) {
  return store.write('settings', { ...getSettings(), ...patch });
}

// ---------- dizi tablolar ----------
function rows(table) { return store.read(table, []); }

export function all(table) { return rows(table); }

export function insert(table, row) {
  const list = rows(table);
  const full = { id: row.id || uid(table.slice(0, 3)), createdAt: row.createdAt || now(), ...row };
  list.push(full);
  store.write(table, list);
  return full;
}

export function update(table, id, patch) {
  const list = rows(table);
  const row = list.find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: now() });
  store.write(table, list);
  return row;
}

export function remove(table, id) {
  const list = rows(table);
  const i = list.findIndex((r) => r.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  store.write(table, list);
  return true;
}

export function find(table, id) { return rows(table).find((r) => r.id === id) || null; }

// ---------- beyin (sistem promptu) sürüm geçmişi ----------
export const BASE_PROMPT = `Sen EVRIM'sin: kullanıcısına yardım eden, onu tanıdıkça daha iyi hale gelen bir yapay zekâ asistanı.

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
- GitHub yardımcısı: repoyu analiz et, özetle, geliştirme önerisi üret.
- Kendini geliştirme: her etkileşimden sonra öğrendiklerini hafızaya yaz ve kurallarını iyileştir.`;

export function currentPrompt() {
  const list = rows('prompts');
  if (!list.length) {
    const first = { id: 'prompt_base', version: 1, text: BASE_PROMPT, reason: 'Başlangıç kişiliği', source: 'base', createdAt: now() };
    store.write('prompts', [first]);
    return first;
  }
  return list[list.length - 1];
}

export function pushPromptVersion({ text, reason, source = 'self', patch = null }) {
  const list = rows('prompts');
  if (!list.length) currentPrompt();
  const last = list[list.length - 1];
  const next = { id: uid('prompt'), version: (last?.version || 1) + 1, text, reason, source, patch, createdAt: now() };
  list.push(next);
  store.write('prompts', list);
  return next;
}

export function rollbackPrompt(id) {
  const list = rows('prompts');
  const target = list.find((r) => r.id === id);
  if (!target) return null;
  const next = {
    id: uid('prompt'), version: (list[list.length - 1]?.version || 1) + 1,
    text: target.text, reason: `v${target.version} sürümüne geri alındı`, source: 'rollback', createdAt: now(),
  };
  list.push(next);
  store.write('prompts', list);
  return next;
}

// ---------- yedekleme (cihazlar arası taşımak için) ----------
const TABLES = ['settings', 'memories', 'prompts', 'evolutions', 'skills', 'cards', 'reviews', 'messages', 'conversations'];

export function exportData() {
  const out = { app: 'EVRIM-web', version: 1, exportedAt: now() };
  for (const t of TABLES) out[t] = store.read(t, t === 'settings' ? {} : []);
  return JSON.stringify(out, null, 2);
}

export function importData(json, { merge = false } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.app !== 'EVRIM-web') throw new Error('Bu bir EVRIM yedek dosyası değil');
  for (const t of TABLES) {
    if (data[t] === undefined) continue;
    if (!merge) { store.write(t, data[t]); continue; }
    if (t === 'settings') { store.write(t, { ...getSettings(), ...data[t] }); continue; }
    const existing = rows(t);
    const ids = new Set(existing.map((r) => r.id));
    for (const r of data[t] || []) if (!ids.has(r.id)) existing.push(r);
    store.write(t, existing);
  }
  return true;
}

export function wipeData() {
  for (const t of TABLES) store.remove(t);
}

export function storageSize() {
  let total = 0;
  for (const t of TABLES) total += (localStorage.getItem(NS + t) || '').length;
  return total;
}
