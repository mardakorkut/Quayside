# Quayside 🚢🌍

Deniz trafiğini ve gemi hareketlerini anlık olarak izlemek, işlemek ve yönetmek için tasarlanmış, yüksek performanslı ve modern bir **FastAPI** tabanlı backend projesidir. Gerçek zamanlı veri akışı, güçlü kimlik doğrulama mekanizmaları ve konteynerleştirilmiş mimarisi ile prodüksiyon ortamına hazır bir yapı sunar.

🔗 **Canlı Demo:** [quayside.onrender.com](https://quayside.onrender.com)
🟢 **Durum:** Yayında (Production) / Aktif Geliştirme

## ✨ Öne Çıkan Özellikler

* **Yüksek Performanslı REST API:** FastAPI ile asenkron (async/await) mimari üzerine kurulu hızlı endpoint'ler.
* **Gerçek Zamanlı Veri Akışı:** Gemi konumları ve durum güncellemeleri için **WebSockets** entegrasyonu.
* **Güvenli Kimlik Doğrulama (Auth):** `JWT (JSON Web Tokens)`, `passlib` (bcrypt) ve `python-jose` ile güçlendirilmiş kullanıcı kayıt/giriş ve yetkilendirme sistemi.
* **Sağlam Veri Modelleme:** `SQLAlchemy` ORM ve veri doğrulama için en güncel `Pydantic v2` standartları.
* **Konteynerizasyon & Dağıtım:** Geliştirme ve yayına alma (deployment) süreçlerini standartlaştıran **Docker** ve **Uvicorn** konfigürasyonu.

## 🛠️ Teknik Altyapı ve Teknolojiler

* **Backend Framework:** Python / FastAPI (Tamamen asenkron, yüksek hızlı)
* **ASGI Sunucu:** Uvicorn
* **Veritabanı & ORM:** SQLAlchemy
* **Veri Doğrulama:** Pydantic (v2.10.6)
* **Güvenlik & Kriptografi:** Python-Jose, Passlib, Cryptography
* **Real-Time İletişim:** WebSockets
* **Dağıtım / Altyapı:** Docker, Render, Google Cloud Services

## 📸 Ekran Görüntüleri

*(Projenin web arayüzü veya API dokümantasyonu görselleri buraya eklenecektir)*

## 📂 Proje Yapısı (Folder Structure)

```text
Quayside/
├── src/                     # Güvenlik, veritabanı ve auth (kimlik doğrulama) servisleri
├── static/                  # İstemci tarafı dosyaları (CSS, JS)
├── templates/               # Frontend şablonları (HTML)
├── app.py                   # FastAPI uygulama giriş noktası (Entrypoint)
├── config.py                # Konfigürasyon ve ortam ayarları
├── Dockerfile               # Docker imaj yapılandırması
├── .env.example             # Çevresel değişkenlerin şablonu (Gizli veriler hariç)
├── .gitignore               # Güvenlik için repoya dahil edilmeyen dosyalar
└── requirements.txt         # Proje bağımlılıkları
```
*(Not: Sunucuya ve lokale özel `.venv`, `__pycache__`, lokal veritabanı dosyaları ve `.env` gibi kritik dosyalar güvenlik mimarisi gereği repoya dahil edilmemiştir.)*

## 🚀 Kurulum ve Çalıştırma (Local Setup)

Projeyi kendi bilgisayarınızda (local) çalıştırmak için aşağıdaki adımları izleyebilirsiniz.

**1. Repoyu Klonlayın ve Sanal Ortam Oluşturun**
```bash
git clone [https://github.com/mardakorkut/Quayside.git](https://github.com/mardakorkut/Quayside.git)
cd Quayside
python -m venv .venv
```

Windows için:
```bash
.venv\Scripts\activate
```

MacOS/Linux için:
```bash
source .venv/bin/activate
```

**2. Gerekli Kütüphaneleri Yükleyin:**
```bash
pip install -r requirements.txt
```

**3. Çevresel Değişkenleri (Environment Variables) Ayarlayın:**
Proje ana dizininde bulunan `.env.example` dosyasının adını `.env` olarak değiştirin ve içindeki anahtarı kendi sisteminize göre doldurun:
```text
# .env dosyası
SECRET_KEY=your_super_secret_key_here
```

**4. Uygulamayı Başlatın:**
FastAPI sunucusunu başlatmak için Uvicorn kullanın:
```bash
uvicorn app:app --reload
```
Uygulama varsayılan olarak `http://127.0.0.1:8000` adresinde çalışacaktır. API dokümantasyonuna (Swagger UI) `http://127.0.0.1:8000/docs` adresinden erişebilirsiniz.

**🐳 Docker ile Çalıştırma (Opsiyonel):**
Projeyi Docker container üzerinde ayağa kaldırmak için:
```bash
docker build -t quayside-app .
docker run -p 8000:8000 quayside-app
```

---

## 👨‍💻 Geliştirici

**Muhammed Arda Korkut**
Computer Engineering Student & Backend Developer
