# Akses staging latihan — opsi, keputusan, dan syarat keamanan

**Keputusan saat ini: staging tetap LOKAL** (`http://127.0.0.1:18080` di komputer pelatih). Tidak dibuka ke internet, tidak ke LAN. Ponsel dihubungkan lewat **terowongan USB**.
Alasan: dua opsi yang lebih baik belum tersedia (tabel). Standar keamanan **tidak diturunkan** demi kecepatan.

## Audit opsi (urutan preferensi)
| # | Opsi | Status (diaudit 4 Okt 2026) | Yang dibutuhkan |
|---|---|---|---|
| 1 | **Subdomain HTTPS training + gerbang autentikasi** | ❌ Belum tersedia | (a) rekaman DNS dari owner; (b) host untuk staging yang **bukan** server production (server production punya nginx+certbot, tetapi menjalankan staging di host production memperbesar risiko & berbagi sumber daya — **tidak direkomendasikan**); (c) gerbang akses (mis. basic-auth/SSO) di depan nginx. Keputusan owner. |
| 2 | **VPN / private tunnel** | ⚠️ Terpasang, belum aktif | Tailscale ada di komputer pelatih tetapi status *Stopped* (belum login). Setelah owner login: `tailscale serve --bg --https=443 http://127.0.0.1:18080` memberi **HTTPS (sertifikat otomatis) hanya untuk perangkat dalam tailnet**; batasi dengan ACL ke akun pelatih/peserta. Belum diaktifkan — mengubah konfigurasi jaringan pribadi owner. |
| 3 | **Lokal / terowongan sementara** | ✅ Dipakai | Laptop pelatih: `http://127.0.0.1:18080`. HP: `adb reverse tcp:18080 tcp:18080` (kabel USB). Tidak ada paparan jaringan; `localhost` dianggap konteks aman oleh Chrome (kamera & penyimpanan offline berfungsi), jadi TLS tidak diperlukan karena lalu lintas **tidak meninggalkan mesin**. |
| ✖ | Tunnel publik tanpa gerbang (ngrok dsb.), bind `0.0.0.0`, port-forward router | **DILARANG** | Staging memuat akun latihan dengan password sekali-tampil; tanpa gerbang + TLS tidak boleh keluar mesin. |

## Menghubungkan HP (Samsung S25 Ultra, Android) lewat USB — langkah pelatih
1. HP: *Pengaturan → Tentang ponsel → Info perangkat lunak →* ketuk **Nomor versi** 7× → *Opsi pengembang → **Debugging USB*** aktif.
2. Colok kabel ke laptop pelatih → izinkan debugging di HP.
3. Laptop: `adb devices` (harus muncul perangkat) lalu `adb reverse tcp:18080 tcp:18080`.
4. Chrome di HP: buka `http://127.0.0.1:18080` (muncul header lingkungan *staging*; data berawalan **QA-PV2**).
5. Selesai latihan: `adb reverse --remove tcp:18080` dan cabut kabel.

## Syarat keamanan dan cara membuktikannya
Jalankan `bash scripts/staging/audit-isolation.sh` (membaca container yang berjalan + satu uji egress dari dalam container). Hasil terakhir: **LULUS** (20 pemeriksaan, diulang 4× stabil).

| Syarat | Bukti |
|---|---|
| Database production tidak terjangkau | DNS `postgres` / `klinik-matras-postgres-1` dari container staging **gagal**; `DATABASE_URL` → `postgres-staging/sanss_staging`; network staging `internal` |
| Kredensial production tidak ada di container | environment bebas WAHA/SMTP/FCM/OPENAI/ANTHROPIC/MAPS/WEBHOOK; hanya `.env.staging` (gitignored) |
| TLS untuk akses non-lokal | Tidak ada akses non-lokal. Akses non-lokal hanya boleh via opsi 1 atau 2 (HTTPS) |
| Access log aktif | `docker logs sanss-staging-edge-staging-1` (nginx `access_log` eksplisit) |
| Hanya akun latihan | 12 akun `qa-pv2-*@staging.invalid`; tidak ada user production di DB staging |
| Reset tidak dapat menyentuh production | CLI menolak `APP_ENV` bukan staging/test & DB tanpa penanda staging, **sebelum** query (kode keluar 2); diuji otomatis |
| Tidak ada container staging di network production | semua network berawalan `sanss-staging_`; tidak ada `klinik*`; tanpa `docker.sock`; hanya edge yang publish port (`127.0.0.1`) |
| Outbound mati | egress internet/DNS publik/WAHA/gateway host: **gagal** dari dalam backend; outbox tanpa consumer |

## Kredensial satu kali
`qa-pv2.js credentials [--role=…]` mencetak password **sekali di terminal pelatih**; tidak disimpan di log/berkas/repo; menjalankan ulang membatalkan yang lama. Bagikan lewat kertas/amplop, bukan chat.
