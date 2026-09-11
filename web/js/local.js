/* js/local.js — CİHAZINDA ÇALIŞAN AÇIK KAYNAK MODEL (WebLLM / WebGPU)
   API anahtarı YOK, sunucu YOK, kota YOK, sınırsız.
   Model bir kez indirilir (~200MB-1.4GB), IndexedDB'de önbelleklenir, sonra çevrimdışı bile çalışır.
   Her şey kullanıcının kendi cihazında koşar -> veriler cihazdan hiç çıkmaz. */
import { getSettings, setSettings } from './store.js';

// WebLLM'i ESM olarak yükleyen CDN'ler (biri düşerse sıradaki denenir)
const CDNS = [
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm',
  'https://esm.run/@mlc-ai/web-llm',
  'https://unpkg.com/@mlc-ai/web-llm?module',
];

/** Cihaz sınıfına göre önerilen modeller (küçükten büyüğe yedek zinciri) */
export const MODEL_TIERS = [
  {
    id: 'desktop',
    label: 'Masaüstü / güçlü cihaz',
    hint: '~1.0 GB · en iyi kalite',
    chain: ['Qwen3.5-2B-q4f16_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Qwen3.5-0.8B-q4f16_1-MLC'],
  },
  {
    id: 'phone',
    label: 'Telefon (önerilen)',
    hint: '~430 MB · hız/kalite dengesi',
    chain: ['Qwen3.5-0.8B-q4f16_1-MLC', 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 'SmolLM2-360M-Instruct-q4f16_1-MLC'],
  },
  {
    id: 'tiny',
    label: 'Eski/düşük cihaz',
    hint: '~200 MB · hızlı ama basit',
    chain: ['SmolLM2-360M-Instruct-q4f16_1-MLC', 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'],
  },
];

const state = {
  engine: null,
  modelId: null,
  loading: false,
  progress: 0,
  progressText: '',
  error: null,
  webgpu: null,      // true | false | null (henüz bakılmadı)
  adapterInfo: null,
};

export function localStatus() {
  const s = getSettings();
  return {
    supported: state.webgpu === true,
    checked: state.webgpu !== null,
    ready: !!state.engine,
    loading: state.loading,
    modelId: state.modelId,
    progress: state.progress,
    progressText: state.progressText,
    error: state.error,
    adapter: state.adapterInfo,
    tier: s.localTier || 'phone',
  };
}

/** WebGPU var mı? (yoksa yerel model çalışmaz, ücretsiz anahtar gerekir) */
export async function detectWebGPU() {
  if (state.webgpu !== null) return state.webgpu;
  try {
    if (!('gpu' in navigator)) { state.webgpu = false; return false; }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { state.webgpu = false; return false; }
    state.webgpu = true;
    try {
      const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
      state.adapterInfo = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'GPU';
    } catch { state.adapterInfo = 'GPU'; }
    return true;
  } catch (e) {
    state.webgpu = false;
    state.error = `WebGPU denetlenemedi: ${e.message}`;
    return false;
  }
}

function tierChain() {
  const s = getSettings();
  const tier = MODEL_TIERS.find((t) => t.id === (s.localTier || 'tiny')) || MODEL_TIERS[2];
  return tier.chain;
}

/**
 * Modeli indir/yükle. İlerleme onProgress(pct, text) ile bildirilir.
 * Zincirdeki modeller sırayla denenir; biri olmazsa küçüğüne düşer.
 */
export async function loadLocal({ onProgress, forceModel } = {}) {
  if (state.engine && !forceModel) return state.engine;
  if (state.loading) throw new Error('Model zaten yükleniyor, biraz bekle.');

  const ok = await detectWebGPU();
  if (!ok) {
    state.error = 'Bu cihazda/tarayıcıda WebGPU yok. Chrome 113+ (Android 121+) veya Safari 26+ gerekir.';
    throw new Error(state.error);
  }

  state.loading = true;
  state.error = null;
  const report = (p, t) => {
    state.progress = p;
    state.progressText = t;
    try { onProgress?.(p, t); } catch {}
  };

  try {
    report(1, 'WebLLM kütüphanesi indiriliyor…');
    let WebLLM = null;
    let libErr = null;
    for (const url of CDNS) {
      try {
        WebLLM = await import(/* @vite-ignore */ url);
        if (WebLLM?.CreateMLCEngine) break;
        WebLLM = null;
      } catch (e) { libErr = e; console.warn('[local] CDN başarısız:', url, e.message); }
    }
    const create = WebLLM?.CreateMLCEngine || WebLLM?.CreateWebWorkerMLCEngine;
    if (!create) throw new Error(`WebLLM yüklenemedi (CDN erişilemedi): ${libErr?.message || 'CreateMLCEngine yok'}`);

    const chain = forceModel ? [forceModel, ...tierChain().filter((m) => m !== forceModel)] : tierChain();
    let lastErr = null;

    for (let i = 0; i < chain.length; i++) {
      const id = chain[i];
      try {
        report(3, `Model hazırlanıyor: ${shortName(id)}${i > 0 ? ` (yedek ${i})` : ''}`);
        // eslint-disable-next-line no-await-in-loop
        const engine = await create(id, {
          initProgressCallback: (p) => {
            const pct = Math.round((p.progress || 0) * 100);
            report(3 + Math.round(pct * 0.94), p.text || `İndiriliyor… %${pct}`);
          },
        });
        state.engine = engine;
        state.modelId = id;
        setSettings({ localModel: id });
        report(100, `Hazır: ${shortName(id)}`);
        return engine;
      } catch (e) {
        lastErr = e;
        console.warn(`[local] ${id} yüklenemedi:`, e.message);
        // Bellek yetmediyse daha küçüğünü dene
        const oom = /memory|out of|alloc|buffer|device lost|too large/i.test(e.message || '');
        if (!oom && i > 0) break; // farklı bir hataysa zinciri zorlama
      }
    }
    throw new Error(`Yerel model yüklenemedi: ${lastErr?.message || 'bilinmeyen hata'}`);
  } finally {
    state.loading = false;
  }
}

export function shortName(id) {
  return String(id || '').replace(/-q[04]f(16|32)(_1)?-MLC$/, '').replace(/-Instruct$/, '');
}

/** Yerel modelle sohbet */
export async function localChat(messages, opts = {}) {
  if (!state.engine) await loadLocal();
  let msgs = messages;
  // Küçük modeller response_format'ı her zaman desteklemez; JSON isteğini ayrıca pekiştir.
  if (opts.json) {
    msgs = [...messages];
    const lastIdx = msgs.length - 1;
    msgs[lastIdx] = {
      ...msgs[lastIdx],
      content: `${msgs[lastIdx].content}\n\nÖNEMLİ: Yanıtın SADECE geçerli bir JSON nesnesi olsun. Açıklama, markdown veya \`\`\` işareti ekleme.`,
    };
  }
  const body = {
    messages: msgs,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 700,
    top_p: 0.9,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  try {
    const out = await state.engine.chat.completions.create(body);
    return (out.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    // response_format desteklenmiyorsa onsuz dene
    if (opts.json && /response_format|json|unsupported/i.test(e.message || '')) {
      delete body.response_format;
      const out = await state.engine.chat.completions.create(body);
      return (out.choices?.[0]?.message?.content || '').trim();
    }
    throw e;
  }
}

export async function unloadLocal() {
  try { await state.engine?.unload?.(); } catch {}
  state.engine = null;
  state.modelId = null;
  state.progress = 0;
  state.progressText = '';
}

/** Cihaz tahmini: mobil + düşük bellek -> küçük model */
export function guessTier() {
  // Varsayılan bilinçli olarak EN KÜÇÜK model: ilk açılışta ~200 MB insin, hızlı çalışsın.
  // Kullanıcı Ayarlar'dan kaliteyi artırabilir.
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const mem = navigator.deviceMemory || 0;   // Chrome'da var (GB)
  if (!mobile && mem && mem >= 16) return 'phone';   // güçlü masaüstü -> orta model
  if (!mobile) return 'tiny';
  return 'tiny';
}
