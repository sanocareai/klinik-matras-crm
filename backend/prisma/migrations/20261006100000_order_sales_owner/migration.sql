-- Pemilik Sales order yang STABIL (Rekonsiliasi Sales-Finance, 30 Sep 2026): kolom ADITIF nullable, tanpa backfill (data lama tetap memakai atribusi percakapan).
-- Tanpa FK/indeks sengaja (skrip rilis hanya mengizinkan ADD COLUMN); validitas pemilik dijaga di aplikasi (services/salesOwner.js).
ALTER TABLE "Order" ADD COLUMN "sales_owner_id" TEXT;
