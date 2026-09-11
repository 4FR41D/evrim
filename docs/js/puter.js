/* js/puter.js — PUTER.COM ÜZERİNDEN ANAHTARSIZ BULUT MODELİ
   ✅ API anahtarı YOK, ✅ indirme YOK, ✅ kota görünmüyor
   ✅ Büyük bulut modelleri (GPT / Claude / Gemini / DeepSeek sınıfı)
   ⚠️ Puter "kullanıcı öder" modeliyle çalışır: misafir (guest) hakkı bitince
      Puter kendi giriş penceresini açar → ücretsiz Puter hesabı (e-posta veya GitHub) gerekir.
      Yine de API anahtarı istemez, sadece oturum.
   CORS doğrulandı: api.puter.com, https://4fr41d.github.io origin'ine izin veriyor. */

const SDK = 'https://js.puter.com/v2/';
const TIMEOUT_MS = 60000;

const state = {
  loaded: false,
  loading: null,
  ready: false,
  models: null,
  error: null,
  lastCheck: 0,
};

export function puterStatus() { return { ...state }; }

/** SDK'yı bir kez yükle */
export async function loadPuter(timeoutMs = 20000) {
  if (state.loaded && globalThis.puter?.ai?.chat) return globalThis.puter;
  if (state.loading) return state.loading;
  state.loading = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-puter]');
    if (existing) existing.remove();
    const sc = document.createElement('script');
    sc.src = SDK; sc.async = true; sc.defer = true; sc.dataset.puter = '1';
    const t = setTimeout(() => reject(new Error('Puter SDK zaman aşımı')), timeoutMs);
    sc.onload = () => {
      clearTimeout(t);
      if (globalThis.puter?.ai?.chat) { state.loaded = true; resolve(globalThis.puter); }
      else reject(new Error('Puter SDK yüklendi ama ai.chat yok'));
    };
    sc.onerror = () => { clearTimeout(t); reject(new Error('Puter SDK indirilemedi (js.puter.com)')); };
    document.head.appendChild(sc);
  }).catch((e) => { state.loading = null; state.error = e.message; throw e; });
  return state.loading;
}

/**
 * PASİF kontrol: oturum zaten var mı? (ağ isteği/pencere açmaz)
 * Puter, oturum yoksa kendi giriş penceresini AÇAR — bu yüzden sayfa açılışında
 * yalnızca bu pasif kontrol yapılır; gerçek deneme kullanıcı düğmeye basınca.
 */
export async function passiveCheck() {
  try {
    const puter = await loadPuter();
    const signedIn = !!(puter?.auth?.isSignedIn?.());
    const token = (() => {
      try {
        // Puter token'ı localStorage'da tutar (anahtar adı sürüme göre değişebilir)
        return Object.keys(localStorage)
          .filter((k) => /puter/i.test(k) && /token/i.test(k))
          .some((k) => !!localStorage.getItem(k));
      } catch { return false; }
    })();
    state.ready = signedIn || token;
    if (state.ready) state.lastCheck = Date.now();
    state.error = null;
    return state.ready;
  } catch (e) {
    state.error = e.message;
    return false;
  }
}

/** Gerçek deneme: bir istek gönderir. Oturum yoksa Puter penceresi açılır. */
export async function probePuter({ force = false } = {}) {
  if (!force && state.ready && Date.now() - state.lastCheck < 30 * 60 * 1000) return true;
  try {
    const puter = await loadPuter();
    // Model listesini al (bazı sürümlerde yok)
    try {
      const list = await puter.ai.listModels?.();
      if (Array.isArray(list) && list.length) {
        state.models = list.map((m) => (typeof m === 'string' ? m : (m.id || m.key || m.model))).filter(Boolean);
      }
    } catch {}
    const out = await puter.ai.chat('Reply with exactly one word: OK', { temperature: 0 });
    const text = normalize(out);
    state.ready = !!text;
    state.lastCheck = Date.now();
    if (!text) state.error = 'Puter boş yanıt verdi';
    return state.ready;
  } catch (e) {
    state.ready = false;
    state.error = e.message;
    return false;
  }
}

/** Puter çıktısını düz metne çevir */
function normalize(out) {
  if (!out) return '';
  if (typeof out === 'string') return out.trim();
  // { message: { content: "..." } }  veya  { content: [...] }  veya dizi
  const m = out.message;
  if (typeof m?.content === 'string') return m.content.trim();
  if (Array.isArray(m?.content)) {
    return m.content.map((c) => (typeof c === 'string' ? c : (c?.text || ''))).join('').trim();
  }
  if (typeof out.content === 'string') return out.content.trim();
  if (Array.isArray(out.content)) {
    return out.content.map((c) => (typeof c === 'string' ? c : (c?.text || ''))).join('').trim();
  }
  if (typeof out.text === 'string') return out.text.trim();
  if (out.toString) {
    const s = out.toString();
    if (s && s !== '[object Object]') return s.trim();
  }
  return '';
}

/** Bizim message dizimizi Puter biçimine çevir */
function toPuterMessages(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  if (sys) rest.unshift({ role: 'system', content: sys });
  return rest.length ? rest : [{ role: 'user', content: 'Merhaba' }];
}

export async function puterChat(messages, opts = {}) {
  const puter = await loadPuter();
  const cfg = {
    temperature: opts.temperature ?? 0.7,
    ...(opts.model ? { model: opts.model } : {}),
  };
  if (opts.maxTokens) { cfg.max_tokens = opts.maxTokens; cfg.maxTokens = opts.maxTokens; }

  const input = toPuterMessages(messages);

  // JSON modu: Puter response_format desteklemiyor -> prompt ile zorla
  if (opts.json) {
    const last = input[input.length - 1];
    input[input.length - 1] = {
      ...last,
      content: `${last.content}\n\nIMPORTANT: Reply with ONLY a valid JSON object. No markdown fences, no explanation.`,
    };
  }

  // Akış (streaming)
  if (opts.onChunk && !opts.json) {
    try {
      let out = '';
      const stream = await puter.ai.chat(input, { ...cfg, stream: true });
      for await (const part of stream) {
        const piece = normalize(part);
        if (piece && piece !== out) {
          const delta = piece.startsWith(out) ? piece.slice(out.length) : piece;
          out = piece.startsWith(out) ? piece : out + piece;
          opts.onChunk(delta, out, 'Puter');
        }
      }
      if (out.trim()) { state.ready = true; state.lastCheck = Date.now(); return out.trim(); }
    } catch (e) {
      // Akış desteklenmiyorsa normal isteğe düş
      console.warn('[puter] stream başarısız, normal istek:', e.message);
    }
  }

  const out = await puter.ai.chat(input, cfg);
  const text = normalize(out);
  if (!text) throw new Error('Puter boş yanıt döndürdü');
  state.ready = true;
  state.lastCheck = Date.now();
  return text;
}

/** ANAHTARSIZ görsel üretim (Puter 'kullanıcı öder' modeli; ücretsiz katman).
    @returns {Promise<string>} data-URL */
export async function puterTxt2Img(prompt, opts = {}) {
  const puter = await loadPuter();
  if (!puter?.ai?.txt2img) throw new Error('Puter SDK bu sürümde görsel üretimi desteklemiyor');
  const img = await puter.ai.txt2img(prompt, { quality: 'low', ...opts });
  const src = typeof img === 'string' ? img : img?.src;
  if (!src || !String(src).startsWith('data:')) throw new Error('Görsel beklenirken boş yanıt döndü');
  return String(src);
}

/** data-URL'i küçült (localStorage kotasını patlatmasın); başarısızsa orijinali ver */
export async function shrinkDataUrl(dataUrl, maxPx = 768, quality = 0.8) {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode?.();
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return dataUrl;
    const k = Math.min(1, maxPx / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/webp', quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch { return dataUrl; }
}

export function puterModels() { return state.models || []; }

/** Sağlayıcı başarısız oldu -> hazır işaretini düşür (bir dahaki açılışta tekrar denenir) */
export function markPuterDown(reason) {
  state.ready = false;
  state.lastCheck = 0;
  if (reason) state.error = String(reason).slice(0, 200);
}

/** Puter oturumu var mı / misafir hakkı bitti mi (bilgi amaçlı) */
export function puterAuth() {
  try {
    const p = globalThis.puter;
    return {
      signedIn: !!(p?.auth?.isSignedIn?.() ?? p?.auth?.signedIn),
      user: p?.auth?.username || p?.auth?.user?.username || null,
    };
  } catch { return { signedIn: false, user: null }; }
}

/** Puter giriş penceresini aç (misafir hakkı bittiğinde) */
export async function puterSignIn() {
  const puter = await loadPuter();
  try {
    await puter.auth?.signIn?.();
    state.ready = false;
    return await probePuter({ force: true });
  } catch (e) {
    state.error = e.message;
    return false;
  }
}
