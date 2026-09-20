# Perpindahan bottom tab (mobile) — audit & hasil ukur

Perangkat ukur: emulator Android x86_64 (GPU host), build **rilis**, 152 order / 300 chat / ratusan pelanggan.
Skrip: `mobile/scripts/tab-bench.cjs <label> --release` (warm 20 pasangan, cold 5, rapid 20 ketukan), `views-probe.cjs`.
Emulator tidak setara HP asli: angka absolut lebih lambat; yang dibandingkan adalah sebelum vs sesudah pada kondisi sama.

## Akar masalah
Layar tab tersembunyi (Inbox dipasang saat startup, tab lain setelah dikunjungi) terukur tinggi 0 px. FlashList v2
mengukur tiap sel 0 px sehingga SEMUA baris dianggap terlihat dan di-render, dan kolam daur-ulangnya tanpa batas:
±9.000 view native ter-mount. Tiap pindah tab thread JS ±100% sibuk 1,4–4 dtk (memangkas/mengukur ulang ribuan sel),
bukan karena animasinya. Sekunder: `App`/`Root` ikut render ulang tiap pindah tab (`syncRouteName` + `AsyncStorage`
sinkron), semua layar tab ikut render ulang, dan fetch berjalan bersamaan dengan animasi.

## Perubahan
- `maxItemsInRecyclePool` dibatasi (8) di semua FlashList tab; data daftar dibekukan saat layar tersembunyi (`useHiddenSafeList`).
- `syncRouteName` hanya mengubah state bila kategori tampilan berganti; simpan state navigasi di-debounce.
- Layar tab `memo`, mount berat setelah animasi (`deferTabScreen` + skeleton statis), fetch via `useFocusAfterInteractions`.
- Preload Inbox saat idle (2,5 dtk setelah Home stabil, tidak saat background/sedang interaksi).
- Animasi: hanya `translateX` 20 dp + opacity anak-tangga, 200 ms ease-out (native driver); pil tab di UI thread (Reanimated).
- Respons sentuhan (`onPressIn`), guard ketukan beruntun (satu tujuan = satu navigasi), reduced motion = tanpa animasi, a11y `tab`.

## Hasil (rilis, emulator)
| Metrik | Sebelum | Sesudah |
|---|---|---|
| View native setelah semua tab dibuka | 9.490 | ±1.380 |
| Memori total (PSS) | ±713 MB | ±594 MB |
| Warm: stall thread JS per pindah tab (p50 / p90) | 1.466 / 1.570 ms | 94 / 174 ms |
| Cold: stall JS terpanjang | 1.917–3.632 ms | 300 ms |
| Warm: frame time p90 / p95 / p99 | 69 / 150 / 600 ms | 65 / 105 / 150 ms |
| Warm: missed vsync | 91 | 65 |
| Warm: animasi selesai (toEnd p50) | — (terhalang stall) | 249 ms |
| Tap → JS bebas (rapid, p50) | — | ≈100 ms |

## Belum tercapai / catatan
- Emulator: p50 frame 20 ms dan masih ada stall JS ~100–300 ms saat tap (render TabBar + mount sel). Target 60 FPS tanpa long-task >50 ms
  perlu diverifikasi di HP asli (belum tersedia di sesi ini).
- Ketuk tab aktif dua kali: tidak menavigasi (diuji di unit test; log adb tidak menangkap event karena memang tidak ada navigasi).
- Deploy: perubahan hanya di aplikasi mobile; distribusi butuh build EAS/OTA dari akun owner (di luar sesi ini).
