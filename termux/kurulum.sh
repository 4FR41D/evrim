#!/data/data/com.termux/files/usr/bin/bash
# EVRIM Termux hızlı kurulum — telefonda Linux ortamı (eğitim amaçlı)
# Kullanım: bash kurulum.sh   (veya: curl -sL https://raw.githubusercontent.com/4FR41D/evrim/main/termux/kurulum.sh | bash)
set -e
echo "📦 Paketler güncelleniyor…"
pkg update -y && pkg upgrade -y
echo "🧰 nodejs, git, python kuruluyor…"
pkg install -y nodejs-lts git python nano
echo "✅ Sürümler:"
node --version; git --version; python --version
echo "📥 EVRIM reposu klonlanıyor…"
[ -d evrim ] || git clone https://github.com/4FR41D/evrim
cd evrim && git pull || true
echo "🎉 Hazır! 'cd evrim' içindesin. Örnek: node -e \"console.log('merhaba linux')\""
