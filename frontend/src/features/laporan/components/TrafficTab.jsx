import React, { useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, Info, Clock, Flame } from "lucide-react";
import dayjs from "dayjs";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { formatDuration, SOURCE_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";

// ═══ LAPORAN TRAFFIC LEAD ═════════════════════════════════════════════════
// Menjawab "kapan lead masuk, dan apakah kami ada di sana saat itu" — dua
// pertanyaan yang tidak terjawab tab lain. Sumber: GET /analytics/traffic.
//
// SPIKE bukan ditentukan ambang persen yang dikarang, tapi baseline statistik
// (rata-rata bergerak 7 hari sebelumnya ± 2 standar deviasi) — lihat catatan
// panjang di backend. Pita abu di grafik = rentang "normal" itu; titik yang
// keluar dari pita ditandai otomatis.

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

// Skala warna heatmap — intensitas via opacity SATU warna (aturan satu accent
// design system), bukan pelangi merah-kuning-hijau yang bikin heatmap terbaca
// seperti peta cuaca.
function selVolume(v, max) {
  if (!max || v === 0) return { background: "var(--bg-inset)" };
  return { background: `color-mix(in srgb, var(--accent) ${Math.round((v / max) * 85) + 8}%, transparent)` };
}
// Respons: DI SINI warna merah dibenarkan — ini status bahaya (SLA), bukan
// sekadar besaran. Makin lama makin merah.
function selRespons(menit) {
  if (menit == null) return { background: "var(--bg-inset)" };
  const p = Math.min(menit / 240, 1); // 4 jam = merah penuh
  return { background: `color-mix(in srgb, var(--red) ${Math.round(p * 80) + 8}%, transparent)` };
}

function TrafficTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{formatTanggalPendek(label)}</p>
      <p className="text-[13px] font-semibold text-ink">{p.value} lead</p>
      {p.baseline != null && (
        <p className="t-secondary mt-0.5 text-[11px]">
          Normal: {p.lower}–{p.upper} (rata-rata {p.baseline})
        </p>
      )}
      {p.partial && <p className="mt-0.5 text-[11px] text-orange">Hari berjalan — belum lengkap</p>}
      {p.status === "spike" && <p className="mt-0.5 text-[11px] font-semibold text-green">▲ Spike +{p.deltaPct}%</p>}
      {p.status === "drop" && <p className="mt-0.5 text-[11px] font-semibold text-red">▼ Drop {p.deltaPct}%</p>}
    </div>
  );
}

export default function TrafficTab({ traffic }) {
  const [mode, setMode] = useState("volume"); // "volume" | "respons"

  const daily = traffic?.daily || [];
  const heatmap = traffic?.heatmap || [];
  const anomali = daily.filter((d) => d.status !== "normal");

  // Recharts butuh field terpisah utk menggambar pita baseline sebagai area
  // bertumpuk (lower + tinggi pita), bukan dua garis terpisah.
  const chartData = useMemo(() => daily.map((d) => ({
    ...d,
    bandBase: d.lower ?? null,
    bandSize: d.upper != null && d.lower != null ? d.upper - d.lower : null,
    spikeDot: d.status === "spike" ? d.value : null,
    dropDot:  d.status === "drop"  ? d.value : null,
  })), [daily]);

  const maxLeadSel = useMemo(() => Math.max(1, ...heatmap.map((c) => c.leads)), [heatmap]);
  const cellByKey = useMemo(() => {
    const m = {};
    for (const c of heatmap) m[`${c.dow}-${c.jam}`] = c;
    return m;
  }, [heatmap]);

  const atribusi = traffic?.atribusi;

  if (!traffic) {
    return <p className="t-secondary py-16 text-center">Gagal memuat laporan traffic.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── KPI ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          index={0} hero label="Total Lead Masuk"
          numericValue={traffic.totalLeads || 0}
          growth={traffic.growthPct}
          sub={`periode sebelumnya: ${(traffic.prevTotalLeads || 0).toLocaleString("id-ID")} lead`}
        />
        <KpiCard
          index={1} label="Hari Tidak Normal"
          numericValue={anomali.length}
          sub={`${anomali.filter((a) => a.status === "spike").length} spike · ${anomali.filter((a) => a.status === "drop").length} drop`}
        />
        <KpiCard
          index={2} label="Jam Tersibuk"
          numericValue={traffic.busiestHours?.[0]?.jam ?? 0}
          format={(v) => `${String(Math.round(v)).padStart(2, "0")}:00`}
          sub={traffic.busiestHours?.[0] ? `${traffic.busiestHours[0].leads} lead masuk di jam ini` : "—"}
        />
        <KpiCard
          index={3} label="Atribusi Sumber"
          numericValue={atribusi?.rate || 0}
          format={(v) => `${v.toFixed(1)}%`}
          sub={`${atribusi?.teridentifikasi || 0} dari ${atribusi?.total || 0} lead diketahui sumbernya`}
        />
      </div>

      {/* Atribusi rendah = MASALAH KUALITAS DATA, bukan insight. Ditandai
          eksplisit (pola sama dgn peringatan "Kota Belum diisi" di Ringkasan)
          supaya owner tidak menyimpulkan "berarti semua lead organik". */}
      {atribusi?.rate != null && atribusi.rate < 20 && atribusi.total > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl bg-orangebg px-3.5 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-orange" size={16} />
          <p className="text-xs leading-relaxed text-ink">
            Hanya <strong>{atribusi.rate}%</strong> lead yang diketahui sumbernya — sisanya
            masuk sebagai "WhatsApp Langsung" karena sistem tidak bisa mendeteksi asalnya.
            Ini <strong>keterbatasan pelacakan, bukan berarti semua lead organik</strong>.
            Untuk tahu iklan mana yang benar-benar menghasilkan, pakai <strong>Link
            Pelacakan</strong> (1 link per campaign) — deteksi otomatis iklan Meta
            terbukti tidak pernah berhasil di data produksi.
          </p>
        </div>
      )}

      {/* ── Tren harian + baseline + spike ── */}
      <ChartCard
        index={4}
        title="Traffic Lead Harian"
        description="Pita abu = rentang normal (rata-rata 7 hari sebelumnya ± 2 standar deviasi). Titik di luar pita ditandai otomatis."
        empty={daily.length === 0 ? "Belum ada data lead pada periode ini." : null}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="bucket" tickFormatter={(v) => dayjs(v).format("D MMM")}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} dy={6}
              interval="preserveStartEnd" minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} width={36} allowDecimals={false}
            />
            <Tooltip content={<TrafficTip />} cursor={{ stroke: "var(--hairline)" }} />
            {/* Pita normal: area transparan (offset) + area terlihat setinggi pita */}
            <Area dataKey="bandBase" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="bandSize" stackId="band" stroke="none" fill="var(--text-tertiary)" fillOpacity={0.13} isAnimationActive={false} />
            <Line type="monotone" dataKey="value" stroke="var(--blue-600)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            <Scatter dataKey="spikeDot" fill="var(--green)" shape="circle" />
            <Scatter dataKey="dropDot"  fill="var(--red)"   shape="circle" />
          </ComposedChart>
        </ResponsiveContainer>

        {anomali.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            {anomali.slice(-6).reverse().map((a) => (
              <div key={a.bucket} className="flex items-center gap-2 text-[12px]">
                {a.status === "spike"
                  ? <TrendingUp size={13} className="shrink-0 text-green" />
                  : <TrendingDown size={13} className="shrink-0 text-red" />}
                <span className="font-medium text-ink">{formatTanggalPendek(a.bucket)}</span>
                <span className={cn("font-semibold tabular-nums", a.status === "spike" ? "text-green" : "text-red")}>
                  {a.value} lead ({a.deltaPct > 0 ? "+" : ""}{a.deltaPct}%)
                </span>
                <span className="t-secondary text-[11px]">vs normal ±{a.baseline}</span>
              </div>
            ))}
          </div>
        )}
      </ChartCard>

      {/* ── Heatmap jam × hari ── */}
      <ChartCard
        index={5}
        title="Peta Traffic: Hari × Jam (WIB)"
        description={mode === "volume"
          ? "Kapan lead paling banyak masuk"
          : "Berapa lama customer menunggu dibalas, menurut jam dia chat"}
      >
        <div className="mb-3 flex gap-1 rounded-btn bg-inset p-1" style={{ width: "fit-content" }}>
          {[["volume", "Volume Lead"], ["respons", "Waktu Respons"]].map(([k, label]) => (
            <button
              key={k} onClick={() => setMode(k)}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[12px] font-medium transition-colors",
                mode === k ? "bg-surface text-ink shadow-card" : "text-ink2 hover:text-ink"
              )}
            >{label}</button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: 640 }}>
            {/* Label jam tiap 3 kolom biar tidak berdesakan */}
            <div className="flex gap-[2px] pl-9">
              {Array.from({ length: 24 }, (_, j) => (
                <div key={j} className="flex-1 text-center text-[9px] text-ink3">
                  {j % 3 === 0 ? String(j).padStart(2, "0") : ""}
                </div>
              ))}
            </div>
            {HARI.map((nama, dow) => (
              <div key={dow} className="mt-[2px] flex items-center gap-[2px]">
                <div className="w-9 shrink-0 text-[10px] font-medium text-ink2">{nama}</div>
                {Array.from({ length: 24 }, (_, jam) => {
                  const c = cellByKey[`${dow}-${jam}`] || { leads: 0, avgMinutes: null, slaBreach: 0 };
                  const style = mode === "volume" ? selVolume(c.leads, maxLeadSel) : selRespons(c.avgMinutes);
                  const judul = mode === "volume"
                    ? `${nama} ${String(jam).padStart(2, "0")}:00 — ${c.leads} lead`
                    : `${nama} ${String(jam).padStart(2, "0")}:00 — ${c.avgMinutes != null ? formatDuration(c.avgMinutes) : "tidak ada data"}${c.slaBreach ? ` · ${c.slaBreach} lewat SLA` : ""}`;
                  return (
                    <div
                      key={jam} title={judul} style={style}
                      className="h-6 flex-1 rounded-[3px]"
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
          Arahkan kursor ke kotak untuk detail. Bandingkan dua mode: kotak
          <strong> gelap</strong> di Volume tapi <strong>merah</strong> di Waktu Respons =
          jam ramai yang tidak terjaga — itu kebocoran lead paling mahal.
        </p>
      </ChartCard>

      {/* ── Jam sibuk & jam rawan ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard index={6} title="Jam Tersibuk" description="Paling banyak lead masuk">
          <div className="flex flex-col gap-2.5">
            {(traffic.busiestHours || []).map((h) => (
              <div key={h.jam} className="flex items-center gap-3">
                <Flame size={15} className="shrink-0 text-accent" />
                <span className="w-14 shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {String(h.jam).padStart(2, "0")}:00
                </span>
                <span className="flex-1 text-[12.5px] text-ink2">{h.leads} lead masuk</span>
                <span className="t-secondary text-[11.5px] tabular-nums">
                  {h.avgMinutes != null ? formatDuration(h.avgMinutes) : "—"}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          index={7} title="Jam Paling Rawan"
          description="Respons terlama — hanya jam yang volumenya signifikan"
          empty={(traffic.riskiestHours || []).length === 0 ? "Belum cukup data respons." : null}
        >
          <div className="flex flex-col gap-2.5">
            {(traffic.riskiestHours || []).map((h) => (
              <div key={h.jam} className="flex items-center gap-3">
                <Clock size={15} className="shrink-0 text-red" />
                <span className="w-14 shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {String(h.jam).padStart(2, "0")}:00
                </span>
                <span className="flex-1 text-[12.5px] font-semibold text-red">
                  {formatDuration(h.avgMinutes)}
                </span>
                <span className="t-secondary text-[11.5px] tabular-nums">
                  {h.leads} lead · {h.slaBreach}× lewat SLA
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              Jam sepi dengan 1-2 chat telat sengaja TIDAK masuk daftar ini —
              yang ditampilkan hanya jam yang volumenya cukup untuk jadi masalah nyata.
            </span>
          </p>
        </ChartCard>
      </div>

      {/* ── Sumber lead ── */}
      {(atribusi?.bySource || []).length > 0 && (
        <ChartCard index={8} title="Sumber Lead" description="Dari sistem pelacakan — lihat catatan akurasi di atas">
          <div className="flex flex-col gap-2">
            {[...atribusi.bySource].sort((a, b) => b.count - a.count).map((s) => (
              <div key={s.source} className="flex items-center justify-between text-[12.5px]">
                <span className="text-ink2">{SOURCE_LABELS[s.source] || s.source}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {s.count.toLocaleString("id-ID")}
                  <span className="ml-1.5 font-normal text-ink3">
                    ({Math.round((s.count / (atribusi.total || 1)) * 100)}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
        </ChartCard>
      )}
    </div>
  );
}
