import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Info, Crown, Loader2, ExternalLink } from "lucide-react";
import Avatar from "../../../components/Avatar.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { formatRupiah, formatRupiahShort } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { cn } from "@/lib/utils.js";
import { compareLabel, toApiParams } from "@/lib/dateRange.js";
import { computeTeamTarget, namaBulanTarget } from "../utils/teamTarget.js";
import { api } from "@/api.js";
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
  { k: "prospect",   label: "Prospect*",  title: "POSISI SAAT INI (bukan hitungan periode): jumlah pelanggan yang SEKARANG ada di tahap Prospect, dari semua percakapan yang dia pegang — tidak mengikuti rentang tanggal di atas." },
  { k: "paidCustomers", label: "Transaksi", title: "Jumlah pelanggan yang PINDAH ke stage Transaksi di dalam periode yang dipilih — dihitung dari riwayat perpindahan stage (pipeline_transitions), bukan posisi sekarang." },
  { k: "conversionRate", label: "Konversi", title: "Konversi = (pelanggan pindah ke Transaksi di periode ini) ÷ (percakapan yang dia tangani di periode ini) × 100%. Contoh: 20 percakapan ditangani, 4 pindah ke Transaksi → 4 ÷ 20 = 20%. Metrik konversi UTAMA — chat SPAM dikecualikan dari penyebutnya." },
  { k: "orderingCustomers", label: "Order-in", title: "Jumlah pelanggan (bukan jumlah order) yang membuat MINIMAL 1 order di dalam periode yang dipilih." },
  { k: "orderConversionRate", label: "Konversi (Order)", title: "Konversi (Order) = (pelanggan yang order di periode ini) ÷ (percakapan yang dia tangani di periode ini) × 100%. Beda dari kolom Konversi: ini mengukur order yang BENAR-BENAR dibuat, bukan cuma kartu pindah stage." },
  { k: "spamRate",   label: "Spam %",     title: "Spam % = (chat yang dia pegang ditandai SPAM) ÷ (chat SPAM + chat yang dia tangani) × 100%. Bukan penalti performa — cuma pengawas, layak ditinjau kalau jauh di atas rata-rata tim." },
  { k: "orders",     label: "Order",      title: "Jumlah order (CANCELLED tidak dihitung)" },
  { k: "grossValue", label: "Nilai",      title: "Total nilai (Rupiah) semua order masuk di periode ini — belum tentu sudah terbayar lunas." },
  // Lunas (30 Agustus 2026, populasi DIPERBAIKI 31 Agustus 2026) — BASIS
  // KOMISI: order APA PUN (dari bulan manapun dibuatnya) yang jadi LUNAS
  // (Order.paidAt) DI DALAM periode ini. Populasi ini BEDA dari kolom Nilai
  // (Reach, basisnya kapan order DIBUAT) — order Agustus yang baru lunas
  // September GESER jadi bagian Lunas September, bukan Agustus (keputusan
  // eksplisit: closing tetap dihargai walau nyebrang bulan, bukan hangus).
  // Konsekuensinya kolom ini TIDAK SELALU "Nilai − Lunas = belum lunas" pas
  // ke rupiah — wajar kalau ada leakage kecil antar-bulan. Order LUNAS lama
  // (sebelum fitur paidAt ada) belum punya paidAt, jadi tidak terhitung di
  // sini sampai statusnya disentuh ulang — bukan berarti benar-benar Rp0.
  { k: "collectedValue", label: "Lunas", title: "Basis komisi: order APA PUN (dari bulan manapun dibuatnya) yang jadi LUNAS di dalam periode ini. Order dari bulan lalu yang baru lunas sekarang IKUT di sini (geser bulan, bukan hangus) — makanya beda populasi dari kolom Nilai (Reach, basisnya kapan order dibuat). ⚠️ Angka ini TERKUNCI ke periode yang dipilih (kalau lunasnya SETELAH tanggal terakhir periode, tidak ikut — geser ke periode berikutnya) — BEDA dari kartu \"Belum Lunas\" di halaman Order, yang LIVE ikut status sekarang. Dua-duanya benar, cuma menjawab pertanyaan beda (komisi terkunci vs status operasional saat ini)." },
  { k: "aov",        label: "AOV",        title: "AOV (Average Order Value) = total Nilai ÷ jumlah Order di periode ini — rata-rata besar 1 order." },
  { k: "percentToTarget", label: "% Target", title: "% Target = (nilai closing BULAN INI, bukan periode yang dipilih di atas) ÷ (target bulanan dari Pengaturan > Target Sales) × 100%." },
];

export default function SalesReportTab({ report, targetReport, grossTotalPerusahaan, onExport, range }) {
  const navigate = useNavigate();
  const cmp = compareLabel(range);

  // Rincian order per-individu di balik kolom "Lunas" (30 Agustus 2026) —
  // komisi dihitung PER SALES, bukan per tim, jadi admin perlu lihat order
  // MANA SAJA yang menyusun angka lunas satu orang, bukan cuma totalnya.
  // Fetch on-demand (bukan sekaligus utk semua sales di /sales-report) —
  // endpoint itu sudah berat, detail ini cuma perlu dimuat kalau diklik.
  const [lunasDetail, setLunasDetail] = useState(null); // { userId, name, loading, data, error }
  async function openLunasDetail(userId, name) {
    setLunasDetail({ userId, name, loading: true, data: null, error: null });
    try {
      const data = await api.getSalesLunasDetail({ userId, ...toApiParams(range) });
      setLunasDetail({ userId, name, loading: false, data, error: null });
    } catch (err) {
      setLunasDetail({ userId, name, loading: false, data: null, error: err.message });
    }
  }
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
  const { teamLeadRows, teamGrossAll, teamOrdersAll, teamAovAll, teamCollectedAll } = computeTeamTarget(report);

  // Semua "% Target"/progres-ke-target di bawah ini SENGAJA baca `targetReport`
  // (selalu bulan berjalan, lihat catatan panjang di Laporan.jsx#salesReportBulanIni)
  // — BUKAN `report` yang ikut `range`. Target itu sendiri bulanan; membagi
  // closing SATU HARI dengan target SEBULAN PENUH selalu kelihatan nyaris 0%
  // begitu range di-set "Hari ini", padahal progres bulanannya bisa saja sudah
  // jauh lebih tinggi. Metrik AKTIVITAS (orders, conversionRate, dst di atas)
  // TETAP ikut `range` — cuma bagian target yang dikunci ke bulan berjalan.
  const targetInfo = computeTeamTarget(targetReport);
  const labelBulanTarget = namaBulanTarget(targetReport?.periodeTarget);
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
      {/* xl:, bukan lg: (D-113) — sama fix dengan RingkasanTab (3 kolom
          lebih longgar dari 4, tapi angka Rupiah di sini juga bisa
          panjang — lebih aman disamakan daripada menunggu laporan sama
          muncul lagi di breakpoint ini). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          index={0} hero label="Nilai Penjualan Tim"
          numericValue={teamGrossAll}
          format={(v) => formatRupiah(Math.round(v))}
          growth={report?.growthTeamGrossValue} compareLabel={cmp}
          sub={`${teamOrdersAll} order · AOV ${formatRupiahShort(teamAovAll)}`}
          tooltip="Total nilai order seluruh tim (8 sales + closing pribadi Team Lead) di periode yang dipilih di atas — “reach”, belum tentu sudah lunas."
        />
        <KpiCard
          index={1} label="Nilai Lunas Tim"
          numericValue={teamCollectedAll}
          format={(v) => formatRupiah(Math.round(v))}
          sub={`${formatRupiahShort(Math.max(teamGrossAll - teamCollectedAll, 0))} belum lunas/masih proses (perkiraan)`}
          tooltip="BASIS KOMISI: order APA PUN (dari bulan manapun dibuatnya) yang jadi LUNAS di dalam periode ini — order bulan lalu yang baru lunas sekarang IKUT di sini (geser bulan, bukan hangus), jadi populasinya BEDA dari 'Nilai Penjualan Tim' (basisnya kapan order dibuat). Angka ini TERKUNCI per periode: dibuka belakangan pun hasilnya sama — order yang lunasnya SETELAH tanggal terakhir periode ini geser ke periode berikutnya, bukan ikut naik di sini. Beda dari kartu 'Belum Lunas' di halaman Order yang LIVE ikut status sekarang, bukan salah hitung kalau angkanya tidak sama. Order LUNAS lama (sebelum fitur paidAt ada) belum kehitung di sini sampai statusnya disentuh ulang."
        />
        <KpiCard
          index={2} label="Konversi Tim"
          numericValue={total?.conversionRate || 0}
          format={(v) => (total?.conversionRate != null ? `${v.toFixed(1)}%` : "—")}
          sub={`${total?.paidCustomers || 0} pelanggan pindah ke Transaksi di periode ini`}
          tooltip={`Konversi Tim = (pelanggan pindah ke Transaksi) ÷ (percakapan yang ditangani) × 100%, dijumlahkan dari 8 sales aktif (Team Lead TIDAK ikut). Contoh: ${total?.paidCustomers || 0} pindah Transaksi dari ${total?.handled || 0} percakapan ditangani. ⚠️ BEDA dengan "Conversion" di Dashboard (keduanya BENAR, bukan salah satu salah hitung): angka ini basisnya PERCAKAPAN yang ditangani tim di periode ini, TERMASUK lead LAMA (lahir bulan sebelumnya) yang baru closing sekarang; "Conversion" Dashboard basisnya LEAD BARU yang lahir di periode ini saja. Makanya penyebut & pembilangnya beda dan wajar angkanya tidak sama.`}
        />
        <KpiCard
          index={3} label="Target Tim"
          numericValue={targetInfo.percentToTarget || 0}
          format={() => (targetInfo.percentToTarget != null ? `${targetInfo.percentToTarget}%` : "—")}
          sub={
            targetInfo.teamLead
              ? (targetInfo.teamLead.target > 0
                  ? `${formatRupiahShort(targetInfo.teamLead.teamGrossValue)} / ${formatRupiahShort(targetInfo.teamLead.target)} (target tim, ${labelBulanTarget})`
                  : "Target tim belum diset (Pengaturan > Target Sales)")
              : `${formatRupiahShort(targetInfo.teamGrossAll)} / ${formatRupiahShort(targetInfo.targetValue)} (jumlah target individu, ${labelBulanTarget})`
          }
          tooltip={`Progres closing tim terhadap target BULANAN — SELALU ${labelBulanTarget}, tidak ikut rentang tanggal yang dipilih di atas.`}
        />
        <KpiCard
          index={4} label="AOV Tim"
          numericValue={teamAovAll}
          format={(v) => (teamAovAll > 0 ? formatRupiah(Math.round(v)) : "—")}
          sub="rata-rata nilai per order, seluruh tim"
          tooltip="Nilai order rata-rata (total nilai / jumlah order) seluruh tim di periode yang dipilih di atas."
        />
        <KpiCard
          index={5} label="Chat Spam"
          numericValue={total?.spamCount || 0}
          format={(v) => Math.round(v).toLocaleString("id-ID")}
          sub={total?.spamRate != null ? `${total.spamRate}% dari chat yang ditangani tim` : "belum ada chat yang ditangani"}
          tooltip={`Spam % = (chat yang dipegang tim & ditandai SPAM) ÷ (chat SPAM + chat yang ditangani) × 100%, dijumlahkan dari 8 sales aktif (Team Lead TIDAK ikut) — scope sama dengan kartu lain di atas. Bukan penalti performa sales — ini pengawas KUALITAS LEAD masuk, layak ditinjau kalau jumlahnya tiba-tiba melonjak.`}
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
                  >
                    {r.conversionRate != null ? `${r.conversionRate}%` : "—"} konversi pribadi
                    <InfoTooltip text={`Konversi PERSONAL ${r.name} (bukan tim) = (pelanggan pindah ke Transaksi dari percakapan yang dia pegang SENDIRI) ÷ (percakapan yang dia tangani sendiri) × 100%. Contoh: ${r.paidCustomers ?? 0} ÷ ${r.handled ?? 0} = ${r.conversionRate != null ? `${r.conversionRate}%` : "—"}.`} />
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
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink3">
                      {mtd?.teamPercentToTarget != null
                        ? `${mtd.teamPercentToTarget}% dari target tim ${labelBulanTarget}`
                        : "Target tim belum diset (Pengaturan > Target Sales)"}
                      <InfoTooltip text={`Target TIM (gabungan closing timnya + closing pribadi), ${labelBulanTarget} — tidak ikut rentang tanggal yang dipilih di atas.`} />
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
                >
                  {r.conversionRate != null ? `${r.conversionRate}%` : "—"} konversi
                  <InfoTooltip text={`Konversi = (pelanggan pindah ke Transaksi) ÷ (percakapan yang dia tangani) × 100%. Contoh: ${r.paidCustomers ?? 0} pindah Transaksi dari ${r.handled ?? 0} percakapan ditangani = ${r.conversionRate != null ? `${r.conversionRate}%` : "—"}.`} />
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
                  <span className="mt-1 inline-block text-[11px] text-ink3" title={`${labelBulanTarget} — tidak ikut rentang tanggal di atas`}>
                    {mtd?.percentToTarget != null ? `${mtd.percentToTarget}% dari target ${labelBulanTarget}` : "Target belum diset"}
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
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openLunasDetail(r.userId, r.name)}
                          className="font-semibold tabular-nums text-green underline decoration-dotted underline-offset-2 hover:text-green/80"
                          title="Lihat rincian order lunas personal (basis komisi)"
                        >
                          {formatRupiahShort(r.collectedValue || 0)}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink2">
                        {r.aov > 0 ? formatRupiahShort(r.aov) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink2" title={`Target TIM, ${labelBulanTarget} — tidak ikut rentang tanggal di atas`}>
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
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openLunasDetail(r.userId, r.name)}
                          className="font-semibold tabular-nums text-green underline decoration-dotted underline-offset-2 hover:text-green/80"
                          title="Lihat rincian order lunas personal (basis komisi)"
                        >
                          {formatRupiahShort(r.collectedValue || 0)}
                        </button>
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
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-green">
                      {formatRupiahShort(total.collectedValue || 0)}
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
            target <strong>{labelBulanTarget}</strong>,
            TIDAK ikut rentang tanggal yang dipilih di atas — kalau di-set
            "Hari ini", % Target tetap menunjukkan progres SEBULAN PENUH
            (bukan closing hari ini dibagi target sebulan, yang akan selalu
            kelihatan nyaris 0%).
            {" "}"Total tim" di baris terakhir HANYA menjumlahkan 8 sales biasa —
            TIDAK termasuk closing pribadi Team Lead (beda dengan KPI "Nilai
            Penjualan Tim" di atas, yang sudah menggabungkan keduanya).
            {" "}Angka <strong className="text-green">Lunas</strong> tiap sales bisa
            diklik untuk lihat rincian order-nya satu per satu — basis komisi
            dihitung PER ORANG, jadi rincian ini yang dipakai untuk hitung
            komisi masing-masing, bukan total tim.
          </p>
        </ChartCard>
      )}

      {/* ── Rincian order lunas per individu (basis komisi) ─────────────── */}
      <Modal
        open={!!lunasDetail}
        onOpenChange={(open) => { if (!open) setLunasDetail(null); }}
        title={lunasDetail ? `Rincian Lunas — ${lunasDetail.name}` : ""}
        description="Order yang jadi lunas di periode ini — basis komisi personal, bukan tim."
        className="w-[620px]"
      >
        {lunasDetail?.loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink3">
            <Loader2 size={16} className="animate-spin" /> Memuat…
          </div>
        ) : lunasDetail?.error ? (
          <p className="py-8 text-center text-[12.5px] text-red">Gagal memuat: {lunasDetail.error}</p>
        ) : !lunasDetail?.data?.orders?.length ? (
          <p className="py-8 text-center text-[12.5px] text-ink3">Belum ada order lunas di periode ini.</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between rounded-btn bg-inset px-3 py-2">
              <span className="text-[12.5px] text-ink2">{lunasDetail.data.orders.length} order</span>
              <span className="font-semibold tabular-nums text-green">{formatRupiah(lunasDetail.data.total)}</span>
            </div>
            {lunasDetail.data.orders.some((o) => o.paidAtPerkiraan) && (
              <p className="mb-3 rounded-btn bg-orangebg px-3 py-2 text-[11px] leading-relaxed text-ink">
                Baris bertanda <strong>"perkiraan"</strong> punya tanggal lunas ASLI yang tidak pernah tercatat
                (order lama, sebelum sistem melacak tanggal lunas) — <strong>31 Agustus 2026</strong> di sana
                cuma tanggal saat kita mencatatnya secara darurat sekali jalan, bukan tanggal lunas sesungguhnya.
              </p>
            )}
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink3">
                    <th className="pb-2 pr-2 font-medium">Order</th>
                    <th className="pb-2 pr-2 font-medium">Pelanggan</th>
                    <th className="pb-2 pr-2 font-medium">Tgl Lunas</th>
                    <th className="pb-2 text-right font-medium">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {lunasDetail.data.orders.map((o) => (
                    <tr key={o.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-2 text-ink2">{o.orderNumber || "—"}</td>
                      <td className="py-2 pr-2 text-ink2">
                        {/* Navigasi dalam aplikasi yang sama, BUKAN tab/window
                            baru — sebelumnya <a target="_blank">, yang di
                            PWA/Capacitor terbuka sebagai jendela app terpisah
                            (ditemukan lewat laporan owner, 31 Agustus 2026). */}
                        <button
                          type="button"
                          onClick={() => navigate(`/customers?id=${o.customerId}`)}
                          className="inline-flex items-center gap-1 hover:text-accent hover:underline"
                        >
                          {o.customerName || "—"} <ExternalLink size={10} />
                        </button>
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-ink3">
                        {formatTanggalPendek(o.paidAt)}
                        {o.paidAtPerkiraan ? (
                          <span
                            className="ml-1.5 rounded-full bg-inset px-1.5 py-0.5 text-[10px] font-medium text-ink3"
                            title="Tanggal lunas ASLI order ini tidak pernah tercatat (dari sebelum sistem melacak paidAt) — 31 Agustus 2026 di sini cuma tanggal pencatatan darurat sekali jalan, bukan tanggal lunas sesungguhnya."
                          >
                            perkiraan
                          </span>
                        ) : o.lintasBulan && (
                          <span
                            className="ml-1.5 rounded-full bg-orangebg px-1.5 py-0.5 text-[10px] font-medium text-orange"
                            title={`Dibuat ${formatTanggalPendek(o.createdAt)} — lintas bulan dari pembuatannya`}
                          >
                            lintas bulan
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums text-ink">
                        {formatRupiah(o.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
