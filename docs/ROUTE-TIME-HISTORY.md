# Histori Waktu Rute & Stop (fase 2 Checklist Persiapan Perjalanan)

Cabang `feat/checklist-persiapan-perjalanan`. Belum merge/deploy/OTA. Migration aditif `20261020100000_route_execution_event_time`.

## Audit sumber waktu yang sudah ada (tidak ada ledger baru)
| Sumber | Isi | Kekurangan |
|---|---|---|
| `delivery_execution_events` (ledger eksekusi, idempoten per Idempotency-Key, ditulis di transaksi yang sama dgn transisi status) | `ROUTE_STARTED`, `JOB_STARTED`, `JOB_ARRIVED`, `JOB_COMPLETED`, `JOB_FAILED` + actor + `created_at` (= waktu diterima server) | tidak ada waktu **kejadian** perangkat, tidak ada **sumber** aksi; tidak ada event reschedule / rute selesai |
| `routes.started_at/completed_at`, `jobs.arrived_at/completed_at` | satu cap waktu server | tanpa actor/sumber; `completed_at` job kadang diisi admin; **tidak ada** `started_at` per job |
| `job_issue_logs` (RESCHEDULED) | alasan + actor + waktu | hanya reschedule |
| `activity_events` | linimasa entitas unit/order | bukan untuk rute/stop |

Keputusan: **memperluas `delivery_execution_events`** (3 kolom nullable: `occurred_at`, `source`, `time_quality`) — bukan tabel baru. Kolom lama dipakai hanya sebagai **cadangan** untuk histori lama dan selalu ditandai ("Dicatat sistem tanpa log aksi").

## Event permanen (satu ledger)
`ROUTE_STARTED` (berangkat dari Sano) · `JOB_STARTED` (menuju stop) · `JOB_ARRIVED` (tiba) · `JOB_COMPLETED` (pengambilan/pengiriman selesai) · `JOB_FAILED` · `JOB_RESCHEDULED` (reschedule proaktif **dan** setelah gagal, kunci = id `JobIssueLog`) ·
`ROUTE_COMPLETED` (turunan dari job terakhir yang tuntas, **ditulis sesudah** event job pemicunya, kunci deterministik) · `TIME_CORRECTED` (koreksi).
Semua ditulis **di transaksi yang sama** dengan perubahan status; transisi yang ditolak (409) tidak meninggalkan event. Retry dengan Idempotency-Key yang sama → replay, tidak menggandakan event.

## Waktu kejadian vs waktu diterima server
- Klien mengirim header `X-Event-Occurred-At` (ISO + zona) dan `X-Action-Source` (`DRIVER_APP` | `DRIVER_WEB` | `ADMIN_WEB`; tanpa header = `KLIEN_LAMA`; `SYSTEM` hanya untuk jalur sinkron tanpa aksi pengguna). Event `ROUTE_COMPLETED` turunan mewarisi actor, sumber, dan waktu aksi job pemicunya (`payload.derived: true`, `triggerJobId`).
- Driver App: waktu = `createdAt` item antrean (saat tombol ditekan), **bukan** saat antrean tersinkron. Driver Web: `occurredAt` disimpan di payload antrean IndexedDB.
- `time_quality` dihitung server **saat menulis**: `LANGSUNG` (≤ 2 mnt) · `SINKRON_TERLAMBAT` (> 2 mnt) · `JAM_PERANGKAT_MASA_DEPAN` (> 5 mnt di depan server) · `JAM_PERANGKAT_USANG` (> 7 hari) · `JAM_PERANGKAT_TIDAK_VALID` (bukan ISO + zona) · `WAKTU_SERVER` (tanpa waktu dari perangkat).
  Jam janggal **tidak memblokir** transisi; tampilan memakai waktu server, memperlihatkan waktu perangkat, dan **tidak menghitung durasi** dari ujung yang janggal.
- `created_at` = waktu diterima server, tidak pernah dari klien.

## Tampilan (Indonesia + WIB, disusun server — sama untuk 3 klien)
`GET /api/armada/routes/:id/timeline` (admin: `JOB_READ`; driver/helper: hanya rutenya). Label: Berangkat dari Sano / Menuju lokasi / Tiba di lokasi / Pengambilan|Pengiriman selesai|gagal / Dijadwalkan ulang / Rute selesai.
Durasi perjalanan (menuju→tiba), layanan (tiba→selesai/gagal), rute (berangkat→selesai) **hanya** bila kedua ujung punya bukti waktu yang layak dipercaya dan urutannya masuk akal. Histori lama tanpa bukti waktu: **"Tidak tersedia"** — tidak diisi, tidak di-backfill (membaca tidak menulis).
Web admin: tombol "Histori Waktu" di RouteCard (modal). Driver Web: bagian "Histori Waktu" di kartu rute. Driver App: layar `HistoriWaktu` dari RouteStartCard.

## Koreksi append-only
`POST /api/armada/routes/:id/timeline/corrections { eventId, correctedOccurredAt, reason }` — hanya `ROUTE_WRITE`; alasan ≥ 5 karakter; waktu bukan di masa depan; hanya untuk tonggak yang **sudah punya event** (tidak untuk mengisi histori kosong). Menulis event `TIME_CORRECTED` baru (actor, alasan, waktu semula, waktu baru); event asli tidak pernah diubah/dihapus; koreksi terbaru menentukan waktu efektif dan seluruh riwayat tampil. Idempoten.

## Akses foto checklist (temuan + perbaikan)
**Bocor sebelumnya:** bukti checklist disimpan di `data/job-photos` yang disajikan `express.static` **publik** — siapa pun yang tahu/menebak URL (tanpa login) bisa membukanya.
**Kini:** bukti disimpan di `data/route-prep-proofs` (bukan direktori statis), nama berkas = UUID acak, disajikan lewat `GET /media/route-prep-proofs/:file`:
- tanpa login & tanpa tanda tangan → **401**; driver lain (bukan driver/helper rute pemilik bukti) → **403**; admin/dispatcher (`JOB_READ`) dan crew rute → 200;
- URL bertanda-tangan berumur pendek (60 mnt, kunci turunan `route-prep-proof-v1`) hanya dikeluarkan server saat melayani daftar checklist kepada pembaca yang sah — untuk `<img>` di web; tanda tangan rusak/kedaluwarsa → 403; path traversal → 404.
Catatan jujur: foto muatan keberangkatan rute (`Job.startPhotoUrls`) dan foto POD tetap di `/media/job-photos` (statis publik, perilaku lama di luar lingkup fase 2) — ditandai sebagai risiko terbuka. Fase 1 belum pernah deploy, jadi tidak ada bukti checklist lama di production yang perlu dipindahkan.

## Verifikasi
Unit: `deliveryTimeline.test.js` (12), `timelineView.test.js` + `executionQueue.test.js` (driver-mobile 48/48), `routeTimelineUI.test.js` (frontend). Integrasi: `routeTimeline.integration.test.js` (9) + `routePrepChecklist.integration.test.js` + 16 berkas Armada/Delivery.
Android export: `expo export --platform android` sukses. **QA HP checklist/histori waktu di perangkat fisik BELUM diuji** (tidak ada perangkat).
Kegagalan lama di basis (bukan dari perubahan ini): 4 tes frontend (`diagnosisWizard`, `rencanaOrderNyata`) dan 4 tes backend (`productionWorkshopExecutionMigrationAndAudit`, `stagingIsolation`) gagal identik pada commit 6b904803 tanpa perubahan.
