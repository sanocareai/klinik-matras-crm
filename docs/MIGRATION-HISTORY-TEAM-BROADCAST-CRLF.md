# Temuan: checksum drift `20261007110000_team_broadcast_contacts` (CRLF)

Ditemukan 4 Okt 2026 saat gate rilis P12B.7. `node scripts/verify-migration-history.js` (hanya SELECT) pada production **sudah gagal sebelum slice P12B**:

```
migration applied diperiksa: 215; pending: -
PENGECUALIAN HISTORIS (terdokumentasi): 20260707130141_add_lid_mapping
GAGAL: 20261007110000_team_broadcast_contacts: checksum drift TIDAK diizinkan (db=ed5e9934 repo=a61efcfa)
```

## Bukti
- Repo: `backend/prisma/migrations/20261007110000_team_broadcast_contacts/migration.sql`, satu commit (`d81ab104`, 1 Okt 2026 09:05 WIB), LF, sha256 `a61efcfa…`.
  Release dir live (`b0005a11`) membawa berkas yang sama (`a61efcfa`).
- DB production: `_prisma_migrations.checksum` = `ed5e9934…`, `finished_at` 2026-10-01 02:09:10 UTC.
- Berkas yang sama dengan **CR ditambahkan di setiap akhir baris** (CRLF, termasuk newline akhir) ber-sha256 **tepat `ed5e9934`**.
  Varian lain (tanpa newline akhir, LF tanpa newline akhir) tidak cocok.
- Kesimpulan: migration diterapkan dari working tree **CRLF** (kelas masalah "rilis harus LF" yang sama dengan B3.2/B3.3). Isi SQL identik; hanya beda byte akhir-baris.
  `prisma migrate deploy` tidak memeriksa ulang checksum migration yang sudah applied, sehingga production berjalan normal.

## Dampak
- Tidak ada dampak runtime. Verifier (gate rilis yang diminta Owner) gagal dan memang harus gagal: tidak ada pengecualian untuk ini.
- Slice P12B tidak menambah/mengubah migration (0 berkas di `backend/prisma`), jadi bukan penyebab.

## Opsi pemulihan (keputusan Owner; tidak ada yang dijalankan)
A. **Perbaiki metadata DB** (setelah backup restore-verified): set `_prisma_migrations.checksum` migration itu ke checksum LF repo (`a61efcfa…`, hash penuh dihitung
   dari berkas). Satu baris metadata, SQL tidak berubah. Menyentuh tulisan production → butuh persetujuan eksplisit.
B. **Samakan repo dengan DB**: commit berkas migration versi CRLF. Verifier lulus tanpa menyentuh production, tetapi memasukkan berkas CRLF ke repo
   (bertentangan dengan kebijakan LF; rawan normalisasi git/autocrlf).
C. **Pengecualian historis sempit seperti LID** (`EXCEPTION` di `backend/src/lib/migrationHistoryVerifier.js` + dokumen): lulus hanya bila berkas repo
   dikonversi ke CRLF persis menghasilkan checksum DB. Tidak menyentuh production dan tidak mengubah berkas. Ini melonggarkan verifier secara eksplisit,
   jadi harus diputuskan Owner.

Rekomendasi: C atau A. Jangan merename migration applied.
