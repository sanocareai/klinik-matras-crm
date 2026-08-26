import React from "react";
import { ChevronRight, Timer, ArrowRightLeft } from "lucide-react";
import { formatRupiah, STAGE_LABELS } from "@/utils/format.js";
import { formatTanggal } from "@/utils/formatDate.js";
import ChartCard from "./ChartCard.jsx";
import Sparkline from "./Sparkline.jsx";

// Revisi 26 Jul 2026: pipeline 8-stage, LOST dihapus (jadi hanya PAID/REVIEWED
// yang punya makna "berhasil"). Label dipakai langsung dari STAGE_LABELS
// (utils/format.js) — dulu file ini punya salinan sendiri (STAGE_LABEL_ID)
// yang independen dan rawan drift dari sumber utama (lihat CLAUDE.md §8,
// "Label 'Penawaran' masih muncul di beberapa tempat"); sekarang satu sumber.
// Revisi 30 Jul 2026: PAID dihapus (7 stage) — COMPLETED sekarang yang
// punya makna "berhasil" bareng REVIEWED.
// Revisi 24 Agustus 2026: 7 stage → 4 (NEW/PROSPECT/TRANSACTION/SPAM).
// QUALIFIED/QUOTED/BOOKED/SCHEDULED digabung PROSPECT, COMPLETED/REVIEWED
// digabung TRANSACTION. SPAM abu-abu netral — bukan "berhasil", bukan
// "sedang berjalan", jadi dapat treatment visual sendiri.
const STAGE_BG = {
  NEW: "bg-inset", PROSPECT: "bg-inset",
  TRANSACTION: "bg-greenbg", SPAM: "bg-inset",
};
// Bar progres per stage — accent, kecuali TRANSACTION yang semantik.
const STAGE_BAR = {
  NEW: "bg-accent", PROSPECT: "bg-accent",
  TRANSACTION: "bg-green", SPAM: "bg-ink3",
};
const STAGE_DOT = {
  NEW: "bg-orange", PROSPECT: "bg-accent",
  TRANSACTION: "bg-green", SPAM: "bg-ink3",
};

// "3.4" → "3,4 hari" · "0.5" → "12 jam" (di bawah 1 hari lebih enak dibaca
// dalam jam). null → em-dash, JANGAN "0 hari" (0 berarti "instan", null
// berarti "belum ada datanya" — dua hal yang sangat berbeda di laporan).
function formatDurasiHari(hari) {
  if (hari == null) return "—";
  if (hari < 1) {
    const jam = Math.round(hari * 24);
    return jam <= 0 ? "<1 jam" : `${jam} jam`;
  }
  return `${hari.toString().replace(".", ",")} hari`;
}

// Stage yang paling lama tertahan = kemungkinan bottleneck.
// TRANSACTION/REVIEWED/SPAM dikecualikan (TRANSACTION & REVIEWED itu stage
// AKHIR "berhasil" — "lama di sana" tidak berarti macet, cuma belum pindah
// lagi / memang sudah selesai. SPAM juga bukan kandidat bottleneck — memang
// sengaja dibiarkan di sana).
function cariBottleneck(avgDaysInStage) {
  const kandidat = (avgDaysInStage || []).filter(
    (r) => r.stage !== "TRANSACTION" && r.stage !== "REVIEWED" && r.stage !== "SPAM" && r.avgDays != null && r.sample > 0
  );
  if (kandidat.length === 0) return null;
  return kandidat.reduce((a, b) => (b.avgDays > a.avgDays ? b : a));
}

export default function PipelineTab({ funnel, velocity }) {
  const total = funnel.reduce((s, f) => s + f.count, 0);

  const avgDays    = velocity?.avgDaysInStage || [];
  const movedTo    = velocity?.movedToStage || [];
  const totalTrans = velocity?.totalTransitions || 0;
  const adaData    = totalTrans > 0;
  const bottleneck = cariBottleneck(avgDays);
  const totalPindah = movedTo.reduce((s, r) => s + (r.count || 0), 0);
  const maxHari    = Math.max(1, ...avgDays.map((r) => r.avgDays || 0));

  // Empty state MENJELASKAN kenapa kosong. Tabel riwayat baru mulai merekam
  // dan tidak bisa di-backfill, jadi tanpa penjelasan ini widget terlihat
  // seperti fitur rusak padahal sedang menunggu data.
  const pesanKosong = (
    <div className="flex flex-col items-center gap-1.5 px-6 text-center">
      <Timer className="text-ink3" size={26} />
      <p className="text-sm font-semibold text-ink2">Data belum terkumpul</p>
      <p className="max-w-md text-xs leading-relaxed text-ink3">
        Kecepatan pipeline dihitung dari <strong>riwayat perpindahan stage</strong>, yang
        baru mulai dicatat sistem. Perpindahan sebelum fitur ini aktif tidak bisa
        dihitung ulang. Grafik akan terisi sendiri setelah tim memindahkan stage
        pelanggan beberapa kali — biasanya jelas dalam 2–4 minggu.
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <ChartCard
        title="Sales Pipeline Funnel"
        description="Jumlah pelanggan & konversi antar stage"
        empty={funnel.length === 0 ? "Belum ada data pipeline." : null}
      >
        <div className="flex flex-col gap-0 sm:flex-row sm:items-stretch sm:gap-0">
          {funnel.map((item, i) => {
            const prev = funnel[i - 1];
            const conversion = prev && prev.count > 0 ? Math.round((item.count / prev.count) * 100) : null;
            return (
              <React.Fragment key={item.stage}>
                {i > 0 && (
                  <div className="flex flex-col items-center justify-center px-1 py-2 sm:py-0">
                    <ChevronRight className="text-ink3" size={18} />
                    {conversion != null && (
                      <span className="text-[11px] font-bold text-ink3">{conversion}%</span>
                    )}
                  </div>
                )}
                <div
                  className={`animate-fade-rise flex-1 rounded-2xl p-4 sm:min-w-0 ${STAGE_BG[item.stage] || "bg-inset"}`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  {/* Teks putih dihapus — kartu funnel sekarang permukaan
                      terang, jadi warna teks ikut tangga tipe normal. */}
                  <p className="t-metric text-[26px]">{item.count}</p>
                  <p className="t-body mt-1.5 font-medium">{item.label}</p>
                  <p className="t-secondary mt-0.5">{formatRupiah(item.value)}</p>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </ChartCard>

      <ChartCard title="Detail per Stage">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Stage", "Jumlah", "Total Nilai", "Persentase"].map((h) => (
                  <th key={h} className="border-b border-line px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnel.map((item) => {
                const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0";
                return (
                  <tr key={item.stage} className="border-b border-line last:border-0">
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className={`h-2.5 w-2.5 rounded-full ${STAGE_DOT[item.stage] || "bg-ink3"}`} />
                        {item.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-lg font-bold text-ink">{item.count}</td>
                    <td className="px-3 py-3 text-ink2">{formatRupiah(item.value)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-inset">
                          <div
                            className={`h-full rounded-full transition-[width] duration-700 ${STAGE_BAR[item.stage] || "bg-accent"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-ink2">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* ── KECEPATAN PIPELINE (dari tabel pipeline_transitions) ───────────── */}
      <ChartCard
        index={2}
        title="Kecepatan Pipeline"
        description="Rata-rata lama pelanggan tertahan di tiap stage — makin pendek makin cepat closing"
        empty={adaData ? null : pesanKosong}
      >
        {bottleneck && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-orangebg px-3.5 py-3">
            <Timer className="mt-0.5 shrink-0 text-orange" size={16} />
            <p className="text-xs leading-relaxed text-ink">
              Paling lama tertahan di{" "}
              <strong>{STAGE_LABELS[bottleneck.stage] || bottleneck.stage}</strong> —
              rata-rata <strong>{formatDurasiHari(bottleneck.avgDays)}</strong>. Ini
              kandidat bottleneck yang paling layak dibenahi lebih dulu.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {avgDays.map((row) => (
            <div key={row.stage} className="flex items-center gap-3">
              <span className="flex w-32 shrink-0 items-center gap-2 text-xs font-semibold text-ink2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT[row.stage] || "bg-ink3"}`} />
                <span className="truncate">{STAGE_LABELS[row.stage] || row.stage}</span>
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-inset">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ease-out ${STAGE_BAR[row.stage] || "bg-accent"}`}
                  style={{ width: `${row.avgDays != null ? Math.max((row.avgDays / maxHari) * 100, 2) : 0}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-bold tabular-nums text-ink">
                {formatDurasiHari(row.avgDays)}
              </span>
              {/* sample = jumlah perpindahan yang jadi dasar rata-rata. Angka
                  kecil = rata-rata belum bisa dipercaya, jadi ditampilkan
                  terbuka daripada menyembunyikan ketidakpastiannya. */}
              <span className="w-14 shrink-0 text-right text-[11px] text-ink3" title="Jumlah perpindahan yang jadi dasar perhitungan">
                {row.sample > 0 ? `n=${row.sample}` : "—"}
              </span>
            </div>
          ))}
        </div>

        {velocity?.dataStartedAt && (
          <p className="mt-4 border-t border-line pt-3 text-[11px] text-ink3">
            Berdasarkan {totalTrans} perpindahan stage yang tercatat sejak{" "}
            {formatTanggal(velocity.dataStartedAt)}.
          </p>
        )}
      </ChartCard>

      <ChartCard
        index={3}
        title="Pergerakan Pipeline"
        description="Berapa pelanggan MASUK ke tiap stage pada periode ini (beda dari tabel di atas yang menghitung posisi saat ini)"
        empty={adaData ? null : pesanKosong}
      >
        {/* Restrukturisasi 24 Agustus 2026: 8 stage → 4, grid disederhanakan
            (2x2 di mobile, 1 baris penuh 4 kolom mulai sm — tidak perlu lagi
            breakpoint xl:grid-cols-8 yang dulu dipakai untuk 8 item). */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {movedTo.map((row) => (
            <div key={row.stage} className="rounded-xl bg-inset/60 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink2">
                <ArrowRightLeft size={11} className="shrink-0 text-ink3" />
                <span className="truncate">{STAGE_LABELS[row.stage] || row.stage}</span>
              </p>
              <p className="mt-1.5 text-xl font-extrabold tabular-nums text-ink">{row.count}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink3">
          Total {totalPindah} perpindahan pada periode terpilih.
        </p>

        {velocity?.monthlyWon?.length >= 2 && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-1 text-[11px] font-semibold text-ink2">
              Tren bulanan masuk “Berhasil”
            </p>
            <Sparkline data={velocity.monthlyWon} color="var(--green)" />
          </div>
        )}
      </ChartCard>
    </div>
  );
}
