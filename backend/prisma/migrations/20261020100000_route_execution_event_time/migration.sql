-- Histori waktu rute/stop: kolom aditif pada ledger eksekusi yang sudah ada (tanpa tabel baru, tanpa backfill).
ALTER TABLE "delivery_execution_events"
  ADD COLUMN "occurred_at" TIMESTAMP(3),
  ADD COLUMN "source" TEXT,
  ADD COLUMN "time_quality" TEXT;
