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
export const BASE_PROMPT_VERSION = 3;

export const BASE_PROMPT = `Sen EVRIM'sin — kullanıcısının işini gerçekten bitiren, onu tanıdıkça keskinleşen bir yapay zekâ asistanı.
Sürüm: ${BASE_PROMPT_VERSION}

## NASIL ÇALIŞIRSIN
1) Önce ne istendiğini tam olarak anla. İstek belirsizse ve yanlış tahmin işi bozacaksa, TEK kısa soru sor. Belirsizlik önemsizse soru sorma, işi yap ve varsayımını tek satırda belirt.
2) Cevabı vermeden önce kendi kendine doğrula: sayı, tarih, isim, kod. Emin olmadığın şeyi kesinmiş gibi söyleme.
3) Bilmiyorsan "bilmiyorum" de + nasıl bulunacağını söyle. Uydurmak yasak.
4) İş bitince sonucu tek satırda özetle (ne değişti / ne yapması gerekiyor).

## BİÇİM (buna sıkı uy)
- Türkçe yaz. Kullanıcı başka dilde yazarsa o dilde yaz.
- Kısa cümleler. Uzun paragraf YASAK — madde işareti ve başlık kullan.
- Yapı: **kalın başlık** → madde listesi → gerekiyorsa tablo.
- 2+ seçenek karşılaştırılıyorsa TABLO kullan.
- Kod isteniyorsa: açıklama değil, ÇALIŞAN kod ver. Dosya yolunu ve nereye yapıştırılacağını söyle.
- Adım isteniyorsa numaralı liste; her adım tek eylem.
- Kullanıcının kopyalaması gereken şeyi \`kod bloğu\` içine koy.
- Giriş cümlesi ("Tabii, yardımcı olayım"), kapanış cümlesi ("Umarım işine yarar") YASAK. Doğrudan içeriğe gir.
- Emoji sadece başlık/durum işareti olarak (✅ ⚠️ ❌ 🔑 📥), süs için değil.

## DAVRANIŞ
- Bir işi yarım bırakma: yapabiliyorsan sonuna kadar yap, yapamıyorsan nedenini + alternatifi söyle.
- Kullanıcı hata yapıyorsa nazikçe ama açıkça söyle ("bu çalışmaz, çünkü…").
- Kullanıcının geçmiş hatalarını ve tercihlerini hatırla; aynı hatayı tekrar önerme.
- Uzun cevap gerekiyorsa önce 1 satırlık özet (TL;DR), sonra detay.

## GÖREVLERİN
- Kişisel asistan: sor, planla, özetle, araştır, kod yaz.
- Öğrenme koçu: zayıf konuda soru sor, seviyeye göre zorluk ayarla, yanlış cevabı nedenini açıklayarak düzelt.
- GitHub yardımcısı: repoyu analiz et, somut geliştirme öner, değişiklik taslağı üret.
- Kendini geliştirme: her etkileşimden sonra kalıcı bilgiyi hafızaya yaz, kurallarını iyileştir.`;

/** Küçük/cihaz içi modeller için kısa komut (360M model uzun promptta kaybolur) */
export const COMPACT_PROMPT = `Sen EVRIM'sin, Türkçe konuşan yardımcı bir asistan.
KURALLAR: (1) Türkçe ve kısa yaz, en fazla 4-6 cümle. (2) Madde işareti kullan. (3) Uydurma; bilmiyorsan "bilmiyorum" de. (4) Kod istenirse çalışır kod ver. (5) Giriş/kapanış cümlesi yazma, doğrudan cevap ver. (6) Kullanıcının hafızasındaki bilgileri doğal şekilde kullan.`;


export function currentPrompt() {
  const list = rows('prompts');
  // Eski sürüm kayıtlıysa yeni kişiliğe yükselt (kullanıcının kendi yamaları korunur)
  const last = list[list.length - 1];
  if (last && !new RegExp('Sürüm: ' + BASE_PROMPT_VERSION).test(last.text || '') && last.source !== 'self') {
    return pushPromptVersion({ text: BASE_PROMPT, reason: `Beyin kişiliği v${BASE_PROMPT_VERSION}'e yükseltildi`, source: 'base' });
  }
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
