# Pengecualian checksum historis: `20261007110000_team_broadcast_contacts` (line ending)

Status: forensik selesai 2026-10-02. Remediasi: pengecualian verifier yang sangat sempit (opsi B). Tidak ada deploy, migration, perubahan flag/cohort,
atau mutasi production. Baris `_prisma_migrations` TIDAK ditulis ulang; file migration TIDAK diubah.

## Ringkasan
| | SHA-256 | Byte | CR |
|---|---|---|---|
| `_prisma_migrations` production (diterapkan 2026-10-01 02:09:10Z) | `ed5e993401ab55c0855299a3e7fda2bc3c5e198cd5fcaf1965390e62a9ed82bd` | 2089 | 31 |
| File repo (blob git `738882fd`, satu-satunya versi sejak `d81ab104`) | `a61efcfadb06f1c0151de5f8a842aaec25c1955cdd030c917e82b8f05f584395` | 2058 | 0 |

**Akar masalah:** rilis Broadcast Team dibangun dari salinan kerja Windows, sehingga image rilisnya membawa file ini dengan CRLF. Prisma mencatat
SHA-256 byte yang benar-benar diterapkan (CRLF). Repo menyimpan LF. Isi SQL identik; bedanya hanya line ending (31 baris).

Bukti byte-exact: mengganti setiap `LF` pada blob git dengan `CRLF` menghasilkan tepat `ed5e9934…` (2089 byte). Tidak ada versi Git lain: file hanya
diubah oleh satu commit (`git log --all --follow` → hanya `d81ab104`).

## Provenance (urutan kejadian, waktu UTC; server VPS memakai +0800)
| Waktu | Kejadian |
|---|---|
| 2026-10-01 02:05:24Z | commit `d81ab104` (Broadcast Team) memperkenalkan file (LF) |
| 02:08:35Z | backup `pre-broadcast-team-d81ab104-…` — **tidak** memuat tabel `team_contacts` maupun baris migration (belum diterapkan) |
| 02:09:10Z | migration diterapkan (`started_at` 02:09:10.625, `finished_at` 02:09:10.652, 1 langkah) — checksum `ed5e9934…` |
| 10:08:53 +0800 | image rilis Broadcast Team (`152f23070e04`) dibuat. File migrasi di dalam image: SHA-256 `ed5e9934…`, 2089 byte, 31 CR. Berkas migration lain di image yang sama (mis. `20261006080000`) juga ber-CRLF → seluruh pohon rilis dari checkout CRLF |
| rilis berikutnya (image `e401ac7b4274`, `klg-58898305`) | file di image sudah LF `a61efcfa…` (dibangun dari `git archive`) |
| backup `pre-klg-58898305-…` dst. | memuat baris `_prisma_migrations` dengan `ed5e9934…` |

Perubahan terjadi **sebelum** applied (file yang diterapkan sudah CRLF); repo tidak pernah berisi CRLF. Hanya migration BARU pada rilis tsb. yang
terekam checksum-nya; migration lama tidak diterapkan ulang sehingga tidak terpengaruh.

## Uji replay di PostgreSQL terisolasi (DB scratch; production hanya `pg_dump -s` baca-saja)
Image/Prisma yang sama dengan production, migration dari commit `2c4909ad` (211 migration).
| Skenario | Checksum tercatat | Migration applied | Hasil |
|---|---|---|---|
| A. clean 0→latest, file LF (repo) | `a61efcfa` | 211 | berhasil; replay `migrate deploy` = no pending |
| B. clean 0→latest, file CRLF (byte image rilis) | `ed5e9934` | 211 | berhasil; replay = no pending |
| C. upgrade dari backup pra-migration + file LF | `a61efcfa` | 204→211 | berhasil |
| D. upgrade dari backup pra-migration + file CRLF | `ed5e9934` | 204→211 | berhasil |

- Skema A == B (5328 baris, identik byte-per-byte). C == D selain tabel manual `backup_*` yang terbawa dari backup.
- Data terdampak identik di semua skenario dan production: 8 baris seed `team_contacts` (md5 sama), kolom `staff_broadcasts.contact_ids` tipe `ARRAY`,
  indeks `team_contacts_active_division_idx`, `team_contacts_division_name_key`, `team_contacts_pkey`.
- Beda skema A vs production: hanya dua tabel manual `backup_assigned_sales_20260823` dan `backup_unit_status_20260830` (di luar migration; tidak terkait).
  Beda C vs production: representasi teks satu CHECK `fin_inventory_openings_status_check` (format pg_dump, bukan perubahan skema; tidak terkait).

Kesimpulan audit: **hanya line ending**. Tidak ada perubahan schema/constraint/index/data. Tidak ada schema drift material.

## Keputusan remediasi
Kriteria opsi A (restore byte-exact) terpenuhi secara teknis, namun **tidak dipilih**:
1. Repo seluruhnya LF (semua file migration `i/lf w/lf`); beberapa tes migration menegakkan "migration harus LF (checksum stabil)" dan rilis dibangun dari checkout LF.
2. File CRLF akan menjadi satu-satunya yang ber-CR; bertahan hanya dengan atribut `-text` — mekanisme normalisasi EOL itulah penyebab drift ini.
3. `git diff --check` menandai CR di akhir baris sebagai whitespace error pada setiap perubahan berikutnya.

Dipilih **opsi B**: pengecualian verifier tepat satu migration (`CRLF_EXCEPTION` di `backend/src/lib/migrationHistoryVerifier.js`). Lulus hanya bila semua benar:
nama migration persis; checksum DB persis `ed5e9934…` (lengkap 64 hex); checksum repo persis `a61efcfa…` (lengkap); file repo tidak mengandung CR dan,
setelah setiap LF diganti CRLF, ber-SHA-256 persis checksum DB (bukti byte-exact). Salah satu berubah → GAGAL. Bukan wildcard: migration lain dengan beda
EOL tetap gagal; pengecualian LID (`20260707130141_add_lid_mapping`) tidak diubah dan tetap menegakkan invariannya sendiri; keduanya independen.

Bila suatu hari file repo diubah/checkout menjadi CRLF byte-identik dengan DB, checksum cocok biasa (pengecualian tidak dipakai).

## Verifikasi
- `backend/tests/migrationHistoryVerifier.test.js` (21 tes): positif (kondisi production nyata → dua pengecualian), tamper checksum DB, tamper isi repo (byte/baris/
  spasi/huruf), repo ber-CR, bukan wildcard (migration lain, checksum DB dipakai nama lain, checksum LID pada migration ini), LID tetap bekerja & independen,
  CLI `--json` hijau lalu merah bila checksum dirusak.
- **Salinan `_prisma_migrations` production** (216 baris, ekspor SELECT baca-saja) dijalankan lewat `node backend/scripts/verify-migration-history.js --json <salinan>`:
  sebelum perubahan GAGAL (`checksum drift TIDAK diizinkan (db=ed5e9934 repo=a61efcfa)`), sesudah perubahan OK (211 diperiksa, dua pengecualian, pending: -).
- Tes batas migration yang ada (`productionDeliveryV2MigrationBoundary`, `unitCustodyMigrationAndAudit`, `productionExperience`) tetap lulus.

## Pencegahan
Rilis harus dibangun dari `git archive` (LF), bukan salinan kerja Windows. Skrip rilis generik (`scripts/release-production-v2.sh`) sudah memakai `git archive`.
