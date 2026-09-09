-- Koreksi Admin atas Proof of Delivery yang sudah tersimpan (9 September
-- 2026, laporan owner: "ketika proof of delivery sudah di input buat fitur
-- edit khusus admin, karna namanya sistem baru, pasti karyawan masih banyak
-- salah"). Sebelumnya foto/waktu selesai/driver-helper yang SUDAH tersimpan
-- tidak bisa dikoreksi lagi -- cuma bisa DITAMBAH foto baru (proof-photos
-- endpoint, push bukan replace).
--
-- ADITIF MURNI: 4 kolom NULLABLE di `jobs`, pola PERSIS sama dengan
-- pod_verified_by/pod_verified_at/pod_rejection_note (migrasi
-- 20260802150000_delivery_pod_verification).

ALTER TABLE "jobs" ADD COLUMN "pod_edited_by"     TEXT;
ALTER TABLE "jobs" ADD COLUMN "pod_edited_at"      TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "pod_edit_reason"    TEXT;

-- SetNull: admin yang mengedit resign, riwayat edit POD TETAP ada -- pola
-- sama dengan jobs_pod_verified_by_fkey.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pod_edited_by_fkey"
    FOREIGN KEY ("pod_edited_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
