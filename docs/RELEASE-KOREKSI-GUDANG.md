# Rilis Koreksi Dokumen Gudang — prosedur dan gerbang

Rilis KODE (backend + web) dengan **1 migrasi aditif**: `20261220090000_gudang_koreksi_dokumen` (tabel `warehouse_corrections` kosong + 2 kolom NULL `correction_id`, `corrects_movement_id` pada `stock_movements`, 4 FK, 4 CHECK, 6 indeks, trigger append-only, pencabutan hak `mcp_hub_readonly`). Tanpa backfill, tanpa perubahan data lama.
UX Tahap 1 (Beranda, halaman detail Penerimaan, Stok & Lokasi, navigasi) adalah **rilis berikutnya** dan TIDAK ada di rilis ini.

Fitur: jalur koreksi per dokumen Gudang (`/api/inventory/koreksi/*`), koreksi Penerimaan tanpa PO yang sudah masuk stok (pergerakan pembalik bertaut, pemohon ≠ penyetuju), jejak edit draf, tab "Koreksi Dokumen". Penerimaan dari PO tetap memakai Koreksi Kedatangan resmi (tidak diubah).

## Skrip

| Berkas | Fungsi |
|---|---|
| `scripts/gen-release-koreksi-gudang.cjs` | Membangkitkan `scripts/release-koreksi-gudang.sh` dari templat; semua nilai bergantung-commit (allowlist, daftar berkas, pin sha256 migrasi, pin diff schema, hasil pemindai DDL, commit live wajib leluhur) dihitung dari git terhadap `--base` |
| `scripts/templates/release-koreksi-gudang.sh.tpl` | Templat skrip rilis (jangan edit hasil bangkitan) |
| `scripts/release-koreksi-gudang.sh` | Skrip rilis bergerbang (fail-closed) |
| `scripts/lib/scan-migrasi-koreksi-gudang.mjs` | Pemindai DDL (daftar putih bentuk pernyataan) |
| `scripts/lib/rehearsal-kode-koreksi-gudang.mjs` | Kode BARU terhadap data restore yang sudah dimigrasi (baca-saja) |
| `scripts/lib/smoke-koreksi-gudang.mjs` | Smoke baca-saja pasca-switch |
| `scripts/rollback-guard-koreksi-gudang.sh` | Guard rollback kode (baca-saja) |
| `backend/tests/releaseKoreksiGudang.test.js` | Tes generator + gerbang + konsistensi uji perilaku |

```
node scripts/gen-release-koreksi-gudang.cjs --base <SHA_LIVE>           # bangkitkan ulang setelah baseline live digabung
node scripts/gen-release-koreksi-gudang.cjs --base <SHA_LIVE> --check   # harus SAMA sebelum rilis

cat scripts/release-koreksi-gudang.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/kg.sh'
ssh ubuntu@43.133.152.6 'bash /tmp/kg.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja
ssh ubuntu@43.133.152.6 'bash /tmp/kg.sh <DEPLOY_SHA> <BASE_SHA> --rehearsal-only'   # backup nyata + restore ke DB sementara + migrasi; produksi tidak diubah
ssh ubuntu@43.133.152.6 'nohup bash /tmp/kg.sh <DEPLOY_SHA> <BASE_SHA> > /tmp/kg.out 2>&1 < /dev/null &'   # rilis penuh (atas keputusan)
```

## Gerbang (urut; semua fail-closed)

1. **Sumber:** kandidat = `origin/<cabang>`; baseline = release aktif; baseline, `origin/main`, dan commit live (Produksi override, Riwayat Referensi, bukti serah) semuanya leluhur kandidat; hotfix Stock Count ada di baseline dan kandidat; berkas pelindung (Stock Count, opname, jurnal, otorisasi, izin, Produksi override, kedatangan PO) identik dengan baseline.
2. **Allowlist eksplisit** berkas yang berbeda dari baseline; tidak ada dist, dependensi, Docker/compose, `.env`, driver-mobile, artefak uji.
3. **Migrasi:** hanya `schema.prisma` + tepat 1 migrasi baru; migrasi baseline tidak diubah/dihapus; pin sha256 isi migrasi (LF); pin diff `schema.prisma`; pemindai DDL (19 pernyataan: 1 tabel, 1 ALTER dua kolom, 6 indeks, 4 FK, 4 CHECK, fungsi, trigger, revoke) + 28 mutan negatif harus ditolak; nama migrasi terurut setelah migrasi live terakhir (`20261219090000_…`).
4. **Produksi (baca-saja):** release aktif = baseline; health; bundel publik = dist aktif; tidak ada migrasi menggantung; semua migrasi terpasang ada di kandidat; **pending = TEPAT migrasi ini**; objek koreksi belum ada; dampak (baris/ukuran `stock_movements`, `goods_receipts`, DB); sidik jari beku (T0−5 menit) untuk pergerakan stok, saldo per bahan, GR + baris + event, jurnal, PO, tagihan, alokasi, pembayaran, run Produksi, aktivitas.
5. **Backup nyata** (`pg_dump`, `gzip -t`, checksum) lalu **rehearsal** pada restore backup itu di DB sementara:
   restore bersih (exit 0, 0 ERROR, WARNING dilaporkan) → identik dengan produksi → sidik jari baris-penuh SEMUA tabel lama → migrasi (waktu per pernyataan) → struktur (kolom uuid nullable tanpa default, semua NULL; 4 FK + 4 CHECK + 6 indeks tervalidasi; trigger hanya pada `warehouse_corrections`; `mcp_hub_readonly` tanpa SELECT) → skema + katalog objek tabel lama identik → **uji perilaku** pada baris nyata (16 penolakan: CHECK, unik, FK, trigger append-only, pembalik wajib bertaut, tidak menunjuk diri, RESTRICT; 4 operasi sah; seluruhnya dibatalkan) → sidik jari semua tabel + saldo per bahan + riwayat migrasi lama sebelum = sesudah → DB sementara dihapus.
6. Rilis penuh menambah: build web + image, rehearsal ulang dengan `prisma migrate deploy` dari image baru + kode baru terhadap data restore, migrasi produksi SATU kali (backend lama tetap melayani), switch, verifikasi byte-identik berkas backend, smoke baca-saja (izin, penolakan sebelum menyentuh data, jalur koreksi per GR nyata), sidik jari beku sebelum = sesudah.

## Rollback

* Sebelum switch: backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
* Kode: `scripts/rollback-guard-koreksi-gudang.sh` (baca-saja) menolak hanya bila ada koreksi `PENDING_APPROVAL` (selesaikan dulu). Rollback kode **tidak menghapus** tabel, kolom, koreksi POSTED, atau pergerakan pembalik — saldo ledger (`SUM(qty)`) tetap benar; yang hilang hanya UI/API koreksi.
* Pemulihan database penuh hanya atas keputusan Owner (menghapus koreksi yang dibuat sesudah backup).

## Dampak migrasi pada tabel aktif

`ADD COLUMN` nullable tanpa default = perubahan katalog saja. `CREATE INDEX` (2) dan validasi FK (2) pada `stock_movements` mengunci tulis tabel itu sepanjang pemindaian; pada produksi tabel kecil (puluhan baris saat persiapan) sehingga sekejap. Rehearsal mencetak waktu per pernyataan pada restore nyata. Bila `stock_movements` kelak jauh lebih besar, jadwalkan di luar jam transaksi.
