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
import { probePuter, passiveCheck, puterChat, puterStatus, puterSignIn, puterModels, loadPuter, markPuterDown } from './puter.js';
import { houseStatus, probeHouse } from './house.js';
import { wasmStatus, loadWasm, wasmChat } from './wasm.js';
import { HOUSE_KEY, HOUSE_PROVIDER, FRONTIER_KEY, FRONTIER_MODEL, FRONTIER_PROVIDER } from './housekey.js';

export const PROVIDERS = {
  puter: {
    name: 'Puter (anahtarsız bulut)',
    defaultModel: 'Puter otomatik',
    models: [],
    signup: null,
    prefix: null,
    format: 'puter',
  },
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
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b'],
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
    ctx: 262144,   // v74: frontier :free havuzu 256K+ bağlam → dev bağlam montajı açılır
  },
  gemini: {
    // v73: OpenAI-uyumlu uç nokta (canlı doğrulandı: CORS + tools + stream) → ajan döngüsü aynen çalışır
    name: 'Google Gemini (frontier)',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    signup: 'https://aistudio.google.com/apikey',
    prefix: 'AIza',
    format: 'openai',
    ctx: 1000000,   // DEV BAĞLAM: 1M token pencere
  },
};

export function detectProvider(key) {
  const k = (key || '').trim();
  if (!k) return null;
  for (const [id, p] of Object.entries(PROVIDERS)) if (p.prefix && k.startsWith(p.prefix)) return id;
  return null;
}

/** O an hangi beyin kullanılacak? */
let houseDownUntil = 0;
export function markHouseDown(ms = 60000) { houseDownUntil = Date.now() + ms; }

// v73: frontier katmanı kota/hata durumu — dolunca Groq ev beynine otomatik düşülür
let frontierDownUntil = 0;
export function markFrontierDown(ms = 600000) { frontierDownUntil = Date.now() + ms; }
export function frontierStatus() { return { hasKey: !!FRONTIER_KEY, down: Date.now() < frontierDownUntil, model: FRONTIER_MODEL }; }

export function active() {
  const s = getSettings();
  const userKey = (s.apiKey || '').trim();
  const houseOk = !!HOUSE_KEY && Date.now() > houseDownUntil;   // kota kilidine saygılı
  const key = userKey || (houseOk ? HOUSE_KEY : '');            // v27: ev anahtarı = platform anahtarı
  const houseKey = !userKey && houseOk;
  // 🔌 BAĞIMSIZ MOD (v58): yalnız cihaz beyni — hiçbir bulut API/AI'ı çağrılmaz
  if (s.solo) {
    if (wasmStatus().ready) {
      return { id: 'wasm', key: '', def: { name: 'Küçük beyin', format: 'wasm', defaultModel: 'SmolLM2-135M' }, model: 'SmolLM2-135M (cihaz)' };
    }
    if (s.useNano !== false && nanoStatus().availability === 'available') {
      return { id: 'nano', key: '', def: PROVIDERS.nano, model: 'Gemini Nano (Chrome)' };
    }
    return { id: 'local', key: '', def: PROVIDERS.local, model: s.localModel || 'cihazında' };
  }
  // 0-) Ev bulutu bağlıysa (WebRTC): sıfır giriş, sıfır sunucu, sıfır anahtar
  if (!key && houseStatus().ready) {
    return { id: 'house', key: '', def: { name: 'Ev bulutu', format: 'house', defaultModel: 'ev-beyni' }, model: 'ev bulutu (WebRTC)' };
  }
  // 0) Anahtar yoksa: ÖNCE anahtarsız BÜYÜK bulut modeli (Puter) — en iyi kalite
  if (!key && s.usePuter !== false && puterStatus().ready) {
    return { id: 'puter', key: '', def: PROVIDERS.puter, model: 'Puter bulut modeli' };
  }
  // 0a) Anahtar yok ama çalışan ücretsiz servis tespit edilmişse
  if (!key && hasWorkingFree()) {
    return { id: 'free', key: '', def: PROVIDERS.free, model: 'halka açık ücretsiz servis' };
  }
  // 0a2) Cihaz içi küçük beyin (WASM) kurulmuşsa: çevrimdışı, sınırsız, sıfır yönlendirme
  if (!key && wasmStatus().ready) {
    return { id: 'wasm', key: '', def: { name: 'Küçük beyin', format: 'wasm', defaultModel: 'SmolLM2-135M' }, model: 'SmolLM2-135M (cihaz)' };
  }
  // 0b) Chrome'un içindeki Gemini Nano hazırsa (0 indirme, sınırsız)
  if (!key && s.useNano !== false && nanoStatus().availability === 'available') {
    return { id: 'nano', key: '', def: PROVIDERS.nano, model: 'Gemini Nano (Chrome)' };
  }

  // 0y) v73 FRONTIER: ücretsiz Gemini ev anahtarı varsa ÖNCELİK onun (frontier kalite + 1M bağlam).
  // Kota/hata durumunda markFrontierDown ile soğur, zincir Groq ev anahtarına düşer.
  if (!userKey && FRONTIER_KEY && Date.now() > frontierDownUntil) {
    const fId = PROVIDERS[FRONTIER_PROVIDER] ? FRONTIER_PROVIDER : 'gemini';
    const fDef = PROVIDERS[fId];
    return { id: fId, key: FRONTIER_KEY, def: fDef, model: FRONTIER_MODEL || fDef.defaultModel, frontier: true };
  }
  // 0z) Ev anahtarı: sağlayıcıyı kendim wire ederim (kullanıcı hiçbir şey seçmez)
  if (houseKey && PROVIDERS[HOUSE_PROVIDER]) {
    return { id: HOUSE_PROVIDER, key, def: PROVIDERS[HOUSE_PROVIDER], model: PROVIDERS[HOUSE_PROVIDER].defaultModel, houseKey: true };
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
  if (getSettings().solo) {
    // 🔌 Bağımsız: cihaz beyni ya hazır ya da kurulabilir (ilk mesajda iner)
    return wasmStatus().ready || wasmStatus().supported || localStatus().supported === true;
  }
  if (puterStatus().ready) return true;
  if (hasWorkingFree()) return true;
  if (nanoStatus().availability === 'available') return true;
  return localStatus().supported === true;   // WebGPU varsa hazır (model ilk mesajda iner)
}

/**
 * Açılışta çalışır: anahtarsız en iyi kaynağı bul.
 * Sıra: Puter (büyük bulut) -> ücretsiz servisler -> Chrome Nano
 */
export async function probeKeyless({ onProgress } = {}) {
  if ((getSettings().apiKey || '').trim()) return null;
  if (getSettings().solo) {
    // 🔌 Bağımsız mod: bulut sondajı YOK — yalnız cihaz katmanları
    onProgress?.('🔌 Bağımsız mod: cihaz beyni kontrol ediliyor…');
    const avSolo = await probeNano();
    if (avSolo === 'available') return 'nano';
    if (wasmStatus().ready) return 'wasm';
    return null;
  }
  if (getSettings().useHouse !== false) {
    onProgress?.('🏠 Ev bulutu kontrol ediliyor…');
    if (await probeHouse(2500)) return 'house';
  }
  if (getSettings().usePuter !== false) {
    // Pasif: oturum zaten varsa etkinleştir. YOKSA pencere açmayız —
    // kullanıcı "☁️ Dene" düğmesine basınca Puter kendi giriş penceresini açar.
    onProgress?.('☁️ Puter oturumu kontrol ediliyor…');
    const ok = await passiveCheck();
    if (ok) return 'puter';
  }
  if (getSettings().preferFree !== false) {
    const id = await findWorkingFree({ onProgress });
    if (id) return id;
  }
  const av = await probeNano();
  if (av === 'available') return 'nano';
  if (wasmStatus().ready) return 'wasm';
  return null;
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
  if (getSettings().solo) {
    if (wasmStatus().supported || localStatus().supported) return null;
    return 'Bağımsız mod: bu tarayıcıda cihaz beyni çalışamaz (WebAssembly/WebGPU yok). Chrome dene ya da modu kapat.';
  }
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
   Aşağıdaki sıra ÖLÇÜLEREK belirlendi (2026-09-11, gerçek isteklerle):
     nemotron-3-ultra-550b : ilk token 3.3 sn, 550B parametre, Türkçe mükemmel  <-- BİRİNCİ
     nemotron-3-super-120b : ilk token 2.5 sn, temiz Türkçe                     <-- yedek
     nemotron-3.5-lightning: 26 sn (çok yavaş)                                  <-- ELENDİ
     inkling               : 403 "only on agentic harnesses"                    <-- ELENDİ
     gemma-4 / laguna      : 429 upstream rate-limit (geçici, listede duruyor)
   Ayrıca "reasoning:{exclude:true}" ZORUNLU — yoksa modelin düşünce metni
   cevabın içine sızıyor ("Okay, the user is asking..." gibi). */
// Sıra ÖLÇÜLEREK belirlendi (2026-09-11, gerçek Türkçe isteklerle):
//   super-120b : 1.9 sn, temiz Türkçe, madde biçimine uyuyor   <-- EN HIZLI+İYİ
//   nex-n2.5-pro: 4.0 sn, daha detaylı                          <-- 2.
//   ultra-550b : 3-20 sn değişken, sık 502 veriyor ama en akıllı <-- 3.
//   gemma-4    : sürekli 429 (upstream dolu)                    <-- yedek
// v79: lab:bas/lab:son ve lab:skip İŞARETLERİ arasını lab KOD AYARI kendisi günceller
// (ölçüm → yama → node --check + tam suite → başarısızsa geri al; kill-switch: lab/AYAR_KAPALI)
const OR_PRIORITY = [ /*lab:bas*/
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nex-agi/nex-n2.5-pro:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nex-agi/nex-n2.5-mini:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'dots-studio/dots-3-note-preview:free',
/*lab:son*/ ];
const OR_SKIP = /inkling|lightning|laguna|-code|-vl|safety|omni|sante|-fin$/i; /*lab:skip*/
const OR_SCORE = (id) => {
  const p = OR_PRIORITY.indexOf(id);
  if (p !== -1) return 1000 - p;
  if (/nemotron-3-ultra|nemotron-3-super/i.test(id)) return 500;
  if (/gemini|gemma/i.test(id)) return 100;
  if (/llama/i.test(id)) return 96;
  if (/qwen|deepseek|mistral|nex-n2\.5-pro/i.test(id)) return 90;
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
    free = free.filter((m) => !OR_SKIP.test(m.id));
    // Ölçülmüş öncelik listesi başa, kalanlar kaliteye göre
    const live = new Map(free.map((m) => [m.id, m]));
    const head = OR_PRIORITY.filter((id) => live.has(id)).map((id) => live.get(id));
    const rest = free.filter((m) => !OR_PRIORITY.includes(m.id))
      .sort((a, b) => (OR_SCORE(b.id) - OR_SCORE(a.id)) || (b.ctx - a.ctx));
    free = [...head, ...rest];
    // Öncelik listesinde olup canlıda görünmeyenleri de ekle (bazen listeden düşüyor)
    for (const id of OR_PRIORITY) if (!free.some((m) => m.id === id)) free.push({ id, ctx: 0, name: id });
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
  return list[0]?.id || OR_PRIORITY[0];
}

/** Sırayla denenecek modeller (ölçülmüş öncelik + canlı liste) */
/* --- KENDİNİ SIRALAMA: her modelin gerçek başarısı+hızı ölçülür,
       sıra zamanla ölçüme göre değişir (öz-gelişimin altyapı katmanı) --- */
const PERF_KEY = 'evrim:modelPerf';
let perfMem = null;
function perfLoad() {
  if (perfMem) return perfMem;
  try { perfMem = JSON.parse(localStorage.getItem(PERF_KEY) || '{}'); } catch { perfMem = {}; }
  return perfMem;
}
export function perfRecord(id, ok, ms) {
  try {
    const p = perfLoad();
    const e = p[id] || (p[id] = { n: 0, ok: 0, ms: 0, last: 0 });
    e.n++;
    if (ok) { e.ok++; e.ms = e.ms ? Math.round(e.ms * 0.7 + ms * 0.3) : ms; }
    e.last = Date.now();
    const keys = Object.keys(p);
    if (keys.length > 40) delete p[keys[0]];
    perfMem = p;
    localStorage.setItem(PERF_KEY, JSON.stringify(p));
  } catch { /* kota/gizli mod */ }
}
export function perfSnapshot() { return { ...perfLoad() }; }
const perfScore = (id) => {
  const e = perfLoad()[id];
  if (!e || e.n < 2) return 0.35;              // ölçülmemiş: ortada başla (denensin)
  const rate = e.ok / e.n;
  const speed = e.ms ? Math.min(1, 4000 / e.ms) : 0.5;   // ≤4 sn = tam puan
  const fresh = Math.max(0, 1 - (Date.now() - e.last) / (7 * 864e5));
  return rate * 0.6 + speed * 0.3 + fresh * 0.1;
};

export async function rankedFreeModels() {
  const list = await fetchFreeModels();
  const ids = [...OR_PRIORITY];
  for (const m of list) if (!ids.includes(m.id)) ids.push(m.id);
  // ölçülen performans varsa sırayı ona göre yeniden kur (kararlı sıralama)
  return ids
    .map((id, i) => ({ id, i, s: perfScore(id) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.id);
}

/** v52: dakikalık token limiti küçük modeller — araç şeması çekirdek sete indirilir */
const SMALL_ITPM_RE = /gpt-oss-20b|qwen3\.[68]-27b/i;

/** 429/502/403 = bu model şu an dolu -> sıradakine geç */
const ROTATABLE = /429|502|503|403|overloaded|rate.?limit|temporarily/i;

/* --- AKIŞ (streaming): yanıt kelime kelime gelir, "cevap yok" hissi biter --- */
/**
 * TEK tur istek (döngü yok). Araç çağrılarını da döndürür.
 * @returns {Promise<{content:string, toolCalls:Array|null, model:string}>}
 */
export async function rawChat(messages, opts = {}) {
  const a = active();
  const useStream = !!opts.onChunk && !opts.json;
  let model = opts.model || a.model;
  if (a.id === 'openrouter' && (!model || model === 'auto' || !model.endsWith(':free'))) model = await bestFreeModel();

  // Araç çağrısı yalnızca OpenAI-biçimli sağlayıcılarda destekleniyor
  const supportsTools = (a.def.format === 'openai') && !opts.json && !!opts.tools?.length;

  if (a.def.format === 'openai') {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.key}` };
    if (a.id === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'EVRIM'; }
    let queue = a.id === 'openrouter'
      ? (opts._queue || await rankedFreeModels()).slice(0, 5)
      : a.id === 'groq'
        ? [model, ...PROVIDERS.groq.models.filter((m) => m !== model)]
        : a.id === 'gemini'
          ? (opts._queue || [...new Set([model, 'gemini-2.5-flash-lite'])])   // v73: lite ayrı kota havuzu olabilir
          : [model];
    // v73: frontier kota/hatasında ev beynine düşüş (bir kez)
    const frontierFall = () => {
      if (!a.frontier || opts._frontierFell) return null;
      markFrontierDown(600000);
      if (HOUSE_KEY && Date.now() > houseDownUntil) {
        opts.onProgress?.(0, '🚀 Frontier kota/hata → ev beynine geçiliyor…');
        return rawChat(messages, { ...opts, _frontierFell: true });
      }
      return null;
    };
    // v64: düz metin cevabında (araçsız + JSON'suz) Groq bileşik AI sistemi de sıraya girer.
    // (compound tool calling DESTEKLEMİYOR — 2026-09-13'te canlı doğrulandı; araç turlarına sokma!)
    if (a.id === 'groq' && !supportsTools && !opts.json && !queue.includes('groq/compound')) {
      queue = [queue[0], 'groq/compound', ...queue.slice(1)];
    }
    let lastErr = null;
    for (let qi = 0; qi < queue.length; qi++) {
      const mid = queue[qi];
      // v52: küçük ITPM limitli modeller (20b/qwen27b) yalnız çekirdek araç setini alır → 413 kökten önlenir
      const toolsForModel = (SMALL_ITPM_RE.test(mid) && Array.isArray(opts.toolsSlim) && opts.toolsSlim.length)
        ? opts.toolsSlim : opts.tools;
      // v64: BEYİN GÜCÜ — gpt-oss modelleri reasoning_effort ile DERİN DÜŞÜNÜR (canlı doğrulandı:
      // 9.11 vs 9.9 tuzağını high modda doğru cevapladı). Düşünce tokenları completion bütçesini
      // yediği için gpt-oss'ta max_tokens tabanı yükseltilir, yoksa cevap kesilir.
      const small64 = SMALL_ITPM_RE.test(mid);
      const oss64 = /^openai\/gpt-oss/i.test(mid);
      let maxTok64 = opts.maxTokens ?? 900;
      if (small64) maxTok64 = Math.min(Math.max(maxTok64, 1500), 4000);
      else if (toolsForModel?.length) maxTok64 = Math.max(maxTok64, 8000);   // v62: büyük araç argümanları
      else if (oss64) maxTok64 = Math.max(maxTok64, 4000);                    // v64: düşünce payı
      if (a.id === 'gemini') maxTok64 = Math.max(maxTok64, toolsForModel?.length ? 16000 : 8000);  // v73/v75: düşünme payı + zengin site kodu
      if ((a.frontier || a.id === 'openrouter') && toolsForModel?.length) maxTok64 = Math.max(maxTok64, 16000);  // v75: 350-600 satır site ~12-15K token
      const body = {
        model: mid, messages, temperature: opts.temperature ?? 0.7,
        max_tokens: maxTok64,
        ...(oss64 ? { reasoning_effort: small64 ? 'medium' : (opts.reasoning || 'high') } : {}),
        ...(a.id === 'openrouter' ? { reasoning: { exclude: true } } : {}),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        ...(supportsTools ? { tools: toolsForModel, tool_choice: 'auto' } : {}),
        ...(useStream ? { stream: true } : {}),
      };
      const t0 = Date.now();
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await withTimeout(a.def.url, { method: 'POST', headers, body: JSON.stringify(body) }, 120000);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const msg = errText(res.status, data, a.id);
          if (a.id === 'openrouter') perfRecord(mid, false, 0);
          if (res.status === 413) {
            // v51: istek modelin token limitini (ITPM) aştı → araçsız + kısa geçmişle zayıflatılmış tekrar
            if (!opts._slimRetry) {
              opts.onProgress?.(0, `⚠️ ${mid.split('/').pop()}: istek çok büyük → inceltiliyor (araçsız + kısa geçmiş)…`);
              return rawChat(trimMessages(messages), { ...opts, _slimRetry: true, tools: null, _queue: queue.slice(qi) });
            }
            if (qi < queue.length - 1) {
              lastErr = new Error(msg);
              opts.onProgress?.(0, `⚠️ ${mid.split('/').pop()} limiti yetmedi → sıradaki model…`);
              continue;
            }
          }
          if (ROTATABLE.test(`${res.status} ${msg}`) && qi < queue.length - 1) {
            lastErr = new Error(msg);
            opts.onProgress?.(0, `⚠️ ${mid.split('/').pop()} dolu (${res.status}) → sıradaki model…`);
            continue;
          }
          if (res.status === 400 && /schema|tools/i.test(msg) && supportsTools && !opts._schemaRetry) {
            return rawChat(messages, { ...opts, _schemaRetry: true, tools: null });
          }
          if (a.houseKey && ROTATABLE.test(`${res.status} ${msg}`)) markHouseDown(60000);
          { const fb = frontierFall(); if (fb) return fb; }   // v73
          throw new Error(msg);
        }
        if (useStream) {
          let r;
          try {
            r = await streamOpenAI(res, opts.onChunk, mid, supportsTools);
          } catch (eStream) {
            const em62 = String(eStream?.message || eStream);
            if (/tool_use_failed|Failed to parse tool call/i.test(em62) && !opts._toolFailRetry) {
              // v62: model araç çağrısı JSON'unu bozdu → araçsız tek tekrar (kullanıcı cevapsız kalmasın)
              opts.onProgress?.(0, '⚠️ Model araç JSON\u2019unu bozdu → araçsız yeniden deneniyor…');
              return rawChat(messages, { ...opts, _toolFailRetry: true, tools: null, toolsSlim: null });
            }
            throw eStream;
          }
          if (a.id === 'openrouter') perfRecord(mid, true, Date.now() - t0);
          return { content: stripReasoning(r.content), toolCalls: r.toolCalls, model: mid };
        }
        const data = await res.json().catch(() => ({}));
        const m = data.choices?.[0]?.message || {};
        const text = (m.content || '').trim();
        const calls = (m.tool_calls || []).map((t) => ({
          id: t.id, name: t.function?.name, arguments: t.function?.arguments || '{}',
        }));
        if (!text && !calls.length) {
          if (qi < queue.length - 1) { lastErr = new Error('boş yanıt'); continue; }
          throw new Error('Model boş yanıt döndürdü');
        }
        return { content: stripReasoning(text), toolCalls: calls.length ? calls : null, model: mid };
      } catch (e) {
        lastErr = e;
        const rotatable = ROTATABLE.test(`${e.status || ''} ${e.message || ''}`);
        if (rotatable && !opts._retriedSame && (e.status === 502 || /overloaded|empty|boş/i.test(e.message || ''))) {
          opts.onProgress?.(0, `🔁 ${mid.split('/').pop()} meşgul, 2 sn sonra tekrar…`);
          await new Promise((r) => setTimeout(r, 2000));
          return rawChat(messages, { ...opts, _retriedSame: true, _queue: queue.slice(qi) });
        }
        if (rotatable && qi < queue.length - 1) { opts.onProgress?.(0, `⚠️ ${mid.split('/').pop()} yanıt vermedi → sıradaki…`); continue; }
        { const fb = frontierFall(); if (fb) return fb; }   // v73
        throw e;
      }
    }
    { const fb = frontierFall(); if (fb) return fb; }   // v73
    throw lastErr || new Error('Hiçbir ücretsiz model yanıt vermedi (günlük kota dolmuş olabilir)');
  }

  // Araç desteklemeyen sağlayıcılar (Gemini/Puter/Nano/yerel) -> düz metin
  const text = await chat(messages, { ...opts, tools: undefined });
  return { content: text, toolCalls: null, model };
}

async function streamOpenAI(res, onChunk, model, wantTools = false) {
  /* DİKKAT: OpenRouter bazen HTTP 200 döner ama AKIŞIN İÇİNE hata koyar:
       data: {"choices":[],"error":{"code":502,"message":"...overloaded"}}
     Bunu yakalamazsak boş cevap "başarılı" sanılır. (2026-09-11'de ölçüldü) */
  const fail = (code, msg) => { const e = new Error(`${model}: HTTP ${code} ${msg}`); e.status = code; throw e; };

  if (!res.body) {
    const d = await res.json().catch(() => ({}));
    if (d?.error) fail(d.error.code || res.status, d.error.message || 'akış hatası');
    const txt = (d.choices?.[0]?.message?.content || '').trim();
    if (txt) onChunk?.(txt, txt);
    return txt;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '', streamErr = null;
  const toolAcc = new Map();   // index -> {id, name, args}
  try {
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
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          if (j.error) { streamErr = { code: j.error.code || 502, msg: j.error.message || 'akış hatası' }; break; }
          const ch = j.choices?.[0];
          if (!ch) continue;
          const delta = ch.delta || {};
          // Araç çağrıları parça parça gelir -> index'e göre birleştir
          for (const tc of delta.tool_calls || []) {
            const i = tc.index ?? 0;
            const cur = toolAcc.get(i) || { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(i, cur);
          }
          const d = delta.content ?? '';
          if (d) { out += d; onChunk?.(d, out, model); }
          if (ch.finish_reason && ch.finish_reason !== 'stop' && !out && !toolAcc.size) {
            streamErr = { code: 502, msg: `finish_reason=${ch.finish_reason}` };
          }
        } catch {}
      }
      if (streamErr) break;
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const toolCalls = wantTools && toolAcc.size
    ? [...toolAcc.values()].filter((t) => t.name).map((t) => ({ id: t.id, name: t.name, arguments: t.args || '{}' }))
    : null;
  if (streamErr && !out.trim() && !toolCalls) fail(streamErr.code, streamErr.msg);
  if (!out.trim() && !toolCalls) fail(502, 'model boş akış döndürdü');
  return { content: out.trim(), toolCalls };
}

/** "Düşünce" metni cevaba sızarsa temizle (reasoning:exclude çalışmazsa yedek) */
export function isBigCtx(a = active()) { return (a?.def?.ctx || 0) >= 200000; }

export function stripReasoning(text) {
  let t = String(text || '');
  const marks = [
    /^(?:Okay|OK|Hmm|Alright|Let me|The user|Here'?s a thinking process|I need to|First,|Analysis:)[\s\S]*?(?=\n\s*(?:\d+[.)]|[-*•]|\*\*|#))/im,
  ];
  // İçerik İngilizce düşünce ile başlayıp sonra Türkçe/madde cevapla devam ediyorsa kes
  const nl = t.indexOf('\n');
  if (nl > 0 && nl < 200) {
    const head = t.slice(0, nl);
    if (/^(Okay|OK|Hmm|Alright|Let me|The user|Here'?s|I need to|So,|Well,)/i.test(head.trim())
      && /[çğıöşü]|\d+[.)]|[-*•]/i.test(t.slice(nl))) {
      t = t.slice(nl + 1);
    }
  }
  for (const re of marks) { if (re.test(t)) { const m = t.match(re); if (m && m.index === 0 && m[0].length < t.length * 0.7) t = t.slice(m[0].length); } }
  return t.trim();
}

/** v51 (413 inceltme): araç izlerini düşür, uzun mesajları kısalt, ilk sistem + son 8 mesajı tut */
function trimMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'system') { out.push({ role: 'system', content: String(m.content || '').slice(0, 2600) }); continue; }
    if (m.role === 'tool' || m.tool_calls) continue;
    out.push({ role: m.role, content: String(m.content || '').slice(0, 1600) });
  }
  const sys = out.filter((m) => m.role === 'system').slice(0, 2);
  const rest = out.filter((m) => m.role !== 'system').slice(-8);
  return [...sys, ...rest];
}

function errText(status, data, id) {
  const msg = data?.error?.message || data?.error?.error?.message || JSON.stringify(data || {}).slice(0, 200);
  if (status === 401) return `Anahtar geçersiz (${id}). Ayarlar’dan kontrol et.`;
  if (status === 402) return `${id}: ücretsiz kota/bakiye tükendi.`;
  if (status === 413) return `${id}: istek çok büyük — modelin dakikalık token limiti aşıldı (konuşma kısaltılınca tekrar dene).`;
  if (status === 429) return id === 'groq'
    ? 'groq: paylaşımlı ücretsiz kota bu dakika dolu — diğer modeller sırayla deneniyor'
    : `${id}: hız limiti/kota dolu — birazdan tekrar dene`;
  if (status === 404) return `Model bulunamadı (${id}): ${msg}`;
  return `${id} HTTP ${status}: ${msg}`;
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number,maxTokens?:number,json?:boolean,onProgress?:Function}} opts
 */
export async function chat(messages, opts = {}) {
  let a = active();

  // --- PUTER: ANAHTARSIZ BÜYÜK BULUT MODELİ ---
  if (a.id === 'puter') {
    try {
      return await puterChat(messages, opts);
    } catch (e) {
      console.warn('[llm] Puter başarısız:', e.message);
      opts.onProgress?.(0, `☁️ Puter yanıt vermedi (${e.message.slice(0, 60)}) — yedek kaynağa geçiliyor…`);
      markPuterDown(e.message);
      const alt = await findWorkingFree({});
      a = alt ? { id: 'free', def: PROVIDERS.free } : (nanoStatus().availability === 'available'
        ? { id: 'nano', def: PROVIDERS.nano } : { id: 'local', def: PROVIDERS.local });
      if (a.id === 'free') { try { return await freeChat(messages, opts); } catch {} a = { id: 'local', def: PROVIDERS.local }; }
    }
  }

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
      opts.onProgress?.(0, '🌐 Ücretsiz halka açık servisler kapalı (bu servislerin garantisi yok) → cihazında açık kaynak model başlatılıyor…');
      a = { id: 'local', def: PROVIDERS.local };
    }
  }

  // --- CİHAZINDA ÇALIŞAN MODEL (anahtarsız) ---
  if (a.id === 'local') {
    const solo = !!getSettings().solo;
    // Belki bu arada bir ücretsiz servis çalışır hale gelmiştir (🔌 bağımsız modda ASLA)
    if (!solo && getSettings().preferFree !== false && !(getSettings().apiKey || '').trim()) {
      const id = await findWorkingFree({ onProgress: opts.onProgress });
      if (id) {
        try { return await freeChat(messages, opts); } catch {}
      }
    }
    if (!localStatus().ready) {
      // 🔌 Bağımsız mod + WebGPU yok → küçük beyin (WASM/CPU) ile yola devam
      if (solo && !localStatus().supported && wasmStatus().supported) {
        if (!wasmStatus().ready) await loadWasm((p) => opts.onProgress?.(p, `🧠 Cihaz beyni kuruluyor… %${p}`));
        const out = await wasmChat(messages, opts.onChunk);
        return out.content;
      }
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
    const r = await rawChat(messages, opts);
    return r.content;
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
  return stripReasoning((data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('').trim());
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
  probePuter, passiveCheck, puterStatus, puterSignIn, puterModels, loadPuter, markPuterDown,
};
