import React, { useMemo } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import { AlertTriangle, Crown } from "lucide-react";
import { formatDuration, formatRupiah, formatRupiahShort } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { cn } from "@/lib/utils.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import BarRow from "./BarRow.jsx";

const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };
const CHANNEL_COLOR = { WHATSAPP: "bg-green", INSTAGRAM: "bg-accent" };
const STATUS_COLOR = {
  OPEN: "bg-accent", PENDING: "bg-orange", RESOLVED: "bg-green",
};
const STATUS_LABEL = { OPEN: "Terbuka", PENDING: "Pending", RESOLVED: "Selesai" };

// Kolom performa per-sales (dipindah dari KOLOM di SalesReportTab.jsx 25
// Agustus 2026) — Nilai/Konversi/dst TIDAK ada di sini, itu urusan tab Sales.
const KOLOM_PERFORMA = [
  { k: "handledOwn", label: "Ditangani",  title: "Percakapan yang DIA KLAIM/PEGANG SENDIRI dari awal pada periode terpilih (tidak termasuk warisan Ambil Alih)" },
  { k: "handledTakeover", label: "Warisan", title: "Percakapan yang berpindah ke dia lewat Ambil/Ambil Alih dari sales lain — bukan tanggung jawab penanganan asli dia" },
  { k: "stalled",    label: "Mengg.",     title: "Menggantung: dia pegang, pesan terakhir dari customer, >60 menit belum dibalas" },
  { k: "avgResponseMinutes", label: "Avg Respons", title: "Rata-rata jeda pesan pertama customer → balasan pertama" },
  { k: "slaBreach",  label: "SLA >1j",    title: "Balasan pertama >60 menit, DITAMBAH percakapan yang ditutup (RESOLVED) tanpa satu pun balasan sama sekali — supaya lead yang diabaikan total sampai ditutup tidak lolos dari radar" },
];

function toneRespons(menit) {
  if (menit == null) return "text-ink3";
  if (menit <= 30) return "text-green";
  if (menit <= 120) return "text-ink";
  return "text-red";
}

// Tooltip gabungan revenue (batang) + avg respons (garis) — pola sama
// dengan RespTrendTip di SalesReportTab.jsx, cuma nilai batangnya Rupiah
// bukan jumlah pelanggaran SLA.
function TrenTip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  const revenue = payload.find((p) => p.dataKey === "revenue")?.value;
  const avgMinutes = payload.find((p) => p.dataKey === "avgMinutes")?.value;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{granularity === "day" ? formatTanggalPendek(label) : label}</p>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full bg-accent" /> Penjualan: {formatRupiah(revenue || 0)}
      </p>
      {avgMinutes != null && (
        <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-600">
          <span className="h-2 w-2 rounded-full bg-blue-600" /> Avg respons: {Math.round(avgMinutes)} mnt
        </p>
      )}
    </div>
  );
}

// Tooltip tren respons/SLA murni (tanpa revenue) — dipakai chart "Tren Waktu
// Respons & Pelanggaran SLA" yang dipindah dari SalesReportTab.jsx.
function RespTrendTip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  const avg = payload.find((p) => p.dataKey === "avgMinutes")?.value;
  const sla = payload.find((p) => p.dataKey === "slaBreach")?.value;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{granularity === "day" ? formatTanggalPendek(label) : label}</p>
      {avg != null && (
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-accent" /> Avg respons: {Math.round(avg)} mnt
        </p>
      )}
      <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-red">
        <span className="h-2 w-2 rounded-full bg-red" /> SLA breach: {sla ?? 0}
      </p>
    </div>
  );
}

// ═══ PERFORMA TIM ═══════════════════════════════════════════════════════════
// Gabungan tab "Percakapan" + "Penjualan" lama (25 Agustus 2026). Sejak revisi
// hari yang sama: tab ini FOKUS PERFORMA (kecepatan balas chat, beban,
// menggantung, SLA) — bukan lagi angka penjualan, yang sekarang jadi urusan
// tab "Sales" sepenuhnya (lihat SalesReportTab.jsx). KPI/chart chat-handling
// yang tadinya di SalesReportTab.jsx (Percakapan Ditangani, Menggantung
// Sekarang, alert box, Waktu Respons Pertama, Tren Respons&SLA, Beban
// Percakapan) DIPINDAH ke sini. Chart tren gabungan revenue+respons TETAP
// dipertahankan sebagai pengecualian sengaja — satu-satunya tempat yang
// menampilkan revenue di tab ini, karena tujuannya diagnostik (korelasi
// "respons lambat → penjualan turun"), bukan laporan penjualan.
export default function PerformaTimTab({ perf, summary, respTimeSeries, channelBreakdown, salesReport }) {
  const statusBreakdown = perf?.statusBreakdown || [];
  const totalStatus = statusBreakdown.reduce((s, r) => s + (r.count || 0), 0);
  const totalChannel = channelBreakdown.reduce((s, r) => s + (r.count || 0), 0);

  // Baris sales biasa (tanpa Team Lead) — dipakai untuk chart & tabel
  // per-sales di bawah, sama pola dengan SalesReportTab.jsx.
  const rows = (salesReport?.rows || []).filter((r) => !r.isTeamLead);
  const teamLeadRows = (salesReport?.rows || []).filter((r) => r.isTeamLead);
  const total = salesReport?.total;
  const aktif = rows.filter((r) => r.handled > 0);
  const maxHandled = Math.max(1, ...rows.map((r) => r.handledOwn));
  const maxRespons = Math.max(1, ...rows.map((r) => r.avgResponseMinutes || 0));
  const lambat = [...aktif]
    .filter((r) => r.avgResponseMinutes != null)
    .sort((a, b) => b.avgResponseMinutes - a.avgResponseMinutes);

  // Revenue (business-summary) & avg respons (response-time-series) SUDAH
  // dipanggil dengan `params` yang SAMA dari Laporan.jsx → granularitas &
  // batas bucket-nya identik (keduanya pakai seriesWindow() di backend),
  // jadi aman di-zip per index tanpa join by key.
  const trenData = useMemo(() => {
    const revenuePts = summary?.revenueSeries || [];
    const avgPts = respTimeSeries?.avgResponseSeries || [];
    return revenuePts.map((p, i) => ({
      bucket: p.bucket, revenue: p.value, avgMinutes: avgPts[i]?.value ?? null,
    }));
  }, [summary, respTimeSeries]);
  const granularity = summary?.granularity || respTimeSeries?.granularity || "day";
  const tickX = (v) => (granularity === "day" ? dayjs(v).format("D MMM") : v);

  // Deret tren respons+SLA (dipindah dari SalesReportTab.jsx) — beda dari
  // trenData di atas: itu revenue+respons, ini murni respons+pelanggaran SLA
  // (dua lensa berbeda, sengaja tidak digabung jadi satu chart supaya tidak
  // terlalu ramai).
  const slaTrendData = useMemo(() => {
    const avgPts = respTimeSeries?.avgResponseSeries || [];
    const slaPts = respTimeSeries?.slaBreachSeries || [];
    return avgPts.map((p, i) => ({
      bucket: p.bucket, avgMinutes: p.value, slaBreach: slaPts[i]?.value ?? 0,
    }));
  }, [respTimeSeries]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard index={0} label="Total Percakapan" numericValue={perf?.totalConversations || 0} />
        <KpiCard
          index={1} label="Percakapan Ditangani"
          numericValue={total?.handled || 0}
          sub={`${aktif.length} sales aktif dari ${rows.length}`}
        />
        <KpiCard
          index={2} label="Rata-rata Respons"
          numericValue={perf?.avgResponseMinutes || 0}
          format={() => formatDuration(perf?.avgResponseMinutes)}
          sub="jeda pesan pertama customer → balasan pertama"
        />
        <KpiCard
          index={3} label="Menggantung Sekarang"
          numericValue={salesReport?.stalledNow || 0}
          sub="lintas semua periode — belum dibalas >60 menit"
        />
      </div>

      {/* Menggantung/belum diambil = beban nyata yang masih menempel sekarang,
          bukan statistik historis. Kalau ada, ini hal PERTAMA yang harus
          dikerjakan tim hari ini — jadi ditaruh sebagai peringatan, bukan
          sekadar kolom. (Dipindah dari SalesReportTab.jsx 25 Agustus 2026.) */}
      {(salesReport?.stalledNow > 0 || total?.slaBreach > 0 || salesReport?.unassignedInPeriod > 0) && (
        <div className="flex items-start gap-2.5 rounded-xl bg-orangebg px-3.5 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-orange" size={16} />
          <p className="text-xs leading-relaxed text-ink">
            {salesReport?.unassignedInPeriod > 0 && (
              <><strong>{salesReport.unassignedInPeriod} percakapan</strong> pada periode ini
              BELUM DIAMBIL siapa pun — tidak masuk hitungan sales manapun, dan ini
              sebabnya "Percakapan Ditangani" di sini lebih kecil dari "Total
              Percakapan". </>
            )}
            {salesReport?.stalledNow > 0 && (
              <><strong>{salesReport.stalledNow} percakapan</strong> sedang menggantung
              SEKARANG — pesan terakhir dari customer dan sudah lebih dari 60 menit
              tanpa balasan (dihitung lintas semua periode, karena beban ini tetap
              ada berapa pun rentang yang dipilih). </>
            )}
            {total?.slaBreach > 0 && (
              <>Pada periode terpilih ada <strong>{total.slaBreach} percakapan</strong> yang
              balasan pertamanya lewat 60 menit{total?.neverReplied > 0 && (
                <> (termasuk <strong>{total.neverReplied}</strong> yang ditutup tanpa
                dibalas sama sekali)</>
              )}. </>
            )}
            Ini kebocoran lead yang paling murah untuk diperbaiki.
          </p>
        </div>
      )}

      <ChartCard
        index={4}
        title="Tren Penjualan & Waktu Respons"
        description="Nilai penjualan (batang) & rata-rata waktu respons (garis) tim, dari waktu ke waktu — kelihatan langsung kalau respons lambat berbarengan dengan penjualan turun"
        empty={trenData.length === 0 ? "Belum ada data pada periode ini." : null}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={trenData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="performaTimBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="var(--accent)" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="bucket" tickFormatter={tickX}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={28}
            />
            <YAxis
              yAxisId="rupiah" tickFormatter={formatRupiahShort}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} width={64}
            />
            <YAxis
              yAxisId="menit" orientation="right"
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} width={42}
              label={{ value: "menit", angle: 90, position: "insideRight", fontSize: 10, fill: "var(--text-tertiary)" }}
            />
            <Tooltip content={<TrenTip granularity={granularity} />} cursor={{ fill: "var(--bg-inset)" }} />
            <Bar yAxisId="rupiah" dataKey="revenue" name="revenue" fill="url(#performaTimBarFill)" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive animationDuration={700} />
            <Line
              yAxisId="menit" type="monotone" dataKey="avgMinutes"
              stroke="var(--blue-600)" strokeWidth={2.5} dot={false}
              connectNulls={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={700}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
          Garis respons terputus = periode tanpa data (bukan 0 menit).
        </p>
      </ChartCard>

      {/* ── Waktu respons per sales (dipindah dari SalesReportTab.jsx) ──── */}
      {lambat.length > 0 && (
        <ChartCard
          index={5}
          title="Waktu Respons Pertama"
          description="Rata-rata jeda pesan pertama customer → balasan pertama. Makin pendek makin baik."
        >
          <div className="flex flex-col gap-2.5">
            {lambat.map((r) => (
              <BarRow
                key={r.userId}
                label={r.name}
                value={r.avgResponseMinutes} max={maxRespons}
                display={formatDuration(r.avgResponseMinutes)}
                sub={`${r.slaBreach}× >1j`}
                tone={r.avgResponseMinutes <= 30 ? "green" : r.avgResponseMinutes <= 120 ? "accent" : "red"}
              />
            ))}
          </div>
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
            Sampel dihitung hanya dari percakapan yang benar-benar sudah dibalas,
            jadi sales yang tidak membalas sama sekali TIDAK membuat angkanya
            terlihat bagus — cek kolom “Menggantung”.
          </p>
        </ChartCard>
      )}

      {/* ── Tren respons & SLA tim (dipindah dari SalesReportTab.jsx) ───── */}
      {slaTrendData.length > 0 && (
        <ChartCard
          index={6}
          title="Tren Waktu Respons & Pelanggaran SLA"
          description="Rata-rata waktu respons (garis) & jumlah pelanggaran SLA >60 menit (batang) tim, dari waktu ke waktu"
        >
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={slaTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
              <XAxis
                dataKey="bucket" tickFormatter={tickX}
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                axisLine={false} tickLine={false} dy={6}
                interval="preserveStartEnd" minTickGap={28}
              />
              <YAxis
                yAxisId="menit" tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                axisLine={false} tickLine={false} width={42}
                label={{ value: "menit", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--text-tertiary)" }}
              />
              <YAxis
                yAxisId="sla" orientation="right" allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                axisLine={false} tickLine={false} width={30}
              />
              <Tooltip content={<RespTrendTip granularity={granularity} />} cursor={{ fill: "var(--bg-hover)" }} />
              <Bar yAxisId="sla" dataKey="slaBreach" fill="var(--red)" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="menit" type="monotone" dataKey="avgMinutes"
                stroke="var(--blue-600)" strokeWidth={2.5} dot={false}
                connectNulls={false} activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
            Garis terputus = periode tanpa data respons (bukan 0 menit).
            Pelanggaran SLA termasuk percakapan yang ditutup tanpa satu pun balasan.
          </p>
        </ChartCard>
      )}

      {/* ── Beban percakapan (dipindah dari SalesReportTab.jsx) ─────────── */}
      <ChartCard
        index={7} title="Beban Percakapan"
        description="Percakapan yang diklaim/dipegang sendiri sejak awal — tidak termasuk warisan Ambil Alih"
      >
        <div className="flex flex-col gap-2.5">
          {rows.filter((r) => r.handledOwn > 0 || r.handledTakeover > 0).map((r) => (
            <BarRow
              key={r.userId} label={r.name} value={r.handledOwn} max={maxHandled}
              display={`${r.handledOwn}`}
              sub={r.handledTakeover > 0 ? `+${r.handledTakeover} warisan takeover` : undefined}
            />
          ))}
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
          "Warisan takeover" = percakapan yang berpindah ke orang ini lewat
          Ambil/Ambil Alih dari sales lain (biasanya lead mangkrak yang
          sudah dingin) — sengaja dipisah supaya sales yang rajin
          membersihkan chat mangkrak tidak tampak "paling sibuk" padahal
          beban itu bukan hasil penanganannya sendiri sejak awal.
        </p>
      </ChartCard>

      {/* ── Rincian performa per sales ───────────────────────────────────
          Kolom kecepatan/beban chat (dipindah dari "Rincian Lengkap" di
          SalesReportTab.jsx 25 Agustus 2026) — tabel Sales sekarang HANYA
          kolom penjualan, tabel ini HANYA kolom performa. Data sumbernya
          SAMA (`salesReport`), cuma kolom yang ditonjolkan beda. */}
      {rows.length > 0 && (
        <ChartCard index={8} title="Rincian Performa" description="Kecepatan & beban chat per sales — gulir ke samping untuk kolom lainnya. Metrik penjualan ada di tab Sales.">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink3">
                    Sales
                  </th>
                  {KOLOM_PERFORMA.map((c) => (
                    <th
                      key={c.k} title={c.title}
                      className="whitespace-nowrap border-b border-line px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-ink3"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamLeadRows.map((r) => (
                  <tr key={r.userId} className="border-b-2 border-line bg-blue-50">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-blue-50 px-3 py-2.5 font-semibold text-ink">
                      <span className="flex items-center gap-1.5">
                        {r.name}
                        <Crown size={11} className="text-blue-ink" />
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.handledOwn}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink3">{r.handledTakeover}</td>
                    <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", r.stalled > 0 ? "text-orange" : "text-ink3")}>
                      {r.stalled}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2.5 text-right tabular-nums", toneRespons(r.avgResponseMinutes))}>
                      {formatDuration(r.avgResponseMinutes)}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", r.slaBreach > 0 ? "text-red" : "text-ink3")}>
                      {r.slaBreach}
                    </td>
                  </tr>
                ))}
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-line last:border-0">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-2.5 font-semibold text-ink">
                      {r.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.handledOwn}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink3">{r.handledTakeover}</td>
                    <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", r.stalled > 0 ? "text-orange" : "text-ink3")}>
                      {r.stalled}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2.5 text-right tabular-nums", toneRespons(r.avgResponseMinutes))}>
                      {formatDuration(r.avgResponseMinutes)}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", r.slaBreach > 0 ? "text-red" : "text-ink3")}>
                      {r.slaBreach}
                    </td>
                  </tr>
                ))}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 text-ink">Total tim</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{total.handledOwn}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink3">{total.handledTakeover}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-orange">{total.stalled}</td>
                    {/* Rata-rata respons tim SENGAJA em-dash: merata-ratakan
                        rata-rata per orang tanpa membobot jumlah percakapan
                        menghasilkan angka yang salah. */}
                    <td className="px-3 py-2.5 text-right text-ink3">—</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red">{total.slaBreach}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink3">
            "Total tim" HANYA menjumlahkan 8 sales biasa — TIDAK termasuk
            closing pribadi Team Lead, konsisten dengan tabel di tab Sales.
          </p>
        </ChartCard>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard index={9} title="Breakdown Channel" description="Asal percakapan masuk" empty={channelBreakdown.length === 0 ? "Belum ada data." : null}>
          <div className="flex h-3 overflow-hidden rounded-full bg-inset">
            {channelBreakdown.map((row) => (
              <div
                key={row.channel}
                className={`h-full transition-[width] duration-700 ease-out ${CHANNEL_COLOR[row.channel] || "bg-accent"}`}
                style={{ width: `${totalChannel > 0 ? (row.count / totalChannel) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {channelBreakdown.map((row) => (
              <div key={row.channel} className="flex items-center justify-between rounded-xl bg-inset px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-ink2">
                  <span className={`h-2.5 w-2.5 rounded-full ${CHANNEL_COLOR[row.channel] || "bg-accent"}`} />
                  {CHANNEL_LABEL[row.channel] || row.channel}
                </span>
                <span className="text-lg font-bold text-ink">{row.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard index={10} title="Status Percakapan" description="Terbuka / Pending / Selesai" empty={statusBreakdown.length === 0 ? "Belum ada data." : null}>
          <div className="flex h-3 overflow-hidden rounded-full bg-inset">
            {statusBreakdown.map((row) => (
              <div
                key={row.status}
                className={`h-full transition-[width] duration-700 ease-out ${STATUS_COLOR[row.status] || "bg-accent"}`}
                style={{ width: `${totalStatus > 0 ? (row.count / totalStatus) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {statusBreakdown.map((row) => (
              <div key={row.status} className="flex items-center justify-between rounded-xl bg-inset px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-ink2">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[row.status] || "bg-accent"}`} />
                  {STATUS_LABEL[row.status] || row.status}
                </span>
                <span className="text-lg font-bold text-ink">{row.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
