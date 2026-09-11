/* js/llm.js — tarayıcıdan doğrudan AI çağrısı (sunucu yok)
   Groq API'si CORS'a izin verdiği için anahtar tarayıcıda kalabilir.
   ⚠️ Anahtar bu cihazda saklanır; bu yüzden herkes KENDİ anahtarını girer. */
import { getSettings, setSettings } from './store.js';

export const PROVIDERS = {
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
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.prefix && k.startsWith(p.prefix)) return id;
  }
  return null;
}

export function active() {
  const s = getSettings();
  const key = (s.apiKey || '').trim();
  if (!key) return { id: null, key: '', def: null, model: null };
  let id = s.provider === 'auto' ? (detectProvider(key) || 'groq') : s.provider;
  if (!PROVIDERS[id]) id = 'groq';
  const def = PROVIDERS[id];
  return { id, key, def, model: s.model || def.defaultModel };
}

export const isReady = () => !!active().id;

async function withTimeout(url, opts, ms = 60000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}

function errText(status, data, id) {
  const msg = data?.error?.message || data?.error?.error?.message || JSON.stringify(data || {}).slice(0, 200);
  if (status === 401) return `Anahtar geçersiz (${id}). Ayarlar'dan kontrol et.`;
  if (status === 429) return `Hız limiti doldu (${id}). Ücretsiz katmanda dakikalık sınır var, biraz bekle.`;
  if (status === 404) return `Model bulunamadı (${id}): ${msg}`;
  return `${id} HTTP ${status}: ${msg}`;
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number,maxTokens?:number,json?:boolean,model?:string}} opts
 */
export async function chat(messages, opts = {}) {
  const a = active();
  if (!a.id) throw new Error('Önce Ayarlar’dan ücretsiz bir API anahtarı gir.');

  const model = opts.model || a.model;
  const temperature = opts.temperature ?? 0.7;

  if (a.def.format === 'openai') {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.key}` };
    if (a.id === 'openrouter') {
      headers['HTTP-Referer'] = location.origin;
      headers['X-Title'] = 'EVRIM';
    }
    const res = await withTimeout(a.def.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model, messages, temperature,
        max_tokens: opts.maxTokens ?? 900,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(errText(res.status, data, a.id));
      // Model adı kalkmışsa varsayılana düş ve ayarı güncelle
      if (res.status === 404 && model !== a.def.defaultModel) {
        setSettings({ model: '' });
        return chat(messages, { ...opts, model: a.def.defaultModel });
      }
      throw e;
    }
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  // Gemini
  const url = a.def.url(model, a.key);
  const res = await withTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        temperature,
        maxOutputTokens: opts.maxTokens ?? 900,
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

/** Bağlantı + model testi */
export async function testConnection() {
  const a = active();
  if (!a.id) return { ok: false, error: 'Anahtar girilmedi' };
  try {
    const reply = await chat([{ role: 'user', content: 'Tek kelimeyle cevap ver: hazır' }], { maxTokens: 20, temperature: 0 });
    return { ok: true, provider: a.def.name, model: a.model, reply };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
