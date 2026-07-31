-- Sano Hub Phase 1 (2/2) — verdict Uji Berat Badan (D-005, ROUTING.md §4).
--
-- TERPISAH dari unit_stage_logs yang generik: verdict punya bentuk sendiri
-- (keras/pas/empuk, berat acuan, override customer) yang tidak masuk akal
-- dipaksakan ke kolom generik "note" milik ledger tahap biasa.
--
-- CATATAN LIABILITY (D-009): kalau customer memaksa preferensi yang menyimpang
-- dari rekomendasi berat badan, itu WAJIB tercatat BESERTA bukti edukasi yang
-- diberikan — bukan preferensi biasa, ini pembelaan garansi. Aturan itu
-- dipaksakan CHECK constraint di database, bukan cuma validasi di kode
-- aplikasi yang bisa diam-diam terlewat.

CREATE TYPE "FitVerdict" AS ENUM ('TERLALU_KERAS', 'PAS', 'TERLALU_EMPUK');
CREATE TYPE "PreferenceOverride" AS ENUM ('LEBIH_KERAS', 'LEBIH_EMPUK');

CREATE TABLE "qc_fit_tests" (
    "id"                          UUID          NOT NULL,
    "unit_id"                     UUID          NOT NULL,
    "stage_id"                    UUID          NOT NULL,
    "verdict"                     "FitVerdict"  NOT NULL,
    "reference_weight_kg"         INTEGER       NOT NULL,

    -- NULL = customer terima hasil uji apa adanya.
    "customer_preference_override" "PreferenceOverride",

    -- WAJIB true kalau override terisi — dipaksakan CHECK di bawah, bukan
    -- sekadar konvensi kode.
    "education_given"             BOOLEAN       NOT NULL DEFAULT false,

    "tested_by_id"                TEXT,
    "note"                        TEXT,
    "created_at"                  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_fit_tests_pkey" PRIMARY KEY ("id"),

    -- D-009: override tanpa edukasi tercatat = data liability yang cacat.
    -- Database menolaknya, bukan cuma UI yang "seharusnya" mencegahnya.
    CONSTRAINT "qc_fit_tests_override_requires_education" CHECK (
        "customer_preference_override" IS NULL OR "education_given" = true
    )
);

-- CreateIndex
CREATE INDEX "qc_fit_tests_unit_id_created_at_idx" ON "qc_fit_tests"("unit_id", "created_at");

-- AddForeignKey
-- Cascade dari Unit — konsisten dengan pola unit_stage_logs.
ALTER TABLE "qc_fit_tests" ADD CONSTRAINT "qc_fit_tests_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_fit_tests" ADD CONSTRAINT "qc_fit_tests_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull: QC Leader resign, riwayat putusannya TETAP ada.
ALTER TABLE "qc_fit_tests" ADD CONSTRAINT "qc_fit_tests_tested_by_id_fkey" FOREIGN KEY ("tested_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
