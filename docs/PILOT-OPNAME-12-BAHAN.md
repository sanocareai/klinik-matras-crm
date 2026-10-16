# Pilot Opname 12 Bahan — Sesi hitung, preview, dan matriks keputusan

Untuk: Kepala Gudang, dua petugas Gudang (penghitung dan pemeriksa), Finance, dan Tech yang menjalankan preview.
Status: **persiapan selesai; hitung fisik BELUM dilakukan.** Tidak ada angka fisik, nama petugas, atau tanda pergerakan yang diisi oleh sistem/Tech. Pilot ini **berhenti di status Waiting Review** — tombol *Complete Count* (yang menulis ADJUSTMENT) **tidak ditekan** dalam pilot.

## 1. Orang (diisi Gudang; tidak boleh diwakilkan Tech)
| Peran | Tugas | Syarat |
|---|---|---|
| Petugas A — penghitung | membuat Stock Count, menghitung buta, menginput angka di aplikasi | akun login A (nama dibaca dari akun, bukan ketikan) |
| Petugas B — pemeriksa | menghitung ulang/menyaksikan, lalu menekan **Saya memeriksa hitungan ini** di aplikasi setelah Submit | akun login B, **orang lain dari A** (akun penugas juga tidak sah) |
| Penanda pergerakan | satu orang (A atau B) menandai pergerakan selama sesi | tanda dibuat sadar, per pergerakan |
| Penyetuju (Owner/Finance) | hanya dibutuhkan bila nanti ada Complete — **bukan bagian pilot** | orang lain dari A, B, penanda |

## 2. Langkah di aplikasi (dikerjakan Gudang)
1. **Gudang → Stock Opname → Schedule Count**: jenis **Opname Penuh** (wajib — hanya jenis ini yang mensyaratkan pemeriksa sebelum Complete), metode *By Item*, *Blind count* tetap menyala, *Assigned To* = Petugas A. Tambahkan 12 bahan (cari lewat kode — daftar di `Lembar-Hitung-PILOT.xlsx` › Hitung; Material ID tertera).
2. **Start Count** — sistem merekam snapshot saldo dan waktu mulai. Mulai dari sini setiap pergerakan ledger pada 12 bahan akan tampil di detail count.
3. Hitung fisik per bahan (lokasi per lokasi). Input angka di kolom *Counted* di aplikasi **atau** minta A menyalin ke lembar; angka di aplikasi dibaca preview. **Angka 0 hanya bila memang dicari dan kosong** (status NOL_FISIK + foto di lembar).
4. Isi **Lembar-Hitung-PILOT.xlsx** (sheet *Hitung*): Lokasi, Bukti (nomor foto/form), waktu mulai/selesai per bahan bila dicatat (Penghitung/Pemeriksa di lembar TIDAK dipakai — nama diambil dari akun yang login di aplikasi; nama lembar yang berbeda hanya jadi peringatan), dan kolom terpisah (GR sudah datang belum diposting, dalam perjalanan, sisa di lantai produksi, milik customer). Sheet *Sesi*: tanggal, jam, nomor dokumen terakhir.
5. Bila ada pergerakan ledger selama sesi (GR diposting, Issue, retur, dll.), buka detail count dan **tandai satu per satu**: *Sudah masuk hitungan fisik* atau *Belum masuk hitungan*. Sistem tidak menebak; Complete ditolak selama ada yang belum ditandai. Mengubah angka hitung atau *Recount* **mereset** tanda material itu — tandai ulang.
6. **Submit Count** (→ Waiting Review).
7. **Petugas B** membuka detail count dan menekan **Saya memeriksa hitungan ini** (blok *Petugas hitungan* menampilkan Dihitung oleh / Diperiksa oleh). Pemeriksaan **batal otomatis** bila angka diubah atau Recount — tekan lagi setelah Submit ulang. **Berhenti di sini** (Complete tidak dilakukan di pilot).

## 3. Preview (Tech, baca-saja)
```bash
docker compose cp Lembar-Hitung-PILOT-terisi.xlsx backend:/tmp/pilot.xlsx
docker compose exec -T backend node scripts/opname-preview.mjs --file /tmp/pilot.xlsx --stock-count <No. Count> --out /tmp/preview-pilot [--saldo-1400-sampai 2026-10-xx]
docker compose cp backend:/tmp/preview-pilot ./preview-pilot
docker compose exec -T backend node scripts/opname-matriks-pilot.mjs --pilot <12 kode dipisah koma> --preview /tmp/preview-pilot/preview.json [--keputusan /tmp/keputusan.xlsx] --out /tmp/matriks
```
Preview menggabungkan angka & waktu dari Stock Count dengan metadata lembar, membaca tanda pergerakan, dan **tidak menulis apa pun** (transaksi READ ONLY; tanpa `--apply`). Isu yang menghalangi (BLOCKER) ditampilkan, tidak diselesaikan otomatis.

## 4. Matriks 12 bahan
Kolom: fisik · satuan · saldo pada waktu hitung · pergerakan sesi (dengan tanda) · selisih · bukti · dokumen tertunda · keputusan Gudang · keputusan Finance · **KUANTITAS GO/NO-GO** · **VALUASI SIAP/BELUM**.
- **GO kuantitas** = ada hasil hitung Gudang + tanpa BLOCKER + tanpa dokumen tertunda + keputusan Gudang `TERIMA_FISIK`. GO berarti *boleh diajukan* sebagai Stock Adjustment/Count (pengaju ≠ penyetuju), **bukan** diposting.
- **Valuasi SIAP** hanya bila harga bersumber dokumen sah (faktur/tagihan/pembelian) **dan** Finance memutuskan `HARGA_DITETAPKAN`. Harga sheet lama dan harga referensi master tidak sah.
- Nilai selisih **naik** dan **turun** dijumlah terpisah; tidak ada angka bersih.

## 5. Hal khusus di pilot
- **LEM-I-SR-1037-13-KG**: dua GR ESA duplikat (GR-091026-02, GR-151026-01) untuk PO 10 CAN — NO-GO sampai petugas memutuskan satu GR (lihat `AUDIT-GR-ESA-16okt.md`). Satuan master CAN (bukan kg).
- **LIST-WIBING-ABU**: master ROLL; saldo −383,5 akibat pemakaian lama dalam meter. Hitung dalam ROLL.
- **BUSA-SOFT-FOAM-35SS-SKY-160X200X2**: PO-15102026-006 (25 lembar, DISETUJUI) belum ada GR; bila barang tiba selama sesi, putaway-nya akan menjadi pergerakan sesi yang harus ditandai.
- Bahan stok-diam dan ledger-nol (SAKURA, SUDUT, OLYMPIC): angka lama di file Jan–Sep **tidak dipakai** sebagai pembanding hitung.

## 6. Setelah pilot (di luar dokumen ini)
Posting apa pun (Complete Count, Stock Adjustment, jurnal persediaan awal) menunggu keputusan Owner (tanggal cutover, penyetuju, perlakuan pembelian tanpa GR) dan keputusan Gudang/Finance per bahan.
