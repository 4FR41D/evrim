# 📖 EVRIM — Adım Adım Kurulum Rehberi (Türkçe)

Bu rehber üç işi sırayla anlatır:
**A)** Ücretsiz AI anahtarı almak → **B)** GitHub'da repo açıp kodu yüklemek → **C)** Telefonda kullanmak.

---

## A) Ücretsiz AI anahtarı (3-4 dakika)

En kolayı **Groq**: hızlı ve ücretsiz katmanı geniş.

1. <https://console.groq.com/keys> adresine git (Google hesabınla girebilirsin).
2. **"Create API Key"** → bir isim ver (örn. `evrim`) → **Submit**.
3. Çıkan anahtarı kopyala: `gsk_` ile başlar. ⚠️ Sayfayı kapatınca bir daha gösterilmez, hemen kaydet.
4. EVRIM'i aç → **Ayarlar** sekmesi → "API anahtarı" alanına yapıştır → **Kaydet** → **Test et**.
5. Üstteki rozet `🧪 demo modu` yerine `Groq · openai/gpt-oss-120b` yazıyorsa tamam ✅

Alternatifler:
- **OpenRouter** <https://openrouter.ai/settings/keys> → `sk-or-...` (model listesinden `:free` olanlar ücretsiz)
- **Google AI Studio** <https://aistudio.google.com/app/apikey> → `AIza...`

---

## B) GitHub'a yükleme (5 dakika)

### B1. Repoyu oluştur
1. <https://github.com/new>
2. **Repository name**: `evrim`
3. **Public** veya **Private** (ikisi de ücretsiz) — private seçmeni öneririm.
4. ⚠️ "Add a README file" / ".gitignore" / "license" kutularını **işaretleme** (boş repo olsun, çakışma çıkmasın).
5. **Create repository**.

### B2. Kodu yükle
Bilgisayarında kodun olduğu klasörde terminal aç:

```bash
cd evrim
git init -b main
git add .
git commit -m "feat: EVRIM - kendini gelistiren AI uygulamasi"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADI/evrim.git
git push -u origin main
```

İlk push'ta kullanıcı adı + parola sorar. **Parola artık çalışmıyor**, onun için:
1. <https://github.com/settings/tokens> → **Generate new token (classic)**
2. İzin: sadece `repo`
3. Oluşan token'ı **parola yerine** yapıştır.

### B3. EVRIM'i bu repoya bağla (uygulama içinden)
Uygulamanın kendi reponu okuyup commit atabilmesi için **ikinci bir token** gerekiyor:
1. <https://github.com/settings/personal-access-tokens/new> (Fine-grained token)
2. **Repository access** → *Only select repositories* → `evrim`
3. **Permissions → Repository permissions → Contents** → `Read and write`
4. **Generate token** → kopyala (`github_pat_...`)
5. EVRIM → **Ayarlar → GitHub**:
   - Repo: `KULLANICI_ADI/evrim` (ya da **Seç** düğmesiyle listeden)
   - Dal: `main`
   - Token: yapıştır → **Kaydet** → **Bağlantıyı test et**

Artık **GitHub** sekmesinde dosyaların, commitlerin ve issue'ların görünür.

---

## C) Telefonda kullanma

### C1. Aynı Wi-Fi üzerinden (hemen, ücretsiz)
Bilgisayarında:
```bash
npm start
```
Bilgisayarın yerel IP'sini bul (Windows: `ipconfig` → IPv4, Mac/Linux: `ifconfig` veya `ip a`), örn. `192.168.1.25`.
Telefonun tarayıcısında: `http://192.168.1.25:3000`

**Ana ekrana ekle:**
- iPhone → Safari → Paylaş (kutu+ok) → **Ana Ekrana Ekle**
- Android → Chrome → ⋮ → **Uygulamayı yükle** / **Ana ekrana ekle**

Artık tam ekran bir uygulama gibi açılır. 🎉

### C2. Her yerden erişim (bilgisayarın açıkken)
- **Tailscale** (ücretsiz, en kolayı): bilgisayara ve telefona kur, aynı hesaba giriş yap → telefon `http://100.x.y.z:3000` ile erişir. Kurulum gerektirmez, port açmaz.

### C3. Bilgisayar kapalıyken de çalışsın (ücretsiz bulut)
**Render.com**:
1. <https://dashboard.render.com> → **New → Web Service** → GitHub repoyu bağla
2. Build Command: `npm install` · Start Command: `npm start`
3. Plan: **Free** → Create
4. Birkaç dakikada `https://evrim-xxxx.onrender.com` adresin hazır — telefonda açıp ana ekrana ekle.

⚠️ İki önemli not:
- Ücretsiz planda **disk geçicidir**: yeniden başlatmada `data/` sıfırlanır. Çözüm: Render'da bir **Disk (volume)** ekleyip `DATA_DIR` ortam değişkenini o yola ayarla. Ya da ileride Supabase'e geçeriz (tek dosya değişikliği: `src/db.js`).
- Ücretsiz plan 15 dk kullanılmayınca uyur; ilk açılış ~30 sn sürer.

---

## 🧪 İlk denemen için öneri

1. **Sohbet**'e yaz: *"Beni tanıman için 3 soru sor"*
2. Cevapları ver → **Evrim** sekmesini aç: hafızaya eklenen kayıtları ve "beyin sürümü"nün v2, v3… diye arttığını göreceksin.
3. Yanıtlardan birine **👎** bas ve nedenini yaz → EVRIM bunu "geçmiş hatalar" hafızasına yazar ve bir dahaki yanıtında davranışını değiştirir.
4. **Öğren**'e git → konu yaz (örn. *"İngilizce present perfect"*) → **Soruları üret** → cevapla. Yanlış yaptığında kart 4 saat sonra, zorluk bir kademe düşmüş şekilde geri gelir.
5. **GitHub → 🤖 AI Geliştirici**'ye git → görev yaz: *"README.md dosyasına kurulum bölümü ekle"* → üretilen kodu gör → **Commit et**.

---

## ❓ Sık sorunlar

| Sorun | Çözüm |
|---|---|
| `GitHub: HTTP 403 / rate limit` | Token ekle (token'sız istek limiti saatte 60). |
| `401 Bad credentials` | Token süresi dolmuş veya yetkisi eksik. `Contents: Read and write` ver. |
| Model yanıt vermiyor | Ayarlar → **Test et**. Model adını boş bırakıp varsayılana dön. |
| Commit atılmıyor | `autoCommit` kapalıdır (güvenli varsayılan). Kodu görüp **Commit et** düğmesine bas. |
| Verilerim nerede? | Sunucudaki `data/*.json` dosyalarında. Bu klasör git'e girmez. |
| Anahtarım çalınır mı? | Anahtar yalnızca senin sunucunda durur, tarayıcıya maskeli gider. Yine de repoya asla commit etme. |
