# Perf harness (Inbox)

Mengukur runtime Inbox di Chrome sungguhan (CDP) terhadap **API mock + data sintetis**
(100 percakapan, 1 percakapan 3.000 pesan, foto 4000×3000). Tidak menyentuh data produksi.

```bash
cd frontend
npm i                                             # puppeteer-core (dev) — memakai Chrome yang sudah terpasang
npx vite build --minify false --outDir /tmp/dist-perf --emptyOutDir   # nama komponen tetap terbaca
node perf-harness/measure.cjs <label> /tmp/dist-perf full 4 [soakDetik] [--renders] [--trace]
#                                <label> <dist> <full|lite|auto> <CPU throttle> ...
node perf-harness/profile.cjs /tmp/dist-perf      # CPU profile: fungsi paling berat saat scroll pesan
```

Env: `CHROME_PATH` untuk lokasi chrome. Hasil JSON: `perf-harness/result-<label>.json` (di-ignore git).

Metrik per skenario: TaskDuration/ScriptDuration/Layout/Style, long task (PerformanceObserver),
frame jank (>20 ms) & p95, jumlah request, heap, `--renders` = hitungan render per komponen
(logika DevTools hook), `--trace` = Paint/Raster/Layerize/GPU/Decode dari Chrome trace.
`CPU throttle 4` ≈ HP mid-range. Ini pengganti `chrome://inspect` di CI — tetap lakukan uji perangkat nyata.
