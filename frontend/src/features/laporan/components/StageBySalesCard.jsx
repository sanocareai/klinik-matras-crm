import React, { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "@/api.js";
import { toApiParams } from "@/lib/dateRange.js";
import { formatRupiahShort, STAGE_LABELS } from "@/utils/format.js";
import ProgressRing from "@/components/ui/progress-ring.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { STAGE_INFO } from "../utils/stageInfo.js";

// ═══ SALES PER STAGE (30 September 2026) ═══════════════════════════════════
// Permintaan owner: "sales per stage tuh kondisinya seperti apa" — dalam gaya
// bento ala Apple (kartu putih membulat, angka besar, grafik kecil). Data dari
// /analytics/stage-by-sales yang memakai aturan SAMA PERSIS dengan papan
// Pipeline (populasi, sales = assignedSales, mandek ≥14 hari), jadi angka di
// sini dan di halaman Pipeline tidak pernah beda. Nilai order "Menunggu"
// ditampilkan TERPISAH dan tidak ikut omset (keputusan owner hari yang sama).
// Jumlah sales yang tampil sebelum "Tampilkan semua".
const SALES_AWAL = 6;
const STAGES = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"];
const STAGE_COLOR = {
  NEW:         "var(--orange)",
  PROSPECT:    "var(--accent)",
  TRANSACTION: "var(--green)",
  REVIEWED:    "color-mix(in srgb, var(--green) 55%, transparent)",
  SPAM:        "var(--hairline)",
};

// Penjelasan tiap bagian, bahasa sederhana untuk sales & owner (permintaan
// owner 30 Sep 2026). STAGE_INFO dipakai bersama dgn tab Pipeline.
const INFO = {
  totalLeads: "Jumlah lead (calon pelanggan) yang PERTAMA KALI masuk di periode yang dipilih di atas, dikelompokkan menurut posisinya sekarang. Bar warna menunjukkan porsi tiap stage; makin panjang satu warna, makin banyak lead di stage itu.",
  mandek: "Mandek = lead di stage New atau Prospek yang sudah 14 hari atau lebih tidak ada perubahan/tindak lanjut. Mereka rawan hilang, jadi perlu dihubungi lagi. Stage Transaksi, Reviewed, dan Spam tidak dianggap mandek.",
  pctMandek: "Persentase = jumlah lead mandek dibagi total lead di stage New + Prospek. Contoh: 5 mandek dari 20 lead New + Prospek = 25%. Makin kecil makin bagus. Cincin hijau = tidak ada yang mandek, oranye = ada.",
  nilaiPasti: "Total nilai (Rupiah) order milik lead-lead di periode ini yang sudah PASTI: order berstatus Menunggu dan Dibatalkan tidak dihitung. Aturannya sama dengan omset di seluruh laporan.",
  menunggu: "Order yang sudah diinput tapi statusnya Menunggu (misalnya customer minta dikerjakan 2 minggu lagi). Belum pasti, jadi TIDAK masuk omset. Nilainya ditampilkan di sini saja sebagai gambaran.",
  stageValue: "Total nilai order pasti dari lead yang sekarang berada di stage ini (tanpa order Menunggu dan Dibatalkan).",
  stageBar: "Bar kecil membandingkan jumlah lead stage ini dengan stage terbanyak (Spam tidak ikut dibandingkan).",
  stageMandek: "Jumlah lead di stage ini yang sudah 14 hari atau lebih tidak ada tindak lanjut.",
  perSales: "Setiap baris = satu sales beserta lead yang ditugaskan kepadanya (sales yang menangani chat customer). Bar berwarna menunjukkan sebaran lead sales itu di tiap stage, warnanya sama dengan warna stage di atas. 'Belum ditugaskan' = lead yang belum dipegang sales mana pun.",
  aman: "Aman = tidak ada lead New/Prospek milik sales ini yang mandek 14 hari atau lebih.",
};

const Tile = ({ className = "", children }) => (
  <div className={`rounded-card bg-surface p-5 shadow-card ${className}`}>{children}</div>
);

function Avatar({ name, url }) {
  const inisial = (name || "?").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return url
    ? <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-[var(--bg-surface)]" />
    : (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-inset text-[12px] font-semibold text-ink2 ring-2 ring-[var(--bg-surface)]">
        {inisial}
      </span>
    );
}

// Bar tersegmen per stage — satu garis horizontal, proporsi tiap stage.
function StageBar({ byStage, total, height = 8 }) {
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-inset" style={{ height }}>
      {total > 0 && STAGES.map((s) => (byStage[s] || 0) > 0 && (
        <span
          key={s}
          title={`${STAGE_LABELS[s]}: ${byStage[s]}`}
          style={{ width: `${(byStage[s] / total) * 100}%`, background: STAGE_COLOR[s] }}
        />
      ))}
    </div>
  );
}

export default function StageBySalesCard({ range, onGoTab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [semuaSales, setSemuaSales] = useState(false);

  useEffect(() => {
    if ((!!range?.from) !== (!!range?.to)) return;
    let batal = false;
    setError(null);
    api.getAnalyticsStageBySales(toApiParams(range))
      .then((d) => { if (!batal) setData(d); })
      .catch((e) => { if (!batal) setError(e.message || "Gagal memuat"); });
    return () => { batal = true; };
  }, [range?.from, range?.to]);

  if (error) {
    return <Tile><p className="text-sm text-ink3">Sales per Stage gagal dimuat: {error}</p></Tile>;
  }
  if (!data) {
    return <Tile className="h-40 animate-pulse"><span className="sr-only">Memuat…</span></Tile>;
  }

  const byStage = Object.fromEntries(data.stages.map((s) => [s.stage, s]));
  const countByStage = Object.fromEntries(data.stages.map((s) => [s.stage, s.count]));
  const aktif = (byStage.NEW?.count || 0) + (byStage.PROSPECT?.count || 0);
  const mandek = data.stages.reduce((n, s) => n + s.stale, 0);
  const pctMandek = aktif > 0 ? Math.round((mandek / aktif) * 100) : 0;
  const nilaiPasti = data.stages.reduce((n, s) => n + s.value, 0);
  const nilaiMenunggu = data.stages.reduce((n, s) => n + s.pendingValue, 0);
  const tampilSales = semuaSales ? data.sales : data.sales.slice(0, SALES_AWAL);
  const maxStage = Math.max(1, ...data.stages.filter((s) => s.stage !== "SPAM").map((s) => s.count));

  return (
    <section className="flex flex-col gap-4" aria-labelledby="judul-sales-stage">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="judul-sales-stage" className="text-[22px] font-bold tracking-tight text-ink">Sales per Stage</h2>
          <p className="text-[13px] text-ink3">Posisi lead tiap sales di pipeline, untuk lead yang masuk di periode ini</p>
        </div>
        {onGoTab && (
          <button type="button" onClick={() => onGoTab("Pipeline")}
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            Detail pipeline <ArrowRight size={13} />
          </button>
        )}
      </div>

      {/* Baris bento atas: 1 kartu besar + 2 kartu angka */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr_1fr]">
        <Tile>
          <p className="flex items-center gap-1 text-[13px] font-medium text-ink3">Lead di pipeline <InfoTooltip text={INFO.totalLeads} /></p>
          <p className="mt-1 text-[40px] font-extrabold leading-none tracking-tight tabular-nums text-ink">
            {data.totalLeads.toLocaleString("id-ID")}
          </p>
          <div className="mt-5"><StageBar byStage={countByStage} total={data.totalLeads} height={12} /></div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {STAGES.map((s) => (
              <li key={s} className="flex items-center gap-1.5 text-[12px] text-ink3">
                <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[s] }} />
                {STAGE_LABELS[s]} <strong className="tabular-nums text-ink2">{byStage[s]?.count || 0}</strong>
                <InfoTooltip text={STAGE_INFO[s]} />
              </li>
            ))}
          </ul>
        </Tile>

        <Tile className="flex items-center gap-4">
          <ProgressRing percent={pctMandek} color={mandek > 0 ? "var(--orange)" : "var(--green)"} size={84} strokeWidth={9}>
            <span className="text-lg font-extrabold tabular-nums text-ink">{pctMandek}%</span>
          </ProgressRing>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[13px] font-medium text-ink3">Mandek ≥{data.staleDays} hari <InfoTooltip text={INFO.mandek} /></p>
            <p className="mt-1 text-[32px] font-extrabold leading-none tabular-nums text-ink">{mandek}</p>
            <p className="mt-1 flex items-center gap-1 text-[12px] text-ink3">{pctMandek}% dari {aktif} lead New + Prospek <InfoTooltip text={INFO.pctMandek} /></p>
          </div>
        </Tile>

        <Tile>
          <p className="flex items-center gap-1 text-[13px] font-medium text-ink3">Nilai order pasti <InfoTooltip text={INFO.nilaiPasti} /></p>
          <p className="mt-1 text-[32px] font-extrabold leading-none tracking-tight tabular-nums text-ink">
            {formatRupiahShort(nilaiPasti)}
          </p>
          <div className="mt-4 rounded-xl bg-inset px-3 py-2.5">
            <p className="flex items-center gap-1 text-[12px] text-ink3">Menunggu (belum dihitung omset) <InfoTooltip text={INFO.menunggu} /></p>
            <p className="text-[15px] font-bold tabular-nums text-ink2">{formatRupiahShort(nilaiMenunggu)}</p>
          </div>
        </Tile>
      </div>

      {/* Satu kartu kecil per stage */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {STAGES.map((s) => {
          const st = byStage[s] || { count: 0, value: 0, pendingValue: 0, stale: 0 };
          return (
            <Tile key={s} className="flex flex-col">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink3">
                <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[s] }} />
                {STAGE_LABELS[s]}
                <InfoTooltip text={STAGE_INFO[s]} />
              </p>
              <p className="mt-2 text-[28px] font-extrabold leading-none tabular-nums text-ink">{st.count}</p>
              <p className="mt-1 flex items-center gap-1 text-[12px] tabular-nums text-ink3">{formatRupiahShort(st.value)} <InfoTooltip text={INFO.stageValue} /></p>
              {s !== "SPAM" && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-inset" title={INFO.stageBar}>
                  <span className="block h-full rounded-full" style={{ width: `${(st.count / maxStage) * 100}%`, background: STAGE_COLOR[s] }} />
                </div>
              )}
              {st.stale > 0 && (
                <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-orange-bg px-2 py-0.5 text-[11px] font-semibold text-orange">
                  <AlertTriangle size={11} /> {st.stale} mandek <InfoTooltip text={INFO.stageMandek} />
                </span>
              )}
            </Tile>
          );
        })}
      </div>

      {/* Per sales — grid kartu ringkas (30 Sep 2026): daftar satu-baris-per-sales
          dengan bar selebar layar terlalu panjang & penuh saat 12+ sales tampil.
          Sekarang 3 kolom, bar selebar kartu, dan hanya 6 teratas dulu. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
            Per sales <span className="text-[12px] font-normal text-ink3">{data.sales.length} orang</span>
            <InfoTooltip text={INFO.perSales} />
          </p>
        </div>
        {data.sales.length === 0 ? (
          <Tile><p className="text-sm text-ink3">Belum ada lead di periode ini.</p></Tile>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tampilSales.map((r) => (
              <Tile key={r.userId || "none"} className="flex flex-col gap-3 !p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} url={r.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">{r.name}</p>
                    <p className="text-[12px] tabular-nums text-ink3">{formatRupiahShort(r.value)}</p>
                  </div>
                  <p className="shrink-0 text-right text-[22px] font-extrabold leading-none tabular-nums text-ink">
                    {r.total.toLocaleString("id-ID")}
                    <span className="block text-[10px] font-medium text-ink3">lead</span>
                  </p>
                </div>
                <StageBar byStage={r.byStage} total={r.total} />
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 flex-wrap gap-x-2.5 text-[11px] tabular-nums text-ink3">
                    {STAGES.filter((s) => r.byStage[s] > 0).map((s) => (
                      <span key={s} className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_COLOR[s] }} />
                        {STAGE_LABELS[s].split(" /")[0]} <strong className="text-ink2">{r.byStage[s].toLocaleString("id-ID")}</strong>
                      </span>
                    ))}
                  </p>
                  {r.stale > 0
                    ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-bg px-2 py-0.5 text-[11px] font-semibold text-orange"><AlertTriangle size={11} /> {r.stale.toLocaleString("id-ID")} mandek</span>
                    : <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-bg px-2 py-0.5 text-[11px] font-semibold text-green">Aman <InfoTooltip text={INFO.aman} /></span>}
                </div>
              </Tile>
            ))}
          </div>
        )}
        {data.sales.length > SALES_AWAL && (
          <button
            type="button" onClick={() => setSemuaSales((v) => !v)}
            className="self-center rounded-full bg-surface px-4 py-2 text-[12px] font-semibold text-accent shadow-card transition-colors hover:bg-accentbg"
          >
            {semuaSales ? "Tampilkan lebih sedikit" : `Tampilkan semua ${data.sales.length} sales`}
          </button>
        )}
      </div>
    </section>
  );
}
