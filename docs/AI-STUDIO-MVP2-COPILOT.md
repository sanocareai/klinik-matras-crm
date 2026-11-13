# AI Studio MVP 2 — Copilot Sales di Inbox

Status: **DRAFT spesifikasi** (13 Nov 2026) · Pemilik: Owner · Belum ada kode.

## 1. Kenapa (dan kenapa bukan flow builder)

Cekat, Wati, dan Qontak menjual *flow builder*: pohon tombol, form yang ditanya satu-satu, `else` saat
customer keluar skrip. Cepat dibuat tapi kaku — kebalikan dari konsultan kasur yang mendiagnosa dulu.
Arah SANSS: **AI agent adalah otak, aturan operasional hanya rel.** Pembeda kita: agent dilatih oleh
sales kita sendiri (koreksi → test case → uji) sebelum dipercaya.

MVP 1 (live sejak 13 Nov 2026) sudah membuktikan otaknya di playground. MVP 2 membawanya ke **chat
customer asli**, dengan sales tetap memegang tombol kirim.

## 2. Keputusan yang sudah diambil

| Topik | Keputusan |
|---|---|
| Mode | **Copilot saja.** AI menyusun draft, sales yang mengirim. Tidak ada kirim otomatis. |
| Pemicu draft | **Saat sales klik "Saran AI"** di chat (bukan otomatis tiap pesan masuk). |
| Data ke CRM | **Usulan.** AI menampilkan chip "Simpan ke CRM"; tidak menulis CRM sendiri. |
| Pilot | **Tahap A:** hanya akun ber-role ADMIN/OWNER. **Tahap B:** sales Novi, Fadlan, Kiki — dinyalakan per user oleh Owner/Admin setelah Tahap A lolos. |
| Autopilot | **Ditunda ke MVP 3** (butuh skor uji lolos; WAHA bukan API resmi → risiko blokir nomor). |
| Model | Default `claude-haiku-5-5`; Sonnet hanya pilihan manual di Studio. |

## 3. Alur pengguna (sales pilot)

1. Sales membuka chat di Inbox. Ada tombol **✨ Saran AI** di atas kolom ketik (hanya untuk user pilot —
   Tahap A: role ADMIN/OWNER; Tahap B: + Novi, Fadlan, Kiki —
   hanya chat INDIVIDUAL customer — bukan grup, bukan Kontak Tim).
2. Klik → 3–6 detik → panel draft muncul di atas kolom ketik:
   - 1–3 bubble draft (bisa diedit langsung).
   - Saran foto katalog bila relevan (`kirimKatalog`).
   - Chip data tertangkap: *Kota: Bekasi · Ukuran: 160×200 · Keluhan: pegal pinggang* → **Simpan ke CRM**.
   - Label tahap (Diagnosa / Edukasi / Rekomendasi / Harga / Closing) + peringatan cek keras bila ada.
   - Bila `handover.perlu`: banner "AI menyarankan ditangani manusia: <alasan>" dan draft tidak disarankan dipakai.
3. Sales memilih salah satu:
   - **Pakai** → teks masuk kolom ketik (bisa diedit) → kirim lewat alur kirim yang SUDAH ADA.
   - **Pakai & kirim semua bubble** → tetap lewat endpoint kirim yang sama, satu per satu dengan jeda.
   - **Abaikan** → minta alasan singkat opsional (chip: salah info / terlalu panjang / tidak natural / salah tahap / lainnya).
4. Sistem mencatat apa yang **akhirnya dikirim** sales dibanding draft (lihat §6) — inilah data latihan utama.

## 4. Konteks yang dibaca agent (tiap klik)

- **Riwayat chat**: 30 pesan teks terakhir percakapan ini (inbound = customer, outbound = sales/agent),
  media diringkas jadi `[foto]`/`[voice note]`. Pesan revoked dibuang.
- **Kartu customer**: nama, kota, `pipelineStage`, tag, order sebelumnya (ringkas: produk, tanggal, status),
  komplain terbuka bila ada. Customer lama tidak boleh ditanya ulang dari nol.
- **Skill versi aktif** (sama dengan Studio) + **katalog & harga live** (`Product` aktif) — harga hanya dari sini.
- **Contoh gaya**: 6–10 kutipan `GoldStandardExample` **yang sudah dikurasi** (lihat §12; sudah ter-mask) sesuai tahap saat ini, disisipkan
  sebagai "contoh cara sales terbaik kita bicara". Ini cara murah membuat suara agent mirip sales asli.

Semua dirakit di server; frontend hanya mengirim `conversationId`.

## 5. Gaya bicara (ditambahkan ke skill, bukan kode)

Ditulis sebagai referensi baru `references/52-gaya-wa.md`:
- Bubble pendek (≤ 2–3 kalimat), maksimal 3 bubble; satu pertanyaan per giliran.
- Tanpa bullet list, tanpa "Terima kasih telah menghubungi kami", tanpa emoji berlebihan.
- Ikuti register customer (santai ↔ formal), panggil dengan sapaan yang sudah dipakai sales di chat itu.
- Data diambil dari obrolan, bukan ditanya seperti form.
- Diagnosa dulu, harga belakangan; harga hanya dari katalog; **tidak boleh diskon/nego**.

## 6. Data & skema (additive saja — perlu persetujuan Owner sebelum migrasi)

Satu tabel baru, tidak mengubah tabel Inbox yang ada:

```prisma
model StudioCopilotDraft {
  id              String   @id @default(cuid())
  conversationId  String   // string biasa, pola isolasi seperti ConversationQualityScore
  customerId      String?
  salesUserId     String
  skillVersionId  String
  model           String
  contextMessageId String? // pesan inbound terakhir saat draft dibuat
  output          Json     // { bubbles, kirimKatalog, tahap, dataTerkumpul, handover, checks }
  outcome         StudioDraftOutcome @default(SHOWN) // SHOWN | USED_AS_IS | USED_EDITED | IGNORED
  ignoreReason    String?
  sentText        String?  // teks yang benar-benar dikirim sales setelah draft (dicocokkan ≤ 10 menit)
  crmSaved        Json?    // field yang disimpan sales dari chip
  inputTokens     Int @default(0)
  outputTokens    Int @default(0)
  cacheReadTokens Int @default(0)
  costUsd         Float @default(0)
  latencyMs       Int @default(0)
  createdAt       DateTime @default(now())
  @@index([salesUserId, createdAt])
  @@index([conversationId, createdAt])
  @@index([outcome, createdAt])
  @@map("studio_copilot_drafts")
}
```

Akses pilot (tanpa kolom baru): boleh bila user ber-role ADMIN/OWNER **atau** id-nya ada di
`StudioAgent.config.copilotUsers` (field `config` sudah ada). Tahap A daftar ini kosong; Tahap B diisi
Novi, Fadlan, Kiki lewat halaman Copilot.

**Dari draft ke latihan:** draft `USED_EDITED` dengan perubahan besar, atau `IGNORED`, otomatis masuk antrian
**Tinjauan Koreksi** yang sudah ada (sebagai feedback dengan `idealReply` = `sentText`). Owner/Admin tetap
yang menyetujui → jadi test case. Tidak ada yang masuk skill tanpa persetujuan.

## 7. API (baru)

| Method | Path | Akses | Isi |
|---|---|---|---|
| POST | `/api/studio/copilot/:conversationId/draft` | user pilot | Rakit konteks, panggil `runTurn`, simpan draft, kembalikan output |
| POST | `/api/studio/copilot/drafts/:id/outcome` | pemilik draft | `{ outcome, ignoreReason?, sentText? }` |
| POST | `/api/studio/copilot/drafts/:id/crm` | pemilik draft | Simpan field terpilih ke Customer — hanya kota, tag keluhan (append), catatan; field lain ditolak |
| GET/PUT | `/api/studio/copilot/contoh-gaya` | Owner/Admin | Lihat kandidat gold standard & atur daftar kutipan terkurasi |
| GET | `/api/studio/copilot/stats` | Owner/Admin | Pemakaian, tingkat dipakai, biaya, per sales |
| PUT | `/api/studio/copilot/users` | Owner/Admin | Atur daftar pilot |

Pengaman:
- Rate limit per user (mis. 30 draft/jam) dan plafon biaya harian (env `STUDIO_COPILOT_DAILY_USD`, default $3).
- Endpoint kirim pesan Inbox **tidak diubah**; copilot tidak pernah memanggil WAHA.
- Nomor/nama customer tidak dikirim ke log; prompt memakai nama panggilan saja.

## 8. UI

- **Inbox (Sales CRM)**: tombol ✨ Saran AI + panel draft (komponen baru, di-mount hanya untuk user pilot).
- **AI Studio → menu baru "Copilot"** (Owner/Admin): kartu ringkas (draft dibuat, % dipakai apa adanya,
  % diedit, % diabaikan, biaya), tabel per sales, daftar draft terbaru dengan perbandingan draft ↔ yang dikirim.
  Gaya `ap-*` seperti tampilan Studio sekarang.
- Pengaturan pilot (pilih user) dan tab **Contoh gaya** (kurasi gold standard) di halaman Copilot.

## 9. Ukuran sukses pilot (2 minggu)

| Metrik | Target awal |
|---|---|
| Draft dipakai (as-is + edit ringan) | ≥ 50% |
| Draft diabaikan karena "salah info" | ≤ 5% |
| Pelanggaran cek keras (harga di luar katalog, diskon) yang lolos terkirim | 0 |
| Waktu balas sales pilot vs sebelum pilot | turun |
| Biaya | ≤ $3/hari |

Gagal target → perbaiki skill lewat Tinjauan Koreksi, bukan perluas pilot.

## 10. Di luar cakupan MVP 2

Autopilot / kirim otomatis · draft otomatis tiap pesan masuk · tulis CRM otomatis · Instagram ·
judge otomatis & versioning skill (MVP 3) · broadcast / follow-up terjadwal · flow builder.

## 11. Rencana kerja

1. Skill: tambah `52-gaya-wa.md` + aturan konteks customer → uji di Playground yang ada.
2. Backend: perakit konteks (riwayat Inbox + kartu customer + gold standard) — fungsi murni + tes.
3. Migrasi `StudioCopilotDraft` (setelah Owner setuju) + 5 endpoint + rate limit/plafon.
4. Frontend: panel Saran AI di Inbox; halaman Copilot di AI Studio.
5. Uji lokal di DB tes (chat contoh) → rilis lewat skrip `release-ai-studio-copilot.sh` di atas live terbaru.
6. **Tahap A** — aktif untuk akun ADMIN/OWNER saja; Owner/Admin mencoba di chat asli ±1 minggu.
7. **Tahap B** — bila metrik §9 di Tahap A aman, tambahkan Novi, Fadlan, Kiki; tinjau mingguan.

## 12. Keputusan tambahan (13 Nov 2026)

- **Gold standard dikurasi manual dulu.** Hanya kutipan yang dipilih Owner/Admin yang dipakai sebagai contoh
  gaya. Daftar id terpilih disimpan di `StudioAgent.config.contohGaya` (tanpa kolom baru); halaman Copilot
  punya tab "Contoh gaya" untuk memilih/membuang kutipan per kategori. Daftar kosong → agent jalan tanpa contoh.
- **Simpan ke CRM hanya 3 field:** `city` (kota), tag keluhan (ditambahkan ke `Customer.tags`, tidak menghapus
  tag lama), dan catatan. **`pipelineStage` tidak boleh** diubah dari chip — tetap keputusan sales.
