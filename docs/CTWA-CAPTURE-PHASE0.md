# Capture atribusi Meta CTWA — Fase 0

**Status:** kode siap, flag **MATI** secara default, belum di-deploy.
**Tujuan:** membuktikan field atribusi apa yang benar-benar diterima dari WAHA/GOWS untuk pesan inbound Click-to-WhatsApp, tanpa menyimpan isi chat atau data pribadi. Ini **bukan atribusi** — tidak mengubah `Customer.leadSource`, tidak membuat `attribution_touch`, tidak mengirim apa pun ke Meta.

## Yang dicatat (allowlist)

Satu baris JSON per pesan inbound individual yang berhasil disimpan, di `backend/data/ctwa-capture/ctwa-capture-YYYY-MM-DD.jsonl` (bind-mount ke host, di-gitignore):

| Kelompok | Isi |
|---|---|
| Meta pesan | event (`message`/`message.any`), engine, hash HMAC ID pesan, timestamp provider, selisih detik, `NEW`/`EXISTING` customer |
| Verdict | `CTWA_AD`, `AD_REPLY_UNMARKED`, `CONTEXT_NON_AD`, `NO_CONTEXT_INFO`, `NO_MESSAGE_BODY` |
| Status field | `absent` / `empty` / `present` untuk `sourceURL`, `sourceID`, `sourceType`, `ctwaClid`, `containsCtwaFlowsAutoReply`, `conversionSource`, `entryPointConversionSource/App/DelaySeconds` |
| Nilai | hanya bila lolos validasi bentuk (angka untuk `sourceID`, enum pendek untuk tipe/sumber, integer untuk delay, boolean untuk flag); yang gagal hanya dicatat di `rejected` |
| `ctwa_clid` | HMAC-SHA256 (16 hex) + panjang + kelas karakter. **Nilai utuh dan 4 karakter terakhir tidak disimpan** — hash cukup untuk menjawab "ada atau tidak, unik per klik atau tidak" |
| `sourceURL` | jenis (`instagram_post`, `fb_short`, `facebook_post`, `whatsapp_status`, ...), token publik post bila ada, **nama** parameter query (bukan nilainya). Path `wa.me` dibuang (bisa berisi nomor) |
| Nama key lain | daftar **nama** key di `externalAdReply` dan `contextInfo` (bukan nilai) — menjawab "field referral lain apa yang tersedia" |

**Tidak pernah dicatat:** isi pesan, nama, nomor/JID, media, `healthStatus`, `complaintCategory`, token/API key, payload mentah. Observasi dirakit dari nol field demi field; objek payload tidak pernah disalin.

## Mengaktifkan

1. Buat salt acak (jangan dipakai ulang di tempat lain):
   `openssl rand -hex 24`
2. Di `backend/.env` server:
   ```
   CTWA_ATTRIBUTION_CAPTURE_ENABLED=true
   CTWA_CAPTURE_HASH_SALT=<salt dari langkah 1>
   CTWA_CAPTURE_RETENTION_DAYS=7
   ```
3. Restart backend saja: `docker compose up -d --force-recreate backend` (env baru hanya terbaca saat container dibuat ulang).
4. Verifikasi di log: tidak ada baris `[ctwa-capture] ...`. Peringatan `CTWA_CAPTURE_HASH_SALT ... belum diisi` berarti salt kosong/terlalu pendek dan capture **menolak** menulis.
5. Tunggu sampai ada ≥ 30 observasi `CTWA_AD`, lalu: `docker compose exec backend node scripts/ctwa-capture-report.js`

Flag harus persis `true`; nilai lain (`1`, `TRUE`, kosong) dianggap mati.

## Menonaktifkan

1. Set `CTWA_ATTRIBUTION_CAPTURE_ENABLED=false` (atau hapus barisnya).
2. `docker compose up -d --force-recreate backend`.
3. Hapus data: `docker compose exec backend node scripts/ctwa-capture-purge.js --all`.

Berkas lama tetap dihapus otomatis walau flag mati: pemeriksaan retensi berjalan sekali per hari-UTC dari webhook inbound pertama.

## Retensi dan cleanup

- Berkas harian dihapus bila **awal hari-UTC-nya** lebih tua dari retensi, sehingga baris tertua yang tersisa tidak pernah lebih tua dari retensi. Maksimum dipaksa 7 hari (nilai env lebih besar dipotong ke 7).
- Purge hanya menyentuh nama berkas ber-pola `ctwa-capture-YYYY-MM-DD.jsonl`.
- Manual: `node scripts/ctwa-capture-purge.js [--dry-run] [--all]`.
- Batas 5 MB per berkas harian dan 4 KB per baris; kelebihannya dibuang dan dihitung, bukan ditulis.
- **Wajib `--all` saat fase selesai.**

## Jaminan ke pemrosesan pesan

- Dipanggil **setelah** `Message.create` berhasil dan hanya di jalur `saved`, tidak di-await, dibungkus try/catch; nilai kembalian handler tidak berubah.
- Yang kalah race (`message` vs `message.any`) kena P2002 dan tidak sampai ke capture. Ada dedupe kedua berbasis hash ID pesan di memori.
- Kegagalan tulis hanya menaikkan penghitung dan menulis satu baris peringatan per menit berisi kode error saja.
- Flag mati: biaya per pesan hanya satu pembacaan env dan satu perbandingan tanggal.
- Tidak ada perubahan skema DB.

## Cakupan yang tidak teramati (sengaja)

Pesan grup, pesan `fromMe`, nomor staf internal, header album, dan pesan yang nomornya tidak bisa di-resolve (`UnresolvedMessage`) tidak masuk capture.

## Kriteria keputusan untuk `attribution_touch`

Jalankan report setelah ≥ 30 observasi `CTWA_AD`.

| Hasil | Keputusan |
|---|---|
| `sourceID` ada di ≥ 90% `CTWA_AD`, numerik, dan 5 iklan berbeda cocok dengan ID iklan di Ads Manager | GO penuh: touch menyimpan `source_id` sebagai ad ID terverifikasi |
| `sourceID` ada tapi sama dengan ID post turunan dari shortcode (`instagramComparison`) | GO terbatas: simpan sebagai ID kreatif/post, bukan ad ID |
| `sourceID` absen, `ctwa_clid` ada | GO terbatas: touch dengan `ctwa_clid` + `sourceURL`; pemetaan ke ad set/campaign butuh jalur lain (Cloud API atau Marketing API) |
| `ctwa_clid` ada di < 80% `CTWA_AD`, atau sampel < 30 | NO-GO: perpanjang capture atau perbaiki sumber dulu |

`sourceIdLooksLikeAdId` di report sengaja selalu `null`: ID baru boleh disebut ad ID setelah dicocokkan manual.
