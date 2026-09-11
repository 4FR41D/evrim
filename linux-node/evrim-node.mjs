#!/usr/bin/env node
/* EVRIM Linux düğümü (evrim-node) — SAHİBİN makinesinde tam yetkili yürütücü.
 *
 * Mimari:  EVRIM (tarayıcı) --> private GitHub repo "bus" (cmd.json/out.json) --> bu betik
 * - Makine internete AÇILMAZ: yalnız outbound HTTPS (api.github.com). Port/NAT/güvenlik duvarı ayarı yok.
 * - Yetki: betiği hangi kullanıcıyla başlatırsan o yetkiyle çalışır (root başlatırsan root).
 * - Bus private olduğu için komut/çıktıyı yalnız senin token'ın okuyabilir.
 *
 * Kurulum: linux-node/README.md
 * Gereksinim: Node.js 18+ (fetch yerleşik). Bağımlılık YOK.
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';

const REPO = process.env.EVRIM_BUS || '4FR41D/evrim-node-bus';
const POLL_MS = Number(process.env.EVRIM_POLL || 3000);
const KILL_MS = Number(process.env.EVRIM_TIMEOUT || 110000);
const TOK = process.env.EVRIM_TOKEN ||
  (existsSync(homedir() + '/.evrim-node-token') ? readFileSync(homedir() + '/.evrim-node-token', 'utf8').trim() : '');
if (!TOK) {
  console.error('❌ Token yok. Yap: echo "gsk_DEGIL_ghp_TOKENINI" > ~/.evrim-node-token && chmod 600 ~/.evrim-node-token');
  process.exit(1);
}
const H = { Authorization: 'Bearer ' + TOK, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
const API = `https://api.github.com/repos/${REPO}/contents/`;

let lastId = null;
let etag = null;

async function getFile(path, useEtag) {
  const headers = { ...H };
  if (useEtag && etag) headers['If-None-Match'] = etag;
  const r = await fetch(API + path, { headers });
  if (r.status === 304) return { notModified: true };
  if (r.status === 404) return { sha: null, data: null };
  if (!r.ok) throw new Error(`bus okunamadı: ${r.status}`);
  if (useEtag) etag = r.headers.get('etag') || null;
  const j = await r.json();
  const data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  return { sha: j.sha, data };
}

async function putFile(path, obj) {
  const cur = await getFile(path, false);
  const body = {
    message: `evrim-node out ${obj.id || ''}`.trim(),
    content: Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'),
    branch: 'main',
  };
  if (cur.sha) body.sha = cur.sha;
  const r = await fetch(API + path, { method: 'PUT', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`bus yazılamadı: ${r.status}`);
}

function run(komut, cwd) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn('bash', ['-c', komut], {
      cwd: cwd || process.env.EVRIM_CWD || homedir(),
      env: { ...process.env },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (d) => { so += d; if (so.length > 12000) so = so.slice(0, 12000); });
    p.stderr.on('data', (d) => { se += d; if (se.length > 4000) se = se.slice(0, 4000); });
    const killer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, KILL_MS);
    p.on('close', (code) => {
      clearTimeout(killer);
      res({ exit: code ?? -1, stdout: so.slice(0, 8000), stderr: se.slice(0, 3000), ms: Date.now() - t0 });
    });
    p.on('error', (e) => {
      clearTimeout(killer);
      res({ exit: -1, stdout: '', stderr: String(e.message || e), ms: Date.now() - t0 });
    });
  });
}

console.log(`🐧 EVRIM düğümü başladı: ${hostname()} | bus: ${REPO} | yoklama: ${POLL_MS}ms | kullanıcı: ${process.env.USER || 'root'}`);
console.log('   Durdurmak için Ctrl+C. Kalıcı servis için README\'deki systemd birimine bak.');

for (;;) {
  try {
    const g = await getFile('cmd.json', true);
    const cmd = g.notModified ? null : g.data;
    if (cmd && cmd.id && cmd.id !== lastId) {
      lastId = cmd.id;
      const komut = String(cmd.komut || '').slice(0, 4000);
      console.log(`▶ [${cmd.id}] ${komut.slice(0, 120)}`);
      const r = await run(komut, cmd.cwd || undefined);
      await putFile('out.json', {
        id: cmd.id, host: hostname(), user: process.env.USER || 'root', ts: Date.now(), ...r,
      });
      console.log(`■ [${cmd.id}] exit=${r.exit} ${r.ms}ms${r.stderr ? ' (stderr var)' : ''}`);
    }
  } catch (e) {
    if (String(e.message).includes('401')) { console.error('❌ Token geçersiz (401) — ~/.evrim-node-token dosyasını kontrol et'); process.exit(1); }
    console.error('⚠️ tur hatası:', String(e.message || e).slice(0, 140));
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
