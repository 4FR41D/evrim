# ☁️ DEPLOY — EVRIM'i ücretsiz yayınlama (Render)

Hedef: `https://evrim-xxxx.onrender.com` adresi, telefonda ana ekranda, **bilgisayarın kapalıyken de çalışsın**.

---

## ⚠️ Önce şunu bil: ücretsiz planda disk geçicidir

Render'ın ücretsiz planında:
- **15 dk hareketsizlikte uyur**, ilk istekte ~30-60 sn'de uyanır
- **Dosya sistemi kalıcı değildir** — her deploy ve her uykudan uyanışta disk sıfırlanabilir
- Ücretsiz plana **persistent disk bağlanamaz**, ücretsiz Postgres ise **30 günde silinir**

Bu yüzden EVRIM'e bir **kalıcılık katmanı** ekledim: `data/` klasörünü GitHub'daki
**özel (private)** bir repoda şifreli olarak yedekliyor, açılışta geri yüklüyor.
Ek hesap yok, ek ücret yok — zaten olan GitHub token'ını kullanıyor.

Test edildi: disk tamamen silinip sunucu sıfırdan başlatıldı → 8/8 dosya geri geldi,
hafıza + beyin sürümü + AI ayarları aynen korundu.

---

## 🚀 Adım adım kurulum (~10 dk)

### 1. Render hesabı aç
https://dashboard.render.com/register → **"GitHub"** ile kaydol (en kolayı, repoyu otomatik görür).
Kredi kartı **istemiyor**.

### 2. Web Service oluştur
1. **New +** → **Web Service**
2. **Connect a repository from GitHub** → ilk kezse "Configure account" ile GitHub'a izin ver
   - İzin ekranında **Only select repositories** → `evrim` ve `evrim-data` seç
3. Listeden **4FR41D/evrim** → **Connect**

### 3. Servis ayarları

| Alan | Değer |
|---|---|
| **Name** | `evrim` |
| **Region** | **Frankfurt (EU Central)** ← Türkiye'ye en yakın |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

### 4. Environment Variables (en kritik kısım)

"Advanced" → **Add Environment Variable** ile şunları ekle:

| Key | Value | Açıklama |
|---|---|---|
| `PERSIST` | `1` | GitHub yedeklemesini açar |
| `DATA_DIR` | `/opt/render/project/src/data` | veri klasörü |
| `DATA_BRANCH` | `evrim-data` | yedek dalı |
| `GITHUB_TOKEN` | `ghp_...` | classic token (`repo` scope) |
| `GROQ_API_KEY` | `gsk_...` | AI beyni |
| `APP_PIN` | kendin belirle (örn. `482913`) | 🔒 uygulamayı açmak için sorulur |
| `DATA_KEY` | uzun rastgele bir parola | yedekleri şifreler |

> `DATA_KEY` için rastgele parola üret: https://1password.com/password-generator/ (20+ karakter)
>
> ⚠️ **`DATA_KEY`'i bir yere not et ve DEĞİŞTİRME.** Değiştirirsen eski şifreli yedekler çözülemez.

### 5. Create Web Service
Build 1-3 dk sürer. Loglarda şunu görmelisin:

```
🧬 EVRIM çalışıyor → http://0.0.0.0:10000
   Sağlayıcı: groq | Model: openai/gpt-oss-120b
   PIN koruması: AÇIK
[persist] özel veri reposu hazır: 4FR41D/evrim-data
[persist] pull: 8/8 dosya geri yüklendi
   Kalıcılık: ✅ 4FR41D/evrim-data@evrim-data (şifreli)
```

### 6. Aç ve PIN gir
`https://evrim-xxxx.onrender.com` → PIN soracak → gir → **Ana ekrana ekle**:
- iPhone: Safari → Paylaş → **Ana Ekrana Ekle**
- Android: Chrome → ⋮ → **Uygulamayı yükle**

---

## 🔁 Alternatif: Blueprint (tek tıkla)

Repoda `render.yaml` var. **New + → Blueprint** → repoyu seç → Render ayarları otomatik kurar.
Secret'ları (`GITHUB_TOKEN`, `GROQ_API_KEY`, `APP_PIN`, `DATA_KEY`) yine panelde girmen gerekir.

---

## 📱 İlk açılışta ne olacak?

`GITHUB_TOKEN` ve `GROQ_API_KEY` ortam değişkeni olarak verildiği için:
- Sunucu **boş diskle** başlasa bile yedeği geri indirir
- AI anahtarı ve GitHub token'ı otomatik tanınır
- Ayarlar sekmesinde maskeli olarak görünür (`gsk_••••RK1M`)

Hiçbir şeyi yeniden girmen gerekmez.

---

## 🧪 Deploy sonrası kontrol listesi

```bash
# sağlık (PIN istemez)
curl https://evrim-xxxx.onrender.com/api/health
```

- [ ] `/api/health` → `{"ok":true,"pin":true,...}`
- [ ] PIN soruluyor ve girince açılıyor
- [ ] Üstteki rozet: `Groq · gpt-oss-120b` (demo modu **değil**)
- [ ] Evrim sekmesinde eski hafıza kayıtların duruyor
- [ ] Ayarlar → ☁️ Veri yedeği → **açık / şifreli** yazıyor
- [ ] Sohbet edince yanıt geliyor
- [ ] GitHub sekmesinde `4FR41D/evrim` görünüyor

---

## 🛠 Sorun giderme

| Belirti | Sebep / Çözüm |
|---|---|
| Logda `Sağlayıcı: demo` | `GROQ_API_KEY` eksik ya da yanlış. Değeri kontrol et, redeploy et. |
| Logda `Kalıcılık: ⚠️ ...token gerekiyor` | `GITHUB_TOKEN` ortam değişkeni yok. Ekle ve redeploy. |
| `DATA_KEY tanımlı değil` | Yedek şifreli ama env var yok. Aynı `DATA_KEY`'i ekle. |
| `unable to authenticate data` | `DATA_KEY` **değişmiş**. Eski değeri geri koy. |
| Uygulama açılmıyor, sürekli PIN soruyor | `APP_PIN` ile girdiğin PIN farklı. Render panelinden değere bak. |
| İlk açılış 30-60 sn sürüyor | Normal — ücretsiz plan uykudan uyandırıyor. |
| Veri yine kayboldu | `PERSIST=1` mi? Ayarlar → Veri yedeği "açık" mı? Logda `pull: N/N` var mı? |
| Build başarısız: `Cannot find package 'express'` | Build Command `npm install` olmalı (`npm ci` de olur). |

### Yedeği elle tetikleme
Uygulamada **Ayarlar → ☁️ Veri yedeği → 💾 Şimdi yedekle**.
Ayrıca sunucu her kapanışta (SIGTERM) otomatik yedekler ve 3 dakikada bir değişiklik varsa yazar.

---

## 💸 Gerçekten 0 TL mi?

Evet:
- Render Free: 750 instance-saat/ay (tek servis için yeterli), kredi kartı yok
- Groq Free: `gpt-oss-120b` ücretsiz katman
- GitHub: private repo + API ücretsiz
- Toplam: **0 TL**

Tek bedel: 15 dk sonra uyuması ve ilk açılışta ~30 sn beklemesi.
Bunu istemezsen Render Starter **$7/ay** (uyumaz, disk kalıcı olur).

---

## 🔐 Güvenlik notları

1. `APP_PIN` koymadan **asla** yayınlama — URL'i bulan herkes AI'ını ve token'larını kullanır.
2. `evrim-data` reposu **private** olmalı (kod otomatik private oluşturuyor, yine de kontrol et).
3. Bu rehberdeki token'ları repoya **yazma** — sadece Render panelindeki env var'lara gir.
4. Sohbet ekranına yapıştırdığın token'ları iptal edip yenile:
   - https://github.com/settings/tokens → eski `ghp_...` → **Revoke**
   - https://console.groq.com/keys → eski `gsk_...` → **Revoke**
5. `DATA_KEY`'i kaybettiğin an yedekler okunamaz olur — bir yerde sakla.
