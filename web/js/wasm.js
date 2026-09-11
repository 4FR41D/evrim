/* js/wasm.js — CİHAZ İÇİ KÜÇÜK BEYİN: transformers.js (WASM/CPU)
   WebGPU gerektirmez, giriş/anahtar/sunucu gerektirmez. Bir kez iner (~90 MB),
   sonra bu cihazda ÇEVRİMDIŞI ve sınırsız cevap verir. Puter'a gerek kalmaz. */
const MODEL_ID = 'Xenova/SmolLM2-135M-Instruct';
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

const state = {
  supported: typeof WebAssembly === 'object',
  loading: false, progress: 0, ready: false, gen: null, error: null, modelId: MODEL_ID,
};

export function wasmStatus() {
  return { supported: state.supported, loading: !!state.loading, progress: state.progress, ready: state.ready, error: state.error, modelId: state.modelId };
}

async function loadLib() {
  if (globalThis.__EVWASM) return globalThis.__EVWASM; // test kancası
  return import(/* webpackIgnore: true */ CDN);
}

export async function loadWasm(onProgress) {
  if (state.ready && state.gen) return true;
  if (!state.supported) throw new Error('Bu tarayıcı WebAssembly desteklemiyor');
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const T = await loadLib();
    state.progress = 4; onProgress?.(4);
    const gen = await T.pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
      device: 'wasm',
      progress_callback: (p) => {
        if (p && p.status === 'progress' && typeof p.progress === 'number') {
          state.progress = Math.round(p.progress); onProgress?.(state.progress);
        } else if (p && p.status === 'done') {
          state.progress = Math.min(100, state.progress + 12); onProgress?.(state.progress);
        }
      },
    });
    state.gen = gen; state.ready = true; state.error = null; state.progress = 100;
    return true;
  })().catch((e) => {
    state.loading = false; state.error = String(e.message || e); throw e;
  });
  return state.loading;
}

function toPrompt(messages) {
  // SmolLM2-Instruct sohbet şablonu
  let p = '';
  for (const m of messages) {
    const role = m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user';
    p += `<|im_start|>${role}\n${m.content}\n<|im_end|>\n`;
  }
  return p + '<|im_start|>assistant\n';
}

export async function wasmChat(messages, onChunk) {
  if (!state.ready || !state.gen) await loadWasm();
  let acc = '';
  const streamer = {
    callback_function: (t) => { if (t) { acc += t; onChunk?.(t); } },
    end: () => {},
  };
  const out = await state.gen(toPrompt(messages), {
    max_new_tokens: 220, temperature: 0.7, top_p: 0.9, do_sample: true,
    return_full_text: false, streamer,
  });
  const txt = acc || (Array.isArray(out) ? out[0]?.generated_text : out?.generated_text) || '';
  return { content: String(txt).trim(), model: MODEL_ID };
}

export function unloadWasm() {
  try { state.gen?.dispose?.(); } catch {}
  state.gen = null; state.ready = false; state.progress = 0;
}
