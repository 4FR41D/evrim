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
      opts.onTool?.(tc.name, 'done', result, ms);
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

  return { content: lastContent, steps, model: lastModel };
}

/** Araç adını Türkçe eylem metnine çevir (UI için) */
export function toolLabel(name, args = {}) {
  const map = {
    memory_search: `🧠 Hafızada arıyor: "${args.query || ''}"`,
    remember: '📝 Hafızaya kaydediyor',
    conversation_search: `💬 Geçmiş sohbeti arıyor: "${args.query || ''}"`,
    calculator: `🧮 Hesaplıyor: ${args.expression || ''}`,
    datetime: '📅 Tarih/saat alıyor',
    wikipedia: `🌐 Vikipedi: "${args.query || ''}"`,
    learning_status: '🎓 Öğrenme durumuna bakıyor',
    create_flashcard: '🃏 Tekrar kartı oluşturuyor',
    self_status: '🔍 Kendi durumunu inceliyor',
    improve_self: `⚙️ Kendini geliştiriyor: "${(args.rule || '').slice(0, 50)}"`,
  };
  return map[name] || `🔧 ${name}`;
}
