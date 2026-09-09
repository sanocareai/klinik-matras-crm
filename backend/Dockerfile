FROM node:20-slim
WORKDIR /app

# zip (9 September 2026) — dipakai scripts/publish-driver-bundle.js (OTA
# self-hosted APK Driver) utk mem-zip frontend/dist-driver sebelum
# di-publish. Dijalankan via `docker compose exec backend node scripts/
# publish-driver-bundle.js --apply`, sama pola dengan seed-toll-roads.js.
RUN apt-get update -y && apt-get install -y openssl ffmpeg zip && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

EXPOSE 4000
# Jalankan migrate deploy dulu sebelum server start, supaya kolom baru otomatis dibuat
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
