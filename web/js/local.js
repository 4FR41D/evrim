/* js/local.js — CİHAZINDA ÇALIŞAN AÇIK KAYNAK MODEL (WebLLM / WebGPU)
   API anahtarı YOK, sunucu YOK, kota YOK, sınırsız.
   Model bir kez indirilir, tarayıcı önbelleğine alınır, sonra çevrimdışı bile çalışır.

   ÖNEMLİ: Model kimlikleri SABİT YAZILMIYOR — WebLLM'in kendi `prebuiltAppConfig`
   listesinden çalışma anında doğrulanır. Böylece "olmayan model" hatası imkânsız hale gelir. */
import { getSettings, setSettings } from './store.js';

// WebLLM'i ESM olarak yükleyen CDN'ler (biri düşerse sıradaki denenir)
const CDNS = [
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm',
  'https://esm.run/@mlc-ai/web-llm',
  'https://unpkg.com/@mlc-ai/web-llm?module',
];

/** İndirme bütçeleri (yaklaşık). Kullanıcı Ayarlar'dan seçer. */
export const MODEL_TIERS = [
  { id: 'tiny',    label: 'Küçük & hızlı',          hint: '~150-250 MB · en az yer',      maxMB: 300  },
  { id: 'phone',   label: 'Dengeli (önerilen)',      hint: '~400-600 MB · hız/kalite',     maxMB: 700  },
  { id: 'desktop', label: 'Yüksek kalite',           hint: '~1 GB+ · güçlü cihaz',          maxMB: 4000 },
];

/** Model adından parametre sayısını (milyon) tahmin et: "0.5B"->500, "360M"->360 */
function paramSize(id) {
  const b = id.match(/(\d+(?:\.\d+)?)B/i);
  if (b) return Math.round(parseFloat(b[1]) * 1000);
  const m = id.match(/(\d+(?:\.\d+)?)M/i);
  if (m) return Math.round(parseFloat(m[1]));
  return 99999;
}

//** ~parametre sayısından MB tahmini (ilk eleme için; sonra gerçek boyut ölçülür) */
function estMB(id) {
  const p = paramSize(id);
  const q = /q0f/i.test(id) ? 2.1 : /q4f/i.test(id) ? 0.62 : /q3f/i.test(id) ? 0.45 : 1.1;
  return Math.round(p * q) + 30;
}

/** Kalite tercihi: Türkçe'de iyi bilinen aileler öne çıkar */
function familyScore(id) {
  if (/^Llama-3\.2-(1B|3B)/i.test(id)) return 100;
  if (/^Qwen3(\.5)?-|^Qwen2\.5-(0\.5B|1\.5B|3B)/i.test(id)) return 95;
  if (/^gemma3-(1b|4b)/i.test(id)) return 85;
  if (/^SmolLM2-(360M|1\.7B)/i.test(id)) return 70;
  if (/^Qwen2-|^Llama-3\.1|^phi/i.test(id)) return 60;
  return 40;
}

/** GERÇEK indirme boyutunu ölç (ndarray-cache.json) — tahmin değil */
async function measureMB(rec, timeoutMs = 9000) {
  try {
    const url = new URL('ndarray-cache.json', rec.model.endsWith('/') ? rec.model : rec.model + '/').href;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(url, { cache: 'no-store', signal: c.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const bytes = (j.records || []).reduce((a, r) => a + (r.nbytes || 0), 0);
    return bytes > 0 ? Math.round(bytes / 1048576) : null;
  } catch { return null; }
}

/** Kullanılabilir depolama alanı (MB) */
async function freeStorageMB() {
  try {
    const q = await navigator.storage?.estimate?.();
    if (!q?.quota) return null;
    return Math.round((q.quota - (q.usage || 0)) / 1048576);
  } catch { return null; }
}

const state = {
  engine: null,
  modelId: null,
  loading: false,
  progress: 0,
  progressText: '',
  error: null,
  webgpu: null,          // true | false | null
  f16: null,             // shader-f16 destekleniyor mu
  adapterInfo: null,
  catalog: null,         // doğrulanmış model listesi (prebuiltAppConfig'ten)
  webllm: null,
  cacheBackend: 'cache', // hata olursa 'indexeddb' -> 'opfs'
  net: null,             // { hf: bool, gh: bool }
};

export function localStatus() {
  const s = getSettings();
  return {
    supported: state.webgpu === true,
    checked: state.webgpu !== null,
    f16: state.f16 === true,
    ready: !!state.engine,
    loading: state.loading,
    modelId: state.modelId,
    progress: state.progress,
    progressText: state.progressText,
    error: state.error,
    adapter: state.adapterInfo,
    tier: s.localTier || 'tiny',
    net: state.net,
    cacheBackend: state.cacheBackend,
    catalogSize: state.catalog?.length || 0,
  };
}

/** WebGPU var mı + shader-f16 destekleniyor mu */
export async function detectWebGPU() {
  if (state.webgpu !== null) return state.webgpu;
  try {
    if (!('gpu' in navigator)) { state.webgpu = false; return false; }
    let adapter = await navigator.gpu.requestAdapter();
    if (adapter?.features?.has?.('shader-f16')) state.f16 = true;
    else {
      // f16 yoksa "compatibility" modunda tekrar dene
      try {
        const a2 = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
        if (a2) { adapter = adapter || a2; state.f16 = a2.features?.has?.('shader-f16') || false; }
      } catch {}
      if (state.f16 === null) state.f16 = false;
    }
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

/** WebLLM kütüphanesini yükle (3 CDN yedeği) */
async function loadLib(report) {
  if (state.webllm?.CreateMLCEngine) return state.webllm;
  let lastErr = null;
  for (const url of CDNS) {
    try {
      report?.(1, 'WebLLM kütüphanesi indiriliyor…');
      // eslint-disable-next-line no-await-in-loop
      const m = await import(/* @vite-ignore */ url);
      if (m?.CreateMLCEngine) { state.webllm = m; return m; }
      lastErr = new Error('CreateMLCEngine export yok');
    } catch (e) {
      lastErr = e;
      console.warn('[local] CDN başarısız:', url, e.message);
    }
  }
  throw new Error(`WebLLM kütüphanesi indirilemedi (3 CDN de erişilemedi): ${lastErr?.message}`);
}

/**
 * WebLLM'in GERÇEK model listesinden, bu cihazın desteklediği ve bütçeye uyan
 * modelleri seçer. Böylece olmayan bir model asla istenmez.
 */
function buildCatalog(appConfig, { maxMB, f16, vramCapMB }) {
  const list = appConfig?.model_list || [];
  const out = [];
  for (const r of list) {
    const id = r.model_id;
    if (!id) continue;
    if (!/-MLC$/.test(id)) continue;                       // sadece MLC derlemeleri
    if (/(embed|Encoder|VL|vision|math|Coder|jpn|kr|cn|zephyr|TinyLlama|OLMo|stablelm)/i.test(id)) continue;
    if (r.model_type && r.model_type !== 'text') continue;
    const feats = r.required_features || [];
    if (feats.includes('shader-f16') && !f16) continue;     // cihaz desteklemiyorsa ATLA (kritik)
    const vram = r.vram_required_MB || 0;
    if (vramCapMB && vram > vramCapMB) continue;            // bellek tavanı
    const mb = estMB(id);
    if (mb > maxMB) continue;
    out.push({ id, mb, vram, size: paramSize(id), fam: familyScore(id), rec: r });
  }
  // Kalite önce, sonra büyük model, sonra düşük VRAM
  out.sort((a, b) => (b.fam - a.fam) || (b.size - a.size) || (a.vram - b.vram));
  return out;
}

/** Seçilen modellerin wasm kütüphanesi gerçekten var mı? (404 = listeden çıkar) */
async function verifyWasm(rec, timeoutMs = 8000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(rec.model_lib, { method: 'HEAD', signal: c.signal, cache: 'no-store' });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

/** Ağ ön kontrolü: model sunucularına erişebiliyor muyuz? */
export async function netCheck() {
  const test = async (url) => {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      const r = await fetch(url, { method: 'GET', cache: 'no-store', signal: c.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  };
  const [hf, gh] = await Promise.all([
    test('https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f32-MLC/resolve/main/mlc-chat-config.json'),
    test('https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/README.md'),
  ]);
  state.net = { hf, gh };
  return state.net;
}

function tierMaxMB() {
  const s = getSettings();
  const t = MODEL_TIERS.find((x) => x.id === (s.localTier || 'tiny')) || MODEL_TIERS[0];
  return t.maxMB;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendly(e) {
  const m = String(e?.message || e || '');
  if (/Cache\.add\(\) encountered a network error|Failed to fetch|network error|Load failed|ERR_/i.test(m)) {
    return {
      msg: 'Model sunucusuna (huggingface.co) ulaşılamadı — indirme isteği ağda başarısız oldu.',
      hint: 'İnternet bağlantını/Wi-Fi\'yi kontrol et, VPN veya reklam engelleyici açıksa kapat, sonra tekrar dene. '
        + 'Ayarlar → "Yerel modeli tanıla" ile hangi sunucunun kapalı olduğunu görebilirsin.',
      kind: 'network',
    };
  }
  if (/quota|storage|space|exceed/i.test(m)) {
    return { msg: 'Tarayıcı depolama alanı yetmedi.', hint: 'Cihazında yer aç ya da daha küçük bir model seç (Ayarlar → model boyu).', kind: 'quota' };
  }
  if (/Cannot find model record/i.test(m)) {
    return { msg: 'Seçilen model bu WebLLM sürümünde yok.', hint: 'Ayarlar → model listesinden geçerli bir model seç.', kind: 'badid' };
  }
  if (/shader-f16|not supported|WebGPU/i.test(m)) {
    return { msg: 'Cihazın bu modeli çalıştıracak GPU özelliğini desteklemiyor.', hint: 'Daha küçük/uyumlu bir model seç veya ücretsiz bulut anahtarı kullan.', kind: 'gpu' };
  }
  if (/memory|out of|alloc|buffer|device lost|too large/i.test(m)) {
    return { msg: 'Bellek yetmedi (model bu cihaz için büyük).', hint: 'Daha küçük model seç: Ayarlar → "Küçük & hızlı".', kind: 'oom' };
  }
  return { msg: m, hint: '', kind: 'other' };
}

/**
 * Modeli indir/yükle. Sırayla dener:
 *   geçerli modeller (büyükten küçüğe) × önbellek arka uçları (cache → indexeddb → opfs)
 */
export async function loadLocal({ onProgress, forceModel, maxModels = 4 } = {}) {
  if (state.engine && !forceModel) return state.engine;
  if (state.loading) throw new Error('Model zaten yükleniyor, biraz bekle.');

  const ok = await detectWebGPU();
  if (!ok) {
    state.error = 'Bu cihazda/tarayıcıda WebGPU yok. Chrome 113+ (Android 121+) veya Safari 26+ gerekir. Alternatif: ücretsiz bulut anahtarı.';
    throw new Error(state.error);
  }

  state.loading = true;
  state.error = null;
  const report = (p, t) => {
    state.progress = p; state.progressText = t;
    try { onProgress?.(p, t); } catch {}
  };

  try {
    const W = await loadLib(report);

    report(2, 'Model listesi doğrulanıyor…');
    const f16 = state.f16 === true;
    const memGB = navigator.deviceMemory || 0;
    const vramCapMB = memGB >= 8 ? 2600 : (memGB >= 4 ? 1500 : 1100);
    let budgetMB = tierMaxMB();

    // Depolama kotası bütçeyi kısabilir (Cache.add hatasının 2. sebebi)
    const freeMB = await freeStorageMB();
    if (freeMB && freeMB < budgetMB * 1.5) {
      budgetMB = Math.max(150, Math.floor(freeMB * 0.6));
      report(2, `Depolama alanı az (${freeMB} MB) → bütçe ${budgetMB} MB'ye düşürüldü`);
    }

    const all = buildCatalog(W.prebuiltAppConfig, { maxMB: 4000, f16, vramCapMB });
    let chain = forceModel
      ? [{ id: forceModel, rec: (W.prebuiltAppConfig?.model_list || []).find((r) => r.model_id === forceModel), mb: estMB(forceModel), vram: 0, size: paramSize(forceModel), fam: 0 }]
          .concat(buildCatalog(W.prebuiltAppConfig, { maxMB: budgetMB, f16, vramCapMB }))
      : buildCatalog(W.prebuiltAppConfig, { maxMB: budgetMB, f16, vramCapMB });

    chain = chain.filter((c) => c.rec);
    if (!chain.length) chain = all.slice(-3).reverse();   // bütçe çok kısıtlıysa en küçüğü

    // Aynı modelin farklı niceleme sürümlerinden sadece en iyisini bırak
    const seen = new Set(); const uniq = [];
    for (const c of chain) {
      const base = c.id.replace(/-q\df\d+(_\d)?-MLC$/, '');
      if (seen.has(base)) continue;
      seen.add(base); uniq.push(c);
    }
    chain = uniq.slice(0, 8);

    // GERÇEK indirme boyutlarını ölç ve bütçeye uymayanları ele
    report(3, 'İndirme boyutları ölçülüyor…');
    const sized = await Promise.all(chain.slice(0, 6).map(async (c) => {
      const real = await measureMB(c.rec);
      return { ...c, mb: real || c.mb, measured: !!real };
    }));
    chain = sized.filter((c) => !c.measured || c.mb <= budgetMB);
    if (!chain.length) chain = [sized.reduce((a, b) => (a.mb <= b.mb ? a : b))];   // en küçüğü
    chain = chain.slice(0, maxModels);
    state.catalog = chain.map((c) => ({ id: c.id, mb: c.mb }));
    report(3, `Adaylar: ${chain.map((c) => `${shortName(c.id)} ~${c.mb}MB`).join(' → ')}`);

    // Ağ ön kontrolü — erken ve anlaşılır hata için
    report(3, 'Sunucu erişimi denetleniyor…');
    const net = await netCheck();
    if (!net.hf) {
      const f = friendly(new Error('Failed to fetch'));
      state.error = f.msg + ' ' + f.hint;
      throw new Error(state.error);
    }

    const backends = ['cache', 'indexeddb', 'opfs'];
    const startIdx = Math.max(0, backends.indexOf(state.cacheBackend));
    let lastErr = null;

    for (let bi = startIdx; bi < backends.length; bi++) {
      const backend = backends[bi];
      for (let i = 0; i < chain.length; i++) {
        const cand = chain[i];
        try {
          report(4, `Hazırlanıyor: ${shortName(cand.id)} (~${cand.mb} MB, ${backend})`);
          // eslint-disable-next-line no-await-in-loop
          if (i === 0 && bi === startIdx) {
            // İlk denemeden önce wasm dosyası gerçekten var mı (404 = zaman kaybı)
            const okWasm = await verifyWasm(cand.rec);
            if (!okWasm) { console.warn('[local] wasm yok:', cand.rec.model_lib); continue; }
          }
          // eslint-disable-next-line no-await-in-loop
          const engine = await W.CreateMLCEngine(cand.id, {
            initProgressCallback: (p) => {
              const pct = Math.round((p.progress || 0) * 100);
              report(4 + Math.round(pct * 0.94), p.text || `${shortName(cand.id)} indiriliyor… %${pct}`);
            },
            appConfig: { model_list: W.prebuiltAppConfig.model_list, cacheBackend: backend },
          });
          state.engine = engine;
          state.modelId = cand.id;
          state.cacheBackend = backend;
          setSettings({ localModel: cand.id, localTier: getSettings().localTier || 'tiny' });
          report(100, `Hazır: ${shortName(cand.id)}`);
          return engine;
        } catch (e) {
          lastErr = e;
          const f = friendly(e);
          console.warn(`[local] ${cand.id} (${backend}) başarısız:`, f.msg);
          // Ağ hatası geçici olabilir -> aynı modeli geri çekilerek 2 kez daha dene
          if (f.kind === 'network' && (cand.tries || 0) < 2) {
            cand.tries = (cand.tries || 0) + 1;
            const wait = cand.tries * 3000;
            report(state.progress, `🔁 Bağlantı koptu, ${wait / 1000} sn sonra yeniden denenecek (${cand.tries}/2)…`);
            await sleep(wait);
            i--; continue;
          }
          report(state.progress, `⚠️ ${shortName(cand.id)} olmadı (${f.kind}), yedek deneniyor…`);
          // Depo/önbellek hatası -> bu backend'i bırak, sıradakine geç
          if (f.kind === 'network' || f.kind === 'quota') break;
        }
      }
      // Ağ hatası: başka backend de kurtarmaz
      if (lastErr && friendly(lastErr).kind === 'network') break;
    }

    const f = friendly(lastErr);
    state.error = `${f.msg}${f.hint ? ' ' + f.hint : ''}`;
    throw new Error(state.error);
  } finally {
    state.loading = false;
  }
}

/** Ayarlar için: bu cihazda gerçekten yüklenebilir modeller */
export function availableModels() {
  return state.catalog || [];
}

export function shortName(id) {
  return String(id || '').replace(/-q[04]f(16|32)(_1)?-MLC$/, '').replace(/-Instruct$/, '');
}

/** Yerel modelle sohbet */
export async function localChat(messages, opts = {}) {
  if (!state.engine) await loadLocal();
  let msgs = messages;
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

/** Önbellekteki model dosyalarını sil (yer açmak / yeniden denemek için) */
export async function clearModelCache() {
  const done = [];
  try {
    const keys = await caches.keys();
    for (const k of keys) {
      if (/webllm|model|mlc/i.test(k)) { await caches.delete(k); done.push(k); }
    }
  } catch (e) { console.warn(e); }
  try {
    const dbs = await indexedDB.databases?.();
    for (const d of dbs || []) {
      if (/webllm|model|mlc/i.test(d.name || '')) { indexedDB.deleteDatabase(d.name); done.push(d.name); }
    }
  } catch (e) { console.warn(e); }
  return done;
}

/** Cihaz tahmini: varsayılan en küçük bütçe */
export function guessTier() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const mem = navigator.deviceMemory || 0;
  if (!mobile && mem >= 16) return 'desktop';
  if (!mobile && mem >= 8) return 'phone';
  if (mobile && mem >= 6) return 'phone';
  return 'tiny';
}

/** Tanılama: tek çağrıda cihaz + ağ raporu */
export async function diagnose() {
  const gpu = await detectWebGPU();
  const net = await netCheck();
  let lib = false, models = 0;
  try { const W = await loadLib(); lib = !!W.CreateMLCEngine; models = (W.prebuiltAppConfig?.model_list || []).length; } catch {}
  let quota = null;
  try {
    if (navigator.storage?.estimate) {
      const q = await navigator.storage.estimate();
      quota = { usedMB: Math.round((q.usage || 0) / 1048576), totalMB: Math.round((q.quota || 0) / 1048576) };
    }
  } catch {}
  return {
    gpu, f16: state.f16 === true, adapter: state.adapterInfo,
    net, lib, models, quota,
    deviceMemoryGB: navigator.deviceMemory || null,
    online: navigator.onLine,
    tier: getSettings().localTier || 'tiny',
    catalog: state.catalog,
  };
}
