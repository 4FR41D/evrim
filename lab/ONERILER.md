# 💡 Lab Önerileri

_Son güncelleme: 2026-09-13T13:17:29.240Z — bench ortalaması 8/10_

- **web/js/agent.js**: Araç çağırma fonksiyonuna `AbortController` ekleyerek uzun süren istekleri zaman aşımına uğrat, böylece “ağ/kota” hataları azaltılır.  
- **web/js/rag.js**: RAG sorgularını önbelleğe almak için `localStorage` tabanlı bir LRU cache katmanı ekle; aynı sorgular tekrarlandığında ağ çağrısı yapılmaz.  
- **web/js/store.js**: Bellek yönetimini iyileştirmek amacıyla, hafıza sınırı aşıldığında en eski sohbet geçmişini otomatik olarak silen bir “eviction policy” uygula.  
- **web/js/learn.js**: Kullanıcıdan gelen geri bildirimleri toplamak ve model güncellemelerinde kullanmak için basit bir “feedback queue” (localStorage’da kuyruk) ekle.  
- **tests/suite.mjs**: Benchmark testlerini paralel çalıştırmak yerine `Promise.allSettled` ile asenkron hale getir, böyleca CI süresi kısalır ve “ağ/kota” hataları daha net izlenebilir.
