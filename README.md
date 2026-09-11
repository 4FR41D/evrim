# EVRIM

> 🇹 **[turkiye-acik-kaynak-platformu](https://github.com/topics/turkiye-acik-kaynak-platformu)** konusunda listeli — Türkçe açık kaynak yapay zeka topluluğunun parçası.
> Canlı demo: **https://4fr41d.github.io/evrim/** · anahtarsız · ücretsiz · ajan döngülü


Mobil öncelikli bir web uygulaması (PWA). Dört modül tek çatı altında:

| Modül | Ne yapar |
|---|---|
| 💬 **Sohbet** | Hafızalı asistan. Seni tanır, tercihlerini hatırlar, yanıtlarını kişiselleştirir. |
| 🔁 **Evrim** | Her yanıttan sonra *meta-öğrenme* döngüsü çalışır: kalıcı bilgi çıkarır, kendi sistem promptuna kural yamar, beceri haritanı günceller. Sürüm geçmişi + tek tıkla geri alma. |
| 📚 **Öğren** | Spaced repetition (aralıklı tekrar). AI soru üretir, cevabını puanlar; yanlışlarına göre hem tekrar aralığını hem zorluğu otomatik ayarlar. |
| 🐙 **GitHub** | Reponu bağla: dosya ağacı, commit/issue/PR özeti, AI repo analizi ve **AI'ın ürettiği kodu doğrudan repoya commit atma**. |

Tamamen ücretsiz çalışacak şekilde tasarlandı: Groq / OpenRouter / Google Gemini ücretsiz katmanları.
Anahtar yoksa **demo modu** devreye girer, arayüz ve GitHub okuma yine çalışır.

---

## 🖥 Arayüz (v15 — Claude benzeri kabuk)

Canlı yayın: **`web/` klasörü → GitHub Pages (`docs/`)**. Sunucu gerekmez.

- **Giriş / profiller:** cihaz içi çoklu profil, isteğe bağlı PIN. Her profilin sohbet
  geçmişi ayrıdır. Sunucu olmadığı için "giriş" yalnızca bu cihazda geçerlidir.
- **Sohbet botları:** 7 hazır kişilik (EVRIM, Kod Uzmanı, Öğrenme Koçu, Yazı Editörü,
  Araştırmacı, Planlayıcı, Sohbet Arkadaşı) + kendi botunu oluşturma. Seçili botun
  kişiliği sistem promptuna eklenir; bot değiştirince yeni sohbet açılır.
- **Kenar çubuğu:** botlar, sohbet listesi (son etkinlik sırasıyla), profil çipi.
  Mobilde hamburger + çekmece. Alt sekme çubuğu kaldırıldı.
- **Ajan modu:** model araç çağırabilir (hafıza, hesap, Vikipedi, tarih, açık API kataloğu…). Adımlar
  mesajın üstünde "🔧 Hesapladı: … 12 ms" şeklinde görünür, kalıcıdır.
- **Beyin katmanları (öncelik sırası):** senin OpenRouter/Groq anahtarın → Puter
  (anahtarsız bulut) → ücretsiz servisler → Chrome Nano → cihazında açık kaynak model.
  Hiçbiri yoksa sohbet kilitlenmez: engelleyici olmayan bir uyarı şeridi çıkar.

---

## 🚀 5 dakikada çalıştır

```bash
git clone https://github.com/KULLANICI/evrim.git
cd evrim
npm install
npm start          # → http://localhost:3000
```

## 🔑 Ücretsiz AI anahtarı (birini seç)

1. **Groq** (en hızlısı, önerilen) → <https://console.groq.com/keys> → "Create API Key" → `gsk_...`
2. **OpenRouter** (çok model, `:free` olanlar ücretsiz) → <https://openrouter.ai/settings/keys> → `sk-or-...`
3. **Google AI Studio** → <https://aistudio.google.com/app/apikey> → `AIza...`

Uygulamada **Ayarlar → AI beyni** alanına yapıştır → **Kaydet** → **Test et**.
Sağlayıcı otomatik algılanır (anahtarın önekinden).

> Anahtar yalnızca senin sunucundaki `data/settings.json` dosyasında durur, hiçbir yere gönderilmez.

## 🐙 GitHub bağlantısı

1. GitHub → Settings → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → *Generate new token*
2. **Repository access**: sadece kendi repon ("Only select repositories")
3. **Permissions → Repository permissions → Contents**: `Read and write`
4. Token'ı kopyala (`github_pat_...`)
5. EVRIM → **Ayarlar → GitHub**: repo adını yaz (`kullanici/repo`) veya **Seç** ile listenden bağla, token'ı yapıştır, **Kaydet**

> Token olmadan da **public** repolar okunabilir (commit/dosya/issue). Commit atmak için token şart.
> Güvenlik: `autoCommit` varsayılan **kapalı**. AI kodu üretir, sen görüp onaylarsın.

## 📱 Telefonda kullan

- Sayfa telefonda açıkken: iPhone → Safari → **Paylaş → Ana Ekrana Ekle**; Android → Chrome → **⋮ → Uygulamayı yükle**.
- Tam ekran, uygulama gibi açılır, çevrimdışı kabuğu çalışır.

## ☁️ Ücretsiz yayınlama (telefondan her yerden erişim)

> 📘 **Adım adım tam rehber: [DEPLOY.md](DEPLOY.md)** — Render kurulumu, ortam değişkenleri,
> veri kalıcılığı, sorun giderme tablosu ve güvenlik notları orada.

**Önemli:** ücretsiz bulut planlarında disk geçicidir. EVRIM bu yüzden `data/` klasörünü
GitHub'daki **özel** bir repoda (`evrim-data`) şifreli yedekler ve açılışta geri yükler.
`PERSIST=1` ile açılır; `GITHUB_TOKEN`, `GROQ_API_KEY`, `APP_PIN`, `DATA_KEY` ortam değişkenleri yeterlidir.



### Seçenek A — Render / Railway (Node sunucusu, en kolay)
1. Repoyu GitHub'a push et
2. Render → **New → Web Service** → repoyu seç
3. Build: `npm install` · Start: `npm start` · Ücretsiz plan
4. **ÖNEMLİ:** ücretsiz planda disk geçicidir. Kalıcı veri için ortam değişkeni olarak `DATA_DIR` ver ve bir volume bağla, ya da `src/db.js` içindeki JSON katmanını Supabase/Postgres ile değiştir (tek dosya).

### Seçenek B — Kendi bilgisayarın + Tailscale (tamamen ücretsiz, veri sende)
```bash
npm start
```
Telefona Tailscale kur, aynı ağda `http://bilgisayarın-tailscale-ip:3000` adresini aç. Veriler diskinde kalır, kimseye gitmez.

### Seçenek C — Vercel/Netlify
Statik arayüzü çalışır ama bu backend uzun ömürlü bir Node process'i olduğu için serverless'a taşımak gerekir.
İstersen `server.js` içindeki route'ları Vercel function'larına bölebilirim.

## 🧠 Öz-gelişim döngüsü nasıl işliyor?

```
kullanıcı mesajı ──► sistem promptu (beyin vN) + hafıza + beceri haritası
                 ──► LLM yanıtı
                 ──► arka planda META-ÖĞRENME çağrısı (JSON):
                       • memories[]      → kalıcı bilgi / tercih / hata / kural
                       • promptPatch     → beynin yeni kuralı
                       • confidence      → güven skoru
                       • skills[]        → beceri haritası güncellemesi
                 ──► confidence ≥ eşik  → otomatik uygulanır (beyin vN+1)
                     confidence <  eşik  → "bekleyen yama" olur, sen onaylarsın
```

- 👍/👎 geri bildirimi doğrudan hafızaya ve gelişim günlüğüne işlenir.
- **Evrim** sekmesinden her sürümü görebilir, eski bir sürüme dönebilirsin.
- Güven eşiğini Ayarlar'dan kaydır: düşük = hızlı evrim, yüksek = kontrollü evrim.

## 📁 Yapı

```
evrim/
├─ web/                 # CANLI statik uygulama (GitHub Pages buradan yayınlanır)
│  ├─ index.html        # giriş + kabuk + görünümler
│  ├─ style.css
│  ├─ sw.js             # service worker (çevrimdışı kabuk)
│  └─ js/
│     ├─ app.js         # UI + mesaj akışı + ajan bağlantısı
│     ├─ shell.js       # giriş akışı, kenar çubuğu, botlar, modal, çekmece
│     ├─ profile.js     # cihaz içi profiller + PIN
│     ├─ personas.js    # hazır botlar + şablonlar
│     ├─ agent.js       # 27 araç + ajan döngüsü + Türkçe-duyarlı Vikipedi
│     │                 #   + gorsel_uret: Puter üzerinden anahtarsız/ücretsiz görsel üretimi
│     │                 #   + api_katalog: awesome-agent-apis (660+ model, anahtarsız/ücretsiz okuma)
│     │                 #   + web_ara: anahtarsız web araması (jina+ddg) → web_oku zinciri
│     │                 #   + web_oku: herhangi bir web sayfasını okur (r.jina.ai, anahtarsız)
│     │                 #   + kod_calistir: JS sandbox (benim bash'imin karşılığı)
│     │                 #   + gorsel_uret: girişsiz/anahtarsız görsel (pollinations, CORS *)
│     ├─ linux-node/     # 🐧 SAHİBE ÖZEL Linux düğümü: private GitHub bus üzerinden tam yetkili yürütücü
│     ├─ data/mufredat.json # 🎓 KURS MODU: GenAI 21 ders (MIT, Microsoft) + SciML bonusu, TR
│     ├─ reflex.js      # REFLEKS KATMANI: beyinsiz bile anında cevap (selam, saat, matematik)
│     ├─ wasm.js        # CİHAZ İÇİ KÜÇÜK BEYİN: transformers.js WASM (SmolLM2-135M) —
│     │                 #   WebGPU'suz, girişsiz, çevrimdışı; hiçbir siteye yönlendirmez
│     └─ house.js       # EV BULUTU: sunucusuz/hesapsız WebRTC beyni (PeerJS) —
│                       #   sahibin cihazı beyin olur, diğer tüm cihazlar sıfır girişle bağlanır
│                       #   v25: ilk cihaz otomatik beyin, doluySA yeni cihaz otomatik misafir
│     ├─ data/katalog.json  # kataloğun YEREL YEDEĞİ (upstream silinse bile çalışır)
│     ├─ llm.js         # sağlayıcılar, akış, model rotasyonu
│     ├─ store.js       # localStorage tabanlı veri katmanı + beyin sürümleri
│     ├─ evolve.js      # hafıza + öz-gelişim + beceri haritası
│     ├─ learn.js       # aralıklı tekrar, soru üretme, plan
│     ├─ github.js      # GitHub REST (okuma + commit)
│     └─ local.js / nano.js / puter.js / free.js   # beyin katmanları
├─ docs/                # web/'in birebir kopyası (Pages bu klasörü servis eder)
├─ server.js + src/     # (eski) Node backend — artık gerekli değil
└─ data/                # yerel veri (git'e girmez)
```

> Not: `web/` dosyalarını değiştirirsen `docs/` ile senkronla
> (`cp -r web/. docs/`) ve ikisini birlikte commit'le.
> Katalog yedeğini tazelemek için: `node scripts/katalog-sync.js`.

## 🔒 Güvenlik notları

- `data/` klasörü `.gitignore` içinde — API anahtarların repoya sızmaz.
- Token'lar sunucuda kalır, tarayıcıya maskelenmiş (`gsk_••••1234`) gönderilir.
- AI'ın repoya yazma yetkisini istediğin an kapat (`autoCommit: false` + token'ı sil).

## 🗺 Sıradaki adımlar (istersen ekleriz)

- [ ] Gerçek mobil uygulama paketi (Expo/React Native) — aynı API'yi kullanır
- [ ] SQLite/Supabase'e geçiş (çok cihaz senkronu)
- [ ] Sesli sohbet (mikrofon → STT → LLM → TTS)
- [ ] Zamanlanmış görevler: her sabah GitHub + öğrenme özeti bildirimi
- [ ] Çok kullanıcılı giriş (auth)
