-- D-077 (4 September 2026) — satukan skema penugasan driver+helper+kendaraan.
-- Laporan owner: driver+helper+kendaraan dulu ditugaskan 2 skema terpisah
-- (langsung per-job di Penjadwalan, ATAU per-rute di Route Planner) yang
-- bisa saling menimpa diam-diam. Route.helperId melengkapi Route.driverId/
-- vehicleId yang sudah ada, supaya Route jadi otoritas PENUH begitu job
-- masuk rute (lihat POST /routes/:id/publish yang sekarang ikut menyalin
-- helperId ke job, sama seperti driverId/vehicleId).
ALTER TABLE "routes" ADD COLUMN "helper_id" TEXT;

ALTER TABLE "routes" ADD CONSTRAINT "routes_helper_id_fkey"
    FOREIGN KEY ("helper_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
