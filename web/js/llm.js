/* js/llm.js — AI yönlendirici (4 katman, otomatik düşüş)
     1) Kendi anahtarın varsa   -> Groq / OpenRouter / Gemini   (en yüksek kalite)
     2) Anahtar yoksa           -> çalışan ÜCRETSİZ halka açık servis (varsa: indirme de yok)
     3) O da yoksa + WebGPU     -> CİHAZINDA açık kaynak model (~200 MB, sınırsız, çevrimdışı)
     4) Hiçbiri                 -> net hata + çözüm önerileri
   Yani ne anahtar ne indirme ZORUNLU. */
import { getSettings, setSettings } from './store.js';
import { detectWebGPU, loadLocal, localChat, localStatus, shortName, guessTier } from './local.js';
import { findWorkingFree, hasWorkingFree, freeChat, FREE_ENDPOINTS } from './free.js';
import { detectNano, nanoStatus, createNano, nanoChat, destroyNano, hasNanoAPI } from './nano.js';

export const PROVIDERS = {
  nano: {
    name: 'Chrome Nano (cihazında)',
    defaultModel: 'Gemini Nano',
    models: [],
    signup: null,
    prefix: null,
    format: 'nano',
  },
  free: {
    name: 'Ücretsiz servis',
    defaultModel: 'topluluk',
    models: [],
    signup: null,
    prefix: null,
    format: 'free',
  },
  local: {
    name: 'Cihazın (açık kaynak)',
    defaultModel: 'auto',
    models: [],
    signup: null,
    prefix: null,
    format: 'local',
  },
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'],
    signup: 'https://console.groq.com/keys',
    prefix: 'gsk_',
    format: 'openai',
  },
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'auto',           // canlı listeden en iyi :free model seçilir
    models: [],                     // fetchFreeModels() doldurur
    dynamic: true,
    signup: 'https://openrouter.ai/settings/keys',
    prefix: 'sk-or-',
    format: 'openai',
  },
  gemini: {
    name: 'Google Gemini',
    url: (m, k) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(k)}`,
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash'],
    signup: 'https://aistudio.google.com/app/apikey',
    prefix: 'AIza',
    format: 'gemini',
  },
};

export function detectProvider(key) {
  const k = (key || '').trim();
  if (!k) return null;
  for (const [id, p] of Object.entries(PROVIDERS)) if (p.prefix && k.startsWith(p.prefix)) return id;
  return null;
}

/** O an hangi beyin kullanılacak? */
export function active() {
  const s = getSettings();
  const key = (s.apiKey || '').trim();
  // 0) Anahtar yok ama çalışan ücretsiz servis tespit edilmişse
  if (!key && hasWorkingFree()) {
    return { id: 'free', key: '', def: PROVIDERS.free, model: 'halka açık ücretsiz servis' };
  }
  // 0b) Chrome'un içindeki Gemini Nano hazırsa (0 indirme, sınırsız)
  if (!key && s.useNano !== false && nanoStatus().availability === 'available') {
    return { id: 'nano', key: '', def: PROVIDERS.nano, model: 'Gemini Nano (Chrome)' };
  }

  // 1) Kullanıcı açıkça bir sağlayıcı seçtiyse
  if (s.provider && s.provider !== 'auto' && s.provider !== 'local') {
    if (key && PROVIDERS[s.provider]) {
      const def = PROVIDERS[s.provider];
      return { id: s.provider, key, def, model: s.model || def.defaultModel };
    }
  }
  // 2) Anahtar varsa bulut (kalite daha yüksek)
  if (key) {
    const id = detectProvider(key) || (PROVIDERS[s.provider] && s.provider !== 'local' ? s.provider : 'groq');
    const def = PROVIDERS[id] || PROVIDERS.groq;
    return { id, key, def, model: s.model || def.defaultModel };
  }
  // 3) Anahtar yok -> cihazında çalıştır
  return { id: 'local', key: '', def: PROVIDERS.local, model: s.localModel || 'cihazında' };
}

/** Sohbet edilebilir durumda mıyız? (anahtar YOKSA bile ücretsiz servis ya da yerel model varsa evet) */
export function isReady() {
  const a = active();
  if (a.id !== 'local') return true;
  if (hasWorkingFree()) return true;
  if (nanoStatus().availability === 'available') return true;
  return localStatus().supported === true;   // WebGPU varsa hazır (model ilk mesajda iner)
}

/** Nano'yu dene: varsa 'available'/'downloadable' döner */
export async function probeNano() {
  if (!hasNanoAPI()) return null;
  const ok = await detectNano();
  return ok ? nanoStatus().availability : null;
}

/** İlk açılışta: ücretsiz servis var mı diye bak (kısa zaman aşımıyla) */
export async function probeFree({ onProgress, force = false } = {}) {
  if ((getSettings().apiKey || '').trim()) return null;
  if (getSettings().preferFree === false) return null;
  return findWorkingFree({ onProgress, force });
}

export function readyReason() {
  const a = active();
  if (a.id !== 'local') return null;
  const st = localStatus();
  if (st.checked && st.supported) return null;
  return 'Cihazında WebGPU bulunamadı. Chrome 113+ (Android 121+) / Safari 26+ gerekir, ya da ücretsiz bir API anahtarı girebilirsin.';
}

async function withTimeout(url, opts, ms = 60000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}

/* OpenRouter'ın ÜCRETSİZ (:free) modelleri sürekli değişiyor.
   Sabit liste yerine canlı çekip Türkçe için en uygununu seçiyoruz. */
const OR_SCORE = (id) => {
  if (/gemini|gemma/i.test(id)) return 100;
  if (/llama/i.test(id)) return 96;
  if (/qwen|deepseek|mistral|nex-n2\.5-pro|nemotron-3-ultra/i.test(id)) return 90;
  if (/nemotron|inkling|laguna|dots|ling-3/i.test(id)) return 78;
  return 60;
};
let orCache = { at: 0, models: [] };

export async function fetchFreeModels(force = false) {
  if (!force && orCache.models.length && Date.now() - orCache.at < 3600_000) return orCache.models;
  try {
    const res = await withTimeout('https://openrouter.ai/api/v1/models', { method: 'GET' }, 15000);
    const j = await res.json();
    let free = (j.data || []).filter((m) => m.id.endsWith(':free')).map((m) => ({
      id: m.id, ctx: m.context_length || 0, name: m.name || m.id,
    }));
    // kod/güvenlik/vizyon/finans gibi özel amaçlıları ele
    free = free.filter((m) => !/(-code|-vl|-sante|-fin$|-finance|safety|omni|reasoning)/i.test(m.id));
    free.sort((a, b) => (OR_SCORE(b.id) - OR_SCORE(a.id)) || (b.ctx - a.ctx));
    if (free.length) { orCache = { at: Date.now(), models: free }; }
    return free;
  } catch (e) {
    console.warn('[llm] OpenRouter model listesi alınamadı:', e.message);
    return orCache.models;
  }
}

/** Sohbet için en iyi ücretsiz model (OpenRouter) */
export async function bestFreeModel() {
  const list = await fetchFreeModels();
  return list[0]?.id || 'google/gemma-4-26b-a4b-it:free';
}

/* --- AKIŞ (streaming): yanıt kelime kelime gelir, "cevap yok" hissi biter --- */
async function streamOpenAI(res, onChunk, model) {
  if (!res.body) {
    const d = await res.json().catch(() => ({}));
    const txt = (d.choices?.[0]?.message?.content || '').trim();
    if (txt) onChunk?.(txt, txt);
    return txt;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() || '';
    for (const line of parts) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const payload = l.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content ?? '';
        if (delta) { out += delta; onChunk?.(delta, out, model); }
      } catch {}
    }
  }
  return out.trim();
}

function errText(status, data, id) {
  const msg = data?.error?.message || data?.error?.error?.message || JSON.stringify(data || {}).slice(0, 200);
  if (status === 401) return `Anahtar geçersiz (${id}). Ayarlar’dan kontrol et.`;
  if (status === 402) return `${id}: ücretsiz kota/bakiye tükendi.`;
  if (status === 429) return `${id}: hız limiti doldu. Ücretsiz katmanda dakikalık sınır var, biraz bekle.`;
  if (status === 404) return `Model bulunamadı (${id}): ${msg}`;
  return `${id} HTTP ${status}: ${msg}`;
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number,maxTokens?:number,json?:boolean,onProgress?:Function}} opts
 */
export async function chat(messages, opts = {}) {
  let a = active();

  // --- CHROME GEMINI NANO (anahtarsız + sınırsız, 0 indirme) ---
  if (a.id === 'nano') {
    try {
      return await nanoChat(messages, opts);
    } catch (e) {
      console.warn('[llm] Nano başarısız, cihazdaki açık kaynak modele geçiliyor:', e.message);
      opts.onProgress?.(0, 'Nano yanıt vermedi, açık kaynak model başlatılıyor…');
      a = { id: 'local', def: PROVIDERS.local };
    }
  }

  // --- ÜCRETSİZ HALKA AÇIK SERVİS (anahtarsız + indirmesiz) ---
  if (a.id === 'free') {
    try {
      return await freeChat(messages, opts);
    } catch (e) {
      // Servis öldüyse yerel modele düş
      console.warn('[llm] ücretsiz servis başarısız, yerel modele geçiliyor:', e.message);
      opts.onProgress?.(0, 'Ücretsiz servis yanıt vermedi, cihazında model başlatılıyor…');
      a = { id: 'local', def: PROVIDERS.local };
    }
  }

  // --- CİHAZINDA ÇALIŞAN MODEL (anahtarsız) ---
  if (a.id === 'local') {
    // Belki bu arada bir ücretsiz servis çalışır hale gelmiştir
    if (getSettings().preferFree !== false && !(getSettings().apiKey || '').trim()) {
      const id = await findWorkingFree({ onProgress: opts.onProgress });
      if (id) {
        try { return await freeChat(messages, opts); } catch {}
      }
    }
    if (!localStatus().ready) {
      await loadLocal({ onProgress: opts.onProgress });
    }
    return localChat(messages, opts);
  }

  let model = a.model;
  const temperature = opts.temperature ?? 0.7;
  if (opts.model) model = opts.model;          // yeniden denemede zorlanan model
  const useStream = !!opts.onChunk && !opts.json;

  // OpenRouter'da model seçilmemiş/seçim bayatsa canlı ücretsiz listeden seç
  if (a.id === 'openrouter' && (!model || model === 'auto' || !model.endsWith(':free'))) {
    model = await bestFreeModel();
    opts.onProgress?.(0, `Ücretsiz model: ${model}`);
  }

  if (a.def.format === 'openai') {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.key}` };
    if (a.id === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'EVRIM'; }
    const body = {
      model, messages, temperature,
      max_tokens: opts.maxTokens ?? 900,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      ...(useStream ? { stream: true } : {}),
    };
    const res = await withTimeout(a.def.url, { method: 'POST', headers, body: JSON.stringify(body) }, 120000);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Model artık yoksa listeden yenisini seçip bir kez daha dene
      if ((res.status === 404 || res.status === 400) && a.id === 'openrouter' && !opts._retriedModel) {
        orCache = { at: 0, models: [] };
        const alt = await bestFreeModel();
        if (alt && alt !== model) return chat(messages, { ...opts, _retriedModel: true, model: alt });
      }
      if (res.status === 404 && model !== a.def.defaultModel && !opts._retriedModel) {
        setSettings({ model: '' });
        return chat(messages, { ...opts, _retriedModel: true });
      }
      throw new Error(errText(res.status, data, a.id));
    }
    if (useStream) return await streamOpenAI(res, opts.onChunk, model);
    const data = await res.json().catch(() => ({}));
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  // Gemini
  const res = await withTimeout(a.def.url(model, a.key), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        temperature, maxOutputTokens: opts.maxTokens ?? 900,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errText(res.status, data, a.id));
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('').trim();
}

export function safeJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const i = raw.indexOf('{'), j = raw.lastIndexOf('}');
  if (i !== -1 && j > i) { try { return JSON.parse(raw.slice(i, j + 1)); } catch {} }
  return null;
}

export async function chatJSON(messages, opts = {}) {
  return safeJSON(await chat(messages, { ...opts, json: true }));
}

export async function testConnection() {
  const a = active();
  try {
    if (a.id === 'local') {
      await detectWebGPU();
      if (!localStatus().supported) return { ok: false, error: readyReason() };
      await loadLocal();
      const reply = await localChat([{ role: 'user', content: 'Tek kelimeyle cevap ver: hazır' }], { maxTokens: 20 });
      return { ok: true, provider: 'Cihazın (açık kaynak)', model: shortName(localStatus().modelId), reply };
    }
    const reply = await chat([{ role: 'user', content: 'Tek kelimeyle cevap ver: hazır' }], { maxTokens: 20, temperature: 0 });
    return { ok: true, provider: a.def.name, model: a.model, reply };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export {
  detectWebGPU, guessTier, shortName, localStatus, loadLocal, FREE_ENDPOINTS,
  detectNano, nanoStatus, createNano, destroyNano, hasNanoAPI,
};
