/* js/housekey.js — EV ANAHTARI (v27): Arena-ajan modeli, platform yönetimli anahtar.
   Sahip bir kez ücretsiz Groq anahtarı sağlar; ben gömerim. TÜM kullanıcılar
   her cihazda sıfır kurulum/giriş/indirme ile anında gerçek cevap alır.
   Anahtar halka açıktır (repo public): risk kabul edildi — ücretsiz kota paylaşımı. */
export const HOUSE_KEY = (typeof globalThis !== 'undefined' && globalThis.__EVHOUSEKEY) || '';
export const HOUSE_PROVIDER = 'groq';
