import React, { useMemo } from "react";
import KpiCard from "./KpiCard.jsx";

// ─── MetricCard — kartu metrik SADAR TREN ────────────────────────────────────
//
// Beda dari KpiCard: KpiCard itu lapisan TAMPILAN (angka + badge + sparkline)
// dan harus disuapi `growth` serta `sparkline` yang SUDAH dihitung. MetricCard
// menerima `history` MENTAH (deret data apa adanya dari endpoint analytics)
// lalu menurunkan sendiri seri sparkline + persentase trennya.
//
// SENGAJA membungkus KpiCard, BUKAN menyalin markup-nya — supaya hanya ada
// SATU implementasi tampilan kartu di Laporan. (CLAUDE.md §8 mencatat masalah
// nyata di project ini: komponen kembar yang lama-lama saling drift.)
//
// Props:
//   title      — judul kartu, mis. "Avg Response Time"
//   value      — angka SEKARANG (periode terpilih)
//   history    — array titik historis, mis. [{month:"2026-07", value:120}, ...]
//   valueKey   — nama field angka di dalam history (default "value")
//   format     — (n) => string untuk merender angka besar
//   lowerIsBetter — true untuk metrik yang BAIK kalau MENURUN (response time).
//                   Tanpa ini, respons yang makin cepat akan tampil merah.
//   hero, sub, index — diteruskan ke KpiCard
export default function MetricCard({
  title, value, history = [], valueKey = "value",
  format, lowerIsBetter = false, hero = false, sub, index = 0,
}) {
  const { sparkline, growth } = useMemo(() => {
    // 7 titik terakhir — sama seperti buildSparkline() di ../utils.js, dan
    // Sparkline.jsx sendiri sudah menolak render kalau titiknya < 2.
    const titik = (history || [])
      .slice(-7)
      .map((row) => ({ value: Number(row?.[valueKey]) || 0 }));

    if (titik.length < 2) return { sparkline: titik, growth: null };

    const awal = titik[0].value;
    const akhir = titik[titik.length - 1].value;

    // Basis 0 → persentase tak terdefinisi (bukan "naik 100%"), jadi badge
    // trennya disembunyikan saja daripada menampilkan angka menyesatkan.
    if (awal === 0) return { sparkline: titik, growth: null };

    const pct = Math.round(((akhir - awal) / Math.abs(awal)) * 100);
    // Untuk metrik lowerIsBetter, tanda dibalik supaya WARNA badge benar:
    // response time turun 30% → tampil hijau "+30%" (membaik).
    return { sparkline: titik, growth: lowerIsBetter ? -pct : pct };
  }, [history, valueKey, lowerIsBetter]);

  // KpiCard defaultnya menulis "vs periode sebelumnya" kalau ada growth —
  // KELIRU di sini, karena tren MetricCard dihitung dari ujung ke ujung
  // rentang `history`, bukan dibanding periode sebelumnya. Jadi captionnya
  // selalu diisi eksplisit supaya angka tidak salah dibaca.
  const caption = sub ?? (
    growth != null ? `tren ${sparkline.length} periode terakhir` : undefined
  );

  return (
    <KpiCard
      index={index}
      hero={hero}
      label={title}
      numericValue={value || 0}
      format={format}
      growth={growth}
      sparkline={sparkline}
      sub={caption}
    />
  );
}
