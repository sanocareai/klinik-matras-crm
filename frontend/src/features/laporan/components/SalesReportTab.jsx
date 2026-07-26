import React from "react";
import { Download, AlertTriangle, Info } from "lucide-react";
import Avatar from "../../../components/Avatar.jsx";
import { formatRupiah, formatRupiahShort, formatDuration } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import BarRow from "./BarRow.jsx";

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
// "Closing Rate 1%" di Laporan lama menyesatkan. Konversi di sini =
// pelanggan yang sampai tahap bayar / percakapan yang dipegang.
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
  { k: "handled",    label: "Ditangani",  title: "Percakapan yang di-assign ke orang ini pada periode terpilih" },
  { k: "stalled",    label: "Mengg.",     title: "Menggantung: dia pegang, pesan terakhir dari customer, >60 menit belum dibalas" },
  { k: "avgResponseMinutes", label: "Avg Respons", title: "Rata-rata jeda pesan pertama customer → balasan pertama" },
  { k: "slaBreach",  label: "SLA >1j",    title: "Jumlah percakapan yang balasan pertamanya lebih dari 60 menit" },
  { k: "qualified",  label: "Qualified*", title: "POSISI SAAT INI: pelanggan yang sekarang berada di tahap Qualified (tidak mengikuti rentang tanggal)" },
  { k: "quoted",     label: "Quoted*",    title: "POSISI SAAT INI: pelanggan yang sekarang berada di tahap Quoted (tidak mengikuti rentang tanggal)" },
  { k: "orderingCustomers", label: "Order-in", title: "Pelanggan yang membuat order DI DALAM periode terpilih" },
  { k: "orderConversionRate", label: "Konversi", title: "Pelanggan yang order di periode ini / percakapan yang ditangani di periode ini" },
  { k: "orders",     label: "Order",      title: "Jumlah order (CANCELLED tidak dihitung)" },
  { k: "grossValue", label: "Nilai",      title: "Nilai order masuk — belum tentu sudah terbayar" },
  { k: "aov",        label: "AOV",        title: "Rata-rata nilai per order" },
  { k: "percentToTarget", label: "% Target", title: "Nilai order dibanding target bulan berjalan" },
];

export default function SalesReportTab({ report, grossTotalPerusahaan, onExport }) {
  const rows  = report?.rows || [];
  const total = report?.total;

  const aktif = rows.filter((r) => r.handled > 0);
  // Median dipakai untuk mewarnai baik/buruk secara RELATIF terhadap tim,
  // bukan ambang absolut yang dikarang — 5% bisa bagus atau buruk tergantung
  // jenis lead. Memakai konversi berbasis ORDER karena datanya sudah ada
  // sekarang (konversi berbasis transisi stage baru terkumpul sejak 25 Jul).
  const konversiList = aktif.map((r) => r.orderConversionRate).filter((v) => v != null).sort((a, b) => a - b);
  const median = konversiList.length > 0 ? konversiList[Math.floor(konversiList.length / 2)] : null;

  const maxHandled = Math.max(1, ...rows.map((r) => r.handled));
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
          sub={`${aktif.length} sales aktif dari ${rows.length}`}
        />
        <KpiCard
          index={1} label="Konversi Tim (order)"
          numericValue={total?.orderConversionRate || 0}
          format={(v) => (total?.orderConversionRate != null ? `${v.toFixed(1)}%` : "—")}
          sub={`${total?.orderingCustomers || 0} pelanggan order di periode ini`}
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

      {/* Menggantung = beban nyata yang masih menempel sekarang, bukan
          statistik historis. Kalau ada, ini hal PERTAMA yang harus dikerjakan
          tim hari ini — jadi ditaruh sebagai peringatan, bukan sekadar kolom. */}
      {(report?.stalledNow > 0 || total?.slaBreach > 0) && (
        <div className="flex items-start gap-2.5 rounded-xl bg-orangebg px-3.5 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-orange" size={16} />
          <p className="text-xs leading-relaxed text-ink">
            {report?.stalledNow > 0 && (
              <><strong>{report.stalledNow} percakapan</strong> sedang menggantung
              SEKARANG — pesan terakhir dari customer dan sudah lebih dari 60 menit
              tanpa balasan (dihitung lintas semua periode, karena beban ini tetap
              ada berapa pun rentang yang dipilih). </>
            )}
            {total?.slaBreach > 0 && (
              <>Pada periode terpilih ada <strong>{total.slaBreach} percakapan</strong> yang
              balasan pertamanya lewat 60 menit. </>
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
        <div className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <div key={r.userId} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={r.name} src={r.avatarUrl} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                  <p className="text-xs text-ink3">
                    {r.handled} percakapan · {formatDuration(r.avgResponseMinutes)}
                    {r.stalled > 0 && (
                      <span className="ml-1.5 font-semibold text-orange">· {r.stalled} menggantung</span>
                    )}
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  "inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
                  r.orderConversionRate == null ? "bg-inset text-ink3"
                  : median != null && r.orderConversionRate >= median * 1.2 ? "bg-greenbg text-green"
                  : median != null && r.orderConversionRate <= median * 0.6 ? "bg-redbg text-red"
                  : "bg-accentbg text-accent"
                )}
                title="Pelanggan yang order pada periode ini / percakapan yang ditangani pada periode ini"
              >
                {r.orderConversionRate != null ? `${r.orderConversionRate}%` : "—"} konversi
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

      {/* ── Beban vs hasil ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard index={6} title="Beban Percakapan" description="Siapa memegang paling banyak">
          <div className="flex flex-col gap-2.5">
            {rows.filter((r) => r.handled > 0).map((r) => (
              <BarRow key={r.userId} label={r.name} value={r.handled} max={maxHandled} display={`${r.handled}`} />
            ))}
          </div>
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
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-line last:border-0">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-2.5 font-semibold text-ink">
                      {r.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.handled}</td>
                    <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", r.stalled > 0 ? "text-orange" : "text-ink3")}>
                      {r.stalled}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2.5 text-right tabular-nums", toneRespons(r.avgResponseMinutes))}>
                      {formatDuration(r.avgResponseMinutes)}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", r.slaBreach > 0 ? "text-red" : "text-ink3")}>
                      {r.slaBreach}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink3">{r.funnel?.QUALIFIED ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink3">{r.funnel?.QUOTED ?? 0}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-green">{r.orderingCustomers}</td>
                    <td className={cn("px-3 py-2.5 text-right font-bold tabular-nums", toneKonversi(r.orderConversionRate, median))}>
                      {r.orderConversionRate != null ? `${r.orderConversionRate}%` : "—"}
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{total.handled}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-orange">{total.stalled}</td>
                    {/* Rata-rata respons tim SENGAJA em-dash: merata-ratakan
                        rata-rata per orang tanpa membobot jumlah percakapan
                        menghasilkan angka yang salah. */}
                    <td className="px-3 py-2.5 text-right text-ink3">—</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red">{total.slaBreach}</td>
                    <td className="px-3 py-2.5 text-right text-ink3">—</td>
                    <td className="px-3 py-2.5 text-right text-ink3">—</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-green">{total.orderingCustomers}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                      {total.orderConversionRate != null ? `${total.orderConversionRate}%` : "—"}
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
            Kolom bertanda <strong>*</strong> (Qualified, Quoted) adalah <strong>posisi
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
