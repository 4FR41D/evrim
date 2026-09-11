/* js/nano.js — CHROME'UN İÇİNDEKİ GEMINI NANO (Prompt API / LanguageModel)
   ✅ anahtar yok, ✅ hesap yok, ✅ ücret yok, ✅ SINIRSIZ, ✅ veriler cihazdan çıkmaz
   ✅ Chrome zaten modeli arka planda indirdiyse 0 MB indirme
   ⚠️ SADECE masaüstü Chrome 148+ (Windows/macOS/Linux/Chromebook Plus) — Android/iOS YOK
   ⚠️ Model ağırlıklı olarak İNGİLİZCE eğitildi → Türkçe cevaplar zayıf olabilir
   Not: Gemini Nano kapalı kaynak ağırlıklara sahiptir (açık kaynak DEĞİL);
        açık kaynak + sınırsız isteyen -> js/local.js (WebLLM, Apache-2.0 modeller) */

const state = {
  supported: null,     // true | false | null
  availability: null,  // 'available' | 'downloadable' | 'downloading' | 'unavailable'
  session: null,
  error: null,
  progress: 0,
};

export function nanoStatus() {
  return { ...state };
}

export function hasNanoAPI() {
  return typeof globalThis.LanguageModel !== 'undefined';
}

/** Cihazda Nano var mı / indirilebilir mi */
export async function detectNano() {
  if (state.supported !== null) return state.supported;
  if (!hasNanoAPI()) {
    state.supported = false;
    state.error = 'Bu tarayıcıda LanguageModel API yok (Chrome 148+ masaüstü gerekir)';
    return false;
  }
  try {
    state.availability = await globalThis.LanguageModel.availability();
    state.supported = state.availability !== 'unavailable';
    if (!state.supported) state.error = `Nano bu cihazda kullanılamıyor (${state.availability})`;
  } catch (e) {
    state.supported = false;
    state.error = e.message;
  }
  return state.supported;
}

/** Oturum aç (model yoksa Chrome kendisi indirir, ilerleme bildirilir) */
export async function createNano({ onProgress } = {}) {
  if (state.session) return state.session;
  const ok = await detectNano();
  if (!ok) throw new Error(state.error || 'Gemini Nano bu cihazda yok');

  try {
    state.session = await globalThis.LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          state.progress = Math.round((e.loaded || 0) * 100);
          onProgress?.(state.progress, `Chrome modeli indiriyor… %${state.progress}`);
        });
      },
    });
    state.availability = 'available';
    state.progress = 100;
    return state.session;
  } catch (e) {
    state.error = e.message;
    throw new Error(`Gemini Nano başlatılamadı: ${e.message}`);
  }
}

/** messages: [{role:'system'|'user'|'assistant', content}] */
async function toPrompt(messages) {
  // System promptu ayrı alana taşı (Nano destekler), kalanı dizi olarak ver
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  // En az bir mesaj olmalı
  if (!rest.length) rest.push({ role: 'user', content: 'Merhaba' });
  return { input: rest.length === 1 ? rest[0].content : rest, sys };
}

export async function nanoChat(messages, opts = {}) {
  const session = state.session || (await createNano({ onProgress: opts.onProgress }));
  const { input, sys } = await toPrompt(messages);

  // Nano JSON modunu desteklemez -> prompt seviyesinde zorla
  let finalInput = input;
  if (opts.json && typeof input === 'string') {
    finalInput = `${input}\n\nIMPORTANT: Reply with ONLY a valid JSON object. No markdown, no explanation.`;
  }

  const cfg = {
    ...(sys ? { systemPrompt: sys } : {}),
    ...(opts.temperature !== undefined ? { temperature: Math.min(2, Math.max(0, opts.temperature)) } : {}),
    ...(opts.maxTokens ? { maxTokens: Math.min(3000, opts.maxTokens) } : {}),
  };

  if (opts.onChunk && !opts.json) {
    let out = '';
    const stream = session.promptStreaming(finalInput, cfg);
    for await (const part of stream) {
      const delta = typeof part === 'string' ? part : (part?.content || '');
      if (delta) { out += delta; opts.onChunk(out.slice(out.length - delta.length), out, 'Gemini Nano'); }
    }
    return out.trim();
  }

  const out = await session.prompt(finalInput, cfg);
  return String(out || '').trim();
}

export function destroyNano() {
  try { state.session?.destroy?.(); } catch {}
  state.session = null;
  state.progress = 0;
}
