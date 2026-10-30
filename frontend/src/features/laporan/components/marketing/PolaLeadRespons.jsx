import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, Flame, Info } from "lucide-react";
import { formatDuration } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import { compareLabel } from "@/lib/dateRange.js";
import KpiCard from "../KpiCard.jsx";
import ChartCard from "../ChartCard.jsx";

// Pola lead & respons (pindahan dari tab Traffic): rata-rata harian, hari tidak normal, jam tersibuk, respons pertama, peta hari × jam, jam rawan.
// Sumber: GET /analytics/traffic (lead tanpa spam). Tidak ada perhitungan baru di klien.
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

// Skala warna heatmap — intensitas via opacity SATU warna (aturan satu accent
// design system), bukan pelangi merah-kuning-hijau yang bikin heatmap terbaca
// seperti peta cuaca.
function selVolume(v, max) {
  if (!max || v === 0) return { background: "var(--bg-inset)" };
  return { background: `color-mix(in srgb, var(--accent) ${Math.round((v / max) * 85) + 8}%, transparent)` };
}
// Respons: DI SINI warna merah dibenarkan — ini status bahaya (SLA), bukan
// sekadar besaran. Makin lama makin merah.
function selRespons(menit) {
  if (menit == null) return { background: "var(--bg-inset)" };
  const p = Math.min(menit / 240, 1); // 4 jam = merah penuh
  return { background: `color-mix(in srgb, var(--red) ${Math.round(p * 80) + 8}%, transparent)` };
}

export default function PolaLeadRespons({ traffic, rangeParams }) {
  const cmp = compareLabel(rangeParams);
  const [mode, setMode] = useState("volume"); // "volume" | "respons"
  // Tooltip heatmap dibuat sendiri (atribut `title` browser lambat dan tak bisa distyle).
  const [hover, setHover] = useState(null); // { cell, nama, x, y }
  const daily = traffic?.daily || [];
  const heatmap = traffic?.heatmap || [];
  const anomali = daily.filter((d) => d.status !== "normal");
  // Hari yang BENAR-BENAR dinilai (punya baseline, bukan hari berjalan) — dibedakan dari "0 anomali".
  const hariDinilai = daily.filter((d) => d.baseline != null && !d.partial).length;
  const maxLeadSel = useMemo(() => Math.max(1, ...heatmap.map((c) => c.leads)), [heatmap]);
  const cellByKey = useMemo(() => {
    const m = {};
    for (const c of heatmap) m[`${c.dow}-${c.jam}`] = c;
    return m;
  }, [heatmap]);

  return (
    <div className="flex flex-col gap-5">
      <p className="t-secondary text-[12px]" data-testid="pola-basis">Semua angka di bagian ini menghitung lead TANPA spam dan tanpa B2B/penjualan karyawan — bukan “Total lead (termasuk spam)” di kartu.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          index={0} label="Rata-rata per Hari"
          numericValue={traffic.rataRataHarian ?? 0}
          format={(v) => v.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
          growth={traffic.rataRataGrowthPct} compareLabel={cmp}
          sub={traffic.rataRataHarianPrev != null
            ? `periode sebelumnya: ${traffic.rataRataHarianPrev.toLocaleString("id-ID", { maximumFractionDigits: 1 })} lead/hari`
            : "Belum ada periode pembanding"}
          tooltip="Hari yang sedang berjalan (belum selesai 24 jam) dikecualikan dari rata-rata, supaya angkanya tidak turun palsu tiap kali laporan dibuka siang hari."
        />
        <KpiCard
          index={1} label="Hari Tidak Normal"
          numericValue={anomali.length}
          sub={hariDinilai === 0
            ? "Belum cukup histori pembanding — pilih periode yang lebih panjang"
            : `${anomali.filter((a) => a.status === "spike").length} spike · ${anomali.filter((a) => a.status === "drop").length} drop, dari ${hariDinilai} hari yang dinilai`}
          tooltip="Dibandingkan rata-rata 7 hari SEBELUM hari itu (tidak termasuk hari itu sendiri) ± 2 standar deviasi. Di luar rentang itu → ditandai Spike (lebih ramai dari biasa) atau Drop (lebih sepi). Hari yang sedang berjalan tidak pernah dinilai — datanya belum lengkap."
        />
        <KpiCard
          index={2} label="Jam Tersibuk"
          numericValue={traffic.busiestHours?.[0]?.jam ?? 0}
          format={(v) => `${String(Math.round(v)).padStart(2, "0")}:00`}
          sub={traffic.busiestHours?.[0] ? `${traffic.busiestHours[0].leads} lead masuk di jam ini` : "—"}
          tooltip="Jam WIB (00-23) dengan jumlah lead masuk terbanyak, dijumlahkan dari seluruh hari di periode yang dipilih."
        />
        <KpiCard
          index={3} label="Respons Rata-rata"
          numericValue={traffic.avgResponseMinutes ?? 0}
          format={(v) => traffic.avgResponseMinutes != null ? formatDuration(traffic.avgResponseMinutes) : "—"}
          sub="Rata-rata waktu balas pertama, terbobot per jumlah percakapan — bukan rata-rata dari 24 angka per-jam"
          tooltip="Waktu dari pesan pertama pelanggan sampai balasan pertama sales, dihitung dalam jam operasional (09-21 WIB)."
        />
      </div>

      {/* ── Heatmap jam × hari ── */}
      <ChartCard
        index={5}
        title="Peta Traffic: Hari × Jam (WIB)"
        description={mode === "volume"
          ? "Kapan lead paling banyak masuk"
          : "Berapa lama customer menunggu dibalas, menurut jam dia chat"}
      >
        <div className="mb-3 flex gap-1 rounded-btn bg-inset p-1" style={{ width: "fit-content" }}>
          {[["volume", "Volume lead (tanpa spam)"], ["respons", "Waktu Respons"]].map(([k, label]) => (
            <button
              key={k} onClick={() => setMode(k)}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[12px] font-medium transition-colors",
                mode === k ? "bg-surface text-ink shadow-card" : "text-ink2 hover:text-ink"
              )}
            >{label}</button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: 640 }}>
            {/* Label jam tiap 3 kolom biar tidak berdesakan */}
            <div className="flex gap-[2px] pl-9">
              {Array.from({ length: 24 }, (_, j) => (
                <div key={j} className="flex-1 text-center text-[9px] text-ink3">
                  {j % 3 === 0 ? String(j).padStart(2, "0") : ""}
                </div>
              ))}
            </div>
            {HARI.map((nama, dow) => (
              <div key={dow} className="mt-[2px] flex items-center gap-[2px]">
                <div className="w-9 shrink-0 text-[10px] font-medium text-ink2">{nama}</div>
                {Array.from({ length: 24 }, (_, jam) => {
                  const c = cellByKey[`${dow}-${jam}`] || { dow, jam, leads: 0, responded: 0, avgMinutes: null, slaBreach: 0 };
                  const style = mode === "volume" ? selVolume(c.leads, maxLeadSel) : selRespons(c.avgMinutes);
                  return (
                    <div
                      key={jam} style={style}
                      className="h-6 flex-1 cursor-help rounded-[3px] transition-[outline] hover:outline hover:outline-2 hover:outline-ink"
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHover({ cell: c, nama, x: r.left + r.width / 2, y: r.top });
                      }}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {/* BUG YANG DIPERBAIKI: tooltip dulu dirender di dalam ChartCard dan
            tertutup card di bawahnya. Penyebabnya BUKAN z-index kurang tinggi —
            ChartCard memakai animasi `fade-rise` yang meninggalkan
            `transform: translateY(0)` (fill-mode `both`). Transform non-none
            membuat elemen jadi CONTAINING BLOCK untuk position:fixed SEKALIGUS
            stacking context baru, jadi tooltip terkurung di dalam card itu dan
            z-50-nya cuma bersaing DI DALAM card — card berikutnya tetap menang.
            Portal ke document.body melepasnya dari semua stacking context
            ancestor, sekalian membuat koordinat fixed-nya benar-benar relatif
            viewport (sesuai getBoundingClientRect). */}
        {hover && createPortal(
          <div
            className="pointer-events-none fixed z-[1200] rounded-btn bg-surface px-3 py-2 shadow-popover"
            style={
              // Dibalik ke BAWAH kotak kalau ruang di atas tidak cukup —
              // baris "Min" di layar pendek tooltipnya akan kepotong tepi atas.
              hover.y < 150
                ? { left: hover.x, top: hover.y + 30, transform: "translateX(-50%)" }
                : { left: hover.x, top: hover.y - 8, transform: "translate(-50%, -100%)" }
            }
          >
            <p className="t-caption mb-1">
              {hover.nama}, {String(hover.cell.jam).padStart(2, "0")}:00–{String(hover.cell.jam).padStart(2, "0")}:59 WIB
            </p>
            <p className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {hover.cell.leads} lead masuk
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-ink2">
              <span className="h-2 w-2 rounded-full bg-red" />
              {hover.cell.avgMinutes != null
                ? <>Respons {formatDuration(hover.cell.avgMinutes)}</>
                : <>Belum ada data respons</>}
            </p>
            {hover.cell.slaBreach > 0 && (
              <p className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-red">
                {hover.cell.slaBreach}× lewat SLA 60 menit
              </p>
            )}
            {hover.cell.responded > 0 && (
              <p className="t-secondary mt-0.5 whitespace-nowrap text-[10.5px]">
                dari {hover.cell.responded} percakapan yang dibalas
              </p>
            )}
          </div>,
          document.body
        )}

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
          Arahkan kursor ke kotak untuk detail. Bandingkan dua mode: kotak
          <strong> gelap</strong> di Volume tapi <strong>merah</strong> di Waktu Respons =
          jam ramai yang tidak terjaga — itu kebocoran lead paling mahal.
        </p>
      </ChartCard>

      {/* ── Jam sibuk & jam rawan ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard index={6} title="Jam Tersibuk" description="Paling banyak lead masuk">
          <div className="flex flex-col gap-2.5">
            {(traffic.busiestHours || []).map((h) => (
              <div key={h.jam} className="flex items-center gap-3">
                <Flame size={15} className="shrink-0 text-accent" />
                <span className="w-14 shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {String(h.jam).padStart(2, "0")}:00
                </span>
                <span className="flex-1 text-[12.5px] text-ink2">{h.leads} lead masuk</span>
                <span className="t-secondary text-[11.5px] tabular-nums">
                  {h.avgMinutes != null ? formatDuration(h.avgMinutes) : "—"}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          index={7} title="Jam Paling Rawan"
          description="Respons terlama — hanya jam yang volumenya signifikan"
          empty={(traffic.riskiestHours || []).length === 0 ? "Belum cukup data respons." : null}
        >
          <div className="flex flex-col gap-2.5">
            {(traffic.riskiestHours || []).map((h) => (
              <div key={h.jam} className="flex items-center gap-3">
                <Clock size={15} className="shrink-0 text-red" />
                <span className="w-14 shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {String(h.jam).padStart(2, "0")}:00
                </span>
                <span className="flex-1 text-[12.5px] font-semibold text-red">
                  {formatDuration(h.avgMinutes)}
                </span>
                <span className="t-secondary text-[11.5px] tabular-nums">
                  {h.leads} lead · {h.slaBreach}× lewat SLA
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              Jam sepi dengan 1-2 chat telat sengaja TIDAK masuk daftar ini —
              yang ditampilkan hanya jam yang volumenya cukup untuk jadi masalah nyata.
            </span>
          </p>
        </ChartCard>
      </div>
    </div>
  );
}
