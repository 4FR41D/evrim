# 🔬 Araştırma Labı — 7/24 döngüyü etkinleştirme (2 dakika, telefondan)

Lab dosyaları repoda hazır; tek eksik GitHub'ın otomatik zamanlayıcısı. GitHub,
`.github/workflows/` dosyalarının **token ile** eklenmesine izin vermiyor — bu yüzden
son adımı senin web arayüzünden yapman gerekiyor (bilgisayar gerekmez):

1. Şu adresi aç: **https://github.com/4FR41D/evrim/new/main/.github/workflows/lab.yml**
   (Sayfa "yeni dosya oluştur" ekranını dosya yolu hazır şekilde açar.)
2. İçeriği şuradan kopyala: **https://raw.githubusercontent.com/4FR41D/evrim/main/lab/lab.yml**
   (tamamını seç-kopyala yap)
3. Açık sekmeye dön, büyük boş alana **yapıştır**.
4. Sağ üstten **Commit changes…** → tekrar **Commit changes**.
5. Bitti! Döngü artık her 6 saatte bir (00:17, 06:17, 12:17, 18:17 UTC) kendiliğinden çalışır.
   Hemen başlatmak istersen: **https://github.com/4FR41D/evrim/actions/workflows/lab.yml** →
   **Run workflow** → **Run workflow**.

## Ne yapıyor?
- **Bench**: 5 sabit tuzak/beceri sorusunu mevcut beyin (gpt-oss-120b) cevaplar, bağımsız jüri 0-10 puanlar
- **İçerik**: her çalıştırmada 2 derse doğrulanmış yeni quiz sorusu ekler (kurs modunda sorulur)
- **Öneri**: düşük puanlardan somut iyileştirme önerileri yazar (`lab/ONERILER.md`)
- **Güvenlik**: tam test paketi (299 test) geçmeden HİÇBİR şey commit edilmez; lab yalnız veri üretir, uygulama koduna dokunamaz

Sonuçlar: `lab/ARASTIRMA.md` (günlük) · `lab/ozet.json` (Ayarlar → 🔬 Araştırma Labı kartında canlı görünür)

Alternatif: GitHub token'ına `workflow` yetkisi eklersen bir sonraki sohbette "labı kur" demen yeterli — gerisini ben yaparım.
