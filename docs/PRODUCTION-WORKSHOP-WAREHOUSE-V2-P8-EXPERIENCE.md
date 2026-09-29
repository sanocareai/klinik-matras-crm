# Production Workshop + Warehouse V2 — P8 Production Experience

Sumber: `sanss_production_v2_blueprint_operational_schema.md` (blueprint 12 tahap) + mockup "Produksi terarah. Gudang terhubung."
Basis: production `b9da5705` (P1–P7 + hotfix fail-closed). Branch `feat/production-v2-experience`. Flag `production_v2_reader`/`production_v2_writer` tetap OFF; tidak ada deploy.

## 1. Gap matrix (blueprint vs source sebelum P8)

| Kebutuhan blueprint | Sudah ada (P1–P7) | Gap yang ditutup P8 |
|---|---|---|
| Pool unit masuk dari Sales/pickup | Custody INBOUND (P1–P2), eligible units (P3) | Kolom "Belum Dijadwalkan" papan |
| Target 12/hari, Meja 1–4 × 3 | Plan workshop+operator+target (P3) | `production_date`, `station_code`, `priority`, PIC Corner + command `SCHEDULE_PLAN` (kapasitas dijaga) |
| Kartu HP: order, customer, merk/ukuran, berat, keluhan, request | Order: `beratBadan`, `weightEntries`, `complaintCategory`, `notes`; Unit: `merk`, `ukuran` | Read-model kartu (tanpa telepon/alamat) |
| Posisi tidur customer | — | **Belum ditangkap Sales** — ditampilkan "Belum dicatat Sales" (gap data, bukan diisi tebakan) |
| 9 tahap Table evidence-gated | Stage engine + operasi P5 (start/pause/resume/complete + foto) | Bukti per tahap IMMUTABLE (`production_step_evidence_v2`), kontrak bukti, urutan diturunkan server |
| Diagnosa sebelum bahan turun | Gerbang material P5 berlaku sejak tahap pertama | Gerbang dipindah ke tahap MODULE pertama (BOM setelah diagnosa nyata) |
| "Menunggu Bahan Baku" | Jeda P5 (BREAK/PROCESS_DELAY/OTHER) | `production_material_shortages_v2` + jeda sah PROCESS_DELAY; Gudang menyelesaikan |
| Potong/cocokkan Warehouse di tahap 6/7 | Material Issue P4 (stok berkurang saat pick) | Tahap 6/7/10 MENCOCOKKAN bahan yang diserahkan (tanpa potong stok kedua) |
| Uji tekstur PAS/KERAS/EMPUK + rework | QC P6 (fit test, QC_WRITE) | Uji PIC tahap 8 (bukan QC): KERAS/EMPUK wajib ulang bukti lapisan; QC resmi tetap P6 |
| Handoff ke Corner, spesifikasi kain/list/model | Stage `corner_sewing`/`finished`; plan satu operator | PIC Corner pada plan; otorisasi tahap pasca-QC ke PIC Corner |
| Konfirmasi selesai → broadcast Sales | Handoff barang jadi P6, outbox (tanpa consumer) | Event `production.report.ready` PENDING; laporan before–proses–after + pesan siap salin |
| Andon TV | — | `/bengkel/andon` (polling 20 dtk, visibility-aware) |
| Link media aman | Foto unit publik `/media/unit-photos` | `/media/production-evidence` (Bearer + reader cohort atau URL bertanda-tangan 60 menit) |

Layar lama DIPERTAHANKAN: Papan Produksi, Work Order, Rencana Produksi P3, Antrean Kerja P5, Antrean QC V2, Penerimaan Unit, Terima Barang Jadi, Pengambilan Bahan. Layar V2 baru: lihat §4.

## 2. Pemetaan 12 tahap → backend

| # | Tahap | Aktor | Transisi (P5/P6) | Bukti wajib |
|---|---|---|---|---|
| 1 | Sebelum Bongkar | PIC Meja | MULAI `pre_teardown_test` | ≥1 foto/video + konfirmasi ukuran/kain |
| 2 | Uji Rasa Awal | PIC Meja | SELESAI `pre_teardown_test` → mulai `teardown` | video + catatan rasa |
| 3 | Hasil Bongkar | PIC Meja | SELESAI `teardown` → mulai `foundation_test` | foto + checklist material lama |
| 4 | Uji Fondasi Lama | PIC Meja | SELESAI `foundation_test` → mulai `diagnosis` | video + tinggi awal/ditekan (selisih dihitung server) + berat penguji |
| 5 | Diagnosa | PIC Meja | SELESAI `diagnosis` (wajib layanan unit sudah ditetapkan; tanpa itu bukti tersimpan, tahap menunggu Planner) | teks/voice-to-text |
| 6 | Fondasi Baru | PIC Meja | modul seq 10; bukan terakhir → SELESAI + mulai modul berikutnya | video + bahan yang diserahkan + penjelasan |
| 7 | Lapisan Baru | PIC Meja | modul seq ≥20; modul terakhir: bukti saja | foto + bahan yang diserahkan |
| 8 | Uji Tekstur Akhir | PIC Meja | PAS → SELESAI modul terakhir → AWAITING_QC; lainnya → rework (ulang tahap 7) | video + hasil + berat penguji |
| — | QC resmi | QC_WRITE | P6 `inspect` (PASS/FAIL) — tidak berubah | P6 |
| 9 | Kirim ke Corner | PIC Meja | tanpa transisi (membuka antrean Corner setelah QC LULUS) | foto siap dibungkus |
| 10 | Mulai Jahit | PIC Corner | MULAI `corner_sewing` | model, kain, list, bahan kain opsional |
| 11 | Jahit Selesai | PIC Corner | SELESAI `corner_sewing` | foto/video + checklist 4 poin |
| 12 | Konfirmasi Selesai | PIC Corner | MULAI+SELESAI `finished` → penawaran barang jadi P6 (unit tetap IN_PRODUCTION sampai Gudang ACCEPTED) | foto kasur selesai (routing wajib foto) |

Semua tahap: `Idempotency-Key` (replay = respons sama), `expectedRevision` run (409 bila basi), tidak bisa dilewati (409 `STEP_OUT_OF_ORDER`), bukti immutable (trigger), media harus hasil unggah P8 dan ada di penyimpanan (422 bila tidak).

## 3. Migration & API

Migration aditif `20261006080000_production_experience_v2`: kolom papan pada `production_run_plans_v2`; tabel `production_step_evidence_v2` (trigger immutable, unik run+tahap+versi); tabel `production_material_shortages_v2` (satu OPEN per run). Tanpa DROP/UPDATE/DELETE.

`/api/production-v2` (reader cohort untuk GET; writer cohort di command):
- `GET /config`, `/board?date=`, `/andon?date=`, `/runs/:runId/card`, `/worker/table|corner`, `/warehouse/queue`, `/runs/:runId/report`
- `POST /plans` (buat + jadwalkan, PRODUCTION_ASSIGNMENT_WRITE), `POST /plans/:id/schedule`
- `POST /runs/:runId/steps/:stepNo` (UNIT_STAGE_WRITE), `POST /runs/:runId/material-shortage` (UNIT_STAGE_WRITE), `POST /material-shortages/:id/resolve` (INVENTORY_WRITE)
- `POST /evidence/upload` (multipart; foto ≤15 MB, video ≤80 MB; hanya unit writer cohort)
- `GET /media/production-evidence/:file` (Bearer + reader cohort, atau `?exp&sig`)

## 4. Layar

- `/bengkel/production-v2` — Planner (papan Meja 1–4, KPI, Belum Dijadwalkan, drawer detail, seret-lepas + tombol Pindah, tetapkan layanan).
- `/produksi/meja`, `/produksi/corner` — aplikasi PIC mobile (PWA; shortcut manifest), halaman mandiri tanpa sidebar.
- `/bengkel/andon` — kiosk TV 1920×1080, wajib login.
- `/warehouse/antrean-produksi` — antrean Gudang (unit masuk, bahan, kekurangan, barang jadi).
- `/bengkel/production-v2/laporan/:runId` — paket laporan Sales + "Salin Pesan".

## 5. Keamanan & cohort

Reader/writer fail-closed hanya `unitIds` (tanpa GLOBAL). Unit non-cohort tidak dimuat read-model, tidak bisa diunggah/dicatat (503), tidak mendapat artefak V2. Izin ditegakkan server; UI hanya menyembunyikan aksi. Rangkap Nadya (Operator + Gudang) didukung; QC tetap hanya pemegang `QC_WRITE`. QC_WAIVED tidak dipakai jalur P8.

## 6. Risiko tersisa

- Consumer broadcast outbox belum ada: laporan PENDING; Sales mengirim manual lewat "Salin Pesan".
- Posisi tidur customer belum ditangkap Sales.
- Bahan tambahan di luar BOM saat produksi: laporan kekurangan hanya alert; penambahan BOM setelah reservasi mengikuti jalur P3/P4/P6 yang ada.
- Pindah PIC saat tahap berjalan ditolak (by design) — selesaikan/jeda dulu.
- Voice-to-text bergantung dukungan browser (Chrome Android); tanpa dukungan tombol disembunyikan.
- Draft lokal menyimpan bukti yang sudah terunggah; berkas yang belum selesai diunggah tidak ikut draft (harus diambil ulang).
