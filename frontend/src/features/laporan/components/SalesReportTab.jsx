import React, { useMemo } from "react";
import { Download, AlertTriangle, Info, Crown } from "lucide-react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import Avatar from "../../../components/Avatar.jsx";
import { formatRupiah, formatRupiahShort, formatDuration } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { cn } from "@/lib/utils.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import BarRow from "./BarRow.jsx";

// Tooltip khusus tren respons/SLA — dua series beda satuan (menit vs
// jumlah pelanggaran), jadi tidak bisa reuse ChartTip revenue yang cuma 1 nilai.
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

// ═══ LAPORAN SALES ════════════════════════════════════════════════════════
// Pengganti tab "Performa CS" lama (4 kolom: percakapan, closing rate, avg
// response, nilai order). Yang lama tidak bisa menjawab pertanyaan yang
// sebenarnya dipakai untuk mengambil keputusan: siapa yang lambat merespons,
// siapa yang percakapannya menumpuk tanpa dibalas, dan dari percakapan yang
// dipegang berapa yang BENAR-BENAR jadi uang.
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

function toneRespons(menit) {
  if (menit == null) return "text-ink3";
  if (menit <= 30) return "text-green";
  if (menit <= 120) return "text-ink";
  return "text-red";
}

const KOLOM = [
  { k: "handledOwn", label: "Ditangani",  title: "Percakapan yang DIA KLAIM/PEGANG SENDIRI dari awal pada periode terpilih (tidak termasuk warisan Ambil Alih)" },
  { k: "handledTakeover", label: "Warisan", title: "Percakapan yang berpindah ke dia lewat Ambil/Ambil Alih dari sales lain — bukan tanggung jawab penanganan asli dia" },
  { k: "stalled",    label: "Mengg.",     title: "Menggantung: dia pegang, pesan terakhir dari customer, >60 menit belum dibalas" },
  { k: "avgResponseMinutes", label: "Avg Respons", title: "Rata-rata jeda pesan pertama customer → balasan pertama" },
  { k: "slaBreach",  label: "SLA >1j",    title: "Balasan pertama >60 menit, DITAMBAH percakapan yang ditutup (RESOLVED) tanpa satu pun balasan sama sekali — supaya lead yang diabaikan total sampai ditutup tidak lolos dari radar" },
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

export default function SalesReportTab({ report, respTimeSeries, grossTotalPerusahaan, totalConversations, onExport }) {
  const semuaRows = report?.rows || [];
  // Baris "Team Lead" (Novi) TERPISAH dari leaderboard/tabel 8 sales biasa
  // di bawah sini (25 Agustus 2026) — target dia mewakili target TIM
  // gabungan, jadi tercampur ke ranking/median 8 sales akan salah makna.
  // Backend SUDAH memisahkan dia dari `total` (Total Tim) — lihat catatan
  // di routes/analytics.js /sales-report.
  const rows  = semuaRows.filter((r) => !r.isTeamLead);
  const total = report?.total;

  // Progres target TIM Novi = closing pribadinya + closing 8 sales (total
  // tim) dibagi target tim miliknya — BUKAN cuma grossValue pribadinya
  // (yang akan selalu jauh dari Rp600jt kalau dilihat sendirian, karena
  // memang bukan dia yang closing semuanya). grossValue/handled/dst di
  // baris ini TETAP angka personalnya (menjawab "closing berapa bagian").
  const teamLeadRows = useMemo(() => semuaRows
    .filter((r) => r.isTeamLead)
    .map((r) => {
      const teamGrossValue = r.grossValue + (total?.grossValue || 0);
      return {
        ...r,
        teamGrossValue,
        teamPercentToTarget: r.target > 0 ? Math.round((teamGrossValue / r.target) * 100) : null,
      };
    }), [semuaRows, total]);

  // Gabung dua deret (avg respons per bucket, SLA breach per bucket) jadi
  // satu array utk ComposedChart — keduanya SUDAH bucket yang sama & urutan
  // yang sama dari backend (lihat /analytics/response-time-series), jadi
  // cukup zip berdasarkan index, tidak perlu join by key.
  const trendData = useMemo(() => {
    const avgPts = respTimeSeries?.avgResponseSeries || [];
    const slaPts = respTimeSeries?.slaBreachSeries || [];
    return avgPts.map((p, i) => ({
      bucket: p.bucket, avgMinutes: p.value, slaBreach: slaPts[i]?.value ?? 0,
    }));
  }, [respTimeSeries]);
  const trendGranularity = respTimeSeries?.granularity || "day";
  const trendTickX = (v) => (trendGranularity === "day" ? dayjs(v).format("D MMM") : v);

  const aktif = rows.filter((r) => r.handled > 0);
  // Median dipakai untuk mewarnai baik/buruk secara RELATIF terhadap tim,
  // bukan ambang absolut yang dikarang — 5% bisa bagus atau buruk tergantung
  // jenis lead. Memakai conversionRate (transisi pipeline, metrik UTAMA sejak
  // 25 Agustus 2026) — datanya sudah >1 bulan terekam.
  const konversiList = aktif.map((r) => r.conversionRate).filter((v) => v != null).sort((a, b) => a - b);
  const median = konversiList.length > 0 ? konversiList[Math.floor(konversiList.length / 2)] : null;

  const maxHandled = Math.max(1, ...rows.map((r) => r.handledOwn));
  const maxNilai   = Math.max(1, ...rows.map((r) => r.grossValue));
  const maxRespons = Math.max(1, ...rows.map((r) => r.avgResponseMinutes || 0));

  // Selisih penjualan perusahaan vs yang bisa diatribusikan ke sales. Muncul
  // kalau ada order dari customer yang percakapannya belum di-assign ke
  // siapa pun (atau dipegang admin). Ditampilkan supaya tidak ada kesan
  // "angka Laporan tidak konsisten antar tab".
  const takTeratribusi = grossTotalPerusahaan != null && total
    ? grossTotalPerusahaan - total.grossValue
    : 0;

  const lambat = [...aktif]
    .filter((r) => r.avgResponseMinutes != null)
    .sort((a, b) => b.avgResponseMinutes - a.avgResponseMinutes);

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
          index={0} label="Percakapan Ditangani"
          numericValue={total?.handled || 0}
          sub={
            totalConversations != null
              ? `${aktif.length} sales aktif dari ${rows.length} · dari ${totalConversations.toLocaleString("id-ID")} total percakapan`
              : `${aktif.length} sales aktif dari ${rows.length}`
          }
        />
        <KpiCard
          index={1} label="Konversi Tim"
          numericValue={total?.conversionRate || 0}
          format={(v) => (total?.conversionRate != null ? `${v.toFixed(1)}%` : "—")}
          sub={`${total?.paidCustomers || 0} pelanggan pindah ke Transaksi di periode ini`}
        />
        <KpiCard
          index={2} hero label="Nilai Penjualan Tim"
          numericValue={total?.grossValue || 0}
          format={(v) => formatRupiah(Math.round(v))}
          sub={`${total?.orders || 0} order · AOV ${formatRupiahShort(total?.aov || 0)}`}
        />
        <KpiCard
          index={3} label="Menggantung Sekarang"
          numericValue={report?.stalledNow || 0}
          sub="lintas semua periode — belum dibalas >60 menit"
        />
      </div>

      {/* Menggantung/belum diambil = beban nyata yang masih menempel sekarang,
          bukan statistik historis. Kalau ada, ini hal PERTAMA yang harus
          dikerjakan tim hari ini — jadi ditaruh sebagai peringatan, bukan
          sekadar kolom. */}
      {(report?.stalledNow > 0 || total?.slaBreach > 0 || report?.unassignedInPeriod > 0) && (
        <div className="flex items-start gap-2.5 rounded-xl bg-orangebg px-3.5 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-orange" size={16} />
          <p className="text-xs leading-relaxed text-ink">
            {/* BARU 25 Agustus 2026: ditemukan lewat pertanyaan "kenapa Total
                Percakapan (tab Percakapan) beda dengan Percakapan Ditangani
                di sini" — jawabannya sebagian besar adalah percakapan ini,
                yang belum ke-assign ke siapa pun jadi tidak masuk hitungan
                sales manapun. Ditaruh PALING AWAL karena ini yang paling
                mendesak: bukan cuma lambat dibalas, malah belum ada yang pegang. */}
            {report?.unassignedInPeriod > 0 && (
              <><strong>{report.unassignedInPeriod} percakapan</strong> pada periode ini
              BELUM DIAMBIL siapa pun — tidak masuk hitungan sales manapun di tabel
              bawah, dan ini sebabnya "Percakapan Ditangani" di sini lebih kecil
              dari "Total Percakapan" di tab Percakapan. </>
            )}
            {report?.stalledNow > 0 && (
              <><strong>{report.stalledNow} percakapan</strong> sedang menggantung
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

      {/* ── Leaderboard ───────────────────────────────────────────────── */}
      <ChartCard
        index={4}
        title="Leaderboard Sales"
        description="Diurutkan dari nilai penjualan tertinggi"
        empty={rows.length === 0 ? "Belum ada data sales pada periode ini." : null}
      >
        {teamLeadRows.length > 0 && (
          <div className="mb-3 flex flex-col gap-3 border-b border-line pb-3">
            {teamLeadRows.map((r) => (
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
                      Closing pribadi: {r.handledOwn} percakapan · {formatDuration(r.avgResponseMinutes)}
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
                    <span className="font-semibold text-ink2">{formatRupiah(r.teamGrossValue)}</span>
                    {r.target > 0 && <span className="text-ink3">/ {formatRupiahShort(r.target)}</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-700 ease-out",
                        r.teamPercentToTarget == null ? "bg-line"
                        : r.teamPercentToTarget >= 100 ? "bg-green"
                        : r.teamPercentToTarget >= 50 ? "bg-accent" : "bg-orange"
                      )}
                      style={{ width: `${Math.min(r.teamPercentToTarget ?? 0, 100)}%` }}
                    />
                  </div>
                  <span
                    className="mt-1 inline-block text-[11px] text-ink3"
                    title="Target TIM (gabungan closing timnya + closing pribadi) — bukan target closing pribadi"
                  >
                    {r.teamPercentToTarget != null
                      ? `${r.teamPercentToTarget}% dari target tim bulan ini`
                      : "Target tim belum diset (Pengaturan > Target Sales)"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <div key={r.userId} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={r.name} src={r.avatarUrl} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                  <p className="text-xs text-ink3">
                    {r.handledOwn} percakapan · {formatDuration(r.avgResponseMinutes)}
                    {r.handledTakeover > 0 && (
                      <span className="ml-1.5">· +{r.handledTakeover} warisan takeover</span>
                    )}
                    {r.stalled > 0 && (
                      <span className="ml-1.5 font-semibold text-orange">· {r.stalled} menggantung</span>
                    )}
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
                  <span className="font-semibold text-ink2">{formatRupiah(r.grossValue)}</span>
                  {r.target > 0 && <span className="text-ink3">/ {formatRupiahShort(r.target)}</span>}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-700 ease-out",
                      r.percentToTarget == null ? "bg-line"
                      : r.percentToTarget >= 100 ? "bg-green"
                      : r.percentToTarget >= 50 ? "bg-accent" : "bg-orange"
                    )}
                    style={{ width: `${Math.min(r.percentToTarget ?? 0, 100)}%` }}
                  />
                </div>
                <span className="mt-1 inline-block text-[11px] text-ink3">
                  {r.percentToTarget != null ? `${r.percentToTarget}% dari target bulan ini` : "Target belum diset"}
                </span>
              </div>
            </div>
          ))}
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

      {/* ── Waktu respons ────────────────────────────────────────────── */}
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

      {/* ── Tren waktu respons & SLA (TIM, dari waktu ke waktu) ─────────
          Beda dari kartu di atas: itu snapshot SATU periode per-sales;
          ini tren TIM sepanjang periode, supaya kelihatan membaik/memburuk
          dari waktu ke waktu, bukan cuma angka sekarang. */}
      {trendData.length > 0 && (
        <ChartCard
          index={6}
          title="Tren Waktu Respons & Pelanggaran SLA"
          description="Rata-rata waktu respons (garis) & jumlah pelanggaran SLA >60 menit (batang) tim, dari waktu ke waktu"
        >
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
              <XAxis
                dataKey="bucket" tickFormatter={trendTickX}
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
              <Tooltip content={<RespTrendTip granularity={trendGranularity} />} cursor={{ fill: "var(--bg-hover)" }} />
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
            Pelanggaran SLA termasuk percakapan yang ditutup tanpa satu pun
            balasan — lihat catatan di kolom "SLA &gt;1j" pada tabel di bawah.
          </p>
        </ChartCard>
      )}

      {/* ── Beban vs hasil ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard
          index={6} title="Beban Percakapan"
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

        <ChartCard index={7} title="Nilai Penjualan" description="Hasil dari beban di sebelah">
          <div className="flex flex-col gap-2.5">
            {rows.filter((r) => r.grossValue > 0).map((r) => (
              <BarRow
                key={r.userId} label={r.name} value={r.grossValue} max={maxNilai}
                display={formatRupiahShort(r.grossValue)} sub={`${r.orders} order`} tone="green"
              />
            ))}
          </div>
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
            Bandingkan dua kolom ini: beban tinggi + nilai rendah berarti banyak
            percakapan tapi sedikit yang dikonversi.
          </p>
        </ChartCard>
      </div>

      {/* ── Tabel rinci ──────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <ChartCard index={8} title="Rincian Lengkap" description="Semua metrik per sales — gulir ke samping untuk kolom lainnya">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink3">
                    Sales
                  </th>
                  {KOLOM.map((c) => (
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink2" title="Dihitung dari target TIM, bukan target pribadi">
                      {r.teamPercentToTarget != null ? `${r.teamPercentToTarget}% (tim)` : "—"}
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink2">
                      {r.percentToTarget != null ? `${r.percentToTarget}%` : "—"}
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                      {total.percentToTarget != null ? `${total.percentToTarget}%` : "—"}
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
            {" "}Kolom target memakai target <strong>bulan berjalan</strong>
            {report?.periodeTarget ? ` (${report.periodeTarget.month}/${report.periodeTarget.year})` : ""},
            karena target disimpan per bulan di Pengaturan.
          </p>
        </ChartCard>
      )}
    </div>
  );
}
