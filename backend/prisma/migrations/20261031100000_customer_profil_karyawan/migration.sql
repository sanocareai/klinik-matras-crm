-- Profil Customer INTERNAL per karyawan untuk Penjualan Karyawan → Order CRM — ADITIF: 1 kolom nullable, 1 indeks unik, 1 FK pada "Customer".
-- Tanpa UPDATE/DELETE/backfill: pelanggan yang ada TIDAK berubah (kolom NULL untuk semuanya). Identitas profil = "User"."id" (bukan nama/email); UNIQUE = satu profil per karyawan.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "staff_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_staff_user_id_key" ON "Customer"("staff_user_id");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
