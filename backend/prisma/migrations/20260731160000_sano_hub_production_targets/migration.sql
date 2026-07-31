-- Sano Hub Phase 1 — target produksi harian (D-014).
--
-- Kepala produksi menetapkan pagi hari: unit mana saja yang dikerjakan hari
-- ini. Sebelum tutup, hasilnya di-update. Tabel ini yang membuat pertanyaan
-- "target hari ini tercapai berapa persen?" bisa dijawab — tanpa ini, yang
-- tersimpan cuma "apa yang terjadi", bukan "apa yang DIRENCANAKAN terjadi".
--
-- Targetnya per UNIT, bukan per order: satu order hotel 15 kasur tidak selalu
-- dikerjakan sekaligus dalam satu hari (D-002/D-006). UI tetap boleh
-- menampilkan & memilih per order — itu urusan tampilan, bukan model data.
--
-- BUKAN ledger append-only: target boleh dibatalkan/dihapus di hari yang sama
-- (salah pilih itu wajar, dan tidak ada nilai audit pada "pernah salah pilih
-- target lalu dibatalkan 2 menit kemudian"). Yang append-only tetap
-- unit_stage_logs — hasil kerja sebenarnya.
--
-- Rollback manual:
--   DROP TABLE "production_targets";

CREATE TABLE "production_targets" (
    "id"          UUID         NOT NULL,

    -- DATE polos, bukan timestamp: ini "hari kerja", bukan instant. Rentang
    -- WIB-nya diterjemahkan di tepi seperti biasa (backend/src/utils/wib.js).
    "target_date" DATE         NOT NULL,

    "unit_id"     UUID         NOT NULL,
    "created_by"  TEXT,
    "note"        TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Satu unit hanya boleh muncul SEKALI di target hari yang sama.
CREATE UNIQUE INDEX "production_targets_target_date_unit_id_key" ON "production_targets"("target_date", "unit_id");
-- Papan harian: "apa target hari ini" — pola akses paling sering.
CREATE INDEX "production_targets_target_date_idx" ON "production_targets"("target_date");
CREATE INDEX "production_targets_unit_id_idx" ON "production_targets"("unit_id");

-- AddForeignKey
-- Cascade dari Unit: target tidak bermakna tanpa unitnya. (Unit sendiri
-- RESTRICT dari Order, jadi unit nyaris tidak pernah benar-benar dihapus.)
ALTER TABLE "production_targets" ADD CONSTRAINT "production_targets_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull: kepala produksi resign, riwayat targetnya TETAP ada.
ALTER TABLE "production_targets" ADD CONSTRAINT "production_targets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
