# Sinkronisasi Meta lewat Composio

Sumber data: Meta Marketing API (`source = META_MARKETING_API`, prioritas 1). Transport tercatat `COMPOSIO` di `meta_spend_imports.transport` dan `meta_ad_reference_imports.transport`. Lead, order, pembayaran, dan rumus atribusi tetap dari SANSS.

## Konfigurasi (nama saja; nilai di `backend/.env` persisten, jangan di chat atau git)
| Nama | Isi |
|---|---|
| `COMPOSIO_API_KEY` | API key project Composio yang memiliki connected account Meta |
| `COMPOSIO_META_CONNECTED_ACCOUNT_ID` | ID connected account (`ca_…`) milik project itu, bukan koneksi chat |
| `COMPOSIO_META_USER_ID` | user_id koneksi. Wajib: kosong = `TIDAK_SIAP` kode `COMPOSIO_META_USER_ID_KOSONG` sebelum ada panggilan jaringan (REST sendiri membalas 400 kode 1811). `--cek` juga menolak nilai yang berbeda dari koneksi: `USER_ID_TIDAK_COCOK` |
| `COMPOSIO_META_TOOL_VERSION` | versi toolkit tetap; `latest` ditolak |
| `META_ADS_ACCOUNT_ID` | `2081614415911241` |
| `COMPOSIO_META_SYNC_ENABLED` | `true` untuk mengizinkan commit; bawaan OFF |

## Prosedur konfigurasi backend (dikerjakan pemilik akun, nilai tidak pernah masuk chat)
Koneksi chat (`metaads_…`) milik sesi konektor dan tidak otomatis tersedia untuk backend.
1. Dashboard Composio: pilih atau buat project khusus SANSS, buat API key project itu. Key terikat project.
2. Di project itu, hubungkan toolkit Meta Ads dengan akun yang berhak baca iklan `2081614415911241`. Catat ID `ca_…` dan user_id koneksinya. Bila hanya ada koneksi di project lain, buat koneksi baru di sini.
3. Tetapkan versi tool: lihat versi toolkit `metaads` terbaru di dashboard atau `GET /api/v3.1/tools/METAADS_GET_INSIGHTS`, salin versi tanggalnya (bukan `latest`). Saat menaikkan versi, ulangi langkah 6.
4. Secret: buka `~/klinik-matras/backend/.env` lewat editor di VPS (bukan argumen perintah, riwayat shell, atau chat). Isi nama di atas; biarkan `COMPOSIO_META_SYNC_ENABLED` kosong atau false. Ini perubahan env produksi, butuh persetujuan.
5. Recreate backend agar env terbaca (butuh izin terpisah), lalu `--cek`. Hasil harus `SIAP`: connected account aktif di project key ini, versi ada di `available_versions` ketiga tool, akun benar, IDR, Asia/Jakarta. Kode galat: `AKSES_COMPOSIO_DITOLAK` (key/project), `CONNECTED_ACCOUNT_TIDAK_ADA_DI_PROJECT` (ID dari project lain atau ID chat), `CONNECTED_ACCOUNT_TIDAK_AKTIF` (hubungkan ulang), `USER_ID_TIDAK_COCOK`, `VERSI_TOOL_TIDAK_TERSEDIA`, `AKUN_SALAH`.
   Uji sebelum menyentuh produksi: simpan nama-nilai di berkas pribadi di luar repo, lalu dari `backend/` kandidat `node --env-file=<berkas> scripts/sync-meta-composio.js --cek`. Mode ini tidak menulis DB. Hapus berkasnya setelah selesai.
6. Bukti REST nyata, tanpa flag: `--dry --dari=<hari penuh> --sampai=<hari yang sama>`. Periksa: status `DRY_RUN`; `kontrolSpend` = `adSpend`, selisih 0; ringkasan referensi 0 konflik; spend 0 ditolak/konflik. Lalu rentang 1 Okt–kemarin untuk pagination nyata. Dry-run hanya menulis catatan `meta_sync_runs`. Replay dari chat tidak menggantikan langkah ini.

## Mode
`docker exec klinik-matras-backend-1 node scripts/sync-meta-composio.js --cek | --dry | --commit | --verify [--dari=… --sampai=…]`. Tanpa rentang: rolling 7 hari penuh sampai kemarin WIB. Hari berjalan ditolak. Keluar 0 sukses, 3 tidak siap/belum direkonsiliasi, 2 gagal.

## Aturan
- Tool yang bisa dipanggil hanya `METAADS_GET_INSIGHTS`, `METAADS_GET_OBJECT`, `METAADS_GET_MULTIPLE_OBJECTS`. Kredensial Meta saat ini punya `ads_management`, jadi BUKAN read-only: pembatasan baca ada di adapter, dan siapa pun yang memegang API key project bisa memanggil tool tulis di luar adapter.
- Percakapan platform: `onsite_conversion.messaging_conversation_started_7d`, kolom `value`. Kolom `7d_click` tidak dipakai. Contoh 7 Nov 2026: value 79, 7d_click 77. `action_attribution_windows=["7d_click"]` dikirim; `action_report_time` tidak tersedia di tool sehingga memakai bawaan Meta. Keduanya dicatat di `meta_sync_runs.attribution`.
- Hari dengan selisih kontrol (spend sen, impressions, klik) atau konflik hierarki ditahan utuh dan run berstatus `BELUM_DIREKONSILIASI`. Selisih percakapan hanya informasi.
- Status hari: `DELIVERY_TERVERIFIKASI`; `NOL_TERVERIFIKASI` (baris kontrol eksplisit spend 0); `TIDAK_ADA_DELIVERY_TERAMATI` (kontrol dan Ad kosong pada tarikan rentang dan tarikan ulang per hari, akun tervalidasi, seluruh halaman selesai, tanpa spend tersimpan; `control_spend` tetap null); `DATA_TIDAK_LENGKAP` (gagal tarik, kontrol ulang tidak konsisten, atau spend tersimpan tetapi API kosong); `BELUM_REKONSILIASI`; `DITAHAN_KONFLIK`.
- Dasar tiap hari disimpan di `meta_account_daily_control.evidence`. Kedua status menutup hari di laporan; tidak dibuat baris spend Rp0. Rp0 total hanya bila SETIAP hari nol eksplisit (CPL/CPA 0 bila penyebut ada, null `BELUM_ADA_KONVERSI` bila penyebut 0, ROAS null `SPEND_NOL`). Periode yang seluruhnya atau sebagian kosong tanpa spend lain tetap null. Kegagalan atau respons kosong tidak menurunkan bukti lama. Batas bukti: respons kosong berarti API konsisten tidak melaporkan delivery, bukan pernyataan angka nol.
- Breakdown ada di `meta_account_daily_breakdowns`, tidak dijumlahkan ke laporan. Reach non-aditif: contoh 7 Nov Σ posisi 47.049 vs reach platform 45.085.
- Hook rate versi `HOOK_V1_3S_PER_IMPRESSION_VIDEO`: Σ `actions[video_view]` ÷ Σ impressions baris Ad video yang punya metrik itu. Creative tanpa `video_id` dikeluarkan. Metrik null tidak dianggap nol: keluar dari penyebut dan menurunkan coverage (`impressionsVideoTanpaMetrik`, `impressionsTidakDiketahui`). Versi tersimpan di tiap run dan tampil di panel. Hanya bandingkan dengan versi sama.
- `hariAdaSpend`: gabungan tanggal antar-Ad. Sebelumnya total selalu 0 dan baris gabungan memakai maksimum per Ad. Hanya tampilan; status biaya dan KPI memakai `hariHilang`.
- Ad ber-touch tanpa referensi: `lengkapiReferensiTouch` membaca hierarki resmi per ID, termasuk Ad tanpa spend. Konflik tidak ditimpa, Ad tak terbaca dilaporkan.
- Thumbnail tidak disimpan karena URL CDN bertanda tangan dan kedaluwarsa.

## Rollout
1. Rilis kode: `scripts/release-meta-composio.sh` (flag OFF). 2. Pasang konfigurasi; `--cek`. 3. `--dry --dari=2026-10-01 --sampai=<kemarin>`. 4. Setelah disetujui: flag ON, `--commit` rentang sama, `--verify`. 5. Pasang `scripts/meta-composio-sync-cron.sh` (blok di kepala berkas, tiap 3 jam). 6. Klaim AUTO SYNC hanya setelah run terjadwal terbukti dan data diverifikasi independen.

## Penghentian dan rollback
- Hentikan sync: cabut blok cron, `COMPOSIO_META_SYNC_ENABLED=false`. Histori tetap.
- Rollback kode: `bash /tmp/mcs.sh <DEPLOY> <BASE> --rollback`. Migrasi aditif dibiarkan.
- Bila data Composio harus dibatalkan: baris `META_MARKETING_API` menang atas Windsor per Ad-hari, jadi pembatalan adalah keputusan data terpisah, dengan backup; skrip tidak menyediakan penghapusan.
- Windsor dan input manual tidak disentuh.

## Izin kredensial
Ketiga tool hanya membaca. Metadata Composio ketiganya menerima `ads_read` atau `ads_management`; dokumen Meta: `ads_read` untuk laporan iklan akun, `read_insights` untuk Page/app/domain, bukan akun iklan. Field yang diminta adalah data iklan dan ID creative, tanpa membaca isi Page. Secara dokumen `ads_read` cukup, tetapi belum diuji dengan token `ads_read` saja; penggantian token wajib mengulang `--cek` dan `--dry` satu hari. Pemilik token tetap perlu akses ke akun iklan.

## Batas bukti
Bukti REST nyata 8 Nov 2026 dari laptop ke DB salinan: `--cek` SIAP, dry-run 1 Okt–7 Nov versi 20261103_00 selisih 0 di 38 hari. Pagination nyata terbukti dengan `limit` kecil, karena pada ukuran bawaan 200 tiap kueri hanya satu halaman. Akses dari server dan `--commit` belum terbukti. Rehearsal replay memakai respons yang disalin dari koneksi chat, bukan panggilan backend. Masa berlaku token tidak tersedia di metadata koneksi.
