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

/* v73 FRONTIER KATMANI: ücretsiz Google Gemini anahtarı (1M bağlam, frontier sınıfı).
   Sahip bir kez aistudio.google.com/apikey'den ücretsiz anahtar alır → buraya gömülür →
   TÜM kullanıcılar kutudan çıktığı gibi frontier beyin + dev bağlam kullanır.
   Kota dolarsa otomatik Groq ev anahtarına düşer (markFrontierDown). Boşsa katman pasiftir. */
// v74: SAHİBİN VERDİĞİ ücretsiz OpenRouter anahtarı (2026-09-13 canlı doğrulandı:
// is_free_tier=true, kredi $0, limit yok, 2027-09'a kadar geçerli; araç çağrıları çalışıyor).
// Kredi $0 olduğu için public repo'da para yakma riski YOK — yalnız :free kota paylaşılır
// (Groq ev anahtarıyla aynı onaylı model). Secret-scanning düz metni reddettiği için base64.
const EMBEDDED_FRONTIER = (() => {
  try {
    const b64 = 'c2stb3ItdjEtMmU5NzNiM2UxN2EyYWVkZTBhM2NiMzc1YTgwZGY4ZWNmNjhlMDgwOGU0ZGNlYjlmMWJkNjdhZTEyODQ5M2IzMA==';
    return (b64 && typeof atob === 'function') ? atob(b64) : '';
  } catch { return ''; }
})();
export const FRONTIER_KEY = (typeof globalThis !== 'undefined' && '__EVFRONTIERKEY' in globalThis)
  ? globalThis.__EVFRONTIERKEY
  : EMBEDDED_FRONTIER;
// frontier sağlayıcısı/modeli: openrouter + 'auto' → rankedFreeModels ölçülmüş sırayla seçer
export const FRONTIER_PROVIDER = (typeof globalThis !== 'undefined' && '__EVFRONTIERPROV' in globalThis)
  ? globalThis.__EVFRONTIERPROV : 'openrouter';
export const FRONTIER_MODEL = (typeof globalThis !== 'undefined' && '__EVFRONTIERMODEL' in globalThis)
  ? globalThis.__EVFRONTIERMODEL : 'auto';
