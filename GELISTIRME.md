# 🛠 EVRIM'i Kendin Geliştirme Rehberi (telefonsuz bilgisayar, tamamen ücretsiz)

Bu rehber: EVRIM'i bana (asistana) bağımlı kalmadan kendin düzenlemen, yeni özellik
eklemen ve bozarsan geri alman için. 3 seviye var — seviye 0'da hiç kod yok.

---

## Seviye 0 — Kodsuz: uygulama içinden kendini geliştirir

Bunlar zaten çalışıyor, sadece yaz:

| Ne istersin | Ne yazarsın | Ne olur |
|---|---|---|
| Kalıcı davranış kuralı | "Bundan sonra kısa cevap ver", "tablo kullan" | `improve_self` → beyin promptuna kalıcı kural eklenir (Evrim sekmesinden geri alınabilir) |
| Seni hatırlasın | "Hatırla: kahve sevmem" | Hafızaya kaydedilir, her sohbette kullanılır |
| Kendi botun | Kenar çubuğu → "Bot oluştur" | Yeni kişilik + sistem promptu (kod gerekmez) |
| Yeni ders/kart | Öğrenme Koçu → konu gir | AI soru üretir, spaced repetition başlar |
| Sistem sağlıklı mı | "Kendini test et" | `oz_test` → 36 araç + DOM + depolama + arşiv kontrolü, ✅/❌ tablosu |
| Verini koru | Ayarlar → 🧾 tek dosya yedek | Tüm verin tek .html'de |

**Sınır:** Seviye 0 davranış/kural/veri değiştirir; yeni ARAÇ veya ekran ekleyemez.
Onun için Seviye 1.

---

## Seviye 1 — Kod düzenleme: 3 yöntem (hepsi telefondan)

### Yöntem A: GitHub web editörü (en kolay, kurulum yok)
1. Tarayıcıdan: `github.com/4FR41D/evrim` → giriş yap.
2. Dosyayı aç (örn. `web/js/agent.js`) → **kalem simgesi** (✏️) → düzenle.
3. Sağ üstten **Commit changes** → mesaj yaz → commit.
4. GitHub Pages ~1 dakikada otomatik yayınlar.
5. **SÜRÜM ADIMINI ATLAMA** (aşağıda) — yoksa telefonun eski önbelleği açar.

### Yöntem B: github.dev (tarayıcıda VS Code)
- Repo sayfasındayken adres çubuğuna **`.`** (nokta) ekle veya `github.dev/4FR41D/evrim`.
- Çok dosyalı değişiklik + tek commit. Telefonda ekran küçük ama çalışır.

### Yöntem C: Termux (tam geliştirme ortamı — test dahil, önerilen)
Termux'ta (F-Droid'den ücretsiz):
```bash
pkg install git nodejs
git clone https://github.com/4FR41D/evrim
cd evrim
npm install jsdom            # test için (bir kez)

nano web/js/agent.js         # düzenle (Ctrl+O kaydet, Ctrl+X çık)

node --check web/js/agent.js # 1. sözdizimi kontrolü
npx esbuild web/js/app.js --bundle --format=iife --outfile=tests/bundle.js
node tests/suite.mjs         # 2. TAM TEST: 232 kontrol → "232 ✅ / 0 ❌" görmelisin

git add -A
git commit -m "benim değişikliğim"
git push                     # kullanıcı: 4FR41D, şifre: TOKEN (normal şifren DEĞİL)
```
Token: EVRIM → Ayarlar → GitHub bölümünde kayıtlı; veya GitHub → Settings →
Developer settings → Personal access tokens (repo yetkili).

---

## ⚠️ Altın kurallar (bozmamak için)

1. **Sürüm arttır:** `web/js/*`, `web/index.html`, `web/style.css` dosyalarına
   dokunduysan İKİ yeri +1 yap:
   - `web/sw.js` → `evrim-web-v57` yerine `v58`
   - `web/index.html` → `sw.js?v=57` yerine `?v=58`
   Yoksa telefon eski sürümü gösterir ("değişiklik çalışmadı" sanırsın).
2. **Test etmeden push'lama** (Termux'ta suite 3 dk sürer, değeri büyük).
3. **`data/settings.json`'ı asla paylaşma/yükleme** — token'ın içinde.
4. **Bozarsan geri al:** GitHub'da dosya → History → eski sürümü aç → ✏️ ile
   içeriğini geri yapıştır → commit. Her şey git geçmişinde durur, kaybolmaz.
5. `docs/` klasörü yayın kopyasıdır: `web/` değiştikten sonra
   `rm -rf docs && mkdir docs && cp -r web/. docs/` (Termux'ta).

---

## 🗺 Hangi dosya ne işe yarar?

| Dosya | Ne var | Örnek değişiklik |
|---|---|---|
| `web/js/store.js` | Beyin promptu (`BASE_PROMPT`), tablolar, `BASE_PROMPT_VERSION` | "Beyne yeni kalıcı kural ekle" |
| `web/js/agent.js` | 36 aracın tanımı (`F(...)`) + yürütücüsü (`EXEC`) + çip etiketleri | "Yeni araç ekle" (aşağıda) |
| `web/js/app.js` | Ekran mantığı: mesaj render, markdown, grafik, mic/PDF/OCR, hatırlatıcı sayacı | "Yeni düğme davranışı" |
| `web/index.html` | Ekran iskeleti, düğmeler | "Yeni düğme/alan ekle" |
| `web/style.css` | Görünüm | Renk/boyut |
| `web/js/llm.js` | Model sırası, 413/429 korumaları | Dokunma (hassas) |
| `web/data/mufredat.json` | 33 ders | Yeni ders ekle |
| `web/data/katalog.json` | 664 açık API | Yeni API kaydı |
| `web/sw.js` | Çevrimdışı önbellek | Sadece sürüm numarası |

---

## 🧩 Örnek: yeni araç nasıl eklenir? (agent.js, 3 adım)

1. **Tanım** (TOOLS listesine, diğer `F(...)` bloklarının yanına):
```js
F('sans_sozu', 'Rastgele motive edici söz üretir. "bana söz ver" denince çağır.', {
  konu: { type: 'string', description: 'opsiyonel konu (sabır, cesaret…)' },
}, []),
```
2. **Yürütücü** (EXEC nesnesine):
```js
async sans_sozu({ konu }) {
  const sozler = ['Düşersen kalk, kalkamazsan yatma.', 'Bugün zor, yarın daha zor, ertesi gün güneş doğar.'];
  return { ok: true, soz: sozler[Math.floor(Math.random() * sozler.length)], not: 'Sözü aynen sun.' };
},
```
3. **Etiket** (label haritasına):
```js
sans_sozu: done ? '✨ Söz hazır' : '✨ Söz seçiliyor',
```
Sonra: sürüm +1 → `node --check` → suite → push. Beyin aracı OTOMATİK görür
(şema modele gidiyor), ekstra ayar gerekmez. `oz_test` yeni aracın şemasını da denetler.

---

## 🔁 Günlük akış (özet)

```
Düzenle → node --check → suite (232 ✅?) → sürüm +1 (sw.js + index.html)
→ docs kopyala → commit → push → 1 dk bekle → telefonda yenile → "kendini test et" yaz
```

Bir şey takılırsa: EVRIM'i aç ve "agent.js'e araç nasıl eklenir?" diye sor —
kendi kodunu okuyup adım adım anlatır. Son çare: bozuk dosyayı git History'den geri al.
