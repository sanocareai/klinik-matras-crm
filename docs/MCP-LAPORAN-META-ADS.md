# MCP — Laporan Meta Ads (campaign → ad set → ad)

Tiga tool BACA-SAJA di server MCP `klinik-matras-crm` (v1.1.0) yang membuka hasil atribusi CTWA yang **sudah live** (`/api/atribusi/iklan`) ke Claude. Tidak ada tracking kedua, tidak ada migrasi, tidak ada tabel baru.

## Arsitektur

```
Claude ──MCP──▶ toolsAtribusiIklan.js ──▶ services/attribution/laporanMeta.js ──▶ hitungLaporanIklan (iklanReport.js)
Halaman Laporan ──HTTP──▶ routes/attributionAds.js ───────────────────────────────▶ hitungLaporanIklan (iklanReport.js)
```

- Endpoint dan tool memanggil **fungsi yang sama** (`hitungLaporanIklan`, transaksi `READ ONLY` + `statement_timeout`). MCP tidak berisi SQL maupun rumus bisnis; `laporanMeta.js` hanya memilih kolom (daftar-putih), mengurutkan, dan menyusun per hari.
- Penjaga satu-perhitungan-sekaligus dipindah ke `penjagaLaporan.js` dan dipakai bersama: endpoint tetap menjawab 429 `SEDANG_DIHITUNG` saat sibuk; tool MCP antre hingga 15 detik.
- Auth MCP tidak berubah: token statis (Claude Code/Desktop) atau OAuth (hanya ADMIN bisa login+approve); fasad ChatGPT `/mcp-chatgpt` hanya OAuth ADMIN. Respons tidak memuat nama, nomor, email, percakapan, atau ID customer/order.
- Perubahan di service lama (aditif): metrik `customerPernahMembayar` (customer unik dengan ≥1 pembayaran ledger sah) di baris `/iklan`, `jumlahTeratribusi`, dan dua pemeriksaan rekonsiliasi baru. Tidak ada kunci yang dihapus/diubah.

## Tool

| Tool | Fungsi |
|---|---|
| `performa_campaign_meta` | Baris campaign / ad set / ad, diperingkat. Param: `dari`, `sampai`, `level`, `urutkan`, `batas`, `campaignId`, `adSetId`. |
| `rekap_harian_meta` | Rekap harian (kohort tanggal lead) + akumulasi periode dihitung ulang. Param: `dari`, `sampai`, `campaignId`. Maks 31 hari. |
| `kesehatan_atribusi_meta` | Capture, cakupan atribusi, kesehatan spend, cakupan ledger, kesiapan KPI; `periksaLintasLevel` membuktikan campaign = Σ ad set = Σ ad. |
| `performa_iklan` (lama) | Tetap ada dan kompatibel. **Bukan atribusi campaign**: mengelompokkan `ctwaSourceUrl`, menghitung "jadi order" dari `orderCount > 0`. Deskripsinya kini menyatakan batasan itu. |

`urutkan` (terbaik dulu): `customer_lunas_ledger` (bawaan, closing utama), `customer_pernah_membayar`, `customer_ber_order`, `lead_akuisisi`, `nilai_order`, `uang_ledger_bersih`, `spend`, `cpa_lunas` (terendah = terbaik), `booked_roas`, `cash_roas`. Seri → peringkat sama. KPI null → tanpa peringkat + alasan.

## Definisi (terkunci, sama dengan halaman Laporan)

- **Lead akuisisi terbukti**: customer baru saat touch `CTWA_AD` pertama (bukti kausal). Reaktivasi (customer lama) dan UNKNOWN dipisah.
- **Customer ber-order**: ≥1 order eligible (bukan CANCELLED/PENDING, bukan penjualan karyawan; spam/staf/B2B keluar).
- **Pernah membayar**: ≥1 pembayaran sah di ledger. **Lunas terbukti ledger** (closing utama): ledger − refund menutup seluruh tagihan. Ber-order ≠ lunas; "lunas CRM" metrik terpisah.
- **Booked ROAS** = nilai order (tanpa ongkir) ÷ spend. **Cash ROAS** = uang ledger bersih (memuat ongkir) ÷ spend — definisi lama dipertahankan; keduanya tidak sebanding langsung.
- **Nilai order setelah biaya iklan** = nilai order − spend. Bukan laba. null bila spend tidak ada/tidak lengkap/periode tidak sebanding.
- **UNMAPPED** (Ad ID belum dipetakan) selalu tampil terpisah dan tidak diperingkat. URL kreatif tidak pernah dipakai untuk atribusi campaign.
- Periode = tanggal **lead** (WIB). Hasil order/pembayaran dihitung sampai waktu snapshot (`snapshot.dihitungPadaWib`); kohort muda masih bertambah (`umurKohortHari`).
- Pengaman KPI (tak berubah): `SEBELUM_ATRIBUSI`, `HARI_ATRIBUSI_PARSIAL`, `HARI_BERJALAN_PARSIAL`, `SPEND_TIDAK_LENGKAP` → CPA/ROAS/nilai-setelah-biaya = null dengan `alasanNull`. Biaya manual per sumber tidak pernah menjadi biaya campaign. Nol yang sah (spend Rp0) ≠ tidak ada data.

## Batasan yang diketahui

- Tampilan **aktivitas kalender** (order/pembayaran yang terjadi pada tanggal tertentu, termasuk dari lead lama) **belum disediakan**: status order pada tanggal itu butuh riwayat transisi yang tidak lengkap untuk order lama (D7 menandainya "TIDAK DIKETAHUI"). Hanya kohort akuisisi yang terbukti.
- Atribusi hanya untuk lead sesudah touch tersimpan (awal Okt 2026); tidak ada backfill.
- `rekap_harian_meta` menjalankan satu perhitungan penuh per hari (28–290 ms di data live untuk 9 hari).

## Akses (tiga tool laporan Meta)
Laporan ini di REST (`/api/atribusi/iklan`) hanya untuk ADMIN. Aturan yang sama berlaku untuk tiga tool di semua jalur:

| Jalur | Diizinkan | Ditolak |
|---|---|---|
| `/mcp` | token statis (kredensial mesin); OAuth ADMIN yang masih aktif | tanpa/palsu token, audience lain (401); OAuth user non-ADMIN, admin yang sudah diturunkan/dinonaktifkan/dihapus, gagal memuat user (403) |
| `/gpt-actions` | sama seperti `/mcp` | sama seperti `/mcp` |
| `/mcp-chatgpt` | OAuth ADMIN aktif saja (dimuat ulang tiap request) | semua selain itu |

Penjaga: `src/mcp/penjagaAksesLaporan.js` (memuat ulang user dari DB untuk token OAuth, fail-closed; hanya aktif untuk tiga tool ini, tool lain tidak berubah). Tanpa penjaga, token OAuth berumur 1 jam dan refresh token tidak memeriksa ulang role, sehingga admin yang diturunkan masih bisa memanggil tool selama token ada. Bukti: `tests/integration/mcpLaporanMetaAkses.integration.test.js` (11 tes, termasuk uji mutasi tanpa penjaga yang gagal) dan 1b di smoke rilis.

## Rilis & reconnect

Konektor yang dipakai:

| Klien | Jalur | Auth | Nama tool |
|---|---|---|---|
| ChatGPT (Mesa) | `/mcp-chatgpt` (fasad, `chatgptPlugin.js`) | OAuth 2.1 + PKCE, hanya ADMIN aktif, audience `/mcp-chatgpt` | `sales_performa_campaign_meta`, `sales_rekap_harian_meta`, `sales_kesehatan_atribusi_meta` (+6 lama; total 9) |
| claude.ai (browser) | `/mcp` | OAuth (ADMIN), audience `/mcp` | `performa_campaign_meta`, `rekap_harian_meta`, `kesehatan_atribusi_meta` |
| Claude Code / Desktop | `/mcp` | token statis `MCP_API_TOKEN` | sama dengan claude.ai |
| Custom GPT Actions (bila dipakai) | `/gpt-actions` | token statis | semua tool server; ambil ulang `/gpt-actions/openapi.json` |

Fasad ChatGPT adalah **allowlist eksplisit**: tool baru hanya terlihat di sana karena `CHATGPT_TOOL_CATALOG` diperluas (21 entri, 9 aktif) dan `registerAtribusiIklanTools` didaftarkan pada fasad. Ini perubahan paparan yang disengaja (agregat saja, ADMIN-OAuth saja).

### Uji lokal ≠ discovery konektor
- **Dibuktikan sebelum/saat rilis oleh skrip** (rehearsal pada salinan restore + smoke pasca-switch): server baru hidup, `tools/list` di `/mcp` dan `/mcp-chatgpt` memuat tool baru lewat OAuth ChatGPT, OAuth Claude, dan token statis; token salah/lintas-audience/non-ADMIN ditolak; hasil tool == endpoint; tidak ada baris berubah.
- **Hanya bisa dibuktikan SESUDAH rilis, manual**: bahwa klien konektor sudah membaca ulang daftar tool. ChatGPT dan claude.ai menyimpan daftar tool per koneksi.
  1. ChatGPT: Settings → Developer mode → app SANSS → **Refresh**; bila tool baru tidak muncul, hapus koneksi lalu buat ulang dengan URL `https://app.sanomatrassehat.com/mcp-chatgpt` dan login ADMIN.
  2. claude.ai: Pengaturan → Konektor → SANSS CRM → putuskan lalu sambungkan ulang (atau percakapan baru).
  3. Uji satu panggilan nyata dari klien (mis. `sales_kesehatan_atribusi_meta` dengan 7 hari terakhir) dan cocokkan dengan halaman Laporan sebelum menyatakan terhubung. Status koneksi ChatGPT sebelum rilis ini sendiri belum terbukti (lihat `docs/CHATGPT-MCP-PLUGIN.md`).

### Langkah rilis
1. Kode saja: tanpa migrasi, env, atau frontend. Skrip bergerbang: `scripts/release-mcp-laporan-meta.sh` (dibangkitkan oleh `scripts/gen-release-mcp-laporan-meta.cjs` terhadap baseline live). Urutan: `--preflight-only` → `--rehearsal-only` → rilis penuh (hanya setelah persetujuan).
2. Rollback: image sebelumnya (`rollback-pre-mlm-<sha8>`); tidak ada perubahan data. Setelah rollback, klien perlu refresh lagi.

## Pengujian

- `tests/laporanMeta.test.js` (unit, 17): proyeksi, peringkat, pengaman KPI, rekap + batas WIB, rekonsiliasi lintas level, penjaga, discovery/schema/galat MCP.
- `tests/integration/mcpLaporanMeta.integration.test.js` (DB nyata terisolasi, 13): endpoint = service = tool di tiga level; multi-order, retry touch, reaktivasi, UNMAPPED, CANCELLED/PENDING, payment dibatalkan+pengganti, ledger parsial, spend parsial, batas WIB 23:59:59/00:00:00; RBAC; read-only (jumlah baris tidak berubah); tanpa PII; tool legacy; konkurensi dengan endpoint.
