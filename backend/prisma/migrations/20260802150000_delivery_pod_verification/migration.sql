-- Delivery Tahap 4 — verifikasi Proof of Delivery.
--
-- Job SUDAH menyimpan proofPhotoUrls[] & signatureUrl (diisi driver saat
-- menyelesaikan job) sejak Phase 2 — tapi tidak ada tempat mencatat apakah
-- admin/dispatcher sudah MENINJAU bukti itu. Tanpa ini, "sudah diverifikasi"
-- tidak bisa dibedakan dari "belum pernah dilihat siapa pun".
--
-- AMAN dilakukan sekarang: `jobs` masih KOSONG (0 baris, diverifikasi
-- langsung di production sebelum migrasi ini ditulis) — sama seperti alasan
-- migrasi Vehicle/Route sebelumnya.
--
-- ADITIF MURNI: 1 enum + 4 kolom NULLABLE di `jobs`. Kolom lama tidak
-- disentuh. `podStatus` NULL bukan berarti "ditolak" — turunan "Belum
-- Lengkap" vs "Menunggu Verifikasi" dihitung di frontend dari ada-tidaknya
-- proofPhotoUrls, supaya tidak ada dua sumber kebenaran soal itu.

-- CreateEnum
CREATE TYPE "PodStatus" AS ENUM ('VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "pod_status"          "PodStatus";
ALTER TABLE "jobs" ADD COLUMN "pod_verified_by"     TEXT;
ALTER TABLE "jobs" ADD COLUMN "pod_verified_at"     TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "pod_rejection_note"  TEXT;

CREATE INDEX "jobs_pod_status_idx" ON "jobs"("pod_status");

-- SetNull: reviewer resign, riwayat verifikasi POD TETAP ada — pola yang
-- sama dengan seluruh aktor lain di sistem (unit_stage_logs, routes, dst).
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pod_verified_by_fkey"
    FOREIGN KEY ("pod_verified_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
