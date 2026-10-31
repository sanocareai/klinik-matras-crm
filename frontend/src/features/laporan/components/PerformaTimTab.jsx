import React, { useMemo } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Crown } from "lucide-react";
import { formatDuration, formatRupiah, formatRupiahShort } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import { Card } from "@/components/ui/card.jsx";
import { compareLabel, formatBucketTick } from "@/lib/dateRange.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import KpiLap from "./KpiLap.jsx";
import MetrikRingkas from "./MetrikRingkas.jsx";
import AlertRingkas from "./AlertRingkas.jsx";
import ChartCard from "./ChartCard.jsx";
import BarRow from "./BarRow.jsx";
import { Avatar } from "./StageBySalesCard.jsx";

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

// Ambang warna respons (tidak berubah): ≤30 mnt hijau, ≤120 mnt biasa, >120 mnt merah; null = tidak ada data (redup).
function toneRespons(menit) {
  if (menit == null) return "kosong";
  if (menit <= 30) return "baik";
  if (menit <= 120) return "biasa";
  return "lambat";
}

// Dua ukuran TERPISAH dengan satuan dan warna berbeda: penjualan = batang BIRU (Rupiah, sumbu kiri); waktu respons = garis HIJAU-TOSCA (menit, sumbu kanan).
// Grafik ini hanya menaruh keduanya pada sumbu waktu yang sama — tidak menyatakan satu mempengaruhi yang lain.
const WARNA_PENJUALAN = "var(--accent)";
const WARNA_RESPONS = "var(--crm-resp)";

function TrenTip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  const revenue = payload.find((p) => p.dataKey === "revenue")?.value;
  const avgMinutes = payload.find((p) => p.dataKey === "avgMinutes")?.value;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{formatBucketTick(label, granularity)}</p>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full" style={{ background: WARNA_PENJUALAN }} /> Penjualan: {formatRupiah(revenue || 0)}
      </p>
      {avgMinutes != null && (
        <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <span className="h-2 w-2 rounded-full" style={{ background: WARNA_RESPONS }} /> Avg respons: {Math.round(avgMinutes)} mnt
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
      <p className="t-caption mb-1">{formatBucketTick(label, granularity)}</p>
      {avg != null && (
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <span className="h-2 w-2 rounded-full" style={{ background: WARNA_RESPONS }} /> Avg respons: {Math.round(avg)} mnt
        </p>
      )}
      <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-red">
        <span className="h-2 w-2 rounded-full bg-red" /> SLA breach: {sla ?? 0}
      </p>
    </div>
  );
}

// Legenda eksplisit: nama ukuran + satuan + sumbu, supaya dua satuan tidak tertukar.
const Legenda = ({ item }) => (
  <ul className="crm-pt-legenda" aria-label="Keterangan grafik">
    {item.map((x) => <li key={x.nama}><i style={{ background: x.warna }} data-bentuk={x.bentuk} aria-hidden="true" />{x.nama} <span>{x.satuan}</span></li>)}
  </ul>
);

// Satu periode (satu titik data): tidak ada tren — tampilkan nilai bertanggal, bukan grafik.
function TitikTunggal({ tanggal, baris }) {
  return (
    <div className="crm-mk-satu" data-testid="pt-satu-titik">
      <p className="crm-mk-satu-tanggal">{tanggal}</p>
      {baris.map((b) => <p key={b.label} className="crm-mk-satu-nilai"><strong>{b.nilai}</strong> {b.label}</p>)}
      <p className="crm-mk-satu-sub">Hanya satu periode data: tidak ada tren untuk ditampilkan.</p>
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
// menampilkan revenue di tab ini; keduanya ditampilkan berdampingan pada sumbu
// waktu yang sama, TANPA menyiratkan hubungan sebab-akibat (redesain 1 Nov 2026).
//
// REDESAIN Sales CRM (1 Nov 2026) — penyajian saja; rumus, endpoint, ekspor, definisi tidak berubah:
// peringatan ringkas (masalah · jumlah · rincian) → 4 KPI berwarna → metrik pendukung → [Tren penjualan & respons | Tren respons & SLA]
// → [Waktu respons pertama | Beban percakapan] → tabel Rincian Performa (kolom Sales menempel) → [Channel | Status].
export default function PerformaTimTab({ perf, summary, respTimeSeries, channelBreakdown, salesReport, range }) {
  const cmp = compareLabel(range);
  const statusBreakdown = perf?.statusBreakdown || [];
  const totalStatus = statusBreakdown.reduce((s, r) => s + (r.count || 0), 0);
  const totalChannel = channelBreakdown.reduce((s, r) => s + (r.count || 0), 0);

  // Baris sales biasa (tanpa Team Lead) — dipakai chart & tabel
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
  const tickX = (v) => formatBucketTick(v, granularity);

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

  // Penutup peringatan (kalimat asli): ditaruh di rincian peringatan terakhir yang tampil.
  const PENUTUP = "Ini kebocoran lead yang paling murah untuk diperbaiki.";
  const adaBelumDiambil = salesReport?.unassignedInPeriod > 0;
  const adaMenggantung = salesReport?.stalledNow > 0;
  const adaSla = total?.slaBreach > 0;

  return (
    <div className="crm-lap-tab" data-testid="tab-performa-tim">
      {/* ── PERINGATAN (masalah · jumlah · Lihat rincian; kalimat lengkap & definisi periode di dalam rincian) ───────── */}
      {/* Menggantung/belum diambil = beban nyata yang masih menempel sekarang, bukan statistik historis. Kalau ada, ini hal PERTAMA yang
          harus dikerjakan tim hari ini — jadi ditaruh sebagai peringatan, bukan sekadar kolom. (Dipindah dari SalesReportTab.jsx 25 Agustus 2026.) */}
      {(adaMenggantung || adaSla || adaBelumDiambil) && (
        <div className="crm-lap-alerts">
          {adaMenggantung && (
            <AlertRingkas tone="oranye" testid="alert-menggantung" judul="Percakapan menggantung sekarang" ringkas={`${salesReport.stalledNow} percakapan · lintas semua periode`}>
              <p>
                <strong>{salesReport.stalledNow} percakapan</strong> sedang menggantung
                SEKARANG — pesan terakhir dari customer dan sudah lebih dari 60 menit
                tanpa balasan (dihitung lintas semua periode, karena beban ini tetap
                ada berapa pun rentang yang dipilih). {!adaSla && !adaBelumDiambil && PENUTUP}
              </p>
            </AlertRingkas>
          )}
          {adaSla && (
            <AlertRingkas tone="oranye" testid="alert-sla" judul="Balasan pertama lewat 60 menit" ringkas={`${total.slaBreach} percakapan · periode terpilih`}>
              <p>
                Pada periode terpilih ada <strong>{total.slaBreach} percakapan</strong> yang
                balasan pertamanya lewat 60 menit{total?.neverReplied > 0 && (
                  <> (termasuk <strong>{total.neverReplied}</strong> yang ditutup tanpa
                  dibalas sama sekali)</>
                )}. {!adaBelumDiambil && PENUTUP}
              </p>
            </AlertRingkas>
          )}
          {adaBelumDiambil && (
            <AlertRingkas tone="oranye" testid="alert-belum-diambil" judul="Percakapan belum diambil siapa pun" ringkas={`${salesReport.unassignedInPeriod} percakapan · periode terpilih`}>
              <p>
                <strong>{salesReport.unassignedInPeriod} percakapan</strong> pada periode ini
                BELUM DIAMBIL siapa pun — tidak masuk hitungan sales manapun, dan ini
                sebabnya "Percakapan Ditangani" di sini lebih kecil dari "Total
                Percakapan". {PENUTUP}
              </p>
            </AlertRingkas>
          )}
        </div>
      )}

      {/* ── 4 KPI utama (4 kolom bila isi tab ≥1180px, 2 kolom sedang, 1 kolom HP: aturan .crm-kpi-grid) ───────────────── */}
      <section className="crm-kpi-grid">
        <KpiLap
          testid="kartu-total-percakapan" tone="revenue" ikon="chat" label="Total Percakapan" numericValue={perf?.totalConversations || 0}
          growth={perf?.growthTotalConversations} compareLabel={cmp}
          tooltip="Jumlah percakapan (WhatsApp/Instagram, bukan grup internal) yang dibuat di periode yang dipilih di atas."
        />
        <KpiLap
          testid="kartu-ditangani" tone="leads" ikon="centang" label="Percakapan Ditangani"
          numericValue={total?.handled || 0}
          growth={salesReport?.growthHandled} compareLabel={cmp}
          sub={`${aktif.length} sales aktif dari ${rows.length}`}
          tooltip="Percakapan yang dipegang 8 sales aktif (tidak termasuk Team Lead) di periode ini, chat SPAM dikecualikan."
        />
        <KpiLap
          testid="kartu-respons" tone="orders" ikon="alur" label="Rata-rata Respons"
          numericValue={perf?.avgResponseMinutes || 0}
          format={() => formatDuration(perf?.avgResponseMinutes)}
          sub="jeda pesan pertama customer → balasan pertama"
          tooltip="Rata-rata jeda pesan pertama customer sampai balasan pertama sales, dihitung dalam jam operasional (09-21 WIB), untuk percakapan yang MULAI di periode yang dipilih di atas."
        />
        <KpiLap
          testid="kartu-menggantung" tone="conversion" ikon="api" label="Menggantung Sekarang"
          numericValue={salesReport?.stalledNow || 0}
          sub="lintas semua periode — belum dibalas >60 menit"
          tooltip="Percakapan yang pesan TERAKHIRNYA dari customer, belum dibalas >60 menit — SENGAJA lintas semua periode (ini masalah HARI INI, bukan riwayat), tidak ikut rentang tanggal yang dipilih di atas."
        />
      </section>

      {/* Metrik pendukung: angka yang SUDAH ada di total tim/peringatan (periode terpilih), diringkas satu baris. */}
      {total && (
        <MetrikRingkas items={[
          { testid: "pendukung-sendiri", ikon: "centang", tone: "green", label: "Ditangani sendiri", numericValue: total.handledOwn || 0, sub: "periode terpilih, tanpa warisan Ambil Alih", tooltip: KOLOM_PERFORMA[0].title },
          { testid: "pendukung-warisan", ikon: "alur", tone: "indigo", label: "Warisan Ambil Alih", numericValue: total.handledTakeover || 0, sub: "berpindah lewat Ambil/Ambil Alih", tooltip: KOLOM_PERFORMA[1].title },
          { testid: "pendukung-sla", ikon: "api", tone: "orange", label: "Balasan pertama >60 mnt", numericValue: total.slaBreach || 0, sub: total.neverReplied > 0 ? `termasuk ${total.neverReplied} ditutup tanpa balasan` : "periode terpilih", tooltip: KOLOM_PERFORMA[4].title },
        ]} />
      )}

      {/* ── Dua grafik berdampingan: ukuran & satuan berbeda ────────────────────────────────────────────────────── */}
      <div className="crm-lap-baris crm-lap-baris--dua">
        <ChartCard
          index={4}
          title="Tren Penjualan & Waktu Respons"
          description="Dua ukuran terpisah pada sumbu waktu yang sama: nilai penjualan tim (batang, Rupiah, sumbu kiri) dan rata-rata waktu respons (garis, menit, sumbu kanan). Grafik ini tidak menyatakan satu mempengaruhi yang lain."
          empty={trenData.length === 0 ? "Belum ada data pada periode ini." : null}
          className="crm-pt-grafik"
        >
          {trenData.length === 1 ? (
            <TitikTunggal tanggal={formatBucketTick(trenData[0].bucket, granularity)} baris={[
              { label: "penjualan (Rupiah)", nilai: formatRupiah(trenData[0].revenue || 0) },
              { label: "rata-rata respons (menit)", nilai: trenData[0].avgMinutes != null ? `${Math.round(trenData[0].avgMinutes)} mnt` : "— (tidak ada data)" },
            ]} />
          ) : (
            <>
              <Legenda item={[{ nama: "Penjualan", satuan: "Rp · sumbu kiri", warna: WARNA_PENJUALAN, bentuk: "batang" }, { nama: "Rata-rata respons", satuan: "menit · sumbu kanan", warna: WARNA_RESPONS, bentuk: "garis" }]} />
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={trenData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
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
                  <Bar yAxisId="rupiah" dataKey="revenue" name="revenue" fill={WARNA_PENJUALAN} fillOpacity={0.85} radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={700} />
                  <Line
                    yAxisId="menit" type="monotone" dataKey="avgMinutes"
                    stroke={WARNA_RESPONS} strokeWidth={2.5} dot={trenData.length <= 14 ? { r: 3, fill: WARNA_RESPONS, strokeWidth: 0 } : false}
                    connectNulls={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={700}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
                Garis respons terputus = periode tanpa data (bukan 0 menit).
              </p>
            </>
          )}
        </ChartCard>

        {/* ── Tren respons & SLA tim (dipindah dari SalesReportTab.jsx) ───── */}
        <ChartCard
          index={6}
          title="Tren Waktu Respons & Pelanggaran SLA"
          description="Rata-rata waktu respons (garis, menit) & jumlah pelanggaran SLA >60 menit (batang, jumlah percakapan) tim, dari waktu ke waktu"
          empty={slaTrendData.length === 0 ? "Belum ada data pada periode ini." : null}
          className="crm-pt-grafik"
        >
          {slaTrendData.length === 1 ? (
            <TitikTunggal tanggal={formatBucketTick(slaTrendData[0].bucket, granularity)} baris={[
              { label: "rata-rata respons (menit)", nilai: slaTrendData[0].avgMinutes != null ? `${Math.round(slaTrendData[0].avgMinutes)} mnt` : "— (tidak ada data)" },
              { label: "pelanggaran SLA >60 mnt (percakapan)", nilai: String(slaTrendData[0].slaBreach ?? 0) },
            ]} />
          ) : (
            <>
              <Legenda item={[{ nama: "Rata-rata respons", satuan: "menit · sumbu kiri", warna: WARNA_RESPONS, bentuk: "garis" }, { nama: "Pelanggaran SLA", satuan: "percakapan · sumbu kanan", warna: "var(--red)", bentuk: "batang" }]} />
              <ResponsiveContainer width="100%" height={260}>
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
                  <Bar yAxisId="sla" dataKey="slaBreach" fill="var(--red)" fillOpacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={36} />
                  <Line
                    yAxisId="menit" type="monotone" dataKey="avgMinutes"
                    stroke={WARNA_RESPONS} strokeWidth={2.5} dot={slaTrendData.length <= 14 ? { r: 3, fill: WARNA_RESPONS, strokeWidth: 0 } : false}
                    connectNulls={false} activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
                Garis terputus = periode tanpa data respons (bukan 0 menit).
                Pelanggaran SLA termasuk percakapan yang ditutup tanpa satu pun balasan.
              </p>
            </>
          )}
        </ChartCard>
      </div>

      {/* ── Waktu respons per sales + beban percakapan (dipindah dari SalesReportTab.jsx) ──────────────────────────── */}
      <div className="crm-lap-baris crm-lap-baris--dua">
        {lambat.length > 0 && (
          <ChartCard
            index={5}
            title="Waktu Respons Pertama"
            description="Rata-rata jeda pesan pertama customer → balasan pertama. Makin pendek makin baik."
          >
            <div className="flex flex-col gap-2.5">
              {lambat.map((r) => (
                <BarRow
                  key={r.userId} tumpuk
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

        <ChartCard
          index={7} title="Beban Percakapan"
          description="Percakapan yang diklaim/dipegang sendiri sejak awal — tidak termasuk warisan Ambil Alih"
        >
          <div className="flex flex-col gap-2.5">
            {rows.filter((r) => r.handledOwn > 0 || r.handledTakeover > 0).map((r) => (
              <BarRow
                key={r.userId} tumpuk label={r.name} value={r.handledOwn} max={maxHandled}
                display={`${r.handledOwn}`}
                sub={r.handledTakeover > 0 ? `+${r.handledTakeover} warisan takeover` : undefined}
                lebarSub="sm:w-40"
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
      </div>

      {/* ── Rincian performa per sales ───────────────────────────────────
          Kolom kecepatan/beban chat (dipindah dari "Rincian Lengkap" di
          SalesReportTab.jsx 25 Agustus 2026) — tabel Sales sekarang HANYA
          kolom penjualan, tabel ini HANYA kolom performa. Data sumbernya
          SAMA (`salesReport`), cuma kolom yang ditonjolkan beda. */}
      {rows.length > 0 && (
        <Card className="crm-pt-tabel-panel" data-testid="pt-rincian">
          <div className="crm-pl-kepala">
            <h3 className="t-card-title">Rincian Performa</h3>
            <p className="crm-mk-deskripsi">Kecepatan &amp; beban chat per sales — gulir ke samping untuk kolom lainnya. Metrik penjualan ada di tab Sales.</p>
          </div>
          <div className="crm-ss-gulir" tabIndex={0} role="region" aria-label="Tabel rincian performa per sales; gulir mendatar untuk kolom lain">
            <table className="crm-ss-tabel-sales crm-pt-tabel">
              <thead>
                <tr>
                  <th scope="col" className="crm-ss-kiri">Sales</th>
                  {KOLOM_PERFORMA.map((c) => (
                    <th key={c.k} scope="col"><span className="crm-mk-th">{c.label}<InfoTooltip text={c.title} /></span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...teamLeadRows.map((r) => ({ r, tl: true })), ...rows.map((r) => ({ r, tl: false }))].map(({ r, tl }) => (
                  <tr key={r.userId} data-tl={tl ? "1" : undefined}>
                    <th scope="row" className="crm-ss-kiri">
                      <span className="crm-ss-orang"><Avatar name={r.name} url={r.avatarUrl} /><span className="crm-ss-nama-sales" title={r.name}>{r.name}</span>{tl && <Crown size={12} className="crm-pt-mahkota" aria-label="Team Lead" />}</span>
                    </th>
                    <td className="crm-ss-tebal">{r.handledOwn}</td>
                    <td className="crm-pt-redup">{r.handledTakeover}</td>
                    <td><b className="crm-ss-chip" data-ada={r.stalled > 0 ? "1" : "0"}>{r.stalled}</b></td>
                    <td className="crm-pt-respons" data-tone={toneRespons(r.avgResponseMinutes)}>{formatDuration(r.avgResponseMinutes)}</td>
                    <td><b className="crm-ss-chip" data-ada={r.slaBreach > 0 ? "1" : "0"} data-merah={r.slaBreach > 0 ? "1" : undefined}>{r.slaBreach}</b></td>
                  </tr>
                ))}
              </tbody>
              {total && (
                <tfoot>
                  <tr>
                    <th scope="row" className="crm-ss-kiri">Total tim</th>
                    <td className="crm-ss-tebal">{total.handledOwn}</td>
                    <td className="crm-pt-redup">{total.handledTakeover}</td>
                    <td>{total.stalled}</td>
                    {/* Rata-rata respons tim SENGAJA em-dash: merata-ratakan
                        rata-rata per orang tanpa membobot jumlah percakapan
                        menghasilkan angka yang salah. */}
                    <td className="crm-pt-redup">—</td>
                    <td>{total.slaBreach}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="crm-mk-catatan">
            "Total tim" HANYA menjumlahkan 8 sales biasa — TIDAK termasuk
            closing pribadi Team Lead, konsisten dengan tabel di tab Sales.
          </p>
        </Card>
      )}

      <div className="crm-lap-baris crm-lap-baris--dua">
        <ChartCard index={9} title="Breakdown Channel" description="Asal percakapan masuk" empty={channelBreakdown.length === 0 ? "Belum ada data." : null} className="crm-pt-ringkas">
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

        <ChartCard index={10} title="Status Percakapan" description="Terbuka / Pending / Selesai" empty={statusBreakdown.length === 0 ? "Belum ada data." : null} className="crm-pt-ringkas">
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
