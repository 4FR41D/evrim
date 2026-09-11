# 🐧 EVRIM Linux Düğümü (evrim-node)

EVRIM'in **sahibine özel** tam yetkili Linux yürütücüsü. Tarayıcıdaki EVRIM `linux_komut`
aracıyla komut gönderir; bu betik senin makinende çalıştırır ve çıktıyı geri yazar.

```
EVRIM (telefon/tarayıcı) ──► private GitHub bus (cmd.json/out.json) ──► evrim-node (senin Linux makinen)
```

- Makine internete **açılmaz**: yalnız dışa HTTPS (`api.github.com`). Port yönlendirme, NAT, güvenlik duvarı ayarı gerekmez.
- Bus **private repo** olduğu için komutları yalnız senin token'ın okuyabilir → diğer EVRIM kullanıcıları bu aracı kullanamaz.
- Betik hangi kullanıcıyla başlatılırsa o yetkiyle çalışır. Tam yönetici için root başlat (aşağıda).

## Gereksinimler

- Herhangi bir Linux makine: eski PC, Raspberry Pi, ucuz VPS — fark etmez. (Termux'ta da çalışır ama sudo/root yoktur.)
- Node.js **18+** (`node --version`), başka bağımlılık YOK.
- Sahibin GitHub token'ı (repo scope'lu — EVRIM Ayarlar'da kullandığının aynısı).

## Kurulum (3 adım)

```bash
# 1) Token'ı yaz (yalnız senin okuyabileceğin dosya)
echo "ghp_XXXX...TOKENIN" > ~/.evrim-node-token && chmod 600 ~/.evrim-node-token

# 2) Betiği indir
mkdir -p ~/evrim-node && cd ~/evrim-node
curl -sLO https://raw.githubusercontent.com/4FR41D/evrim/main/linux-node/evrim-node.mjs

# 3) Başlat
node evrim-node.mjs            # normal kullanıcı yetkisiyle
sudo -E node evrim-node.mjs    # TAM ROOT yetkisiyle (bilinçli tercih)
```

`🐧 EVRIM düğümü başladı` yazısını görünce hazır. Artık EVRIM sohbetinden:
*"linux düğümünde `df -h` çalıştır"* gibi istekler `linux_komut` aracına düşer.

## Kalıcı servis (systemd)

```ini
# /etc/systemd/system/evrim-node.service
[Unit]
Description=EVRIM Linux dugumu
After=network-online.target

[Service]
ExecStart=/usr/bin/node /root/evrim-node/evrim-node.mjs
Restart=always
RestartSec=5
User=root
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp evrim-node.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now evrim-node
sudo journalctl -u evrim-node -f   # canlı günlük
```

## Bilgisayarın yok mu? Ücretsiz online Linux: GitHub Codespaces

Ayda **120 saat ücretsiz**, tarayıcıdan (telefonda bile) çalışır — kayıt/kart gerekmez, GitHub hesabın yeter:

1. `github.com/4FR41D/evrim` → yeşil **Code** düğmesi → **Codespaces** sekmesi → **Create codespace on main**
2. Editör açılınca alttaki **Terminal** sekmesine geç ve 3 kurulum komutunu çalıştır (yukarıdaki gibi)
3. `node evrim-node.mjs` → düğüm hazır; EVRIM'den "linux'ta uname -a çalıştır" de

Notlar:
- Codespace ~30 dk boşta kalınca uyur → düğüm durur. Kullanmadan önce Codespace sayfasını açıp terminalde `node evrim-node.mjs` yeniden başlat (Ctrl+C ile eskiyi durdur).
- Ayda 120 saat dolunca Codespace kapanır; süre sıfırlanınca devam.
- **PIN koruması önerilir:** EVRIM → Ayarlar → 🐧 Linux düğümü PIN'i. PIN varken her `linux_komut` tarayıcıda şifre sorar.

## Güvenlik notları (bilinçli tam yetki)

- **Token = makinenin anahtarı.** Sızarsa repo'ya komut yazabilen herkes makinede root komut çalıştırabilir. Token'ı kimseyle paylaşma; şüphede token'ı GitHub'da iptal edip yenisini üret.
- Bus geçmişi (komutlar + çıktılar) private repoda birikir; ara sıra `cmd.json/out.json` içeriğini temizleyebilirsin.
- İstemiyorsan root başlatma: normal kullanıcı + gerekli işler için `sudo` NOPASSWD kuralı daha dar bir yetkidir.
- Düğümü kapatmak = yetkiyi kapatmak: `Ctrl+C` veya `sudo systemctl stop evrim-node`. Makine tamamen senin kontrolünde.

## Bus protokolü (meraklısına)

- `cmd.json` → `{id, komut, cwd?, ts}` (tarayıcı yazar)
- `out.json` → `{id, exit, stdout, stderr, ms, host, user, ts}` (düğüm yazar)
- Düğüm 3 sn'de bir ETag ile yoklar (ucuz); aynı `id` iki kez çalıştırılmaz.
- Zaman aşımı: komut başına 110 sn (öldürülür), tarayıcı tarafı 60 sn bekler.
- Uzun işler: `nohup komut > /var/log/is.log 2>&1 &` ile arka plana at, sonra logu oku.
