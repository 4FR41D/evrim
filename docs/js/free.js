/* js/free.js — ANAHTARSIZ, İNDİRMESİZ "halka açık ücretsiz uç nokta" katmanı
   Bunlar topluluk tarafından işletilen ücretsiz servislerdir:
     ✅ anahtar yok, indirme yok, kota görünmüyor
     ❌ GARANTİ YOK — bugün çalışır, yarın kapanabilir (Pollinations örneğinde olduğu gibi)
   Bu yüzden: her biri sağlık kontrolünden geçer, çalışan ilk tanesi kullanılır,
   hiçbiri çalışmazsa uygulama otomatik olarak yerel modele / senin anahtarına düşer. */

const TIMEOUT_MS = 45000;

/**
 * Her sağlayıcı: { id, name, health(), chat(messages, opts) }
 * chat() düz metin döndürür.
 */
export const FREE_ENDPOINTS = [
  // NOT: Pollinations.ai burada duruyordu — 2026'da ölçüldü: 8 istek / 0 başarı
  // (402 "deprecation_notice" + Cloudflare 502). Ölü servisleri denemek kullanıcıya
  // sadece bekleme ve kafa karışıklığı yaşatıyor, o yüzden çıkarıldı.
  // Çalışan anahtarsız bir halka açık uç nokta bulunursa buraya eklenir:
  //   { id, name, async health() {...}, async chat(messages, opts) {...} }
  // (CORS başlığı access-control-allow-origin: <bizim origin> şart!)
];

async function post(url, body, ms = TIMEOUT_MS) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: c.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = JSON.parse(text)?.error?.message || JSON.parse(text)?.error || msg; } catch {}
      return { ok: false, status: res.status, text, error: msg };
    }
    return { ok: true, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.name === 'AbortError' ? 'zaman aşımı' : e.message };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- sağlık kontrolü + önbellek ---------------- */
const HEALTH_TTL = 10 * 60 * 1000;   // 10 dk
const cache = new Map();             // id -> { ok, at, name }
let workingId = null;

export function freeCacheSnapshot() {
  return [...cache.values()].map((c) => ({ id: c.id, name: c.name, ok: c.ok, at: c.at }));
}

/** Sırayla dene, çalışan ilkini döndür. */
export async function findWorkingFree({ onProgress, force = false } = {}) {
  if (!force && workingId) {
    const c = cache.get(workingId);
    if (c && c.ok && Date.now() - c.at < HEALTH_TTL) return workingId;
  }
  for (const ep of FREE_ENDPOINTS) {
    const c = cache.get(ep.id);
    if (!force && c && Date.now() - c.at < HEALTH_TTL) {
      if (c.ok) { workingId = ep.id; return ep.id; }
      continue;
    }
    onProgress?.(`Ücretsiz servis deneniyor: ${ep.name}…`);
    let ok = false;
    try { ok = await ep.health(); } catch { ok = false; }
    cache.set(ep.id, { id: ep.id, name: ep.name, ok, at: Date.now() });
    if (ok) { workingId = ep.id; return ep.id; }
  }
  workingId = null;
  return null;
}

export const hasWorkingFree = () => !!workingId && (Date.now() - (cache.get(workingId)?.at || 0) < HEALTH_TTL);

export async function freeChat(messages, opts = {}) {
  const id = await findWorkingFree({ force: !workingId });
  if (!id) throw new Error('Çalışan ücretsiz servis bulunamadı');
  const ep = FREE_ENDPOINTS.find((e) => e.id === id);
  try {
    return await ep.chat(messages, opts);
  } catch (e) {
    cache.set(id, { id, name: ep.name, ok: false, at: Date.now() });
    workingId = null;
    throw e;
  }
}

/** Ayarlar ekranı için: hepsini tek tek test et */
export async function testAllFree(onEach) {
  const results = [];
  for (const ep of FREE_ENDPOINTS) {
    onEach?.(ep.name, 'test ediliyor');
    let ok = false, err = '';
    try { ok = await ep.health(); } catch (e) { err = e.message; }
    cache.set(ep.id, { id: ep.id, name: ep.name, ok, at: Date.now() });
    results.push({ id: ep.id, name: ep.name, ok, err });
    onEach?.(ep.name, ok ? 'çalışıyor' : `çalışmıyor ${err}`);
  }
  workingId = results.find((r) => r.ok)?.id || null;
  return results;
}
