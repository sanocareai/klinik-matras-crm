# SOP — Production V2: writer OFF → aksi V1 pada Run aktif → writer ON

Berlaku sejak P12B.7 (`f752edb4`). Hanya dokumen; tidak mengubah kode atau flag.

## Aturan inti

- **Kepemilikan V2** atas sebuah unit = flag `production_v2_writer` aktif untuk unit itu **dan** unit punya Production Run non-terminal
  (`PENDING_ARRIVAL`, `ACTIVE`, `BLOCKED`). Satu fungsi (`isUnitV2ExecutionOwned`, `backend/src/services/unitV2Ownership.js`) dipakai engine tahap V1 dan
  semua endpoint V1 (layanan, prioritas/target, rute, penugasan, bahan, tahap, QC).
- Unit **dimiliki V2** → semua jalur V1 ditolak `409 UNIT_V2_OWNED`.
- Unit **tidak dimiliki V2** (writer OFF, reader-only, cohort tanpa Run, Run terminal) → jalur V1 bekerja (tab "Kerja V1" di drawer Unit 360).
- Kunci unit: gerbang V1 dan pembuka Run V2 memegang kunci baris unit yang sama. V1 yang tiba saat Run sedang dibuka menunggu lalu ditolak; kalah lomba
  SERIALIZABLE dijawab `409 UNIT_CONCURRENT_CHANGE` tanpa tulisan.

## Skenario yang berbahaya: writer OFF → aksi V1 → writer ON

1. Writer dimatikan (rollback darurat) saat sebuah unit masih punya Run non-terminal.
2. Pekerja memakai tab "Kerja V1" (tahap, QC, bahan, penugasan, layanan, prioritas).
3. **Setiap aksi V1 yang berhasil** pada unit itu menulis satu baris `activity_events` bertipe `PRODUCTION_V1_WRITE_ON_V2_RUN`
   (`entity_id` = unit, `metadata.runId` = Run) dalam transaksi yang sama dengan mutasinya. Aksi yang gagal tidak meninggalkan penanda.
4. Writer dinyalakan kembali → **seluruh command V2 pada Run itu berhenti** dengan `409 PRODUCTION_RUN_V1_DRIFT`:
   langkah tahap (Meja/Corner), rencana & BOM, Material Issue (request/pick/cancel), diagnosis, dan gerbang QC/custody. Proyeksi V2 tidak berubah.
   Unit 360 menampilkan peringatan merah dengan jumlah aksi V1; tab "Kerja V1" tidak ditawarkan lagi (V2 memiliki unit lagi).
5. Alasannya: proyeksi V2 (operasi, Planned BOM, reservasi, rencana) tidak lagi dijamin sama dengan state V1. Melanjutkan state lama diam-diam dilarang.

**Pemulihan resmi satu-satunya saat ini:** Production Lead membatalkan Run (`POST /api/production-planning/qc/runs/:runId/cancel`,
body `{ expectedRevision, reason }`, header `Idempotency-Key`). Command itu sengaja tidak memakai gerbang drift. Setelah Run `CANCELLED`, unit tidak
dimiliki V2 → V1 bekerja; Run baru dibuka lewat alur custody/rework yang sah.

**Belum ada:** "terima state V1 dan sinkronkan ke proyeksi V2". Butuh keputusan desain Owner; jangan ditiru dengan SQL manual.

## Prosedur

### Sebelum mematikan writer
```sql
-- unit yang akan terdampak: punya Run non-terminal
SELECT u.unit_code, r.id AS run_id, r.status, r.current_phase
FROM production_runs_v2 r JOIN units u ON u.id = r.unit_id
WHERE r.status NOT IN ('COMPLETED','CANCELLED') ORDER BY u.unit_code;
```
Catat daftar ini. Matikan writer hanya bila benar-benar darurat; ubah flag lewat jalur resmi (bukan SQL langsung).

### Selama writer OFF
Pekerjaan lewat tab "Kerja V1". Beri tahu Lead: setiap aksi pada unit di daftar di atas akan menandai drift.

### Sebelum menyalakan writer kembali
```sql
-- Run mana yang akan terblokir setelah writer ON
SELECT e.entity_id AS unit_id, e.metadata->>'runId' AS run_id, count(*) AS aksi_v1, min(e.created_at) AS pertama, max(e.created_at) AS terakhir,
       array_agg(DISTINCT e.metadata->>'what') AS jenis
FROM activity_events e
WHERE e.event_type = 'PRODUCTION_V1_WRITE_ON_V2_RUN'
GROUP BY 1, 2 ORDER BY terakhir DESC;
```
Run yang muncul = akan terblokir. Putuskan per unit dengan Production Lead: (a) batalkan Run lalu lanjutkan via V1/Run baru, atau (b) tunda writer ON sampai Owner memutuskan jalur "terima + sinkronkan".

### Setelah writer ON
- Verifikasi: `409 PRODUCTION_RUN_V1_DRIFT` hanya pada Run yang tadi terdaftar; unit lain normal.
- Pemulihan: batalkan Run di atas lewat Production Lead (bukan SQL). Jangan menghapus baris penanda: itu jejak audit, dan tanpanya V2 akan melanjutkan state yang berbeda.

## Yang tidak boleh
- Menghapus/mengubah baris `PRODUCTION_V1_WRITE_ON_V2_RUN` atau `production_runs_v2` lewat SQL.
- Mengubah flag/cohort tanpa daftar unit di atas.
- Menjalankan pembatalan Run atau rekonsiliasi di production sebagai bagian dari rilis. Rilis kode tidak menyentuh Run, flag, atau cohort.

## Catatan teknis
- `lockUnitOwnership` memakai `UPDATE units SET updated_at = now()` di dalam transaksi gerbang. Command yang ditolak melakukan rollback → baris unit
  (semua kolom, `updated_at`, versi tuple `xmin`) dan tabel efek (aktivitas, outbox, command, stok, log tahap, Run) tetap identik; diverifikasi di image
  kandidat (`rowcheck`, 17/17 bersama tes ownership/drift). Pembukaan Run V2 yang sukses memang menaikkan `updated_at` unit.
- Tidak ada trigger database pada tabel `units`.
