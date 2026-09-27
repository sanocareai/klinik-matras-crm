# Production Workshop + Warehouse V2 — P1–P2 Inbound Custody

Slice pertama dari `PRODUCTION-WORKSHOP-WAREHOUSE-V2-P0.md`. Additive; flag default OFF; V1 tidak berubah.

## Keputusan owner yang berlaku
- Sales bukan owner state Unit/Production/Delivery (fence Sales = P7).
- Stok negatif selalu ditolak tanpa bypass (dipakai di P5).
- Semua unit fisik wajib punya custody dan `StorageLocation` (accept mewajibkan lokasi valid).
- QC override memakai `QC_WAIVED`, bukan `QC_PASSED` (P4). Payment hold dibahas di slice outbound (P6).

## Model
Tabel `unit_custody_handoffs_v2` (migration `20260928090000_unit_custody_handoff_v2`, aditif; belum applied di production —
diamendemen sekali sebelum rilis, lihat Gate):
`unitId`, `deliveryJobId`, `direction` (INBOUND | RETURN), `status` (OFFERED | ACCEPTED | REJECTED | CANCELLED | SUPERSEDED),
`locationId` (FK `storage_locations`), `productionRunId`, `offered/accepted/rejected/cancelled` by+at, `reason`, `revision`, `commandId`.
- Unique `(deliveryJobId, unitId)`: satu Job boleh membawa beberapa unit, tetapi tidak pernah menghasilkan handoff ganda.
- Partial unique `(unitId, direction) WHERE status IN ('OFFERED','ACCEPTED')`: satu handoff aktif per unit dan arah.
- Partial unique `production_runs_v2(unit_id) WHERE status NOT IN ('COMPLETED','CANCELLED')`: satu run produksi aktif per
  unit — backstop database untuk `lockRowForUpdate("units", …)` di `openProductionIntakeV2`; dua ACCEPTED dari jalur
  berbeda untuk unit yang sama tidak pernah membuat dua run (dibuktikan tes concurrency).

## Transisi
```
OFFERED --accept(lokasi valid)--> ACCEPTED        (INBOUND: membuka/mengaktifkan Production Intake V2; proyeksi Unit.storageLocation)
OFFERED --reject(alasan wajib)--> REJECTED        (riwayat dipertahankan; muncul di antrean exception)
OFFERED --rollback(unit di cohort writer)--> CANCELLED   (Ops; lihat § Rollback)
OFFERED/ACCEPTED --pickup/return baru--> SUPERSEDED
```
Hanya `OFFERED` yang dapat diputuskan; double accept/reject dan `expectedRevision` basi ditolak 409.
Lokasi INBOUND: RECEIVING/WIP/QUARANTINE. Lokasi RETURN: RETURN/FINISHED_GOODS/DISPATCH/QUARANTINE. Lokasi nonaktif ditolak.

## Proyeksi lokasi legacy
Saat ACCEPTED, `StorageLocation.code` disalin ke `Unit.storageLocation` (kolom teks lama yang masih dibaca
`ProductionUnitDetail.jsx` "Lokasi Simpan"). `locationId` tetap **source of truth**; client hanya bisa memilih
`locationId` dari `StorageLocation` aktif — tidak ada field teks bebas di endpoint. Idempotency command mencegah
penulisan ganda/audit ganda saat replay.

## Pemicu (V1 tetap sama)
- **Pickup selesai** (`POST /api/armada/jobs/:id/complete`, job PICKUP): V1 tetap `Unit.status=RECEIVED`; bila writer aktif untuk unit itu, custody INBOUND `OFFERED` + command + outbox + audit dibuat dalam transaksi yang sama.
- **Pengiriman gagal** (`POST /api/armada/jobs/:id/fail`, job DELIVERY): V1 kembali `READY_FOR_DELIVERY`; unit yang benar-benar dibawa (`IN_TRANSIT_OUT`) mendapat handoff RETURN `OFFERED` tanpa lokasi.
- Kegagalan pembuatan custody membatalkan mutasi V1 seluruhnya (atomik).

## Endpoint Gudang (`/api/inventory/unit-custody`, permission inventori, pesan Indonesia)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/?status=&direction=` | `status`: OFFERED (antrean) \| ACCEPTED \| REJECTED (antrean exception) \| CANCELLED \| SUPERSEDED \| `HISTORY` (semua yang selesai, terbaru dulu) |
| POST | `/:id/accept` | `{ locationId, expectedRevision }` + header `Idempotency-Key` |
| POST | `/:id/reject` | `{ reason, expectedRevision }` + header `Idempotency-Key` |
Accept/reject saat writer OFF untuk unit itu -> 503 `CUSTODY_WRITER_OFF`. GET digerbang flag reader terpisah (lihat § Flag).

## Command, outbox, audit
Command owner tunggal: `src/services/unitCustodyCommandService.js` (`v2_commands` domain `WAREHOUSE`, idempotency `(actorId, key)`,
baris handoff dikunci `FOR UPDATE`). Outbox: `warehouse.custody.{offered,accepted,rejected,superseded,cancelled}`, `production.run.opened`.
Audit: `CUSTODY_OFFERED/ACCEPTED/REJECTED/ROLLED_BACK` (kalimat Indonesia di `activityLog`).

## Flag dan cohort
**Writer** (mutasi): flag existing `production_v2_writer`. OFF = V1 murni; ON tanpa `config.unitIds` = GLOBAL (legacy, bukan
untuk canary); ON dengan `config.unitIds` = COHORT fail-closed (unit di luar cohort/tanpa unitId = V1-only). Tanpa `userIds`.
Aktivasi contoh (satu unit): `enabled=true, config={"unitIds":["<unit uuid>"]}`.

**Reader** (visibilitas antrean GET, halaman Gudang): flag terpisah `production_v2_reader`, pola OFF/GLOBAL/COHORT yang
sama, TIDAK ikut ON hanya karena writer ON. OFF -> antrean selalu kosong (`readerMode:"OFF"` di response, bukan error) —
inilah kondisi normal sebelum reader diaktifkan untuk pilot. COHORT -> hanya unit dalam `config.unitIds` yang tampil.
Reader tidak menggerbang accept/reject (itu urusan writer) — hanya GET.

## Rollback (writer dimatikan)
Menonaktifkan `production_v2_writer` **menghentikan penawaran baru** (V1 kembali murni untuk unit itu) tetapi TIDAK
otomatis menutup handoff `OFFERED` yang sudah ada. Jalankan `rollbackUnitCustodyOffers` (owner command, idempoten
per `(actorId, idempotencyKey)` DAN aman diulang dengan key berbeda — hanya menyentuh baris yang masih OFFERED) untuk
membatalkan (CANCELLED) seluruh OFFERED milik cohort yang di-rollback. Histori tidak dihapus; ACCEPTED/REJECTED tidak
disentuh. CLI: `node scripts/production-delivery-v2/rollback-unit-custody-offers.js --unit-ids=<id,..> --reason="..." --confirm-key=<key> --apply`.
Setelah rollback dan reaktivasi writer, pickup baru untuk unit yang sama membuat handoff baru (job berbeda) — handoff
lama tetap CANCELLED selamanya, tidak pernah dimunculkan lagi sebagai pekerjaan baru di antrean.

## UI Gudang
`frontend/src/pages/warehouse/WarehouseUnitCustody.jsx` (`/warehouse/unit-custody`, nav "Penerimaan Unit"). Tab Menunggu/
Diterima/Ditolak/Riwayat; card per unit (kode unit, order, arah, waktu ditawarkan, sumber job, status); Terima wajib pilih
`StorageLocation` aktif (dropdown, tanpa teks bebas); Tolak wajib alasan; loading/kosong/error/409 ditangani. Bila reader
OFF, halaman menjelaskan "sedang uji coba (canary)", bukan menampilkan seolah error. Logika murni di
`frontend/src/features/warehouse/unitCustody.js` (diuji `frontend/tests/unitCustody.test.js`).

## Gate
`scripts/production-delivery-v2/audit-custody-writers.js`: penulis handoff hanya command owner; dua jalur armada (pickup selesai dan
pengiriman gagal) wajib ter-hook; penulis Unit lain diklasifikasi `PENDING_LATER_SLICE` (gap terlihat, penulis baru tak terklasifikasi = gagal).

## Gap berikutnya
P2b unit lahir di workshop (BARU/SEWA) tanpa pickup butuh custody eksplisit; P3 run produksi writer (fase/diagnosis/QC,
di luar intake); P7 fence kaskade Sales.
