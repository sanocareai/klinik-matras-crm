-- Sano Hub Phase 0 (2/2) — tabel user_roles + units, beserta backfill-nya.
--
-- ADITIF SEPENUHNYA. Tidak ada kolom yang dihapus, tidak ada arti kolom yang
-- berubah. Setelah migrasi ini jalan, 7 user existing dan seluruh alur CRM
-- harus berperilaku persis seperti sebelumnya. Lihat docs/sano-hub/PHASE-0.md.
--
-- Prasyarat: migrasi 20260731100000 (perluasan enum Role) SUDAH jalan.
--
-- Rollback manual bila perlu revert:
--   DROP TABLE "units"; DROP TABLE "user_roles";
--   DROP TYPE "UnitStatus"; DROP TYPE "ServiceLine";
--   (value enum "Role" yang sudah ditambahkan TIDAK bisa dihapus di Postgres —
--    itu tidak apa-apa, value yang tidak dipakai tidak berefek apa pun.)
--
-- KONVENSI YANG DIIKUTI (sengaja sama dengan migrasi lama, jangan "diperbaiki"):
--   - kolom id UUID TANPA default DB — Prisma yang membuat uuid di sisi klien
--     (@default(uuid())). Backfill di bawah karena itu mengisi id secara
--     eksplisit dengan gen_random_uuid().
--   - TIMESTAMP(3), BUKAN TIMESTAMPTZ. Seluruh database ini menyimpan UTC
--     polos dan mengkonversi ke WIB di tepi (lihat CLAUDE.md §11 dan
--     backend/src/utils/wib.js). Mencampur timestamptz di satu tabel saja
--     justru membuat perbandingan antar tabel jadi tidak konsisten.

-- ---------------------------------------------------------------------------
-- 1. user_roles — role jamak per user (D-010)
-- ---------------------------------------------------------------------------
-- "User"."role" yang lama SENGAJA TIDAK DIHAPUS di Phase 0. Seluruh kode yang
-- jalan sekarang masih membacanya. Kolom lama dimatikan belakangan, setelah
-- middleware otorisasi baru terbukti (pola strangler).

-- CreateTable
CREATE TABLE "user_roles" (
    "id"         UUID          NOT NULL,
    "user_id"    TEXT          NOT NULL,
    "role"       "Role"        NOT NULL,
    "granted_by" TEXT,
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_key" ON "user_roles"("user_id", "role");
CREATE INDEX "user_roles_role_idx" ON "user_roles"("role");

-- AddForeignKey
-- Cascade: user dihapus → baris role-nya ikut hilang (tidak ada nilai
-- historis pada "user X pernah punya role Y" setelah user-nya tiada).
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull, BUKAN Cascade: kalau admin pemberi role resign, role yang sudah
-- diberikan TETAP berlaku — cuma jejak pemberinya yang hilang.
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill mekanis murni: satu baris per user, persis dari "User"."role".
-- TIDAK menambah role apa pun yang belum dimiliki (mis. FINANCE untuk Gilang)
-- — pemberian role tambahan dilakukan lewat UI setelah middleware siap, biar
-- ada jejak siapa memberi apa. Migrasi tidak boleh diam-diam menaikkan hak
-- akses seseorang.
--
-- Hanya memakai value enum yang SUDAH ADA sebelum migrasi 20260731100000
-- (ADMIN, SALES), jadi aman dari batasan Postgres "unsafe use of new enum value".
INSERT INTO "user_roles" ("id", "user_id", "role")
SELECT gen_random_uuid(), "id", "role" FROM "User"
ON CONFLICT ("user_id", "role") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. units — entitas inti Sano Hub (D-002)
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ServiceLine" AS ENUM ('SERVICE', 'UPGRADE');

-- CreateEnum
-- Status KASAR saja. Posisi halus di dalam produksi dilacak oleh
-- current_stage_id + unit_stage_logs (menyusul di migrasi routing), BUKAN
-- oleh enum ini. Jangan menambah nilai per-tahap ke sini — itu tepat
-- anti-pattern "satu enum status untuk semuanya".
--
-- READY_ON_CUSTOMER_HOLD berdiri sendiri, terpisah dari READY_FOR_DELIVERY:
-- kasur sudah jadi tapi customer minta tunda kirim. Jamnya TIDAK boleh
-- dihitung sebagai keterlambatan kita (D-007).
CREATE TYPE "UnitStatus" AS ENUM (
    'AWAITING_PICKUP',
    'IN_TRANSIT_IN',
    'RECEIVED',
    'IN_PRODUCTION',
    'READY_FOR_DELIVERY',
    'READY_ON_CUSTOMER_HOLD',
    'IN_TRANSIT_OUT',
    'DELIVERED',
    'CANCELLED'
);

-- CreateTable
CREATE TABLE "units" (
    "id"               UUID          NOT NULL,
    "unit_code"        TEXT          NOT NULL,
    "order_id"         TEXT          NOT NULL,
    "seq"              INTEGER       NOT NULL,

    -- Deskripsi fisik PER UNIT — inilah inti D-002. Satu order bisa berisi
    -- satu queen dan satu king; hari ini merk/ukuran cuma ada satu, di level
    -- order, di dalam blob JSON "Order"."notes" (lihat D-012).
    "merk"             TEXT,
    "ukuran"           TEXT,

    -- Ditetapkan di tahap Uji Fondasi, bukan saat sales input order (D-008).
    -- NULL sampai unit benar-benar dibongkar dan diperiksa.
    "service_line"     "ServiceLine",

    "status"           "UnitStatus"  NOT NULL DEFAULT 'AWAITING_PICKUP',
    "storage_location" TEXT,

    "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_unit_code_key"    ON "units"("unit_code");
CREATE UNIQUE INDEX "units_order_id_seq_key" ON "units"("order_id", "seq");
CREATE INDEX        "units_order_id_idx"     ON "units"("order_id");
CREATE INDEX        "units_status_idx"       ON "units"("status");

-- AddForeignKey
-- RESTRICT, bukan Cascade: menghapus Order yang kasurnya masih dipegang
-- bengkel harus GAGAL KERAS, bukan menghapus jejak unit diam-diam. Pola yang
-- sama dengan Order → Customer. Lihat peringatan CLAUDE.md §5 soal tabel
-- Cascade yang datanya hilang tanpa error.
ALTER TABLE "units" ADD CONSTRAINT "units_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Backfill units dari order yang sudah ada
-- ---------------------------------------------------------------------------
-- Parser JSON yang aman. "Order"."notes" menyimpan
-- {merkKasur, ukuranKasur, keluhanCustomer} sebagai STRING JSON (lihat
-- buildNotes/parseNotes di frontend + mobile), TAPI baris lama berisi teks
-- polos (= keluhan saja). Cast `::jsonb` polos akan MELEDAK di baris lama,
-- jadi kegagalan parse harus menghasilkan NULL, bukan membatalkan migrasi.
-- pg_temp = fungsi sesi, hilang sendiri setelah migrasi selesai.
CREATE OR REPLACE FUNCTION pg_temp.safe_jsonb(t TEXT) RETURNS JSONB AS $$
BEGIN
    RETURN t::jsonb;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Satu unit per kasur, memakai "Order"."quantity" sebagai jumlah kasur.
-- GREATEST(...,1) menjaga order dengan quantity 0/NULL tetap dapat 1 unit.
--
-- unit_code: "<orderNumber>-U<n>". orderNumber NULLABLE (order lama hasil
-- import Excel tidak punya), jadi fallback ke "LEG-<8 char id order>" —
-- jujur menandai baris warisan, dan tetap unik karena id order unik.
-- Prefix order asli selalu RES-/SWS-/NEW-, tidak akan bentrok dengan LEG-.
INSERT INTO "units" (
    "id", "unit_code", "order_id", "seq", "merk", "ukuran", "status", "created_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    COALESCE(o."orderNumber", 'LEG-' || substr(o."id", 1, 8)) || '-U' || g.n,
    o."id",
    g.n,
    NULLIF(btrim(COALESCE(pg_temp.safe_jsonb(o."notes") ->> 'merkKasur',   '')), ''),
    NULLIF(btrim(COALESCE(pg_temp.safe_jsonb(o."notes") ->> 'ukuranKasur', '')), ''),
    CASE o."status"
        WHEN 'PENDING'    THEN 'AWAITING_PICKUP'
        WHEN 'PICKUP'     THEN 'IN_TRANSIT_IN'
        WHEN 'PROCESSING' THEN 'IN_PRODUCTION'
        WHEN 'READY'      THEN 'READY_FOR_DELIVERY'
        WHEN 'DELIVERED'  THEN 'DELIVERED'
        WHEN 'CANCELLED'  THEN 'CANCELLED'
        -- Jaring pengaman: kalau OrderStatus bertambah nilai baru dan CASE ini
        -- lupa diperbarui, jangan biarkan NULL menabrak NOT NULL dan
        -- menggagalkan seluruh migrasi di VPS.
        ELSE 'AWAITING_PICKUP'
    END::"UnitStatus",
    o."createdAt",
    o."updatedAt"
FROM "Order" o
CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(o."quantity", 1), 1)) AS g(n);

-- Laporan hasil backfill — muncul di output `prisma migrate deploy`.
-- Angka-angka ini yang dicocokkan dengan "definisi selesai" di PHASE-0.md,
-- jadi jangan dihapus supaya deploy bisa diverifikasi, bukan diasumsikan.
DO $$
DECLARE
    v_orders      BIGINT;
    v_units       BIGINT;
    v_multi       BIGINT;
    v_legacy_code BIGINT;
    v_no_merk     BIGINT;
    v_users       BIGINT;
    v_roles       BIGINT;
BEGIN
    SELECT count(*) INTO v_orders      FROM "Order";
    SELECT count(*) INTO v_units       FROM "units";
    SELECT count(*) INTO v_multi       FROM "Order" WHERE COALESCE("quantity", 1) > 1;
    SELECT count(*) INTO v_legacy_code FROM "units" WHERE "unit_code" LIKE 'LEG-%';
    SELECT count(*) INTO v_no_merk     FROM "units" WHERE "merk" IS NULL;
    SELECT count(*) INTO v_users       FROM "User";
    SELECT count(*) INTO v_roles       FROM "user_roles";

    RAISE NOTICE '--- Sano Hub Phase 0 backfill ---';
    RAISE NOTICE 'user: % -> baris user_roles: %  (HARUS sama)', v_users, v_roles;
    RAISE NOTICE 'order: %  -> unit: %', v_orders, v_units;
    RAISE NOTICE 'order dengan quantity > 1: % (jadi lebih dari 1 unit)', v_multi;
    RAISE NOTICE 'unit dengan kode warisan LEG-* (order tanpa orderNumber): %', v_legacy_code;
    RAISE NOTICE 'unit tanpa merk (notes bukan JSON / kosong): %', v_no_merk;

    IF v_users <> v_roles THEN
        RAISE EXCEPTION 'Backfill user_roles tidak lengkap: % user, % baris role', v_users, v_roles;
    END IF;
END $$;
