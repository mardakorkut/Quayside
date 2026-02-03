FROM python:3.11-slim

WORKDIR /app

# Logları anlık görmek için gerekli ayar
ENV PYTHONUNBUFFERED=1

# Sistem gereksinimlerini yükle
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Önce kütüphaneleri yükle (Cache için)
COPY requirements.txt .
# Gunicorn yoksa bile garanti olsun diye ekliyoruz
RUN pip install --no-cache-dir -r requirements.txt && pip install gunicorn

# Tüm proje dosyalarını içeri at
COPY . .

# Instance klasörü oluştur
RUN mkdir -p instance

# Port ayarı (Google Cloud için)
ENV PORT=8080
EXPOSE 8080

# FastAPI ile çalıştır
CMD exec uvicorn app:app --host 0.0.0.0 --port $PORT
