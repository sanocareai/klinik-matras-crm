# Perpindahan bottom tab (mobile) — audit, varian animasi & hasil ukur

Perangkat ukur: emulator Android x86_64 (GPU host), build **rilis**, 151 order / 300 chat / ratusan pelanggan.
Skrip: `mobile/scripts/tab-bench.cjs <label> --release` (cold 5, warm 20 pasangan, rapid 20 ketukan), `views-probe.cjs`,
`tab-record.cjs` (screen recording), `tab-qa-behavior.cjs` (scroll/resume/offline/rapid/keyboard).
Emulator tidak setara HP asli; yang dibandingkan adalah varian pada kondisi sama.

## Akar masalah lag (commit `1a945dcf`, dipertahankan)
Daftar di layar tab tersembunyi terukur 0 px → FlashList me-render SEMUA baris (±9.000 view native) dan kolam daur-ulangnya
tanpa batas. Perbaikan: `maxItemsInRecyclePool`, `useHiddenSafeList`, layar tetap mounted, preload idle, fetch setelah interaksi,
navigation guard, `App`/`Root` tidak render ulang tiap pindah tab.

## Revisi pola animasi (QA video)
Slide `translateX` isi layar dihapus. Isi layar pindah langsung; yang bergerak hanya indikator tab (pil meluncur 200 ms,
pop skala 0.94→1 + opacity 180 ms pada pil dan ikon yang baru dipilih; transform/opacity saja, UI thread).
Reduced motion: pil pindah seketika, tanpa pop, tanpa animasi isi. Cold tab: skeleton statis tergambar dulu (2 rAF), isi berat
dipasang setelahnya; daftar penuh dilepas setelah interaksi.

## Tiga varian (build rilis yang sama, hanya beda pola)
| Metrik | Slide lama | **Instant + indikator** | Fade 100 ms |
|---|---|---|---|
| Warm: stall JS p50 / p90 | 47 / 156 ms | **34 / 111 ms** | 41 / 152 ms |
| Warm: frame p90 / p95 / p99 | 30 / 38 / 85 ms | **30 / 34 / 48 ms** | 28 / 36 / 73 ms |
| Warm: janky frames | 7% | **6%** | 8% |
| Warm: tap → JS bebas p50 | 163 ms | **57 ms** | 144 ms |
| Rapid: tap → JS bebas p50 / p90 | 87 / 199 ms | **48 / 69 ms** | 0 / 79 ms |
| Rapid: frame p95 / p99 | 81 / 150 ms | **48 / 150 ms** | 97 / 150 ms |
| Cold: tap → JS bebas p50 | **262 ms** | 317 ms | 335 ms |
| Native view setelah semua tab | ±1.380 | ±1.150 | — |

Pilihan: **instant + indikator tab** — frame time terbaik dan tap→bebas tercepat; fade tidak menambah nilai (p99 lebih buruk) dan
slide paling lambat di warm. Cold sedikit lebih lambat karena skeleton sengaja tergambar dulu (tab langsung berganti, isi menyusul).
Perbandingan visual: `tab-before-slide.mp4` vs `tab-after-instant.mp4` (28 dtk, 540×1200) — analisis luminans per frame: tidak ada
lonjakan (>25) ⇒ tanpa flash putih/hitam; rekaman ada di mesin QA (`C:\tmp`), tidak di-commit (±4 MB masing-masing).

## QA perilaku (build instant, emulator)
| Uji | Hasil |
|---|---|
| Scroll Order & Inbox terjaga setelah pindah tab (SSIM 0.9999 / 1.0) | PASS |
| Resume dari background: posisi tetap (SSIM 0.9996) | PASS |
| Offline: pindah semua tab tanpa crash | PASS |
| 20 ketukan cepat lalu Order: satu state akhir stabil (SSIM 0.9992) | PASS |
| Keyboard/pencarian terbuka lalu pindah tab | PASS |
| Reduced motion | unit test (durasi 0, tanpa pop); belum diuji manual di perangkat |
| Ketuk tab aktif 2× | unit test (guard: tidak menavigasi) |

## Belum tercapai / catatan
- Masih ada stall JS p90 ≈ 110 ms saat tap di emulator (bukan 0); target "tanpa pekerjaan >50 ms sinkron" perlu diverifikasi di HP asli.
- Cold p50 262 → 317 ms (harga skeleton dulu).
- Deploy: hanya perubahan aplikasi mobile. Owner menjalankan (butuh login Expo):
  `cd mobile && eas update --channel preview --message "Tab: instant + indikator"` (OTA, bila runtime version sama) atau
  `eas build -p android --profile preview` (build baru). Belum dijalankan dari sesi ini.
