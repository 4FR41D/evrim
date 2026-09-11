# 🧬 EVRIM — kendini sürekli geliştiren AI uygulaması

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
├─ server.js            # Express API + statik sunucu
├─ src/
│  ├─ db.js             # JSON veri katmanı + prompt sürüm geçmişi
│  ├─ llm.js            # Groq / OpenRouter / Gemini / demo sağlayıcıları
│  ├─ evolve.js         # hafıza + öz-gelişim döngüsü + beceri haritası
│  ├─ learn.js          # aralıklı tekrar, soru üretme, puanlama, plan
│  ├─ github.js         # GitHub REST API (okuma + commit)
│  └─ agent.js          # repo analizi + "kendi kodunu yazan" ajan
├─ public/              # mobil öncelikli arayüz (PWA)
└─ data/                # yerel veri (git'e girmez)
```

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
