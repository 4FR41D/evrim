/* js/house.js — EV BULUTU: sunucusuz, hesapsız, anahtarsız WebRTC beyni (PeerJS)
   Arena-ajan modeli: ortamını kendin kur. Sahibin cihazı EVRIM'i açınca "ev bulutu"
   olur; EVRIM'i başka herhangi bir cihazda açan kişi BU beyne sıfır girişle bağlanır
   ve yazdığı an cevap alır. Broker: PeerJS genel bulutu (ücretsiz, anahtarsız). */
import { getSettings } from './store.js';

export const HOUSE_ID = 'evrim-brain-4fr41d';
const PEER_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';

const state = { hosting: false, ready: false, error: null, peer: null, gpeer: null, conn: null, clients: 0 };

export function houseStatus() {
  return { hosting: state.hosting, ready: state.ready, error: state.error, clients: state.clients };
}

async function loadPeer() {
  if (globalThis.Peer) return globalThis.Peer;
  await new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = PEER_CDN; sc.async = true;
    sc.onload = () => (globalThis.Peer ? res(globalThis.Peer) : rej(new Error('PeerJS yok')));
    sc.onerror = () => rej(new Error('PeerJS CDN indirilemedi'));
    document.head.appendChild(sc);
  });
  return globalThis.Peer;
}

/* ---------------- SAHİP TARAFI: ev bulutunu aç ---------------- */
export async function startHouseHost(handlers) {
  if (state.hosting) return true;
  const Peer = await loadPeer();
  const peer = new Peer(HOUSE_ID, { debug: 0 });
  state.peer = peer;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('broker zaman aşımı')), 9000);
    peer.on('open', () => { clearTimeout(t); res(); });
    peer.on('error', (e) => {
      clearTimeout(t);
      if (String(e?.type) === 'unavailable-id') rej(new Error('ev bulutu zaten başka bir sekmede açık'));
      else rej(e);
    });
  });
  state.hosting = true; state.error = null;
  peer.on('connection', (conn) => {
    state.clients++;
    conn.on('close', () => { state.clients = Math.max(0, state.clients - 1); });
    conn.on('data', async (d) => {
      try {
        if (d?.t === 'ping') { conn.send({ t: 'pong', name: 'EVRIM ev bulutu' }); return; }
        if (d?.t === 'chat') {
          const out = await handlers.chat(d.messages || [], (chunk) => { try { conn.send({ t: 'chunk', d: chunk }); } catch {} });
          conn.send({ t: 'done', content: out.content, model: out.model || 'ev bulutu' });
        }
      } catch (e) {
        try { conn.send({ t: 'err', message: String(e.message || e).slice(0, 140) }); } catch {}
      }
    });
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  return true;
}

export function stopHouseHost() {
  try { state.peer?.destroy(); } catch {}
  state.peer = null; state.hosting = false; state.clients = 0;
}

/* ---------------- MİSAFİR TARAFI: ev bulutuna bağlan ---------------- */
export async function probeHouse(timeoutMs = 3000) {
  if (state.ready && state.conn?.open) return true;
  if (getSettings().houseHost) return false; // kendi kendine misafir olma
  try {
    const Peer = await loadPeer();
    if (!state.gpeer || state.gpeer.destroyed) state.gpeer = new Peer({ debug: 0 });
    const gp = state.gpeer;
    if (!gp.open) {
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('broker zaman aşımı')), timeoutMs);
        gp.once('open', () => { clearTimeout(t); res(); });
        gp.once('error', (e) => { clearTimeout(t); rej(e); });
      });
    }
    const conn = gp.connect(HOUSE_ID, { reliable: true });
    state.conn = conn;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('ev bulutu yanıt vermedi (kapalı olabilir)')), timeoutMs);
      conn.once('open', () => { try { conn.send({ t: 'ping' }); } catch {} });
      const h = (d) => { if (d?.t === 'pong') { clearTimeout(t); conn.off('data', h); res(); } };
      conn.on('data', h);
      conn.once('error', (e) => { clearTimeout(t); rej(e); });
      conn.once('close', () => { clearTimeout(t); rej(new Error('bağlantı kapandı')); });
    });
    state.ready = true; state.error = null;
    return true;
  } catch (e) {
    state.ready = false; state.error = String(e.message || e);
    try { state.conn?.close(); } catch {}
    state.conn = null;
    return false;
  }
}

export function houseChat(messages, onChunk) {
  return new Promise((res, rej) => {
    const conn = state.conn;
    if (!conn?.open) { rej(new Error('ev bulutu bağlantısı yok')); return; }
    let acc = '';
    const t = setTimeout(() => { cleanup(); rej(new Error('ev bulutu zaman aşımı')); }, 90000);
    function on(d) {
      if (d?.t === 'chunk') { acc += d.d; onChunk?.(d.d); }
      else if (d?.t === 'done') { cleanup(); res({ content: d.content || acc, model: d.model || 'ev bulutu' }); }
      else if (d?.t === 'err') { cleanup(); rej(new Error(d.message || 'ev bulutu hatası')); }
    }
    function cleanup() { clearTimeout(t); conn.off('data', on); }
    conn.on('data', on);
    try { conn.send({ t: 'chat', messages }); } catch (e) { cleanup(); rej(e); }
  });
}

export function houseDrop() {
  try { state.conn?.close(); } catch {}
  state.conn = null; state.ready = false;
}
