# 💡 Lab Önerileri

_Son güncelleme: 2026-09-13T09:05:48.012Z — bench ortalaması 7.6/10_

- `tool_call_validator.py` dosyası ekleyerek her araç (tool) yanıtını JSON şemasıyla doğrula ve tutarsız/yanlış sonuçları otomatik olarak yeniden sorgula.  
- Prompt şablonuna “Şu anda senin elinde X elma var” gibi dinamik durum değişkeni ekle; böylece RAG‑destekli yanıtlar mevcut envanteri hesaba katabilir.  
- Mobil tarayıcıda çalışan SPA’da (single‑page app) araç çağrılarının sonuçlarını `localStorage`‑da önbellekle; aynı sorgu tekrarlandığında ağ isteği yapmadan anlık yanıt ver.  
- `memory_manager.js` içinde her yeni bilgi eklenmeden önce basit bir kural‑tabanlı tutarlılık kontrolü (ör. “elma sayısı negatif olamaz”) yap, tutarsızlık tespit edildiğinde kullanıcıya uyarı göster.  
- Araç seçim mantığını `tool_selector.py` içinde “en yüksek güven skoruna sahip 3 aracı paralel çalıştır, sonuçları çoğunluk oylamasıyla birleştir” şeklinde güncelle; bu, tek bir aracın hatalı yanıt vermesini azaltır.
