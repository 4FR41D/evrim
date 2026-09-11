/* js/llm.js — AI yönlendirici
   Öncelik sırası:
     1) Kullanıcının kendi anahtarı varsa  -> Groq / OpenRouter / Gemini (en yüksek kalite)
     2) Anahtar yoksa + WebGPU varsa       -> CİHAZINDA açık kaynak model (anahtarsız, sınırsız)
     3) İkisi de yoksa                     -> çevrimdışı rehber modu
   Yani anahtar ZORUNLU DEĞİL. */
import { getSettings, setSettings } from './store.js';
import { detectWebGPU, loadLocal, localChat, localStatus, shortName, guessTier } from './local.js';

export const PROVIDERS = {
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
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    signup: 'https://console.groq.com/keys',
    prefix: 'gsk_',
    format: 'openai',
  },
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free', 'qwen/qwen-2.5-72b-instruct:free'],
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

/** Sohbet edilebilir durumda mıyız? (anahtar YOKSA bile yerel model varsa evet) */
export function isReady() {
  const a = active();
  if (a.id !== 'local') return true;
  const st = localStatus();
  return st.supported === true;   // WebGPU tespit edildiyse hazır sayılır (model ilk mesajda iner)
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
  const a = active();

  // --- CİHAZINDA ÇALIŞAN MODEL (anahtarsız) ---
  if (a.id === 'local') {
    if (!localStatus().ready) {
      await loadLocal({ onProgress: opts.onProgress });
    }
    return localChat(messages, opts);
  }

  const model = a.model;
  const temperature = opts.temperature ?? 0.7;

  if (a.def.format === 'openai') {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.key}` };
    if (a.id === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'EVRIM'; }
    const res = await withTimeout(a.def.url, {
      method: 'POST', headers,
      body: JSON.stringify({
        model, messages, temperature,
        max_tokens: opts.maxTokens ?? 900,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 404 && model !== a.def.defaultModel) {
        setSettings({ model: '' });
        return chat(messages, opts);   // varsayılan modelle bir kez daha
      }
      throw new Error(errText(res.status, data, a.id));
    }
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

export { detectWebGPU, guessTier, shortName, localStatus, loadLocal };
