-- C2.1 Keanggotaan divisi pengguna — MURNI ADITIF: satu enum + satu tabel baru. Tidak menyentuh User, user_roles, atau data lama.
-- Tidak ada baris yang diisi di sini: keanggotaan produksi TIDAK diberikan otomatis; Admin/Owner mengaturnya sendiri.
CREATE TYPE "DivisiKeanggotaan" AS ENUM ('MARKETING', 'MANAGEMENT', 'HR_GA', 'PRODUCTION', 'WAREHOUSE', 'DELIVERY');

CREATE TABLE "user_divisions" (
    "id"         UUID                NOT NULL,
    "user_id"    TEXT                NOT NULL,
    "division"   "DivisiKeanggotaan" NOT NULL,
    "granted_by" TEXT,
    "created_at" TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_divisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_divisions_user_id_division_key" ON "user_divisions"("user_id", "division");
CREATE INDEX "user_divisions_division_idx" ON "user_divisions"("division");

ALTER TABLE "user_divisions" ADD CONSTRAINT "user_divisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_divisions" ADD CONSTRAINT "user_divisions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
