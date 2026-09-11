# Evrim — kendini geliştiren AI (statik web, GitHub Pages)

**Kayıt yok, API anahtarı yok, ücret yok.** https://4fr41d.github.io/evrim/

## Nasıl çalışıyor? (4 katman, otomatik düşüş)

| # | Kaynak | Anahtar | İndirme | Kalite | Durum |
|---|--------|---------|---------|--------|-------|
| 1 | **Kendi ücretsiz anahtarın** (Groq/OpenRouter/Gemini) | var | yok | ⭐⭐⭐⭐⭐ 70B-120B | her zaman çalışır |
| 2 | **Ücretsiz halka açık servisler** | yok | yok | ⭐⭐⭐ | değişken, garanti yok |
| 3 | **Cihazında açık kaynak model** (WebLLM) | yok | ~200 MB bir kez | ⭐⭐ | her zaman çalışır, çevrimdışı |
| 4 | Çevrimdışı rehber | – | – | – | son çare |

Uygulama sırayla dener; üstteki çalışıyorsa alttakine hiç dokunmaz.
Ayarlar'da her katmanın durumunu görüp tek tek test edebilirsin.

## Cihazında çalışan modeller (boyutlar ölçüldü)

| Katman | Model | İndirme |
|---|---|---|
| **tiny (varsayılan)** | SmolLM2-360M-q4f16_1-MLC | ~197 MB |
| phone | Qwen2.5-0.5B-q4f16_1-MLC | ~276 MB |
| laptop | Qwen3.5-0.8B-q4f16_1-MLC | ~426 MB |
| desktop | Qwen2.5-1.5B-q4f16_1-MLC | ~839 MB |
| max | Qwen3.5-2B-q4f16_1-MLC | ~1032 MB |

İlk indirimden sonra önbelleğe alınır (IndexedDB) → sonraki açılışlarda **çevrimdışı** çalışır.
Gereksinim: WebGPU (Chrome/Edge 113+, Android Chrome 121+, Safari 26+, Firefox 141+).

## Dürüst not
- Küçük yerel modeller Türkçe'de bulut 70B kadar iyi değildir. En iyi ücretsiz kalite = **Groq anahtarı** (3 dk, kredi kartı yok).
- "Anahtarsız + indirmesiz + garantili" diye bir seçenek 2026'da internette yok. Ücretsiz halka açık servisler çalıştığında harika, çalışmadığında uygulama otomatik olarak cihazındaki modele geçer.

## Klasör
- `js/llm.js` — 4 katmanlı yönlendirici
- `js/free.js` — anahtarsız halka açık servisler + sağlık kontrolü
- `js/local.js` — WebLLM ile cihazda çalışan model (3 CDN yedeği)
- `js/evolve.js`, `js/learn.js`, `js/github.js`, `js/app.js`, `js/store.js` — özellikler
- `sw.js` — PWA önbelleği (`evrim-web-v3`)

## Yayınlama
`web/` → `docs/` kopyalanır, `main` dalına push edilir, GitHub Pages kaynağı `main /docs`.
