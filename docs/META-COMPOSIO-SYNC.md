# Sinkronisasi Meta lewat Composio

Sumber data: Meta Marketing API (`source = META_MARKETING_API`, prioritas 1). Transport tercatat `COMPOSIO` di `meta_spend_imports.transport` dan `meta_ad_reference_imports.transport`. Lead, order, pembayaran, dan rumus atribusi tetap dari SANSS.

## Konfigurasi (nama saja; nilai di `backend/.env` persisten, jangan di chat atau git)
| Nama | Isi |
|---|---|
| `COMPOSIO_API_KEY` | API key project Composio yang memiliki connected account Meta |
| `COMPOSIO_META_CONNECTED_ACCOUNT_ID` | ID connected account (`ca_…`) milik project itu, bukan koneksi chat |
| `COMPOSIO_META_USER_ID` | user_id koneksi (wajib bila koneksi shared) |
| `COMPOSIO_META_TOOL_VERSION` | versi toolkit tetap; `latest` ditolak |
| `META_ADS_ACCOUNT_ID` | `2081614415911241` |
| `COMPOSIO_META_SYNC_ENABLED` | `true` untuk mengizinkan commit; bawaan OFF |

Pemasangan: buat project/API key dan hubungkan Meta di dashboard Composio, tambahkan nama di atas ke `.env` lewat editor di VPS (jangan lewat argumen perintah), recreate backend, lalu `--cek`.

## Mode
`docker exec klinik-matras-backend-1 node scripts/sync-meta-composio.js --cek | --dry | --commit | --verify [--dari=… --sampai=…]`. Tanpa rentang: rolling 7 hari penuh sampai kemarin WIB. Hari berjalan ditolak. Keluar 0 sukses, 3 tidak siap/belum direkonsiliasi, 2 gagal.

## Aturan
- Tool yang bisa dipanggil hanya `METAADS_GET_INSIGHTS`, `METAADS_GET_OBJECT`, `METAADS_GET_MULTIPLE_OBJECTS`.
- Percakapan platform: `onsite_conversion.messaging_conversation_started_7d`, kolom `value`. Kolom `7d_click` tidak dipakai. Contoh 7 Nov 2026: value 79, 7d_click 77. `action_attribution_windows=["7d_click"]` dikirim; `action_report_time` tidak tersedia di tool sehingga memakai bawaan Meta. Keduanya dicatat di `meta_sync_runs.attribution`.
- Hari dengan selisih kontrol (spend sen, impressions, klik) atau konflik hierarki ditahan utuh dan run berstatus `BELUM_DIREKONSILIASI`. Selisih percakapan hanya informasi.
- Status hari: `DELIVERY_TERVERIFIKASI`, `NOL_TERVERIFIKASI`, `TANPA_DELIVERY` (bukan bukti Rp0), `BELUM_REKONSILIASI`, `DITAHAN_KONFLIK`; di verify juga `DATA_HILANG`. Gerbang KPI laporan tidak diubah: hari tanpa baris spend tetap membuat CPA/ROAS null.
- Breakdown ada di `meta_account_daily_breakdowns`, tidak dijumlahkan ke laporan. Reach non-aditif: contoh 7 Nov Σ posisi 47.049 vs reach platform 45.085.
- Hook rate: `hookRate()`, Σ pemutaran 3 detik ÷ Σ impressions Ad bermetrik video.
- Thumbnail tidak disimpan karena URL CDN bertanda tangan dan kedaluwarsa.

## Rollout
1. Rilis kode: `scripts/release-meta-composio.sh` (flag OFF). 2. Pasang konfigurasi; `--cek`. 3. `--dry --dari=2026-10-01 --sampai=<kemarin>`. 4. Setelah disetujui: flag ON, `--commit` rentang sama, `--verify`. 5. Pasang `scripts/meta-composio-sync-cron.sh` (blok di kepala berkas, tiap 3 jam). 6. Klaim AUTO SYNC hanya setelah run terjadwal terbukti dan data diverifikasi independen.

## Penghentian dan rollback
- Hentikan sync: cabut blok cron, `COMPOSIO_META_SYNC_ENABLED=false`. Histori tetap.
- Rollback kode: `bash /tmp/mcs.sh <DEPLOY> <BASE> --rollback`. Migrasi aditif dibiarkan.
- Bila data Composio harus dibatalkan: baris `META_MARKETING_API` menang atas Windsor per Ad-hari, jadi pembatalan adalah keputusan data terpisah, dengan backup; skrip tidak menyediakan penghapusan.
- Windsor dan input manual tidak disentuh.

## Batas bukti
Rehearsal replay memakai respons nyata yang disalin dari koneksi chat, bukan panggilan backend. Akses backend ke Composio belum terbukti sampai `--cek` lulus di server. Bentuk respons REST v3.1 diasumsikan sama dengan respons tool chat; `--cek` dan `--dry` adalah pembuktiannya.
