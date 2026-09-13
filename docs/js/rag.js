/* js/rag.js — v65: DERİN HAFIZA (RAG) — açık kaynak çok dilli gömme modeliyle VEKTÖREL arama.
   transformers.js (WASM), model bir kez iner (~45 MB), sonra tamamen ÇEVRİMDIŞI çalışır.
   Anahtar yok, sunucu yok: gömme işlemi cihazında yapılır.
   Test kancası: globalThis.__EVEMBED = async (texts) => [[...], ...]  (gerçek modeli atlar) */
import { all, getSettings } from './store.js';

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';
const VKEY = 'evrim:ragvecs';

let pipe = null;
let loading = null;
let progress = 0;

function loadVecs() { try { return JSON.parse(localStorage.getItem(VKEY) || '{}'); } catch { return {}; } }
function saveVecs(v) { try { localStorage.setItem(VKEY, JSON.stringify(v)); } catch {} }
function hash(s) { let h = 0; const t = String(s); for (let i = 0; i < t.length; i++) { h = (h * 31 + t.charCodeAt(i)) | 0; } return h; }
function dot(a, b) { let s2 = 0; const n = Math.min(a?.length || 0, b?.length || 0); for (let i = 0; i < n; i++) s2 += a[i] * b[i]; return s2; }

export function ragStatus() {
  return { enabled: !!getSettings().rag, ready: !!pipe, loading: !!loading, progress, model: MODEL_ID, indexed: Object.keys(loadVecs()).length };
}

export async function ragLoad(onProgress) {
  if (pipe) return true;
  if (globalThis.__EVRAGPIPE) { pipe = globalThis.__EVRAGPIPE; return true; }
  if (!loading) {
    loading = (async () => {
      const T = await import(/* webpackIgnore: true */ CDN);
      pipe = await T.pipeline('feature-extraction', MODEL_ID, {
        dtype: 'q8',
        progress_callback: (p) => { if (p && typeof p.progress === 'number') { progress = Math.round(p.progress); onProgress?.(progress); } },
      });
      progress = 100;
      return true;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

async function embed(texts) {
  if (globalThis.__EVEMBED) return globalThis.__EVEMBED(texts);
  await ragLoad();
  const out = await pipe(texts, { pooling: 'mean', normalize: true });
  return out.tolist();
}

/** Tüm hafıza kayıtlarını vektörle (artımlı: değişmemişler atlanır). Kaç kayıt işlendiğini döner. */
export async function ragIndex(onProgress) {
  const vecs = loadVecs();
  const rows = all('memories').filter((m) => !m.archived && String(m.content || '').length > 3);
  const need = rows.filter((m) => !vecs[m.id] || vecs[m.id].h !== hash(m.content));
  let n = 0;
  for (let i = 0; i < need.length; i += 8) {
    const batch = need.slice(i, i + 8);
    // eslint-disable-next-line no-await-in-loop
    const embs = await embed(batch.map((m) => String(m.content)));
    batch.forEach((m, j) => { vecs[m.id] = { v: embs[j], h: hash(m.content) }; n++; });
    saveVecs(vecs);
    onProgress?.(Math.round(((i + batch.length) / need.length) * 100));
  }
  return n;
}

/** Sorguyla ANLAMCA ilgili kayıtları getir → sistem promptuna bağlam metni ('' = kapalı/boş/eşleşme yok) */
export async function ragQuery(text, k = 4) {
  if (!getSettings().rag) return '';
  const t = String(text || '').trim();
  if (t.length < 4) return '';
  const vecs = loadVecs();
  const rows = all('memories').filter((m) => !m.archived && vecs[m.id]?.v);
  if (!rows.length) return '';
  let qv;
  try { qv = (await embed([t]))[0]; } catch { return ''; }
  if (!Array.isArray(qv)) return '';
  const scored = rows
    .map((m) => ({ m, s: dot(qv, vecs[m.id].v) }))
    .filter((x) => x.s >= 0.35)
    .sort((a, b) => b.s - a.s)
    .slice(0, k);
  if (!scored.length) return '';
  return scored.map((x) => `- ${String(x.m.content).slice(0, 160)} (ilgi %${Math.round(x.s * 100)})`).join('\n');
}
