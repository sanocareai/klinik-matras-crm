# Production Workshop + Warehouse V2 — P1–P2 Inbound Custody

Slice pertama dari `PRODUCTION-WORKSHOP-WAREHOUSE-V2-P0.md`. Additive; flag default OFF; V1 tidak berubah.

## Keputusan owner yang berlaku
- Sales bukan owner state Unit/Production/Delivery (fence Sales = P7).
- Stok negatif selalu ditolak tanpa bypass (dipakai di P5).
- Semua unit fisik wajib punya custody dan `StorageLocation` (accept mewajibkan lokasi valid).
- QC override memakai `QC_WAIVED`, bukan `QC_PASSED` (P4). Payment hold dibahas di slice outbound (P6).

## Model
Tabel `unit_custody_handoffs_v2` (migration `20260928090000_unit_custody_handoff_v2`, aditif):
`unitId`, `deliveryJobId`, `direction` (INBOUND | RETURN), `status` (OFFERED | ACCEPTED | REJECTED | CANCELLED | SUPERSEDED),
`locationId` (FK `storage_locations`), `productionRunId`, `offered/accepted/rejected` by+at, `reason`, `revision`, `commandId`.
- Unique `(deliveryJobId, unitId)`: satu Job boleh membawa beberapa unit, tetapi tidak pernah menghasilkan handoff ganda.
- Partial unique `(unitId, direction) WHERE status IN ('OFFERED','ACCEPTED')`: satu handoff aktif per unit dan arah.

## Transisi
```
OFFERED --accept(lokasi valid)--> ACCEPTED        (INBOUND: membuka/mengaktifkan Production Intake V2)
OFFERED --reject(alasan wajib)--> REJECTED        (riwayat dipertahankan; muncul di antrean exception)
OFFERED/ACCEPTED --pickup/return baru--> SUPERSEDED
```
Hanya `OFFERED` yang dapat diputuskan; double accept/reject dan `expectedRevision` basi ditolak 409.
Lokasi INBOUND: RECEIVING/WIP/QUARANTINE. Lokasi RETURN: RETURN/FINISHED_GOODS/DISPATCH/QUARANTINE. Lokasi nonaktif ditolak.

## Pemicu (V1 tetap sama)
- **Pickup selesai** (`POST /api/armada/jobs/:id/complete`, job PICKUP): V1 tetap `Unit.status=RECEIVED`; bila writer aktif untuk unit itu, custody INBOUND `OFFERED` + command + outbox + audit dibuat dalam transaksi yang sama.
- **Pengiriman gagal** (`POST /api/armada/jobs/:id/fail`, job DELIVERY): V1 kembali `READY_FOR_DELIVERY`; unit yang benar-benar dibawa (`IN_TRANSIT_OUT`) mendapat handoff RETURN `OFFERED` tanpa lokasi.
- Kegagalan pembuatan custody membatalkan mutasi V1 seluruhnya (atomik).

## Endpoint Gudang (`/api/inventory/unit-custody`, permission inventori, pesan Indonesia)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/?status=OFFERED&direction=INBOUND` | antrean (status=REJECTED = antrean exception) |
| POST | `/:id/accept` | `{ locationId, expectedRevision }` + header `Idempotency-Key` |
| POST | `/:id/reject` | `{ reason, expectedRevision }` + header `Idempotency-Key` |
Accept/reject saat writer OFF untuk unit itu -> 503 `CUSTODY_WRITER_OFF`.

## Command, outbox, audit
Command owner tunggal: `src/services/unitCustodyCommandService.js` (`v2_commands` domain `WAREHOUSE`, idempotency `(actorId, key)`,
baris handoff dikunci `FOR UPDATE`). Outbox: `warehouse.custody.{offered,accepted,rejected,superseded}`, `production.run.opened`.
Audit: `CUSTODY_OFFERED/ACCEPTED/REJECTED` (kalimat Indonesia di `activityLog`).

## Flag dan cohort
Memakai flag yang sudah ada `production_v2_writer`: OFF = V1 murni; ON tanpa `config.unitIds` = GLOBAL (legacy, bukan untuk canary);
ON dengan `config.unitIds` = COHORT fail-closed (unit di luar cohort/tanpa unitId = V1-only). Tanpa `userIds`.
Aktivasi contoh (satu unit): `enabled=true, config={"unitIds":["<unit uuid>"]}`. Rollback: `enabled=false` (data V2 tidak dihapus).

## Gate
`scripts/production-delivery-v2/audit-custody-writers.js`: penulis handoff hanya command owner; dua jalur armada (pickup selesai dan
pengiriman gagal) wajib ter-hook; penulis Unit lain diklasifikasi `PENDING_LATER_SLICE` (gap terlihat, penulis baru tak terklasifikasi = gagal).

## Gap berikutnya
P2b unit lahir di workshop (BARU/SEWA) tanpa pickup butuh custody eksplisit; UI Gudang (antrean + terima/tolak) belum dibuat;
`Unit.storageLocation` (teks) belum diproyeksikan dari lokasi custody; P3 run produksi writer; P7 fence kaskade Sales.
