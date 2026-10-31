import React, { useMemo } from "react";
import { ComposedChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import dayjs from "dayjs";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { cn } from "@/lib/utils.js";
import { Card } from "@/components/ui/card.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";

// Tren lead harian (pindahan dari tab Traffic). Sumber: GET /analytics/traffic → daily. Lead harian TANPA spam dan tanpa B2B/penjualan karyawan (definisi server);
// beda dari kartu "Total lead (termasuk spam)" — selisihnya direkonsiliasi di bagian Kualitas data (rekonLead).
// Redesain Sales CRM (1 Nov 2026): judul + satu baris definisi; penjelasan lengkap (pita normal, hari berjalan, selisih dengan kartu) ada di tooltip judul.
// Periode SATU hari: tidak ada tren untuk digambar → tampil satu nilai bertanggal (tanpa grafik dan tanpa panel kosong yang tinggi).
const PENJELASAN = "Hanya lead BUKAN spam dan bukan B2B/penjualan karyawan, per hari (WIB) — lebih kecil dari “Total lead (termasuk spam)” di kartu; selisihnya ada di Kualitas data. Pita abu = rentang normal (rata-rata 7 hari sebelumnya ± 2 standar deviasi); hari berjalan belum lengkap.";

function TrafficTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{formatTanggalPendek(label)}</p>
      <p className="text-[13px] font-semibold text-ink">{p.value} lead tanpa spam</p>
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

function Kepala() {
  return (
    <div className="crm-mk-kepala">
      <h3 className="t-card-title">Tren lead harian (tanpa spam)</h3>
      <InfoTooltip text={PENJELASAN} />
      <p className="crm-mk-deskripsi">Lead bukan spam dan bukan B2B/penjualan karyawan, per hari (WIB).</p>
    </div>
  );
}

export default function TrenLeadChart({ traffic }) {
  const daily = traffic?.daily || [];
  const anomali = daily.filter((d) => d.status !== "normal");
  // Recharts butuh field terpisah utk menggambar pita baseline sebagai area bertumpuk (lower + tinggi pita).
  const chartData = useMemo(() => daily.map((d) => ({
    ...d,
    bandBase: d.lower ?? null,
    bandSize: d.upper != null && d.lower != null ? d.upper - d.lower : null,
    spikeDot: d.status === "spike" ? d.value : null,
    dropDot:  d.status === "drop"  ? d.value : null,
  })), [daily]);

  if (daily.length === 0) {
    return (
      <Card className="crm-mk-tren crm-mk-tren--ringkas" data-testid="tren-lead">
        <Kepala />
        <p className="crm-mk-kosong">Belum ada data lead pada periode ini.</p>
      </Card>
    );
  }

  if (daily.length === 1) {
    const d = daily[0];
    return (
      <Card className="crm-mk-tren crm-mk-tren--ringkas" data-testid="tren-lead">
        <Kepala />
        <div className="crm-mk-satu" data-testid="tren-satu-titik">
          <p className="crm-mk-satu-tanggal">{formatTanggalPendek(d.bucket)}</p>
          <p className="crm-mk-satu-nilai"><strong>{Number(d.value).toLocaleString("id-ID")}</strong> lead tanpa spam</p>
          {d.baseline != null && <p className="crm-mk-satu-sub">Normal: {d.lower}–{d.upper} (rata-rata {d.baseline})</p>}
          {d.partial && <p className="crm-mk-satu-sub crm-mk-satu-sub--catatan">Hari berjalan — belum lengkap</p>}
          <p className="crm-mk-satu-sub">Periode satu hari: tidak ada tren untuk ditampilkan.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="crm-mk-tren" data-testid="tren-lead">
      <Kepala />
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
          <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} dot={daily.length <= 14 ? { r: 3, fill: "var(--accent)", strokeWidth: 0 } : false} activeDot={{ r: 5 }} />
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
                {a.value} lead tanpa spam ({a.deltaPct > 0 ? "+" : ""}{a.deltaPct}%)
              </span>
              <span className="t-secondary text-[11px]">vs normal ±{a.baseline}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
