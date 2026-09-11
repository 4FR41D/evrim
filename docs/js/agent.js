/* js/agent.js — AJAN DÖNGÜSÜ (EVRIM'i "asistan"dan "ajan"a çeviren katman)

   Normal sohbet:   soru -> cevap
   Ajan döngüsü:    soru -> DÜŞÜN -> ARAÇ ÇAĞIR -> SONUCU OKU -> (gerekirse tekrar) -> cevap

   Bütün araçlar TARAYICIDA çalışır: sunucu yok, ek API anahtarı yok.
   Sadece `wikipedia` dışarı çıkar (CORS'u açık, anahtar istemiyor). */
import { all, insert, getSettings, now, storageSize } from './store.js';
import * as evo from './evolve.js';
import * as learn from './learn.js';
import { rawChat, active as activeLLM } from './llm.js';

const MAX_STEPS = 4;

/* ------------------------------------------------------------------ */
/* ARAÇ TANIMLARI (modele giden şema)                                  */
/* ------------------------------------------------------------------ */
const F = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const TOOLS = [
  F('memory_search', 'Kullanıcının kalıcı hafızasında ara. Kullanıcı daha önce bir şey söylediyse, tercihlerinden veya geçmişinden bahsediyorsan ÖNCE bunu çağır.', {
    query: { type: 'string', description: 'Aranacak konu/anahtar kelime' },
  }, ['query']),

  F('remember', 'Kalıcı bir bilgiyi hafızaya kaydet. Kullanıcı adını, tercihini, hedefini, bir hatanı veya yeni bir kuralı öğrendiğinde çağır.', {
    content: { type: 'string', description: 'Tek cümle, 140 karakterden kısa, Türkçe' },
    kind: { type: 'string', enum: ['fact', 'preference', 'skill', 'mistake', 'rule'], description: 'fact=bilgi, preference=tercih, skill=beceri, mistake=hata, rule=kural' },
  }, ['content', 'kind']),

  F('conversation_search', 'Geçmiş sohbet mesajlarında ara. "daha önce konuşmuştuk", "geçen sormuştum" gibi ifadelerde kullan.', {
    query: { type: 'string' },
  }, ['query']),

  F('calculator', 'Matematiksel hesap yap. Kendin hesaplamaya ÇALIŞMA, bu aracı kullan.', {
    expression: { type: 'string', description: 'Örn: (145*37)+sqrt(16) — sadece sayı ve operatör' },
  }, ['expression']),

  F('datetime', 'Bugünün tarihi, saati ve gün adını al. Tarih/hesap gerektiren her konuda kullan.', {}),

  F('wikipedia', "Gerçek dünya bilgisi için Vikipedi'de ara; başlık + özet + kaynak bağlantısı döner. Kişi, yer, kavram, olay, tarih gibi olgusal sorularda kullan. ÖNEMLİ: found=false dönerse AYNI aracı farklı sorguyla TEKRAR ÇAĞIRMA — genel bilginle cevap ver veya başka araç kullan.", {
    query: { type: 'string', description: "Konu. Tam başlık olmak zorunda değil (örn. 'Kayseri', 'yapay zeka', 'İstanbul\'un fethi')" },
    lang: { type: 'string', description: 'tr (varsayılan) veya en' },
  }, ['query']),

  F('learning_status', 'Kullanıcının öğrenme koçu durumunu getir: beceri haritası, tekrar zamanı gelen kartlar, zayıf konular.', {}),

  F('create_flashcard', 'Kullanıcının öğrenmesi için tekrar kartı oluştur (aralıklı tekrar sistemine eklenir).', {
    question: { type: 'string' },
    answer: { type: 'string' },
    topic: { type: 'string' },
  }, ['question', 'answer', 'topic']),

  F('self_status', 'Kendi durumunu getir: beyin sürümü, hafıza sayısı, aktif model, öğrenilen kurallar. "Nasıl çalışıyorsun?", "neler biliyorsun?" gibi sorularda kullan.', {}),

  F('improve_self', 'KENDİNİ GELİŞTİR: kalıcı bir davranış kuralı ekle. Kullanıcı senden bir biçim/davranış istediğinde ("kısa yaz", "tablo kullan", "emoji kullanma") MUTLAKA bunu çağır.', {
    rule: { type: 'string', description: 'Tek cümlelik kural, Türkçe, emir kipinde' },
    reason: { type: 'string', description: 'Bu kuralın nedeni' },
  }, ['rule']),

  F('web_oku', 'WEB SAYFASI OKU (anahtarsız): kullanıcı bir LİNK paylaştıysa MUTLAKA bunu çağır ve sayfı özetle. Güncel/kesin bilgi lazım olup Vikipedi yetmezse de kullan (resmî site, doküman, haber). Dakikada 20 istek limiti var; gereksiz çağırma.', {
    url: { type: 'string', description: 'https:// ile başlayan tam adres' },
    odak: { type: 'string', description: 'Opsiyonel: sayfada aranacak konu/anahtar kelime (uzun sayfalarda ilgili bölümü getirir)' },
  }, ['url']),

  F('gorsel_uret', 'GÖRSEL ÜRET (anahtarsız + ücretsiz, Puter üzerinden): kullanıcı fotoğraf, çizim, logo, afiş, duvar kağıdı, ikon gibi bir GÖRSEL istediğinde kullan. Araç bir İŞARET döndürür (![görsel](evrimimg:...)) — o işareti yanıtına AYNEN koy ki görsel görünsün.', {
    istem: { type: 'string', description: 'Detaylı görsel promptu (İngilizce önerilir: konu, stil, ışık, kompozisyon)' },
    model: { type: 'string', description: 'Opsiyonel model (örn. gpt-image-1-mini, flux-schnell)' },
  }, ['istem']),

  F('api_katalog', 'AÇIK API KATALOĞU (660+ üretici medya modeli + üçüncü taraf araçlar): kullanıcı görsel/video/ses/3D üretim modeli, arka plan kaldırma, upscale, SEO, scraping, veri zenginleştirme gibi DIŞ API/model araçları sorarsa burada ara. Kendin model adı UYDURMA — katalogdan getir ve ücret/anahtar gereksinimini mutlaka söyle.', {
    sorgu: { type: 'string', description: 'Aranacak yetenek (İngilizce terim daha iyi eşleşir): "text to image", "video upscale", "background removal", "text to speech"...' },
    adet: { type: 'integer', description: 'Kaç sonuç istensin (1-5, varsayılan 3)' },
  }, ['sorgu']),
];

/* ------------------------------------------------------------------ */
/* ARAÇ ÇALIŞTIRICILAR (hepsi tarayıcıda)                              */
/* ------------------------------------------------------------------ */
const norm = (s) => String(s || '').toLocaleLowerCase('tr');
const score = (hay, needle) => {
  const h = norm(hay), n = norm(needle);
  if (!n) return 0;
  if (h.includes(n)) return 3;
  const words = n.split(/\s+/).filter((w) => w.length > 2);
  return words.filter((w) => h.includes(w)).length;
};

function safeCalc(expr) {
  const e = String(expr || '').replace(/,/g, '.').trim();
  if (!e || e.length > 200) throw new Error('ifade boş veya çok uzun');
  // sadece sayı, operatör, parantez ve bilinen fonksiyonlar
  const allowed = /^[0-9+\-*/().%\s^a-zA-Z_]*$/;
  if (!allowed.test(e)) throw new Error('izin verilmeyen karakter');
  if (/[{}[\];]/.test(e)) throw new Error('izin verilmeyen karakter');
  const fn = ['sqrt', 'abs', 'round', 'floor', 'ceil', 'min', 'max', 'pow', 'sin', 'cos', 'tan', 'log', 'log10', 'exp', 'PI', 'E', 'random'];
  const bad = (e.match(/[a-zA-Z_]+/g) || []).filter((w) => !fn.includes(w));
  if (bad.length) throw new Error(`bilinmeyen fonksiyon: ${bad.join(', ')}`);
  const js = e.replace(/\^/g, '**');
  // eslint-disable-next-line no-new-func
  const val = Function(`"use strict";const {sqrt,abs,round,floor,ceil,min,max,pow,sin,cos,tan,log,log10,exp,PI,E,random}=Math;return (${js});`)();
  if (typeof val !== 'number' || !isFinite(val)) throw new Error('sonuç sayı değil');
  return val;
}

/* --- Vikipedi: Türkçe-duyarlı akıllı başlık seçimi ---
   Ölçüldü: aramanın ilk sonucu çoğu zaman YANLIŞ ("İstanbul'un fethi" -> bir ressam).
   Bu yüzden: (1) adayları Türkçe-normalize benzerlikle skorla,
             (2) iyi eşleşme yoksa başlığı DOĞRUDAN sorgula,
             (3) yine de bulamazsan alternatifleri döndür (model tekrar tahmin yürütmesin). */
/* Türkçe-duyarlı normalleştirme. ÖLÇÜLDÜ: toLocaleLowerCase('tr') ile "I" -> "ı" oluyor
   ve "Istanbul" ile "İstanbul" eşleşmiyordu. Bu yüzden önce ASCII/Türkçe I'ları sabitliyoruz. */
const TR_MAP = {
  'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u',
  'İ': 'i', 'I': 'i', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u', 'Â': 'a', 'Î': 'i', 'Û': 'u',
};
const trNorm = (x) => String(x || '').trim().replace(/\s+/g, ' ')
  .split('').map((c) => TR_MAP[c] || c).join('').toLowerCase();

function titleScore(title, query) {
  const t = trNorm(title), q = trNorm(query);
  if (!t) return -1;
  if (t === q) return 100;
  if (t.startsWith(q) || q.startsWith(t)) return 78;
  const qw = q.split(' ').filter((w) => w.length > 2);
  const tw = t.split(' ');
  const exact = qw.filter((w) => tw.includes(w)).length;
  const part = qw.filter((w) => tw.some((x) => x.includes(w) || w.includes(x))).length;
  return exact * 18 + part * 6 + (q.includes(t) ? 25 : 0) - Math.max(0, tw.length - qw.length) * 2;
}

const WIKI_HEADERS = { 'Api-User-Agent': 'EVRIM/1.0 (https://4fr41d.github.io/evrim; kisisel asistan)' };
const wikiCache = new Map();

async function wikiFetch(url) {
  if (wikiCache.has(url)) return wikiCache.get(url);
  let out = null;
  for (let i = 0; i < 2; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 12000);
      // eslint-disable-next-line no-await-in-loop
      const r = await fetch(url, { headers: WIKI_HEADERS, signal: c.signal });
      clearTimeout(t);
      if (r.ok) { out = await r.json().catch(() => null); break; }
      if (r.status === 404) break;
    } catch {}
    if (i === 0) await new Promise((r) => setTimeout(r, 700));
  }
  wikiCache.set(url, out);
  return out;
}

async function pageExists(base, title) {
  const j = await wikiFetch(`${base}/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&format=json&origin=*`);
  const pages = j?.query?.pages || {};
  const k = Object.keys(pages)[0];
  return (k && k !== '-1' && !pages[k].missing) ? pages[k].title : null;
}

/** "Anitkabir" -> "Anıtkabir" gibi Türkçe karakter varyantlarını üret */
function trVariants(word) {
  const out = new Set([word]);
  const swaps = [['i', 'ı'], ['ı', 'i'], ['u', 'ü'], ['o', 'ö'], ['c', 'ç'], ['g', 'ğ'], ['s', 'ş']];
  for (const [a, b] of swaps) if (word.includes(a)) { out.add(word.split(a).join(b)); }
  return [...out];
}

async function wiki(query, lang = 'tr') {
  const base = `https://${lang === 'en' ? 'en' : 'tr'}.wikipedia.org`;
  const q = String(query || '').trim();
  if (!q) return { found: false, note: 'sorgu boş' };
  const enc = encodeURIComponent(q);

  const cands = new Map();
  const add = (title, score) => {
    if (!title) return;
    cands.set(title, Math.max(cands.get(title) || 0, score));
  };

  // 1) opensearch — başlık öneki eşleşmesi ("Istanbul'un fethi" -> "İstanbul'un Fethi")
  const os = await wikiFetch(`${base}/w/api.php?action=opensearch&search=${enc}&limit=6&namespace=0&format=json&origin=*`);
  if (os === null) return { found: false, note: "Vikipedi'ye ulaşılamadı (ağ veya aşırı istek). TEKRAR DENEME, genel bilginle cevap ver." };
  (Array.isArray(os) ? os[1] : []).forEach((t, i) => add(t, Math.max(titleScore(t, q), 92 - i * 4)));

  // 2) tam metin arama — soru biçimli sorgular için
  const sj = await wikiFetch(`${base}/w/api.php?action=query&list=search&srsearch=${enc}&format=json&origin=*&srlimit=6`);
  (sj?.query?.search || []).forEach((x) => add(x.title, titleScore(x.title, q)));

  // 3) doğrudan başlık sorgusu + Türkçe varyantlar (arama bulamadıysa)
  let ranked = [...cands.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 40) {
    const words = q.split(' ').filter((w) => w.length > 3);
    const tries = [];
    for (const base0 of [q, ...(words.length ? [words[0]] : [])]) {
      const cap = base0.charAt(0).toLocaleUpperCase('tr') + base0.slice(1);
      for (const v of trVariants(base0)) { tries.push(v, v.charAt(0).toLocaleUpperCase('tr') + v.slice(1)); }
      for (const v of trVariants(cap)) tries.push(v);
    }
    for (const t of [...new Set(tries)].slice(0, 6)) {
      // eslint-disable-next-line no-await-in-loop
      const real = await pageExists(base, t);
      if (real) { add(real, 95); break; }
    }
    ranked = [...cands.entries()].sort((a, b) => b[1] - a[1]);
  }

  if (!ranked.length) {
    return { found: false, note: `"${q}" için Vikipedi'de sonuç yok. Farklı sorguyla TEKRAR DENEME; genel bilginle cevap ver.`, oneriler: [] };
  }

  for (const [title, score] of ranked.slice(0, 2)) {
    // eslint-disable-next-line no-await-in-loop
    const j = await wikiFetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (j?.extract) {
      return {
        found: true, title: j.title || title, eslesmeSkoru: score,
        extract: String(j.extract).slice(0, 1400),
        url: j.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(title)}`,
        oneriler: ranked.slice(1, 4).map(([t]) => t),
      };
    }
  }
  return {
    found: false,
    note: `"${q}" için özet alınamadı. Farklı sorguyla TEKRAR DENEME; elindeki bilgiyle cevap ver.`,
    oneriler: ranked.slice(0, 4).map(([t]) => t),
  };
}

/* ------------------------------------------------------------------ */
/* AÇIK API KATALOĞU — awesome-agent-apis (MIT)                        */
/* Anahtar YOK, ücret YOK: yalnızca herkese açık GitHub verisi okunur. */
/* CORS: api.github.com ve raw.githubusercontent.com -> *              */
/* ------------------------------------------------------------------ */
const CAT_REPO = 'Anil-matcha/awesome-agent-apis';
const CAT_CACHE_KEY = 'evrim:catTree';
const CAT_TTL = 6 * 60 * 60 * 1000;   // 6 saat
let catTreeMem = null;

const CAT_ASCII = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' };
const catNorm = (s) => String(s || '').replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => CAT_ASCII[c]).toLowerCase();
function catScore(hay, needle) {
  const h = catNorm(hay), n = catNorm(needle);
  if (!n) return 0;
  if (h.includes(n)) return 3;
  const words = n.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return words.filter((w) => h.includes(w)).length;
}

async function catTree() {
  if (catTreeMem) return catTreeMem;
  try {
    const c = JSON.parse(localStorage.getItem(CAT_CACHE_KEY) || 'null');
    if (c && Array.isArray(c.names) && c.names.length && Date.now() - c.t < CAT_TTL) {
      catTreeMem = c.names; return c.names;
    }
  } catch { /* önbellek yok */ }
  const res = await fetch(`https://api.github.com/repos/${CAT_REPO}/git/trees/main?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`katalog listesine ulaşılamadı (${res.status})`);
  const j = await res.json();
  const names = (j.tree || [])
    .filter((x) => x.path.startsWith('models/') && x.path.endsWith('.yaml'))
    .map((x) => x.path.slice('models/'.length, -5));
  if (!names.length) throw new Error('katalog boş geldi');
  catTreeMem = names;
  try { localStorage.setItem(CAT_CACHE_KEY, JSON.stringify({ t: Date.now(), names })); } catch { /* kota */ }
  return names;
}

const catField = (yaml, key) => {
  const m = yaml.match(new RegExp(`^${key}:\\s*"?([^"#\\n]*)"?`, 'm'));
  return m ? m[1].trim() : '';
};

const CAT_UYARI = 'Bu modeller muapi.ai üzerinden çağrılır: ÜCRETLİDİR (kredi) ve muapi API anahtarı ister. EVRIM bunları şu an doğrudan ÇALIŞTIRMAZ; yalnızca katalogdan bulup bildirir.';
const CAT_NOMATCH = 'Bu sorguyla eşleşme yok. İngilizce ve daha genel dene: "text to image", "video", "audio", "upscale", "background".';

/* 1) YEREL YEDEK — kendi repomuzda (GitHub Pages, aynı origin, CORS derdi yok,
      upstream repo silinse bile çalışır, SW sayesinde çevrimdışı da çalışır) */
const CAT_MIRROR = new URL('data/katalog.json', document.baseURI).href;
let catMirrorMem = null;
async function catMirror() {
  if (catMirrorMem) return catMirrorMem;
  const r = await fetch(CAT_MIRROR);
  if (!r.ok) throw new Error(`yerel yedek ${r.status}`);
  const j = await r.json();
  if (!j || !Array.isArray(j.items) || !j.items.length) throw new Error('yerel yedek boş');
  catMirrorMem = j;
  return j;
}

async function katalogAra(sorgu, adet) {
  const q = String(sorgu || '').trim();
  if (!q) return { found: 0, note: 'Sorgu boş.' };
  const lim = Math.max(1, Math.min(5, Number(adet) || 3));

  /* --- önce yerel yedek --- */
  try {
    const mir = await catMirror();
    const ranked = mir.items
      .map((it) => ({
        it,
        s: Math.max(
          catScore(String(it.m || '').replace(/[-_]+/g, ' '), q),
          catScore(String(it.a || ''), q),
          catScore(String(it.c || '').replace(/[._]+/g, ' '), q),
        ),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, lim);
    return {
      found: ranked.length,
      toplam: mir.items.length,
      kaynak: 'yerel yedek (bu repo) ← awesome-agent-apis (MIT)',
      senkron: mir.senkron || null,
      uyari: CAT_UYARI,
      note: ranked.length ? undefined : CAT_NOMATCH,
      items: ranked.map(({ it }) => ({
        model: it.m, ad: it.a, yetenek: it.c, aciklama: it.d,
        ucret: it.u ? `~$${it.u} / çağrı (muapi kredisi)` : 'belirtilmemiş',
        docs: it.l,
      })),
    };
  } catch { /* yerel yedek yoksa upstream'e düş */ }

  /* --- sonra upstream GitHub (eski davranış) --- */
  try {
    const names = await catTree();
    const ranked = names
      .map((n) => ({ n, s: catScore(n.replace(/[-_]+/g, ' '), q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, lim);
    if (!ranked.length) return { found: 0, toplam: names.length, kaynak: 'upstream GitHub', note: CAT_NOMATCH };
    const items = await Promise.all(ranked.map(async ({ n }) => {
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${CAT_REPO}/main/models/${encodeURIComponent(n)}.yaml`);
        if (!r.ok) return { model: n, hata: `okunamadı (${r.status})` };
        const y = await r.text();
        return {
          model: n,
          ad: catField(y, 'title') || n,
          yetenek: catField(y, 'capability'),
          aciklama: catField(y, 'description'),
          ucret: catField(y, 'cost') ? `~$${catField(y, 'cost')} / çağrı (muapi kredisi)` : 'belirtilmemiş',
          docs: catField(y, 'docs_url'),
        };
      } catch (e) { return { model: n, hata: e.message }; }
    }));
    return {
      found: items.length,
      toplam: names.length,
      kaynak: 'awesome-agent-apis (MIT, github.com/Anil-matcha/awesome-agent-apis)',
      uyari: CAT_UYARI,
      items,
    };
  } catch (e) {
    /* HİÇBİR kaynak yoksa çökme: dürüst ve yumuşak cevap */
    return {
      found: 0,
      hata: e.message,
      note: 'Katalog şu an hiçbir kaynaktan okunamadı (yerel yedek + GitHub ikisi de kapalı). Bağlantını kontrol edip tekrar dene.',
    };
  }
}

/* --- üretilen görseller: mesaj geçmişinde data-URL taşıma, id taşı --- */
const MEDIA_KEY = 'evrim:media';
const MEDIA_CAP = 4;
const mediaMem = new Map();
function mediaKaydet(id, dataUrl) {
  mediaMem.set(id, dataUrl);
  try {
    const all = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}');
    all[id] = dataUrl;
    const keys = Object.keys(all);
    while (keys.length > MEDIA_CAP) delete all[keys.shift()];
    try { localStorage.setItem(MEDIA_KEY, JSON.stringify(all)); }
    catch { localStorage.removeItem(MEDIA_KEY); }   // kota: sadece oturumda kalsın
  } catch { /* gizli mod vb. */ }
}
export function mediaGet(id) {
  if (mediaMem.has(id)) return mediaMem.get(id);
  try {
    const all = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}');
    if (all[id]) { mediaMem.set(id, all[id]); return all[id]; }
  } catch { /* yok */ }
  return null;
}

const EXEC = {
  memory_search({ query }) {
    const mems = all('memories').filter((m) => !m.archived);
    const ranked = mems.map((m) => ({ m, s: score(m.content, query) + (m.strength || 0) }))
      .filter((x) => x.s > 0.4).sort((a, b) => b.s - a.s).slice(0, 8);
    if (!ranked.length) return { found: 0, note: 'Hafızada bu konuyla ilgili kayıt yok.' };
    return {
      found: ranked.length,
      items: ranked.map((x) => ({ content: x.m.content, kind: x.m.kind, strength: x.m.strength })),
    };
  },

  remember({ content, kind }) {
    const r = evo.addMemory({ content, kind: kind || 'fact', source: 'tool', strength: 0.85 });
    return r ? { ok: true, saved: r.content, kind: r.kind } : { ok: false, note: 'kaydedilemedi' };
  },

  conversation_search({ query }) {
    const msgs = all('messages');
    const ranked = msgs.map((m) => ({ m, s: score(m.content, query) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, 6);
    if (!ranked.length) return { found: 0, note: 'Geçmiş mesajlarda bulunamadı.' };
    return {
      found: ranked.length,
      items: ranked.map((x) => ({
        role: x.m.role, content: String(x.m.content).slice(0, 220),
        date: new Date(x.m.createdAt).toLocaleDateString('tr-TR'),
      })),
    };
  },

  calculator({ expression }) {
    try { const v = safeCalc(expression); return { expression, result: v }; }
    catch (e) { return { error: e.message }; }
  },

  datetime() {
    const d = new Date();
    return {
      tarih: d.toLocaleDateString('tr-TR', { dateStyle: 'full' }),
      saat: d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      iso: d.toISOString(),
      zamanDilimi: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },

  async wikipedia({ query, lang }) {
    try { return await wiki(query, lang || 'tr'); }
    catch (e) { return { error: `Vikipedi'ye ulaşılamadı: ${e.message}` }; }
  },

  learning_status() {
    const st = learn.learningStats?.() || {};
    return {
      ...st,
      tekrarZamaniGelenKartlar: (learn.dueCards?.() || []).length,
      beceriHaritasi: all('skills').slice(0, 10).map((s) => ({ konu: s.topic, seviye: s.level, not: s.note })),
    };
  },

  create_flashcard({ question, answer, topic }) {
    const r = learn.createCard({ topic: topic || 'genel', question, answer, source: 'agent' });
    return { ok: true, id: r?.id || null, question, topic };
  },

  self_status() {
    const st = evo.stats();
    const a = activeLLM();
    const s = getSettings();
    return {
      beyinSurumu: `v${st.promptVersion}`,
      aktifModel: a.model || a.id,
      saglayici: a.def?.name || a.id,
      hafizaKaydi: st.memories,
      ogrenilenKurallar: all('memories').filter((m) => m.kind === 'rule' && !m.archived).map((m) => m.content).slice(0, 12),
      kartlar: st.cards,
      mesajSayisi: all('messages').length,
      depolama: `${(storageSize() / 1024).toFixed(1)} KB (tarayıcıda, sunucuya gitmez)`,
      aracSayisi: TOOLS.length,
      calismaSekli: 'ajan döngüsü (araç çağırabilen)',
      kullaniciAdi: s.userName || null,
    };
  },

  async web_oku({ url, odak }) {
    const u = String(url || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u)) return { hata: 'geçersiz adres (https:// ile başlamalı)' };
    try {
      const r = await fetch('https://r.jina.ai/' + u, { headers: { Accept: 'text/plain' } });
      if (r.status === 429) return { hata: 'okuyucu limiti dolu (20/dk); 1 dk sonra tekrar dene' };
      if (!r.ok) return { hata: `sayfa okunamadı (${r.status})` };
      let t = await r.text();
      t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!t) return { hata: 'sayfa boş döndü' };
      let govde = t;
      if (odak) {
        const i = t.toLocaleLowerCase('tr').indexOf(String(odak).toLocaleLowerCase('tr'));
        if (i > 800) govde = '…' + t.slice(Math.max(0, i - 400), i + 5200);
      }
      return {
        ok: true,
        url: u,
        baslik: (t.match(/^Title:\s*(.+)/m) || [])[1] || null,
        karakter: t.length,
        icerik: govde.slice(0, 6500),
        not: 'İçerik kırpılmış olabilir; kritik iddiaları ikinci bir kaynakla doğrula.',
      };
    } catch (e) { return { hata: String(e.message || e).slice(0, 120) }; }
  },

  async gorsel_uret({ istem, model }) {
    const prompt = String(istem || '').trim();
    if (!prompt) return { hata: 'istem boş' };
    try {
      const { puterTxt2Img, shrinkDataUrl } = await import('./puter.js');
      const raw = await puterTxt2Img(prompt, model ? { model } : {});
      const small = await shrinkDataUrl(raw);
      const id = 'g' + Date.now().toString(36);
      mediaKaydet(id, small);
      const isaret = `![görsel](evrimimg:${id})`;
      return {
        ok: true, id,
        boyut: Math.round(small.length / 1024) + ' KB',
        not: `Görsel üretildi. Yanıtına bu işareti AYNEN ekle (kopyala-yapıştır): ${isaret}`,
      };
    } catch (e) {
      const m = String(e.message || e);
      if (/insufficient_funds|402|sign|auth|denied|GIRIS/i.test(m)) {
        return { hata: 'Puter oturumu/kredisi gerekiyor: Ayarlar → "☁️ Puter" kutusundan ücretsiz giriş yap, sonra tekrar iste.' };
      }
      return { hata: m.slice(0, 160) };
    }
  },

  async api_katalog({ sorgu, adet }) {
    return katalogAra(sorgu, adet);
  },

  improve_self({ rule, reason }) {
    const clean = String(rule || '').trim().slice(0, 200);
    if (!clean) return { ok: false, note: 'kural boş' };
    evo.addMemory({ content: clean, kind: 'rule', source: 'self', strength: 0.9 });
    insert('evolutions', {
      type: 'tool', summary: 'Kendini geliştirdi', detail: `${clean}${reason ? ' — ' + reason : ''}`,
      applied: true, confidence: 0.9, createdAt: now(),
    });
    return { ok: true, eklenenKural: clean, note: 'Bu kural bundan sonraki tüm yanıtlarda geçerli.' };
  },
};

/* ------------------------------------------------------------------ */
/* AJAN DÖNGÜSÜ                                                        */
/* ------------------------------------------------------------------ */
/**
 * @returns {Promise<{content:string, steps:Array, model:string}>}
 * opts.onTool(name, phase, detail) -> UI'da "🔧 hafızada arıyor…" göstermek için
 */
export async function agentChat(messages, opts = {}) {
  const a = activeLLM();
  if (a.id === 'house') {
    const { houseChat } = await import('./house.js');
    const out = await houseChat(messages, opts.onChunk);
    return { content: out.content, model: out.model || 'ev bulutu', steps: [] };
  }
  const supportsTools = a.def?.format === 'openai' && !opts.json;

  // Araç desteklemeyen beyin (yerel model / Nano / Puter) -> düz sohbet
  if (!supportsTools) {
    const { chat } = await import('./llm.js');
    const content = await chat(messages, opts);
    return { content, steps: [], model: a.model };
  }

  const msgs = [...messages];
  const steps = [];
  let lastContent = '';
  let lastModel = a.model;

  for (let step = 0; step < MAX_STEPS; step++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await rawChat(msgs, {
      ...opts,
      tools: TOOLS,
      // Araç turunda akış açıksa ve içerik gelirse göster (genelde boş gelir)
      onChunk: opts.onChunk,
    });
    lastModel = r.model || lastModel;

    if (!r.toolCalls?.length) {
      lastContent = r.content || lastContent;
      break;
    }

    // Model araç istedi -> çalıştır, sonuçları geri besle
    msgs.push({
      role: 'assistant',
      content: r.content || '',
      tool_calls: r.toolCalls.map((t, i) => ({
        id: t.id || `call_${step}_${i}`,
        type: 'function',
        function: { name: t.name, arguments: t.arguments || '{}' },
      })),
    });

    for (const tc of r.toolCalls) {
      const id = tc.id || `call_${step}_${steps.length}`;
      let args = {};
      try { args = JSON.parse(tc.arguments || '{}'); } catch { args = {}; }
      opts.onTool?.(tc.name, 'running', args);
      let result;
      const t0 = performance.now();
      try {
        const fn = EXEC[tc.name];
        if (!fn) result = { error: `bilinmeyen araç: ${tc.name}` };
        else result = await fn(args);
      } catch (e) {
        result = { error: e.message };
      }
      const ms = Math.round(performance.now() - t0);
      steps.push({ tool: tc.name, args, result, ms });
      opts.onTool?.(tc.name, 'done', result, ms, args);
      msgs.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result).slice(0, 6000) });
    }
    // Son turda hâlâ araç istiyorsa cevabı zorla
    if (step === MAX_STEPS - 1) {
      msgs.push({
        role: 'user',
        content: '(sistem) Araç bütçen bitti. Elindeki bilgilerle şimdi Türkçe ve kısa cevap ver, başka araç çağırma.',
      });
      // eslint-disable-next-line no-await-in-loop
      const fin = await rawChat(msgs, { ...opts, tools: undefined, onChunk: opts.onChunk });
      lastContent = fin.content || lastContent;
      lastModel = fin.model || lastModel;
    }
  }

  // Boş cevap koruması: model turu bitirip içerik üretmediyse araçsız son bir istek
  if (!String(lastContent || '').trim()) {
    try {
      const fin = await rawChat(msgs, { ...opts, tools: undefined, onChunk: opts.onChunk });
      lastContent = fin.content || '';
      lastModel = fin.model || lastModel;
    } catch (e) { console.warn('[agent] boş cevap kurtarma başarısız:', e.message); }
  }
  if (!String(lastContent || '').trim()) {
    throw new Error('Model boş cevap döndürdü. Bir kez daha dene — sorun sürerse Ayarlar → Tanıla.');
  }
  return { content: lastContent, steps, model: lastModel };
}

/** Araç adını Türkçe eylem metnine çevir (UI için) */
export function toolLabel(name, args = {}, done = false, bad = false) {
  const q = args.query || '';
  const map = {
    memory_search: q ? `🧠 Hafızada arad${done ? 'ı' : 'ıyor'}: "${q}"` : `🧠 Hafızaya bakt${done ? 'ı' : 'ıyor'}`,
    remember: done ? '📝 Hafızaya kaydetti' : '📝 Hafızaya kaydediyor',
    conversation_search: q ? `💬 Geçmişte arad${done ? 'ı' : 'ıyor'}: "${q}"` : `💬 Geçmiş sohbeti ar${done ? 'adı' : 'ıyor'}`,
    calculator: args.expression ? `🧮 ${done ? 'Hesapladı' : 'Hesaplıyor'}: ${args.expression}` : `🧮 ${done ? 'Hesapladı' : 'Hesaplıyor'}`,
    datetime: done ? '📅 Tarih/saat alındı' : '📅 Tarih/saat alıyor',
    wikipedia: q ? `🌐 Vikipedi${done ? ' okundu' : ''}: "${q}"` : `🌐 Vikipedi'ye bak${done ? 'tı' : 'ıyor'}`,
    learning_status: done ? '🎓 Öğrenme durumu okundu' : '🎓 Öğrenme durumuna bakıyor',
    create_flashcard: done ? '🃏 Tekrar kartı oluşturuldu' : '🃏 Tekrar kartı oluşturuyor',
    self_status: done ? '🔍 Kendi durumu incelendi' : '🔍 Kendi durumunu inceliyor',
    improve_self: `⚙️ ${done ? 'Kendini geliştirdi' : 'Kendini geliştiriyor'}${args.rule ? `: "${String(args.rule).slice(0, 50)}"` : ''}`,
    gorsel_uret: `🎨 ${done ? (bad ? 'Görsel üretilemedi' : 'Görsel üretti') : 'Görsel üretiyor'}${args.istem ? `: "${String(args.istem).slice(0, 40)}"` : ''}`,
    web_oku: args.url
      ? `🌍 ${done ? 'Sayfa okudu' : 'Sayfa okuyor'}: ${String(args.url).replace(/^https?:\/\//, '').slice(0, 42)}`
      : `🌍 ${done ? 'Sayfa okudu' : 'Sayfa okuyor'}`,
    api_katalog: (args.sorgu || args.query)
      ? `📚 API kataloğunda ${done ? 'aradı' : 'arıyor'}: "${String(args.sorgu || args.query).slice(0, 40)}"`
      : `📚 API kataloğuna ${done ? 'baktı' : 'bakıyor'}`,
  };
  return map[name] || `🔧 ${name}`;
}
