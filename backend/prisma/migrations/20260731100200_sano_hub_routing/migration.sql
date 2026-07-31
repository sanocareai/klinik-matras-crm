-- Sano Hub Phase 0 (3/3) — master data routing produksi.
--
-- Sumber kebenaran isinya: docs/sano-hub/ROUTING.md. Kalau file itu dan seed
-- di bawah berbeda, ROUTING.md yang benar dan seed ini yang salah.
--
-- ATURAN INTI (D-003): tahap produksi adalah DATA, bukan kode. Enam layanan
-- TIDAK dimodelkan sebagai enam routing template — satu tulang punggung tetap
-- (intake → modul → finishing) dengan modul kerja yang dipilih per unit.
-- Layanan ketujuh nanti = satu baris data, bukan template baru.
--
-- Rollback manual:
--   ALTER TABLE "units" DROP COLUMN "service_id", DROP COLUMN "current_stage_id";
--   DROP TABLE "service_catalog_modules"; DROP TABLE "service_catalog";
--   DROP TABLE "routing_stages"; DROP TYPE "StagePhase";

-- CreateEnum
-- Fase menentukan urutan besar. INTAKE selalu dulu, MODULE di tengah (0..n,
-- dipilih per unit), FINISH selalu terakhir. `sequence` mengurutkan DI DALAM
-- fase, bukan lintas fase.
CREATE TYPE "StagePhase" AS ENUM ('INTAKE', 'MODULE', 'FINISH');

-- CreateTable
CREATE TABLE "routing_stages" (
    "id"                        UUID          NOT NULL,
    "code"                      TEXT          NOT NULL,
    "label_id"                  TEXT          NOT NULL, -- label bahasa Indonesia untuk UI
    "phase"                     "StagePhase"  NOT NULL,
    "sequence"                  INTEGER       NOT NULL,

    -- NULL = tahap berlaku untuk KEDUA lini. Diisi hanya kalau tahap itu
    -- eksklusif milik satu lini (mis. Tambah Busa cuma ada di SERVICE).
    "service_line"              "ServiceLine",

    "is_optional"               BOOLEAN       NOT NULL DEFAULT false,

    -- Foto adalah produknya: bukti QC, pembelaan sengketa, baseline garansi,
    -- sekaligus materi marketing. Wajib di titik-titik yang tidak bisa
    -- diulang (sebelum bongkar, bongkar, uji, jahit corner, finish).
    "requires_photo"            BOOLEAN       NOT NULL DEFAULT false,

    -- Pakai FLAG ini di kode, JANGAN `if (stage.code === 'fit_test')`.
    "requires_qc"               BOOLEAN       NOT NULL DEFAULT false,

    -- SENGAJA NULL di seed. Jangan ditebak — isi dari data unit_stage_logs
    -- nyata setelah beberapa minggu, lalu pakai untuk proyeksi tanggal janji.
    "expected_duration_minutes" INTEGER,

    "required_role"             "Role",
    "active"                    BOOLEAN       NOT NULL DEFAULT true,
    "created_at"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routing_stages_code_key" ON "routing_stages"("code");
CREATE INDEX "routing_stages_phase_sequence_idx" ON "routing_stages"("phase", "sequence");

-- CreateTable
CREATE TABLE "service_catalog" (
    "id"           UUID          NOT NULL,
    "code"         TEXT          NOT NULL,
    "label_id"     TEXT          NOT NULL,
    "service_line" "ServiceLine" NOT NULL,
    "active"       BOOLEAN       NOT NULL DEFAULT true,
    "sort_order"   INTEGER       NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_catalog_code_key" ON "service_catalog"("code");

-- CreateTable
-- Modul kerja yang dipakai sebuah layanan, beserta urutannya.
CREATE TABLE "service_catalog_modules" (
    "id"         UUID         NOT NULL,
    "service_id" UUID         NOT NULL,
    "stage_id"   UUID         NOT NULL,
    "sequence"   INTEGER      NOT NULL,

    -- CATATAN: bahwa stage_id HARUS berfase MODULE tidak dipaksakan di level
    -- kolom. Sempat dirancang pakai generated column + composite FK, tapi
    -- Prisma tidak memodelkan generated column — hasilnya drift permanen yang
    -- membuat `prisma migrate dev` selalu minta migrasi tambahan. Untuk repo
    -- yang dirawat satu orang, itu ongkos harian yang lebih mahal daripada
    -- masalah yang dicegahnya.
    -- Gantinya: pemeriksaan di blok verifikasi bawah (gagal keras saat migrasi)
    -- + validasi di aplikasi kalau nanti katalog bisa diedit lewat UI.

    CONSTRAINT "service_catalog_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_catalog_modules_service_id_stage_id_key" ON "service_catalog_modules"("service_id", "stage_id");
CREATE INDEX "service_catalog_modules_service_id_idx" ON "service_catalog_modules"("service_id");

-- AddForeignKey
-- Cascade: layanan dihapus dari katalog → pemetaan modulnya ikut hilang.
ALTER TABLE "service_catalog_modules" ADD CONSTRAINT "service_catalog_modules_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_catalog_modules" ADD CONSTRAINT "service_catalog_modules_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — sambungkan units ke routing (kolom ini sengaja ditunda dari
-- migrasi 20260731100100 sampai tabel tujuannya ada).
ALTER TABLE "units"
    ADD COLUMN "current_stage_id" UUID,
    ADD COLUMN "service_id"       UUID;

-- AddForeignKey
-- RESTRICT dua-duanya: tahap atau layanan yang masih dipakai unit hidup tidak
-- boleh dihapus diam-diam.
ALTER TABLE "units" ADD CONSTRAINT "units_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "routing_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "units" ADD CONSTRAINT "units_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "units_current_stage_id_idx" ON "units"("current_stage_id");

-- ---------------------------------------------------------------------------
-- SEED — tahap produksi (ROUTING.md §2)
-- ---------------------------------------------------------------------------
-- Idempotent lewat ON CONFLICT (code): aman kalau migrasi diulang di DB yang
-- sudah pernah terisi sebagian.

INSERT INTO "routing_stages"
    ("id", "code", "label_id", "phase", "sequence", "service_line", "is_optional", "requires_photo", "requires_qc", "required_role")
VALUES
    -- INTAKE — selalu dilalui, berurutan
    (gen_random_uuid(), 'pre_teardown_test', 'Uji Sebelum Bongkar', 'INTAKE', 1, NULL, false, true,  false, 'PRODUCTION_WORKER'),
    (gen_random_uuid(), 'teardown',          'Bongkar',             'INTAKE', 2, NULL, false, true,  false, 'PRODUCTION_WORKER'),
    -- Titik keputusan lini & modul (D-008). Bukan sales yang menentukan ini.
    (gen_random_uuid(), 'foundation_test',   'Uji Fondasi',         'INTAKE', 3, NULL, false, true,  false, 'PRODUCTION_LEAD'),
    (gen_random_uuid(), 'diagnosis',         'Diagnosa',            'INTAKE', 4, NULL, false, false, false, 'PRODUCTION_LEAD'),

    -- MODULE — dipilih per unit. sequence = urutan fisik membangun kasur:
    -- fondasi (10) → lapisan (20) → kain (30).
    (gen_random_uuid(), 'foundation_service',    'Service Fondasi',      'MODULE', 10, 'SERVICE', false, false, false, 'PRODUCTION_WORKER'),
    (gen_random_uuid(), 'foundation_upgrade',    'Upgrade Fondasi',      'MODULE', 10, 'UPGRADE', false, true,  false, 'PRODUCTION_WORKER'),
    (gen_random_uuid(), 'foam_addition',         'Tambah Busa',          'MODULE', 20, 'SERVICE', false, false, false, 'PRODUCTION_WORKER'),
    (gen_random_uuid(), 'comfort_layer_upgrade', 'Upgrade Lapisan Atas', 'MODULE', 20, 'UPGRADE', false, true,  false, 'PRODUCTION_WORKER'),
    -- Kain dipakai kedua lini; grade kainnya yang berbeda, bukan tahapnya.
    (gen_random_uuid(), 'cover_replacement',     'Ganti Kain',           'MODULE', 30, NULL,      false, false, false, 'PRODUCTION_WORKER'),

    -- FINISH — selalu dilalui, berurutan
    -- fit_test: GERBANG. Perakitan termasuk di sini (cepat, tidak dilacak
    -- terpisah); yang krusial uji tekstur terhadap berat badan pemakai (D-005).
    (gen_random_uuid(), 'fit_test',      'Uji Berat Badan',    'FINISH', 1, NULL, false, true, true,  'QC_LEAD'),
    -- Setelah corner dijahit, membuka lagi mahal — karena itu QC di depannya.
    (gen_random_uuid(), 'corner_sewing', 'Jahit Corner',       'FINISH', 2, NULL, false, true, false, 'PRODUCTION_WORKER'),
    (gen_random_uuid(), 'finished',      'Finish / Siap Kirim','FINISH', 3, NULL, false, true, false, 'PRODUCTION_WORKER')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- SEED — katalog layanan (ROUTING.md §3)
-- ---------------------------------------------------------------------------
INSERT INTO "service_catalog" ("id", "code", "label_id", "service_line", "sort_order")
VALUES
    (gen_random_uuid(), 'SVC_FONDASI',         'Service Fondasi Matras Sehat',        'SERVICE', 10),
    (gen_random_uuid(), 'SVC_FULL',            'Full Service',                        'SERVICE', 20),
    (gen_random_uuid(), 'UPG_LAPISAN',         'Upgrade Lapisan Atas Matras Sehat',   'UPGRADE', 30),
    (gen_random_uuid(), 'UPG_FONDASI',         'Paket Upgrade Fondasi (150kg)',       'UPGRADE', 40),
    (gen_random_uuid(), 'UPG_FONDASI_LAPISAN', 'Paket Upgrade Fondasi + Lapisan',     'UPGRADE', 50),
    (gen_random_uuid(), 'UPG_FULL',            'Full Upgrade (Fondasi + Lapisan + Kain)', 'UPGRADE', 60)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- SEED — pemetaan layanan → modul
-- ---------------------------------------------------------------------------
-- Ditulis pakai kode (bukan UUID hardcode) supaya terbaca dan cocok dengan
-- tabel di ROUTING.md §3. Enam layanan, lima modul.
INSERT INTO "service_catalog_modules" ("id", "service_id", "stage_id", "sequence")
SELECT gen_random_uuid(), sc."id", rs."id", m."seq"
FROM (VALUES
    ('SVC_FONDASI',         'foundation_service',    1),

    ('SVC_FULL',            'foundation_service',    1),
    ('SVC_FULL',            'foam_addition',         2),
    ('SVC_FULL',            'cover_replacement',     3),

    ('UPG_LAPISAN',         'comfort_layer_upgrade', 1),

    ('UPG_FONDASI',         'foundation_upgrade',    1),

    ('UPG_FONDASI_LAPISAN', 'foundation_upgrade',    1),
    ('UPG_FONDASI_LAPISAN', 'comfort_layer_upgrade', 2),

    ('UPG_FULL',            'foundation_upgrade',    1),
    ('UPG_FULL',            'comfort_layer_upgrade', 2),
    ('UPG_FULL',            'cover_replacement',     3)
) AS m("service_code", "stage_code", "seq")
JOIN "service_catalog" sc ON sc."code" = m."service_code"
JOIN "routing_stages"  rs ON rs."code" = m."stage_code"
ON CONFLICT ("service_id", "stage_id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verifikasi seed — gagal keras kalau tidak sesuai ROUTING.md
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_stages   BIGINT;
    v_services BIGINT;
    v_modules   BIGINT;
    v_bad_line  BIGINT;
    v_bad_phase BIGINT;
BEGIN
    SELECT count(*) INTO v_stages   FROM "routing_stages";
    SELECT count(*) INTO v_services FROM "service_catalog";
    SELECT count(*) INTO v_modules  FROM "service_catalog_modules";

    -- Lini modul harus cocok dengan lini layanannya, ATAU modul itu netral
    -- (service_line NULL, mis. Ganti Kain). Mencampur lini dilarang (D-004).
    SELECT count(*) INTO v_bad_line
    FROM "service_catalog_modules" scm
    JOIN "service_catalog" sc ON sc."id" = scm."service_id"
    JOIN "routing_stages"  rs ON rs."id" = scm."stage_id"
    WHERE rs."service_line" IS NOT NULL
      AND rs."service_line" <> sc."service_line";

    -- Hanya tahap berfase MODULE yang boleh jadi modul layanan (pengganti
    -- composite FK yang dibatalkan — lihat catatan di service_catalog_modules).
    SELECT count(*) INTO v_bad_phase
    FROM "service_catalog_modules" scm
    JOIN "routing_stages" rs ON rs."id" = scm."stage_id"
    WHERE rs."phase" <> 'MODULE';

    RAISE NOTICE '--- Sano Hub seed routing ---';
    RAISE NOTICE 'tahap: %, layanan: %, pemetaan modul: %', v_stages, v_services, v_modules;

    IF v_bad_phase > 0 THEN
        RAISE EXCEPTION 'Ada % tahap non-MODULE yang didaftarkan sebagai modul layanan', v_bad_phase;
    END IF;

    IF v_stages <> 12 THEN
        RAISE EXCEPTION 'Seed tahap salah: % (harus 12)', v_stages;
    END IF;
    IF v_services <> 6 THEN
        RAISE EXCEPTION 'Seed layanan salah: % (harus 6)', v_services;
    END IF;
    IF v_modules <> 11 THEN
        RAISE EXCEPTION 'Seed pemetaan modul salah: % (harus 11)', v_modules;
    END IF;
    IF v_bad_line > 0 THEN
        RAISE EXCEPTION 'Ada % pemetaan modul yang lininya bertabrakan dengan lini layanan (D-004)', v_bad_line;
    END IF;
END $$;
