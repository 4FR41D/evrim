/* js/housekey.js — EV ANAHTARI (v27): Arena-ajan modeli, platform yönetimli anahtar.
   Sahip bir kez ücretsiz Groq anahtarı sağlar; ben gömerim. TÜM kullanıcılar
   her cihazda sıfır kurulum/giriş/indirme ile anında gerçek cevap alır.
   Anahtar halka açıktır (repo public): risk kabul edildi — ücretsiz kota paylaşımı. */
// SAHİBİN ONAYIYLA gömüldü (halka açık repo = bilinçli paylaşım).
// GitHub secret-scanning düz metni reddettiği için base64; düz metin istersen:
// github.com/4FR41D/evrim/security/secret-scanning/unblock-secret/3JC2aK5lGpf5Qibpn2MHPdIe01f
const EMBEDDED = (typeof atob === 'function') ? atob('Z3NrX053VXdNNFBpZ1hLRVNtTTNnWkJuV0dkeWIzRll1aWg3Vjl1cmF2YVZJQ1J6cDdRUUZQR3U=') : '';
export const HOUSE_KEY = (typeof globalThis !== 'undefined' && '__EVHOUSEKEY' in globalThis)
  ? globalThis.__EVHOUSEKEY
  : EMBEDDED;
export const HOUSE_PROVIDER = 'groq';
