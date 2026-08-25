import React from "react";
import { Download, Info, Crown } from "lucide-react";
import Avatar from "../../../components/Avatar.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { formatRupiah, formatRupiahShort } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import { compareLabel } from "@/lib/dateRange.js";
import { computeTeamTarget } from "../utils/teamTarget.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import BarRow from "./BarRow.jsx";

// ═══ LAPORAN SALES ════════════════════════════════════════════════════════
// FOKUS PENJUALAN — siapa closing berapa, target, konversi. Metrik KECEPATAN
// respons/beban chat (Ditangani, Warisan, Mengg., Avg Respons, SLA, Waktu
// Respons Pertama, Tren SLA, Beban Percakapan) DIPINDAH ke tab "Performa Tim"
// (25 Agustus 2026, permintaan owner: "laporan sales fokus penjualan, performa
// tim fokus performa sales seperti kecepatan balas chat") — lihat
// PerformaTimTab.jsx. Dua tab sama-sama baca `salesReport`/`report` yang SAMA,
// cuma menonjolkan kolom yang berbeda.
//
// ⚠️ ATRIBUSI: semua angka memakai `Conversation.assignedToId` — "percakapan
// yang saya pegang". BUKAN `Customer.assignedSalesId`. Lihat catatan panjang
// di backend routes/analytics.js #/sales-report. Konsekuensinya: order dari
// customer yang percakapannya dipegang orang lain TIDAK masuk ke baris ini,
// dan total tim bisa lebih kecil dari total penjualan perusahaan — selisih itu
// ditampilkan terbuka di bawah, bukan disembunyikan.

// "Closing rate" LAMA = percakapan RESOLVED / total, dan di produksi hampir
// nol karena tim tidak pernah menandai percakapan selesai — itu sebabnya KPI
// "Closing Rate 1%" di Laporan lama menyesatkan. Konversi di sini = pelanggan
// yang PINDAH ke stage Transaksi / percakapan yang dipegang.
//
// REVISI 25 Agustus 2026: metrik utama "Konversi" pindah dari
// orderConversionRate (order benar-benar dibuat) ke conversionRate (transisi
// pipeline ke TRANSACTION) — datanya sudah >1 bulan terekam, dan ini
// konsisten dengan pipelineStage sebagai sumber kebenaran funnel
// (restrukturisasi 7→4 stage). orderConversionRate tetap ditampilkan sebagai
// kolom sekunder "Konversi (Order)" — mengukur hal genuinely beda.
function toneKonversi(v, median) {
  if (v == null) return "text-ink3";
  if (median != null && v >= median * 1.2) return "text-green";
  if (median != null && v <= median * 0.6) return "text-red";
  return "text-ink";
}

const KOLOM = [
  // Restrukturisasi 24 Agustus 2026 (7→4 stage): kolom Qualified* + Quoted*
  // digabung jadi SATU (Prospect*) — dua-duanya sekarang satu stage PROSPECT.
  { k: "prospect",   label: "Prospect*",  title: "POSISI SAAT INI: pelanggan yang sekarang berada di tahap Prospect (tidak mengikuti rentang tanggal)" },
  { k: "paidCustomers", label: "Transaksi", title: "Pelanggan yang PINDAH ke stage Transaksi di dalam periode terpilih (dari riwayat transisi pipeline)" },
  { k: "conversionRate", label: "Konversi", title: "Pindah ke Transaksi dalam periode / percakapan yang ditangani dalam periode — metrik konversi UTAMA, SPAM dikecualikan" },
  { k: "orderingCustomers", label: "Order-in", title: "Pelanggan yang membuat order DI DALAM periode terpilih" },
  { k: "orderConversionRate", label: "Konversi (Order)", title: "Pelanggan yang order di periode ini / percakapan yang ditangani di periode ini — pelengkap, mengukur order yang benar-benar dibuat" },
  { k: "spamRate",   label: "Spam %",     title: "Persentase lead yang DIA PEGANG ditandai SPAM — bukan metrik performa, layak ditinjau kalau jauh di atas rata-rata tim" },
  { k: "orders",     label: "Order",      title: "Jumlah order (CANCELLED tidak dihitung)" },
  { k: "grossValue", label: "Nilai",      title: "Nilai order masuk — belum tentu sudah terbayar" },
  { k: "aov",        label: "AOV",        title: "Rata-rata nilai per order" },
  { k: "percentToTarget", label: "% Target", title: "Nilai order dibanding target bulan berjalan" },
];

export default function SalesReportTab({ report, targetReport, grossTotalPerusahaan, onExport, range }) {
  const cmp = compareLabel(range);
  const semuaRows = report?.rows || [];
  // Baris "Team Lead" (Novi) TERPISAH dari leaderboard/tabel 8 sales biasa
  // di bawah sini (25 Agustus 2026) — target dia mewakili target TIM
  // gabungan, jadi tercampur ke ranking/median 8 sales akan salah makna.
  // Backend SUDAH memisahkan dia dari `total` (Total Tim) — lihat catatan
  // di routes/analytics.js /sales-report.
  const rows  = semuaRows.filter((r) => !r.isTeamLead);
  const total = report?.total;

  // Progres target TIM (Nilai/Order/AOV) — ini MEMANG ikut `range` yang
  // dipilih (jawab "berapa closing tim di periode ini"). Lihat utils/teamTarget.js
  // untuk kenapa ini SATU sumber kebenaran dipakai bersama RingkasanTab.jsx.
  const { teamLeadRows, teamGrossAll, teamOrdersAll, teamAovAll } = computeTeamTarget(report);

  // Semua "% Target"/progres-ke-target di bawah ini SENGAJA baca `targetReport`
  // (selalu bulan berjalan, lihat catatan panjang di Laporan.jsx#salesReportBulanIni)
  // — BUKAN `report` yang ikut `range`. Target itu sendiri bulanan; membagi
  // closing SATU HARI dengan target SEBULAN PENUH selalu kelihatan nyaris 0%
  // begitu range di-set "Hari ini", padahal progres bulanannya bisa saja sudah
  // jauh lebih tinggi. Metrik AKTIVITAS (orders, conversionRate, dst di atas)
  // TETAP ikut `range` — cuma bagian target yang dikunci ke bulan berjalan.
  const targetInfo = computeTeamTarget(targetReport);
  const targetByUserId = new Map(
    (targetReport?.rows || []).filter((r) => !r.isTeamLead).map((r) => [r.userId, r])
  );

  const aktif = rows.filter((r) => r.handled > 0);
  // Median dipakai untuk mewarnai baik/buruk secara RELATIF terhadap tim,
  // bukan ambang absolut yang dikarang — 5% bisa bagus atau buruk tergantung
  // jenis lead. Memakai conversionRate (transisi pipeline, metrik UTAMA sejak
  // 25 Agustus 2026) — datanya sudah >1 bulan terekam.
  const konversiList = aktif.map((r) => r.conversionRate).filter((v) => v != null).sort((a, b) => a - b);
  const median = konversiList.length > 0 ? konversiList[Math.floor(konversiList.length / 2)] : null;

  const maxNilai = Math.max(1, ...rows.map((r) => r.grossValue));

  // Selisih penjualan perusahaan vs yang bisa diatribusikan ke sales. Muncul
  // kalau ada order dari customer yang percakapannya belum di-assign ke
  // siapa pun (atau dipegang admin). Ditampilkan supaya tidak ada kesan
  // "angka Laporan tidak konsisten antar tab".
  const takTeratribusi = grossTotalPerusahaan != null && total
    ? grossTotalPerusahaan - total.grossValue
    : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <button className="btn btn-ghost btn-sm" onClick={onExport}>
          <Download size={14} /> Export Excel
        </button>
      </div>

      {/* ── Ringkasan tim ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          index={0} hero label="Nilai Penjualan Tim"
          numericValue={teamGrossAll}
          format={(v) => formatRupiah(Math.round(v))}
          growth={report?.growthTeamGrossValue} compareLabel={cmp}
          sub={`${teamOrdersAll} order · AOV ${formatRupiahShort(teamAovAll)}`}
          tooltip="Total nilai order seluruh tim (8 sales + closing pribadi Team Lead) di periode yang dipilih di atas."
        />
        <KpiCard
          index={1} label="Konversi Tim"
          numericValue={total?.conversionRate || 0}
          format={(v) => (total?.conversionRate != null ? `${v.toFixed(1)}%` : "—")}
          sub={`${total?.paidCustomers || 0} pelanggan pindah ke Transaksi di periode ini`}
          tooltip="Pelanggan yang pindah ke stage Transaksi di periode ini, dibagi jumlah percakapan yang ditangani tim (8 sales, tanpa Team Lead)."
        />
        <KpiCard
          index={2} label="Target Tim"
          numericValue={targetInfo.percentToTarget || 0}
          format={() => (targetInfo.percentToTarget != null ? `${targetInfo.percentToTarget}%` : "—")}
          sub={
            targetInfo.teamLead
              ? (targetInfo.teamLead.target > 0
                  ? `${formatRupiahShort(targetInfo.teamLead.teamGrossValue)} / ${formatRupiahShort(targetInfo.teamLead.target)} (target tim, bulan berjalan)`
                  : "Target tim belum diset (Pengaturan > Target Sales)")
              : `${formatRupiahShort(targetInfo.teamGrossAll)} / ${formatRupiahShort(targetInfo.targetValue)} (jumlah target individu, bulan berjalan)`
          }
          tooltip="Progres closing tim terhadap target BULANAN — SELALU bulan berjalan, tidak ikut rentang tanggal yang dipilih di atas."
        />
        <KpiCard
          index={3} label="AOV Tim"
          numericValue={teamAovAll}
          format={(v) => (teamAovAll > 0 ? formatRupiah(Math.round(v)) : "—")}
          sub="rata-rata nilai per order, seluruh tim"
          tooltip="Nilai order rata-rata (total nilai / jumlah order) seluruh tim di periode yang dipilih di atas."
        />
      </div>

      {/* ── Leaderboard ───────────────────────────────────────────────── */}
      <ChartCard
        index={4}
        title="Leaderboard Sales"
        description="Diurutkan dari nilai penjualan tertinggi"
        empty={rows.length === 0 ? "Belum ada data sales pada periode ini." : null}
      >
        {teamLeadRows.length > 0 && (
          <div className="mb-3 flex flex-col gap-3 border-b border-line pb-3">
            {teamLeadRows.map((r) => {
              // Bar/% target row ini SELALU bulan berjalan (lihat catatan
              // targetInfo di atas) — dicocokkan by userId ke rekan MTD-nya,
              // TIDAK memakai r.teamGrossValue/r.target/r.teamPercentToTarget
              // yang ikut range terpilih.
              const mtd = targetInfo.teamLeadRows.find((m) => m.userId === r.userId);
              return (
                <div key={r.userId} className="flex flex-col gap-3 rounded-xl bg-blue-50 px-3 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={r.name} src={r.avatarUrl} size="md" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                        {r.name}
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-ink">
                          <Crown size={10} /> Team Lead
                        </span>
                      </p>
                      <p className="text-xs text-ink3">
                        Closing pribadi: {r.orders} order · {r.orderingCustomers} pelanggan order
                      </p>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
                      r.conversionRate == null ? "bg-inset text-ink3" : "bg-accentbg text-accent"
                    )}
                    title="Konversi PERSONAL Novi (bukan tim) — pelanggan yang pindah ke Transaksi dari percakapan yang dia pegang sendiri"
                  >
                    {r.conversionRate != null ? `${r.conversionRate}%` : "—"} konversi pribadi
                  </div>

                  <div className="w-full sm:w-64">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-ink2">{formatRupiah(mtd?.teamGrossValue || 0)}</span>
                      {mtd?.target > 0 && <span className="text-ink3">/ {formatRupiahShort(mtd.target)}</span>}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-700 ease-out",
                          mtd?.teamPercentToTarget == null ? "bg-line"
                          : mtd.teamPercentToTarget >= 100 ? "bg-green"
                          : mtd.teamPercentToTarget >= 50 ? "bg-accent" : "bg-orange"
                        )}
                        style={{ width: `${Math.min(mtd?.teamPercentToTarget ?? 0, 100)}%` }}
                      />
                    </div>
                    <span
                      className="mt-1 inline-block text-[11px] text-ink3"
                      title="Target TIM (gabungan closing timnya + closing pribadi), bulan berjalan — tidak ikut rentang tanggal di atas"
                    >
                      {mtd?.teamPercentToTarget != null
                        ? `${mtd.teamPercentToTarget}% dari target tim bulan ini`
                        : "Target tim belum diset (Pengaturan > Target Sales)"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-col divide-y divide-line">
          {rows.map((r) => {
            // Bar/% target ini SELALU bulan berjalan (lihat catatan targetInfo
            // di atas) — TIDAK memakai r.grossValue/r.target/r.percentToTarget
            // yang ikut range terpilih (itu bisa cuma "Hari ini").
            const mtd = targetByUserId.get(r.userId);
            return (
              <div key={r.userId} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={r.name} src={r.avatarUrl} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                    <p className="text-xs text-ink3">
                      {r.orders} order · {r.orderingCustomers} pelanggan order
                    </p>
                  </div>
                </div>

                <div
                  className={cn(
                    "inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
                    r.conversionRate == null ? "bg-inset text-ink3"
                    : median != null && r.conversionRate >= median * 1.2 ? "bg-greenbg text-green"
                    : median != null && r.conversionRate <= median * 0.6 ? "bg-redbg text-red"
                    : "bg-accentbg text-accent"
                  )}
                  title="Pelanggan yang pindah ke stage Transaksi pada periode ini / percakapan yang ditangani pada periode ini"
                >
                  {r.conversionRate != null ? `${r.conversionRate}%` : "—"} konversi
                </div>

                <div className="w-full sm:w-56">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink2">{formatRupiah(mtd?.grossValue || 0)}</span>
                    {mtd?.target > 0 && <span className="text-ink3">/ {formatRupiahShort(mtd.target)}</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-700 ease-out",
                        mtd?.percentToTarget == null ? "bg-line"
                        : mtd.percentToTarget >= 100 ? "bg-green"
                        : mtd.percentToTarget >= 50 ? "bg-accent" : "bg-orange"
                      )}
                      style={{ width: `${Math.min(mtd?.percentToTarget ?? 0, 100)}%` }}
                    />
                  </div>
                  <span className="mt-1 inline-block text-[11px] text-ink3" title="Bulan berjalan — tidak ikut rentang tanggal di atas">
                    {mtd?.percentToTarget != null ? `${mtd.percentToTarget}% dari target bulan ini` : "Target belum diset"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {takTeratribusi > 0 && (
          <p className="mt-4 flex items-start gap-1.5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              {formatRupiah(takTeratribusi)} dari nilai penjualan perusahaan belum
              bisa diatribusikan ke sales mana pun — order dari pelanggan yang
              percakapannya belum di-assign. Karena itu total di tab ini lebih
              kecil dari Ringkasan.
            </span>
          </p>
        )}
      </ChartCard>

      {/* ── Nilai Penjualan per sales ────────────────────────────────── */}
      <ChartCard index={5} title="Nilai Penjualan per Sales" description="Perbandingan hasil closing tiap sales">
        <div className="flex flex-col gap-2.5">
          {rows.filter((r) => r.grossValue > 0).map((r) => (
            <BarRow
              key={r.userId} label={r.name} value={r.grossValue} max={maxNilai}
              display={formatRupiahShort(r.grossValue)} sub={`${r.orders} order`} tone="green"
            />
          ))}
        </div>
      </ChartCard>

      {/* ── Tabel rinci ──────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <ChartCard index={6} title="Rincian Penjualan" description="Metrik penjualan per sales — gulir ke samping untuk kolom lainnya. Metrik kecepatan respons/beban chat ada di tab Performa Tim.">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink3">
                    Sales
                  </th>
                  {KOLOM.map((c) => (
                    <th
                      key={c.k}
                      className="whitespace-nowrap border-b border-line px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-ink3"
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {c.label}
                        <InfoTooltip text={c.title} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamLeadRows.map((r) => {
                  const mtd = targetInfo.teamLeadRows.find((m) => m.userId === r.userId);
                  return (
                    <tr key={r.userId} className="border-b-2 border-line bg-blue-50">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-blue-50 px-3 py-2.5 font-semibold text-ink">
                        <span className="flex items-center gap-1.5">
                          {r.name}
                          <Crown size={11} className="text-blue-ink" />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink3">{r.funnel?.PROSPECT ?? 0}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-green">{r.paidCustomers}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-ink" title="Konversi personal, bukan tim">
                        {r.conversionRate != null ? `${r.conversionRate}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink2">{r.orderingCustomers}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink3">
                        {r.orderConversionRate != null ? `${r.orderConversionRate}%` : "—"}
                      </td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", r.spamRate > 15 ? "text-orange" : "text-ink3")}>
                        {r.spamRate != null ? `${r.spamRate}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.orders}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                        {formatRupiahShort(r.grossValue)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink2">
                        {r.aov > 0 ? formatRupiahShort(r.aov) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink2" title="Target TIM, bulan berjalan — tidak ikut rentang tanggal di atas">
                        {mtd?.teamPercentToTarget != null ? `${mtd.teamPercentToTarget}% (tim)` : "—"}
                      </td>
                    </tr>
                  );
                })}
                {rows.map((r) => {
                  const mtd = targetByUserId.get(r.userId);
                  return (
                    <tr key={r.userId} className="border-b border-line last:border-0">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-2.5 font-semibold text-ink">
                        {r.name}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink3">{r.funnel?.PROSPECT ?? 0}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-green">{r.paidCustomers}</td>
                      <td className={cn("px-3 py-2.5 text-right font-bold tabular-nums", toneKonversi(r.conversionRate, median))}>
                        {r.conversionRate != null ? `${r.conversionRate}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink2">{r.orderingCustomers}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink3">
                        {r.orderConversionRate != null ? `${r.orderConversionRate}%` : "—"}
                      </td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", r.spamRate > 15 ? "text-orange" : "text-ink3")}>
                        {r.spamRate != null ? `${r.spamRate}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.orders}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                        {formatRupiahShort(r.grossValue)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink2">
                        {r.aov > 0 ? formatRupiahShort(r.aov) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink2" title="Bulan berjalan — tidak ikut rentang tanggal di atas">
                        {mtd?.percentToTarget != null ? `${mtd.percentToTarget}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 text-ink">Total tim</td>
                    <td className="px-3 py-2.5 text-right text-ink3">—</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-green">{total.paidCustomers}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                      {total.conversionRate != null ? `${total.conversionRate}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink2">{total.orderingCustomers}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink3">
                      {total.orderConversionRate != null ? `${total.orderConversionRate}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink3">
                      {total.spamRate != null ? `${total.spamRate}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{total.orders}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">
                      {formatRupiahShort(total.grossValue)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">
                      {total.aov > 0 ? formatRupiahShort(total.aov) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink" title="Bulan berjalan — tidak ikut rentang tanggal di atas">
                      {targetReport?.total?.percentToTarget != null ? `${targetReport.total.percentToTarget}%` : "—"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink3">
            Kolom bertanda <strong>*</strong> (Prospect) adalah <strong>posisi
            saat ini</strong> dan TIDAK mengikuti rentang tanggal — “stage sekarang”
            adalah keadaan, bukan kejadian di dalam periode. Semua kolom lain
            mengikuti rentang yang dipilih di atas.
            {" "}Kolom <strong>% Target</strong> SELALU memakai penjualan &
            target <strong>bulan berjalan</strong>
            {report?.periodeTarget ? ` (${report.periodeTarget.month}/${report.periodeTarget.year})` : ""},
            TIDAK ikut rentang tanggal yang dipilih di atas — kalau di-set
            "Hari ini", % Target tetap menunjukkan progres SEBULAN PENUH
            (bukan closing hari ini dibagi target sebulan, yang akan selalu
            kelihatan nyaris 0%).
            {" "}"Total tim" di baris terakhir HANYA menjumlahkan 8 sales biasa —
            TIDAK termasuk closing pribadi Team Lead (beda dengan KPI "Nilai
            Penjualan Tim" di atas, yang sudah menggabungkan keduanya).
          </p>
        </ChartCard>
      )}
    </div>
  );
}
