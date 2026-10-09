# Audit migrasi applied: `20260906120000_block_reason_extended` dan `20260906130000_production_blockers`

Dilakukan baca-saja pada production (tanpa mengubah apa pun). Kesimpulan: **bukan yatim — folder-nya ada di repo dan checksum-nya cocok dengan production.** Temuan "applied tapi foldernya hilang" di dokumen kandidat sebelumnya adalah **kesalahan alat saya**, sudah dikoreksi.

## Penyebab salah baca
Saya membandingkan daftar folder repo dengan daftar applied setelah menyaring `migration_lock.toml` memakai `grep -v lock`. Nama kedua migrasi ini mengandung kata **"lock"** (`b`**`lock`**`_reason_extended`, `production_b`**`lock`**`ers`), sehingga ikut tersaring dari sisi repo dan tampak "tidak ada folder". `git ls-tree` pada `2e7d5db8`, `7c4e5586`, `2a5ab783`, `934142cd`, dan kandidat membuktikan kedua folder ada di semuanya. Skrip rehearsal pertama memakai penyaring yang sama (daftar `cand.txt` tanpa kedua nama itu), tetapi `prisma migrate deploy` memakai folder asli sehingga hasil rehearsal tetap benar (+7).

## Bukti
| | `20260906120000_block_reason_extended` | `20260906130000_production_blockers` |
|---|---|---|
| Folder di repo | ada (komit asal `f03167f9`, 7 Sep 2026; leluhur live dan kandidat) | ada (komit yang sama) |
| Tercatat di `_prisma_migrations` production | selesai, tidak rolled-back, 1 langkah | selesai, tidak rolled-back, 1 langkah |
| Checksum production | `4c3fa7bc…c339` | `c52b45fa…a63c` |
| sha256 berkas repo (LF) | `4c3fa7bc…c339` — **sama** | `c52b45fa…a63c` — **sama** |
| Isi | `ALTER TYPE "BlockReason" ADD VALUE` ×3 (aditif) | tabel `production_blockers`, indeks, FK (aditif) |

Skema (`schema.prisma`) memuat nilai enum `AWAITING_CUSTOMER/OPERATOR/TOOL` dan model `ProductionBlocker`; kode (`unitStageEngine.js`, `productionExceptions.js`, …) memakainya.

## Audit checksum seluruh migrasi terpasang (229)
Checksum production (hanya baris selesai dan tidak rolled-back) vs sha256 berkas kandidat, dijalankan oleh pratinjau skrip rilis: **227 sama, 2 berbeda** — keduanya **sudah ada sebelum kandidat ini** dan tidak berhubungan dengan Produksi: `20260707130141_add_lid_mapping` dan `20261007110000_team_broadcast_contacts` (CRLF historis, lihat `docs/MIGRATION-HISTORY-TEAM-BROADCAST-CRLF.md`). (`lead_attribution` dan `return_to_depot` hanya tampak berbeda bila baris rolled-back ikut dihitung.) `prisma migrate deploy` tidak memverifikasi checksum migrasi yang sudah terpasang. Skrip rilis memeriksa ulang dan **berhenti** bila ada selisih di luar daftar tercatat.

## Perbaikan alat
`scripts/release-produksi-fase1-5.sh` tidak lagi memakai `grep -v lock`; ia memakai pola `^[0-9]{14}_` dan memeriksa bahwa **setiap migrasi terpasang punya folder di kandidat** (berhenti bila tidak), serta bahwa pending = tepat 7 migrasi yang di-pin.
