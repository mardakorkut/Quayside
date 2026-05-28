# Quayside
Denizcilik brokerlari ve operasyon ekipleri icin gelistirilmis, AIS verisini gercek zamanli goruntuleyen ve gemi takibini tek panelde yoneten akilli takip platformu.

Canli: https://quayside.onrender.com

---

## Ozellikler
- AISStream uzerinden canli gemi verisi akisi
- Harita uzerinde gemi konumlari ve filtreleme
- Kullanici girisi ve takip listesi yonetimi
- Gemi notlari ve detay modal gorunumu
- WebSocket ile anlik guncellemeler

---

## Teknik Altyapi
- Backend: Python / FastAPI
- Gercek zamanli iletisim: WebSocket
- Veri katmani: SQLAlchemy (local SQLite, opsiyonel Postgres)
- Harita ve UI: Vanilla JS + Leaflet

---

## Proje Yapisi
```text
Quayside/
├── app.py
├── config.py
├── src/
│   ├── routes/
│   ├── services/
│   ├── models/
│   ├── auth.py
│   └── database.py
├── static/
│   ├── js/
│   └── css/
├── templates/
├── requirements.txt
├── .env.example
└── README.md
```

---

## Kurulum (Local)
```bash
git clone https://github.com/mardakorkut/Quayside.git
cd Quayside
py -3.12 -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

---

## Calistirma
```bash
python -m uvicorn app:app --host 0.0.0.0 --port 5000
```

---

## Environment Degiskenleri
Zorunlu:
- SECRET_KEY
- AISSTREAM_API_KEY
- CORS_ORIGINS

Onerilen:
- ENV=production
- LOG_LEVEL=INFO

Ornek:
```ini
ENV=production
SECRET_KEY=replace-with-strong-secret
AISSTREAM_API_KEY=your-aisstream-key
CORS_ORIGINS=https://quayside.onrender.com
LOG_LEVEL=INFO
```

Not:
- PORT Render tarafinda otomatik verilir, ayarlaman gerekmez.

---

## Deploy (Render)
1) Render panelinde servis ayarlarini acin.
2) Environment sekmesine girip yukaridaki degiskenleri ekleyin.
3) Manual Deploy -> Deploy latest commit.

---

## Gelistirici
**Muhammed Arda Korkut**
