// src/llm.js — Ücretsiz AI sağlayıcı katmanı.
// Desteklenenler: Groq (ücretsiz), OpenRouter (ücretsiz modeller), Google Gemini (ücretsiz katman)
// Anahtar yoksa "demo" modu devreye girer: uygulama çalışır, yanıtlar yerel/şablon tabanlıdır.
import { getSettings, updateSettings } from './db.js';

const PROVIDERS = {
  groq: {
    name: 'Groq',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b', 'groq/compound-mini'],
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    free: 'https://console.groq.com/keys',
    format: 'openai',
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'qwen/qwen-2.5-72b-instruct:free',
    ],
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    free: 'https://openrouter.ai/settings/keys',
    format: 'openai',
  },
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash'],
    url: (model, key) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    keyEnv: 'GEMINI_API_KEY',
    free: 'https://aistudio.google.com/app/apikey',
    format: 'gemini',
  },
};

export function providerList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    defaultModel: p.defaultModel,
    models: p.models,
    signupUrl: p.free,
  }));
}

export function activeProvider() {
  const s = getSettings();
  let chosen = s.provider;
  // Anahtar: önce Ayarlar, sonra ortam değişkeni
  let key = (s.apiKey || '').trim();
  if (!key) {
    if (chosen === 'groq') key = process.env.GROQ_API_KEY || '';
    else if (chosen === 'openrouter') key = process.env.OPENROUTER_API_KEY || '';
    else if (chosen === 'gemini') key = process.env.GEMINI_API_KEY || '';
    else key = process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '';
  }
  if (chosen === 'auto') {
    if (key) {
      // Anahtarın biçiminden sağlayıcıyı tahmin et
      if (key.startsWith('gsk_')) chosen = 'groq';
      else if (key.startsWith('sk-or-')) chosen = 'openrouter';
      else if (/^AIza/.test(key)) chosen = 'gemini';
      else chosen = process.env.DEFAULT_PROVIDER || 'groq';
    } else {
      chosen = 'demo';
    }
  }
  if (chosen !== 'demo' && !key) chosen = 'demo';
  return { id: chosen, key, settings: s, def: PROVIDERS[chosen] };
}

export function resolveModel() {
  const { id, def, settings } = activeProvider();
  if (id === 'demo') return 'evrim-demo-v1 (çevrimdışı)';
  return settings.model || def.defaultModel;
}

/**
 * Temel sohbet çağrısı.
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} opts { temperature, maxTokens, json }
 */
export async function chat(messages, opts = {}) {
  const active = activeProvider();
  if (active.id === 'demo') return demoReply(messages, opts);

  const wanted = active.settings.model || active.def.defaultModel;
  try {
    return await callProvider(active, wanted, messages, opts);
  } catch (err) {
    // Model adı değişmiş/kaldırılmış olabilir -> varsayılana düşüp bir kez daha dene
    const isModelIssue = /does not exist|not found|unsupported|404/i.test(err.message);
    if (isModelIssue && wanted !== active.def.defaultModel) {
      try {
        const out = await callProvider(active, active.def.defaultModel, messages, opts);
        updateSettings({ model: active.def.defaultModel });
        return out;
      } catch (e2) {
        throw new Error(`${err.message} | varsayılan model de başarısız: ${e2.message}`);
      }
    }
    throw err;
  }
}

async function callProvider(active, model, messages, opts) {
  const temperature = opts.temperature ?? 0.7;

  if (active.def.format === 'openai') {
    const body = {
      model,
      messages,
      temperature,
      max_tokens: opts.maxTokens ?? 900,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    };
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${active.key}`,
    };
    if (active.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://evrim.local';
      headers['X-Title'] = 'EVRIM';
    }
    const res = await fetchWithTimeout(active.def.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(providerError(active.id, res.status, data));
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  // Gemini
  const url = active.def.url(model, active.key);
  const body = {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature,
      maxOutputTokens: opts.maxTokens ?? 900,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(providerError(active.id, res.status, data));
  return (data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim();
}

function providerError(id, status, data) {
  const msg = data?.error?.message || data?.error?.error?.message || JSON.stringify(data).slice(0, 300);
  return `[${id}] HTTP ${status}: ${msg}`;
}

async function fetchWithTimeout(url, options = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** JSON çıkarmayı garantileyen yardımcı */
export async function chatJSON(messages, opts = {}) {
  const raw = await chat(messages, { ...opts, json: true });
  return safeJSON(raw);
}

export function safeJSON(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {}
  }
  return null;
}

// ---------------- DEMO MODU ----------------
// Anahtar girilmeden uygulamanın tüm akışının test edilebilmesi için.
function demoReply(messages, opts) {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const q = last.toLowerCase();
  const stamp = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  if (opts.json) {
    // Öz-gelişim döngüsü için örnek/boş çıktı
    return Promise.resolve(
      JSON.stringify({
        memories: [],
        promptPatch: null,
        skills: [],
        reasoning: 'Demo modu: gerçek model bağlı değil, öğrenme kaydı üretilmedi.',
      })
    );
  }

  let text = `🧪 **Demo modu yanıtı** (${stamp})\n\nGerçek bir AI anahtarı bağlanmadığı için şablon yanıt üretiyorum. ` +
    `Yazdığın mesajı aldım:\n\n> ${last.slice(0, 300)}\n\n`;

  if (/merhaba|selam|hey|günaydın|iyi akşamlar/.test(q)) {
    text += `Merhaba! Ayarlar sekmesinden ücretsiz bir API anahtarı (Groq / OpenRouter / Gemini) eklediğinde gerçek zekâ devreye girer ve ben her sohbetten sonra kendimi geliştirmeye başlarım.`;
  } else if (/kod|code|javascript|python|hata|bug/.test(q)) {
    text += `Kod konusunda demo modunda örnek veremiyorum, ama GitHub sekmesinden reponu bağlarsan dosyalarını okuyup analiz edebilirim (bu kısım anahtar gerektirmez).`;
  } else if (/öğren|soru|quiz|çalış/.test(q)) {
    text += `Öğren sekmesi anahtarsız da çalışır: kendi sorularını ekleyip tekrar aralıklarını test edebilirsin.`;
  } else {
    text += `Uygulamanın geri kalanı (hafıza, öz-gelişim günlüğü, GitHub entegrasyonu, öğrenme koçu) tam çalışır durumda.`;
  }

  return Promise.resolve(text);
}
