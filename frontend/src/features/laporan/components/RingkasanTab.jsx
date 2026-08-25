import React, { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { formatRupiah, formatRupiahShort, ORDER_STATUS_LABELS, STAGE_LABELS, SOURCE_LABELS } from "@/utils/format.js";
import { compareLabel, formatBucketTick } from "@/lib/dateRange.js";
import { computeTeamTarget } from "../utils/teamTarget.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import BarRow from "./BarRow.jsx";

// D-026 (20 Agustus 2026) — ringkasan kampanye promo (mis. "Merdeka dari
// Sakit Pinggang"). SENGAJA fetch sendiri (bukan lewat prop `summary` dari
// Laporan.jsx) — /api/promos sudah menghitung orderCount/totalValue per
// promo dalam satu query, jadi tidak perlu menambah endpoint/prop baru cuma
// untuk angka yang sudah tersedia. Kalau tidak ada satu pun promo yang
// PERNAH dipakai order, kartu ini menghilang total — bukan tampil kosong —
// supaya tab Ringkasan tidak penuh kartu "belum ada apa-apa" sebelum
// kampanye pertama benar-benar berjalan.
function PromoSummaryCard({ index }) {
  const [promos, setPromos] = useState(null);
  useEffect(() => { api.getPromos().then(setPromos).catch(() => setPromos([])); }, []);

  const dipakai = (promos || []).filter((p) => p.orderCount > 0);
  if (promos === null || dipakai.length === 0) return null;

  const max = Math.max(...dipakai.map((p) => p.orderCount));
  return (
    <ChartCard index={index} title="Kampanye Promo" description="Order & omzet per kampanye yang pernah dipakai">
      <div className="flex flex-col gap-2.5">
        {dipakai.map((p) => (
          <BarRow
            key={p.id}
            label={p.name} value={p.orderCount} max={max}
            display={`${p.orderCount.toLocaleString("id-ID")} order`}
            sub={formatRupiahShort(p.totalValue)}
            tone={p.active ? "accent" : "muted"}
          />
        ))}
      </div>
      <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
        Rata-rata nilai order per kampanye:{" "}
        {dipakai.map((p, i) => (
          <span key={p.id}>
            {i > 0 && " · "}
            <strong className="text-ink2">{p.name}</strong> {formatRupiahShort(Math.round(p.totalValue / p.orderCount))}
          </span>
        ))}
      </p>
    </ChartCard>
  );
}

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
      <p className="t-caption mb-1">{formatBucketTick(label, granularity)}</p>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full bg-accent" />
        {formatRupiah(payload[0].value)}
      </p>
    </div>
  );
}

export default function RingkasanTab({ summary, overview, perf, funnel = [], onGoTab, range, targetReport }) {
  const cmp = compareLabel(range);
  // targetReport SENGAJA month-to-date TETAP, tidak ikut `range` yang
  // dipilih — lihat catatan panjang di Laporan.jsx#salesReportBulanIni.
  const { teamGrossAll, percentToTarget, targetValue } = computeTeamTarget(targetReport);
  const sumberLead = [...(overview?.leadSourceBreakdown || [])].sort((a, b) => b.count - a.count);
  const sumberLeadMax = Math.max(1, ...sumberLead.map((r) => r.count));
  const sumberLeadTotal = sumberLead.reduce((s, r) => s + r.count, 0);
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

  const agingRows = uang?.outstandingAging || [];
  const agingMax  = Math.max(1, ...agingRows.map((r) => r.value));

  return (
    <div className="flex flex-col gap-5">
      {/* Target Bulanan — pertanyaan PERTAMA yang owner tanya ("apa kita on
          track?"), sebelumnya tidak terjawab di tab ini sama sekali (KPI
          Nilai Penjualan cuma angka mentah, tanpa konteks target). Data +
          logika SAMA PERSIS dengan kartu "Target Tim" di tab Sales (lihat
          utils/teamTarget.js) — sengaja tidak dihitung ulang terpisah di
          sini. Disembunyikan total kalau belum ada target diset sama sekali
          (targetValue 0), bukan tampil "0%" yang menyesatkan. */}
      {targetValue > 0 && (
        <div className="rounded-2xl bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-ink3">
              Target Bulanan Tim
              {/* Selalu bulan berjalan — TIDAK ikut date picker di atas (lihat
                  catatan Laporan.jsx#salesReportBulanIni). Ditandai eksplisit
                  supaya tidak membingungkan saat rentang lain (mis. "Hari
                  ini") sedang dipilih untuk sisa halaman. */}
              <span className="ml-1.5 font-normal text-ink4">· bulan berjalan</span>
            </p>
            <span className="text-xs text-ink3">
              {formatRupiah(teamGrossAll)} <span className="text-ink3">/ {formatRupiah(targetValue)}</span>
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-inset">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700 ease-out",
                  percentToTarget == null ? "bg-line"
                  : percentToTarget >= 100 ? "bg-green"
                  : percentToTarget >= 50 ? "bg-accent" : "bg-orange"
                )}
                style={{ width: `${Math.min(percentToTarget ?? 0, 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-lg font-extrabold tabular-nums text-ink">
              {percentToTarget != null ? `${percentToTarget}%` : "—"}
            </span>
          </div>
        </div>
      )}

      {/* ── 1. UANG ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          index={0} hero
          label="Nilai Penjualan"
          numericValue={uang?.grossValue || 0}
          format={(v) => formatRupiah(Math.round(v))}
          growth={overview?.growthOrderValue} compareLabel={cmp}
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

      {/* Aging piutang — "Belum Lunas" di atas satu angka gabungan, tidak
          bisa membedakan piutang yang baru kemarin (wajar) dari yang sudah
          sebulan menunggak (butuh ditagih). Umur dihitung dari createdAt
          order sampai SEKARANG, bukan relatif ke periode laporan yang
          dipilih — piutang 40 hari tetap "40 hari" apa pun rentang di atas. */}
      {agingRows.some((r) => r.value > 0) && (
        <ChartCard
          index={3.5}
          title="Aging Piutang"
          description="Order belum lunas, dikelompokkan berdasarkan sudah berapa lama menunggak"
        >
          <div className="flex flex-col gap-2.5">
            {agingRows.map((r) => (
              <BarRow
                key={r.label} label={r.label} value={r.value} max={agingMax}
                display={formatRupiahShort(r.value)}
                sub={`${r.count} order`}
                tone={r.label === ">30 hari" ? "red" : r.label === "7-30 hari" ? "orange" : "accent"}
              />
            ))}
          </div>
        </ChartCard>
      )}

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
          description={
            gran === "hour" ? "Nilai order per jam, hari ini"
            : gran === "day" ? "Nilai order per hari pada periode terpilih"
            : "Nilai order per bulan pada periode terpilih"
          }
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
                tickFormatter={(v) => formatBucketTick(v, gran)}
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
              {/* Repeat order — dari yang PERNAH order, berapa persen order
                  LAGI. Indikator loyalitas yang tidak kelihatan dari AOV/
                  Total Revenue sendirian (keduanya bisa naik cuma dari
                  pelanggan baru). */}
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-xs text-ink3">Repeat order</span>
                <span className="text-[13px] font-semibold tabular-nums text-ink2">
                  {konversi?.repeatRate != null ? `${konversi.repeatRate}%` : "—"}
                  <span className="ml-1 font-normal text-ink3">({konversi?.repeatCustomers || 0} pelanggan)</span>
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

      {/* ── 4. SUMBER LEAD + PIPELINE + KOTA ──────────────────────────── */}
      {/* "Dari mana pelanggan datang" — sebelumnya TIDAK ADA visibilitas
          sumber lead sama sekali di tab ini (harus pindah ke tab Traffic).
          SPAM dikecualikan (custWhereKonversi di backend) supaya jumlahnya
          sepadan dengan KPI "New Leads" di atas — dulu leadSourceBreakdown
          tidak punya konsumen UI sama sekali, jadi celah ini tidak ketahuan. */}
      <ChartCard
        index={7.5}
        title="Sumber Lead"
        description="Dari mana pelanggan baru datang, periode ini"
        empty={sumberLead.length === 0 ? "Belum ada lead pada periode ini." : null}
      >
        <div className="flex flex-col gap-2.5">
          {sumberLead.map((r) => (
            <BarRow
              key={r.leadSource}
              label={SOURCE_LABELS[r.leadSource] || r.leadSource}
              value={r.count} max={sumberLeadMax}
              display={r.count.toLocaleString("id-ID")}
              sub={sumberLeadTotal > 0 ? `${Math.round((r.count / sumberLeadTotal) * 100)}%` : undefined}
            />
          ))}
        </div>
      </ChartCard>

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
                tone={f.stage === "TRANSACTION" ? "green" : f.stage === "NEW" ? "orange" : f.stage === "SPAM" ? "muted" : "accent"}
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

        <PromoSummaryCard index={10} />
      </div>
    </div>
  );
}
