# Pengecualian historis: checksum `20261007110000_team_broadcast_contacts` (CRLF applied)

Keputusan Owner 4 Oktober 2026: opsi **C** (pengecualian sempit di verifier). Tidak ada migration yang diubah, tidak ada metadata DB production yang ditulis.

## Temuan
`node scripts/verify-migration-history.js` (hanya SELECT) pada production gagal **sebelum** slice P12B ada:

```
GAGAL: 20261007110000_team_broadcast_contacts: checksum drift TIDAK diizinkan (db=ed5e9934 repo=a61efcfa)
```

Bukti (SHA-256 penuh):

| Sumber | SHA-256 |
|---|---|
| Berkas di repo (blob git, LF kanonis, satu commit `d81ab104`, 1 Okt 2026) | `a61efcfadb06f1c0151de5f8a842aaec25c1955cdd030c917e82b8f05f584395` |
| `_prisma_migrations.checksum` di production (`finished_at` 2026-10-01 02:09:10 UTC) | `ed5e993401ab55c0855299a3e7fda2bc3c5e198cd5fcaf1965390e62a9ed82bd` |
| Berkas repo dengan **setiap LF diganti CRLF** | `ed5e993401ab55c0855299a3e7fda2bc3c5e198cd5fcaf1965390e62a9ed82bd` (= checksum applied) |

Kesimpulan: migration diterapkan dari working tree **CRLF** (kelas masalah "rilis harus LF"). Isi SQL identik; hanya akhir baris yang beda. `prisma migrate deploy`
tidak memeriksa ulang checksum migration yang sudah applied, sehingga production berjalan normal. Release dir live membawa berkas LF yang sama dengan repo.

## Pengecualian (kode: `CRLF_EXCEPTION` di `backend/src/lib/migrationHistoryVerifier.js`)
Lulus **hanya jika semuanya benar**:
1. nama migration persis `20261007110000_team_broadcast_contacts`;
2. baris `_prisma_migrations` **selesai** (`finished_at`) dan **tidak rolled back**;
3. checksum DB = `ed5e9934…82bd` (hash penuh, bukan prefix);
4. berkas repo **tanpa satu pun byte CR** dan ber-hash `a61efcfa…4395` (LF kanonis);
5. konversi LF→CRLF berkas repo menghasilkan persis `ed5e9934…82bd`.

Bukan allowlist umum: migration lain dengan pola yang sama tetap gagal; perubahan SQL satu byte gagal; berkas repo ber-CR gagal; baris tidak selesai gagal; baris
rolled back diabaikan dan pengecualian tidak dipakai. Bila checksum DB kelak diperbaiki ke hash LF, verifier cocok biasa tanpa pengecualian.

**Pelaporan:** CLI mencetak `PENGECUALIAN HISTORIS DIPAKAI [CRLF_APPLIED]: …` dan baris akhir `migration history: OK DENGAN N PENGECUALIAN HISTORIS (bukan "tanpa drift")`.
Hasil verifier TIDAK BOLEH dilaporkan sebagai "tidak ada drift" selama pengecualian ini dipakai. (Pengecualian historis lain yang terdokumentasi: LID, satu baris —
`docs/MIGRATION-HISTORY-LID-MAPPING-EXCEPTION.md`.)

## Mencegah terulang
- Verifier menolak sumber migration yang mengandung CR (`sumber migration mengandung CR`), dan CLI punya mode tanpa DB: `node scripts/verify-migration-history.js --sources-only`
  — jalankan sebelum build/rilis.
- Tes `migrationHistoryVerifier.test.js` memeriksa seluruh `migration.sql` di repo LF.
- `.gitattributes`: `backend/prisma/migrations/**/migration.sql text eol=lf` (checkout Windows tidak lagi menghasilkan CRLF).
- Aturan rilis: rilis dibangun dari `git archive` (blob LF); jangan menyalin working tree Windows ke server.
