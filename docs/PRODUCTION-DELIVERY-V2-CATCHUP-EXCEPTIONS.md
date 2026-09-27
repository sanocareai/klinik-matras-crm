# Catch-up V2: exception route/job dan Reader V2

## Masalah yang diperbaiki
`backfill.js --apply` membuat satu exception `ROUTE_JOB_ASSIGNMENT_MISMATCH` **per job**, tetapi kunci unik
`(run_id, domain, aggregate_type, aggregate_id, code)` hanya memuat ID route. Route dengan lebih dari satu job
menyimpang membuat apply gagal dengan `P2002` dan menggagalkan seluruh transaksi. Bug ini baru terlihat pada data
25–26 Sep (route `RTE-280926-01` 6 job, `RTE-280926-02` 13 job).

## Perilaku sekarang
- **Satu exception per route.** Seluruh job menyimpang digabung ke `evidence.mismatchedJobs`, urut `jobId`.
  Tiap job mencatat `differences[] = { field, route, job }` untuk `driverId`, `helperId`, `vehicleId`,
  `scheduledDate`. Header route ada di `evidence.header`. Job berstatus COMPLETED/FAILED/RESCHEDULED tidak dihitung.
- **Idempoten.** Persist di run yang sama tidak menggandakan baris; replay (run baru) menghasilkan tepat satu baris
  per route/kode dengan fingerprint evidence yang sama.
- **Carry-forward antar-run** (`migration-exception-persistence.js`):

  | Exception sebelumnya | Evidence | Hasil di run baru |
  |---|---|---|
  | RESOLVED, provenance sah | sama | RESOLVED (resolusi ikut) |
  | RESOLVED, provenance sah | berubah | **OPEN** + `resolution.previous` (histori resolusi utuh) |
  | OPEN hasil pembukaan-ulang | apa pun | tetap OPEN (tidak turun ke KEEP_V1) |
  | RESOLVED, provenance tidak sah | - | status bawaan (KEEP_V1), resolusi tidak dibawa |

  Provenance sah: `PRODUCTION_ADMIN_BYPASS` (keputusan administratif historis) dan
  `OPS_ROUTE_ASSIGNMENT_DECISION` (keputusan Ops untuk assignment route).
- **Isolasi kegagalan.** Setiap route dan setiap exception diproses di SAVEPOINT. Route yang gagal dicatat sebagai
  exception `ROUTE_BACKFILL_FAILED` (OPEN) dan run berstatus `FAILED` dengan `metadata.partial=true` dan daftar
  `metadata.failures`; route/job lain tetap selesai. CLI keluar dengan kode 3 bila ada failure.
- **Reader V2.** `readDriverFullSnapshot` tidak menyertakan publication route yang exception terbarunya
  (per route + kode) berstatus OPEN/KEEP_V1 (`blockedRouteIdsV2`). Eligibility Driver yang sudah ada tetap berlaku.

## Decision pack Ops (read-only)
`node scripts/production-delivery-v2/ops-decision-pack.js --output=pack.json --markdown=pack.md`
memuat fakta (crew header vs job dengan nama, order, pola perbedaan) dan opsi keputusan; tidak merekomendasikan pilihan.
Jangan commit hasilnya (memuat data operasional production).

## Batasan yang diketahui
- Route yang V2-state-nya sudah diubah command V2 (`routeRevision > 1`) tidak ditimpa backfill (sengaja).
  Sinkronisasi state lifecycle-nya memakai `reconcileDeliveryRouteFromV1` (mode terminal/catch-up), bukan backfill.

## Cohort writer berbasis route (canary)
Satu keputusan bersama (`deliveryWriterDecision` di `src/services/v2FeatureFlags.js`) dipakai `armada.js` dan
cross-boundary service.

| Flag route / execution | Hasil |
|---|---|
| keduanya OFF | OFF |
| hanya satu ON | OFF (`WRITER_PAIR_INCOMPLETE`) |
| keduanya ON, tanpa `routeIds` | GLOBAL (legacy; bukan untuk canary) |
| keduanya ON, `routeIds` identik | COHORT |
| `routeIds` berbeda / hanya di satu flag | OFF (`WRITER_COHORT_MISMATCH`) |
| `userIds` tanpa `routeIds` | OFF (`WRITER_USER_COHORT_UNSUPPORTED`) |

Mode COHORT: route authoritative (job di-resolve ke route dari database); cocok -> V2, tidak cocok atau tanpa route
(route/job baru, command system tanpa route) -> V1-only; command yang menyentuh route di dalam dan di luar cohort
sekaligus -> 409 `WRITER_COHORT_BOUNDARY`. `userIds` tidak disyaratkan untuk command berbasis route, sehingga
dispatcher dan driver yang berbeda sama-sama tercakup. Cross-boundary (Sales/sistem) menjalankan mutation V1 lalu
memproyeksikan V2 hanya untuk route cohort, dalam transaksi yang sama. Diagnostic hanya berisi kode.
Rollback: set kedua flag `enabled=false`; projection/command/outbox V2 tidak dihapus.
