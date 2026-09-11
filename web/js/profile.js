/* js/profile.js — GİRİŞ / PROFİLLER
   Sunucu yok, o yüzden bu "giriş" cihaz içidir: aynı telefonda birden çok kişi
   kendi profilini kullanır, sohbet geçmişi profile göre ayrılır.
   ⚠️ PIN gerçek güvenlik DEĞİLDİR (veri zaten tarayıcıda); sadece ayırmaya yarar. */
import { all, insert, update, remove, getSettings, setSettings, now } from './store.js';

const ACTIVE_KEY = 'evrim:activeProfile';

/* Basit karma — güvenlik için değil, kazara girişleri önlemek için */
function hash(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
}

const COLORS = ['#7c5cff', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#60a5fa', '#f472b6'];

export function profiles() {
  return all('profiles').sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

export function activeProfileId() {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}

export function activeProfile() {
  const id = activeProfileId();
  return id ? profiles().find((p) => p.id === id) || null : null;
}

export function isLoggedIn() { return !!activeProfile(); }

export function createProfile({ name, pin = '' }) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new Error('İsim gerekli');
  if (profiles().some((p) => p.name.toLocaleLowerCase('tr') === clean.toLocaleLowerCase('tr'))) {
    throw new Error('Bu isimde bir profil zaten var');
  }
  const list = profiles();
  const p = insert('profiles', {
    name: clean,
    pinHash: pin ? hash(pin) : null,
    color: COLORS[list.length % COLORS.length],
    createdAt: now(),
    lastSeenAt: now(),
    puterUser: null,
  });
  login(p.id, pin);
  return p;
}

/** Giriş: PIN varsa doğrular */
export function login(id, pin = '') {
  const p = profiles().find((x) => x.id === id);
  if (!p) throw new Error('Profil bulunamadı');
  if (p.pinHash && hash(pin) !== p.pinHash) throw new Error('PIN hatalı');
  try { localStorage.setItem(ACTIVE_KEY, p.id); } catch {}
  update('profiles', p.id, { lastSeenAt: now() });
  // Profil adını asistanın hafızasına da işle (kişiselleştirme)
  if (getSettings().userName !== p.name) setSettings({ userName: p.name });
  return p;
}

export function logout() {
  try { localStorage.removeItem(ACTIVE_KEY); } catch {}
}

export function setPin(id, pin) {
  return update('profiles', id, { pinHash: pin ? hash(pin) : null });
}

export function renameProfile(id, name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return null;
  return update('profiles', id, { name: clean });
}

export function deleteProfile(id) {
  // Profile ait sohbetleri de sil
  all('conversations').filter((c) => c.profileId === id).forEach((c) => {
    all('messages').filter((m) => m.conversationId === c.id).forEach((m) => remove('messages', m.id));
    remove('conversations', c.id);
  });
  remove('profiles', id);
  if (activeProfileId() === id) logout();
}

/** Puter ile gerçek (bulut) kimlik — isteğe bağlı */
export async function linkPuter(id, username) {
  return update('profiles', id, { puterUser: username || null });
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toLocaleUpperCase('tr');

export { hash };
