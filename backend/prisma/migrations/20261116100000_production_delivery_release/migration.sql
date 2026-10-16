-- ADMIN OVERRIDE: SIAP KIRIM SAAT PENCATATAN PRODUKSI BELUM SELESAI (16 Okt 2026, kasus RES-03102026-018-U1). Aditif: 2 kolom NULL pada production_runs_v2.
-- Semua baris yang ada tetap NULL (= tidak pernah di-override). Tanpa backfill, tanpa UPDATE/DELETE, tanpa perubahan perilaku untuk Run yang ada.
ALTER TABLE "production_runs_v2" ADD COLUMN "delivery_released_at" TIMESTAMP(3);
ALTER TABLE "production_runs_v2" ADD COLUMN "delivery_release" JSONB;
-- Kedua kolom harus terisi bersamaan atau kosong bersamaan (rekam audit keputusan override tidak boleh setengah).
ALTER TABLE "production_runs_v2" ADD CONSTRAINT "production_runs_v2_delivery_release_pair_chk" CHECK (("delivery_released_at" IS NULL) = ("delivery_release" IS NULL));
