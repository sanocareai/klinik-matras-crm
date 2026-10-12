-- PEMISAHAN PIC PRODUKSI: PIC Meja Bongkar vs PIC Corner & Finishing (Okt 2026).
-- MIGRASI ADITIF: satu kolom array pada production_operators, BERMULA KOSONG untuk semua baris (lama maupun baru).
-- TIDAK ADA backfill, TIDAK ADA UPDATE berbasis nama/akun/peran. Penetapan "siapa boleh jadi PIC lini mana" dilakukan eksplisit oleh Admin lewat Pengaturan Operator.
-- Nilai yang sah: 'TABLE' (Meja Bongkar) dan 'CORNER' (Corner & Finishing). Kosong = operator tidak ditawarkan sebagai PIC Meja maupun PIC Corner (PIC Bahan tidak terpengaruh).
ALTER TABLE "production_operators" ADD COLUMN "work_lanes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "production_operators" ADD CONSTRAINT "production_operators_work_lanes_valid" CHECK ("work_lanes" <@ ARRAY['TABLE','CORNER']::TEXT[]);
