# 💡 Lab Önerileri

_Son güncelleme: 2026-09-14T05:07:17.883Z — bench ortalaması 7.6/10_

- **web/js/app.js**: Başlangıçta kritik olmayan modülleri `import()` ile dinamik olarak yükleyerek uygulama başlatma süresini %10‑15 azalt.  
- **web/js/store.js**: `localStorage` veri serileştirmesini JSON yerine `structuredClone`/`MessageChannel` ile yapıp, büyük nesnelerde sıkıştırma (LZString) ekleyerek depolama alanı tüketimini %20 düşür.  
- **web/js/rag.js**: Son 20 sorgunun sonuçlarını hafızada LRU önbelleği olarak tutup aynı sorguların tekrar ağ isteği yapmasını engelle, yanıt süresini ortalama 150 ms kısalt.  
- **web/js/learn.js**: Kullanıcı girdisi işleme fonksiyonuna `debounce(300)` ekleyerek gereksiz model çağrılarını azalt, CPU kullanımını %30 düşür.  
- **lab/run.mjs**: Bağımsız test dosyalarını `Promise.allSettled` ile paralel çalıştırıp CI süresini yaklaşık yarıya indirge.
