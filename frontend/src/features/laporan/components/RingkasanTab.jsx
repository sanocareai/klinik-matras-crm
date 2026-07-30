import React from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AlertTriangle, ArrowRight } from "lucide-react";
import dayjs from "dayjs";
import { formatRupiah, formatRupiahShort, ORDER_STATUS_LABELS, STAGE_LABELS } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import BarRow from "./BarRow.jsx";

// ═══ RINGKASAN EKSEKUTIF ══════════════════════════════════════════════════
// Tab ini menjawab SATU pertanyaan: "bagaimana kondisi bisnis periode ini?"
// — tanpa pengguna harus pindah tab. Tab lain (Percakapan/Penjualan/Pipeline/
// Sales) tetap ada untuk mendalami, tapi gambaran utuhnya HARUS ada di sini.
//
// YANG DIHAPUS dari versi lama & alasannya:
// 1. Donut "Channel Masuk" — 100% WhatsApp (Instagram belum terintegrasi),
//    jadi donut satu irisan yang tidak menyampaikan apa pun, dan warnanya
//    hijau (melanggar aturan satu accent). Diganti baris angka di blok
//    Percakapan; kembalikan sebagai chart kalau Instagram sudah masuk.
// 2. Bar "Pelanggan Baru per Bulan" — mengulang angka kartu KPI di atasnya,
//    dan dengan 2 bulan data menghabiskan satu baris penuh untuk 2 batang.
// 3. Grafik "Pendapatan Bulanan" berbucket BULAN — di rentang 30 hari hasilnya
//    SATU titik (Recharts tidak menggambar garis dari 1 titik → grafik tampak
//    kosong). Sekarang memakai deret ADAPTIF dari /business-summary: rentang
//    <=92 hari jadi HARIAN. Itu juga menghilangkan pertentangan lama antara
//    header "Periode: 27 Jun – 26 Jul" dengan grafik yang selalu 6 bulan.
const AXIS = { fontSize: 12, fill: "var(--text-secondary)" };

const CATEGORY_LABELS = {
  LAYANAN: "Layanan/Upgrade",
  SEWA:    "Kasur Sewa",
  BARU:    "Kasur Baru",
};

// Urutan alur kerja produksi, BUKAN alfabet — supaya kolom ini terbaca
// sebagai antrean ("20 menunggu, 17 diambil, 10 dikerjakan..."), bukan
// daftar acak. CANCELLED sengaja terakhir & diberi tone merah.
const STATUS_ORDER = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];
const STATUS_TONE = { DELIVERED: "green", CANCELLED: "red", PENDING: "orange" };

function ChartTip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{granularity === "day" ? formatTanggalPendek(label) : label}</p>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full bg-accent" />
        {formatRupiah(payload[0].value)}
      </p>
    </div>
  );
}

export default function RingkasanTab({ summary, overview, perf, funnel = [], onGoTab }) {
  const uang     = summary?.uang;
  const konversi = summary?.konversi;
  const series   = summary?.revenueSeries || [];
  const gran     = summary?.granularity || "day";

  const statusRows = STATUS_ORDER
    .map((s) => (summary?.orderStatus || []).find((r) => r.status === s))
    .filter(Boolean);
  const statusMax = Math.max(1, ...statusRows.map((r) => r.count));

  const kategori = [...(summary?.revenueByCategory || [])].sort((a, b) => b.value - a.value);
  const katMax   = Math.max(1, ...kategori.map((r) => r.value));

  const kota    = summary?.topCities || [];
  const kotaMax = Math.max(1, ...kota.map((r) => r.count));
  // Kota "Belum diisi" yang dominan bukan insight geografis — itu masalah
  // KUALITAS DATA. Ditandai eksplisit supaya owner tidak salah menyimpulkan
  // "pasar kami tidak terkonsentrasi" padahal kolomnya memang belum diisi.
  const kotaKosong = kota.find((k) => k.city === "Belum diisi");
  const totalKota  = kota.reduce((s, k) => s + k.count, 0);
  const kotaKosongDominan = kotaKosong && totalKota > 0 && kotaKosong.count / totalKota > 0.5;

  const funnelUtama = funnel.filter((f) => f.count > 0);
  const funnelMax = Math.max(1, ...funnelUtama.map((f) => f.count));

  return (
    <div className="flex flex-col gap-5">
      {/* ── 1. UANG ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          index={0} hero
          label="Nilai Penjualan"
          numericValue={uang?.grossValue || 0}
          format={(v) => formatRupiah(Math.round(v))}
          growth={overview?.growthOrderValue}
          sub={`${uang?.totalOrders || 0} order · order masuk (belum tentu terbayar)`}
        />
        <KpiCard
          index={1}
          label="Sudah Lunas"
          numericValue={uang?.collectedValue || 0}
          format={(v) => formatRupiah(Math.round(v))}
          sub={uang?.collectedRate != null ? `${uang.collectedRate}% dari nilai penjualan` : "—"}
        />
        <KpiCard
          index={2}
          label="Belum Lunas"
          numericValue={uang?.outstandingValue || 0}
          format={(v) => formatRupiah(Math.round(v))}
          sub="nilai order yang belum tercatat lunas"
        />
        <KpiCard
          index={3}
          label="Rata-rata per Order"
          numericValue={uang?.aov || 0}
          format={(v) => formatRupiah(Math.round(v))}
          sub="AOV — nilai penjualan / jumlah order"
        />
      </div>

      {/* Peringatan kualitas data pembayaran. Rasio lunas yang sangat rendah
          hampir selalu berarti `paymentStatus` order TIDAK dirawat tim, bukan
          benar-benar ada piutang sebesar itu. Ini harus dikatakan terus
          terang — kalau tidak, angka "Belum Lunas" akan dibaca sebagai
          kerugian nyata dan memicu keputusan yang salah. */}
      {uang?.collectedRate != null && uang.collectedRate < 40 && uang.grossValue > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl bg-orangebg px-3.5 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-orange" size={16} />
          <p className="text-xs leading-relaxed text-ink">
            Hanya <strong>{uang.collectedRate}%</strong> nilai order bertanda “Lunas”.
            Kalau tim belum rutin memperbarui <strong>Status Pembayaran</strong> di
            tiap order, angka “Belum Lunas” di atas bukan piutang sebenarnya —
            itu order yang statusnya belum diisi. Periksa dulu sebelum
            memakainya sebagai angka penagihan.
          </p>
        </div>
      )}

      {/* Integritas data: pelanggan bertanda sudah bayar TAPI tidak punya order
          sama sekali. Ini mustahil secara bisnis dan artinya pendapatannya
          TIDAK PERNAH tercatat — penyebab langsung angka aneh seperti "1
          pelanggan bayar tapi Rp0" di Laporan Sales. Ditampilkan sebagai tugas
          yang bisa dikerjakan, bukan disembunyikan. */}
      {summary?.integritas?.paidTanpaOrder > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl bg-redbg px-3.5 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-red" size={16} />
          <p className="text-xs leading-relaxed text-ink">
            <strong>{summary.integritas.paidTanpaOrder} pelanggan</strong> berstatus
            “Paid”/“Already Reviewed” tapi <strong>tidak punya order sama sekali</strong>.
            Kalau sudah bayar, harusnya ada order yang dibayar — jadi pendapatan
            mereka belum tercatat di sistem dan tidak masuk hitungan Nilai
            Penjualan mana pun. Biasanya karena stage digeser di Kanban tanpa
            membuat order. Perbaiki di Pelanggan → buka profil → tambah order.
          </p>
        </div>
      )}

      {/* ── 2. TREN PENDAPATAN + KONVERSI ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <ChartCard
          index={4}
          title="Tren Pendapatan"
          description={gran === "day" ? "Nilai order per hari pada periode terpilih" : "Nilai order per bulan pada periode terpilih"}
          empty={series.length === 0 ? "Belum ada data pada periode ini." : null}
        >
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="ringkasanRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
              <XAxis
                dataKey="bucket"
                tickFormatter={(v) => (gran === "day" ? dayjs(v).format("D MMM") : v)}
                tick={AXIS} axisLine={false} tickLine={false} dy={4}
                interval="preserveStartEnd" minTickGap={28}
              />
              <YAxis tickFormatter={formatRupiahShort} tick={AXIS} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<ChartTip granularity={gran} />} cursor={{ stroke: "var(--hairline)" }} />
              <Area
                type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5}
                fill="url(#ringkasanRev)"
                dot={series.length <= 14 ? { r: 3, fill: "var(--accent)", strokeWidth: 0 } : false}
                activeDot={{ r: 5, fill: "var(--accent)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
                isAnimationActive animationDuration={700}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard index={5} title="Konversi" description="Dari pelanggan baru ke pembayaran">
          <div className="flex flex-col gap-3.5">
            {[
              { label: "Pelanggan baru", value: konversi?.totalCustomers || 0, tone: "accent", pct: 100 },
              { label: "Pernah order",   value: konversi?.customersWithOrders || 0, tone: "accent", pct: konversi?.orderRate },
              { label: "Sudah bayar",    value: konversi?.paidCustomers || 0, tone: "green", pct: konversi?.paidRate },
            ].map((r) => (
              <div key={r.label}>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-ink2">{r.label}</span>
                  <span className="text-[15px] font-bold tabular-nums text-ink">
                    {r.value.toLocaleString("id-ID")}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-inset">
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ${r.tone === "green" ? "bg-green" : "bg-accent"}`}
                    style={{ width: `${Math.min(r.pct ?? 0, 100)}%` }}
                  />
                </div>
                {r.pct != null && (
                  <span className="mt-1 inline-block text-[11px] text-ink3">{r.pct}% dari pelanggan baru</span>
                )}
              </div>
            ))}

            <div className="mt-1 border-t border-line pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink3">Total percakapan</span>
                <span className="text-[13px] font-semibold tabular-nums text-ink2">
                  {(perf?.totalConversations || 0).toLocaleString("id-ID")}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-xs text-ink3">Rasio komplain</span>
                <span className="text-[13px] font-semibold tabular-nums text-ink2">
                  {summary?.komplain?.rate != null ? `${summary.komplain.rate}%` : "—"}
                  <span className="ml-1 font-normal text-ink3">({summary?.komplain?.count || 0})</span>
                </span>
              </div>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* ── 3. BEBAN PRODUKSI + KATEGORI ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard
          index={6}
          title="Antrean Produksi"
          description="Order per status — beban kerja tim saat ini"
          empty={statusRows.length === 0 ? "Belum ada order pada periode ini." : null}
        >
          <div className="flex flex-col gap-2.5">
            {statusRows.map((r) => (
              <BarRow
                key={r.status}
                label={ORDER_STATUS_LABELS[r.status] || r.status}
                value={r.count} max={statusMax}
                display={`${r.count} order`}
                sub={formatRupiahShort(r.value)}
                tone={STATUS_TONE[r.status] || "accent"}
              />
            ))}
          </div>
        </ChartCard>

        <ChartCard
          index={7}
          title="Pendapatan per Kategori"
          description="Layanan vs Kasur Baru vs Sewa"
          empty={kategori.length === 0 ? "Belum ada order pada periode ini." : null}
        >
          <div className="flex flex-col gap-2.5">
            {kategori.map((r) => (
              <BarRow
                key={r.category}
                label={CATEGORY_LABELS[r.category] || r.category}
                value={r.value} max={katMax}
                display={formatRupiahShort(r.value)}
                sub={`${r.count} order`}
              />
            ))}
          </div>
        </ChartCard>
      </div>

      {/* ── 4. PIPELINE RINGKAS + KOTA ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard
          index={8}
          title="Posisi Pipeline"
          description="Jumlah pelanggan di tiap tahap saat ini"
          empty={funnelUtama.length === 0 ? "Belum ada data pipeline." : null}
        >
          <div className="flex flex-col gap-2.5">
            {funnelUtama.map((f) => (
              <BarRow
                key={f.stage}
                label={STAGE_LABELS[f.stage] || f.stage}
                value={f.count} max={funnelMax}
                display={f.count.toLocaleString("id-ID")}
                sub={f.value > 0 ? formatRupiahShort(f.value) : "—"}
                tone={f.stage === "COMPLETED" || f.stage === "REVIEWED" ? "green" : f.stage === "NEW" ? "orange" : "accent"}
              />
            ))}
          </div>
          {onGoTab && (
            <button
              type="button"
              onClick={() => onGoTab("Pipeline")}
              className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              Lihat kecepatan & pergerakan pipeline <ArrowRight size={13} />
            </button>
          )}
        </ChartCard>

        <ChartCard
          index={9}
          title="Sebaran Kota"
          description="Pelanggan baru per kota (8 teratas)"
          empty={kota.length === 0 ? "Belum ada data kota." : null}
        >
          <div className="flex flex-col gap-2.5">
            {kota.map((r) => (
              <BarRow
                key={r.city}
                label={r.city} value={r.count} max={kotaMax}
                display={r.count.toLocaleString("id-ID")}
                tone={r.city === "Belum diisi" ? "muted" : "accent"}
              />
            ))}
          </div>
          {kotaKosongDominan && (
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
              <strong className="text-ink2">{Math.round((kotaKosong.count / totalKota) * 100)}%</strong> pelanggan
              belum punya data kota, jadi sebaran ini belum mewakili pasar sebenarnya.
              Kota terisi otomatis saat sales melengkapi profil pelanggan.
            </p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
