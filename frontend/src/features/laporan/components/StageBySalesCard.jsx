import React, { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "@/api.js";
import { toApiParams } from "@/lib/dateRange.js";
import { formatRupiah, formatRupiahShort, STAGE_LABELS, stageDotVar } from "@/utils/format.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { STAGE_INFO } from "../utils/stageInfo.js";

// ═══ SALES PER STAGE (30 September 2026; disusun ulang 1 November 2026) ════════════════════════════════════════
// Permintaan owner: "sales per stage tuh kondisinya seperti apa". Data dari /analytics/stage-by-sales yang memakai
// aturan SAMA PERSIS dengan papan Pipeline (populasi, sales = assignedSales, mandek ≥14 hari), jadi angka di sini
// dan di halaman Pipeline tidak pernah beda. Nilai order "Menunggu" ditampilkan TERPISAH dan tidak ikut omset
// (keputusan owner hari yang sama). Jumlah sales yang tampil sebelum "Tampilkan semua".
//
// DISUSUN ULANG (review Owner 1 Nov 2026) — penyajian saja, populasi/periode/penyebut/rumus tidak berubah:
//  • "Sebaran Tahap" (kiri ≈65%): total lead + lima baris tahap (titik palet bersama, nama, lead, bar, nilai, mandek).
//    Menggantikan kartu besar + lima kartu tahap terpisah; semua angka & tooltip-nya pindah ke baris ini.
//  • "Perlu Perhatian" (kanan ≈35%): Mandek ≥14 hari (angka utama + persen/penyebut), Nilai order pasti, Menunggu.
//  • "Per sales": tabel perbandingan (bukan kartu). Warna tahap hanya penanda kecil di header kolom.
//    Mandek 0 ditulis "0" — TIDAK disimpulkan "Aman" (label itu dihapus).
const SALES_AWAL = 6;
const STAGES = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"];
// Warna tahap = palet tahap bersama (styles/stage-palette.css) lewat stageDotVar() di utils/format.js — bukan salinan warna.
const STAGE_COLOR = Object.fromEntries(STAGES.map((s) => [s, stageDotVar(s)]));
// Mandek hanya bermakna untuk New + Prospek (definisi di INFO.mandek); tahap lain ditulis "—" kecuali server mengirim angka.
const STAGE_BISA_MANDEK = new Set(["NEW", "PROSPECT"]);

// Penjelasan tiap bagian, bahasa sederhana untuk sales & owner (permintaan
// owner 30 Sep 2026). STAGE_INFO dipakai bersama dgn tab Pipeline.
const INFO = {
  totalLeads: "Jumlah lead (calon pelanggan) yang PERTAMA KALI masuk di periode yang dipilih di atas, dikelompokkan menurut posisinya sekarang. Bar di tiap baris membandingkan jumlah lead stage itu dengan stage terbanyak.",
  mandek: "Mandek = lead di stage New atau Prospek yang sudah 14 hari atau lebih tidak ada perubahan/tindak lanjut. Mereka rawan hilang, jadi perlu dihubungi lagi. Stage Transaksi, Reviewed, dan Spam tidak dianggap mandek.",
  pctMandek: "Persentase = jumlah lead mandek dibagi total lead di stage New + Prospek. Contoh: 5 mandek dari 20 lead New + Prospek = 25%. Makin kecil makin bagus.",
  nilaiPasti: "Total nilai (Rupiah) order milik lead-lead di periode ini yang sudah PASTI: order berstatus Menunggu dan Dibatalkan tidak dihitung. Aturannya sama dengan omset di seluruh laporan.",
  menunggu: "Order yang sudah diinput tapi statusnya Menunggu (misalnya customer minta dikerjakan 2 minggu lagi). Belum pasti, jadi TIDAK masuk omset. Nilainya ditampilkan di sini saja sebagai gambaran.",
  stageValue: "Total nilai order pasti dari lead yang sekarang berada di stage ini (tanpa order Menunggu dan Dibatalkan).",
  stageBar: "Bar membandingkan jumlah lead stage ini dengan stage terbanyak (Spam tidak ikut menentukan skala; batangnya dipotong di 100%).",
  stageMandek: "Jumlah lead di stage ini yang sudah 14 hari atau lebih tidak ada tindak lanjut. Tanda “—” = stage ini tidak punya konsep mandek.",
  perSales: "Setiap baris = satu sales beserta lead yang ditugaskan kepadanya (sales yang menangani chat customer). Kolom stage menunjukkan jumlah lead sales itu di tiap stage, warnanya sama dengan warna stage di atas. 'Belum ditugaskan' = lead yang belum dipegang sales mana pun.",
  salesNilai: "Total nilai order pasti dari lead sales ini (tanpa order Menunggu dan Dibatalkan) — nilai order, bukan uang yang sudah diterima.",
  salesMandek: "Jumlah lead New/Prospek milik sales ini yang sudah 14 hari atau lebih tidak ada perubahan/tindak lanjut. 0 = tidak ada lead mandek.",
};

const Tile = ({ className = "", children }) => (
  <div className={`rounded-card bg-surface p-5 shadow-card ${className}`}>{children}</div>
);

export function Avatar({ name, url }) {
  const inisial = (name || "?").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return url
    ? <img src={url} alt="" className="crm-ss-avatar object-cover" />
    : <span className="crm-ss-avatar" aria-hidden="true">{inisial}</span>;
}

// Nilai singkat (formatRupiahShort) — nilai penuh tetap bisa dibaca lewat tooltip bawaan peramban.
const Rp = ({ n }) => <span title={formatRupiah(n || 0)}>{formatRupiahShort(n || 0)}</span>;
const Titik = ({ s }) => <i className="crm-ss-titik" style={{ background: STAGE_COLOR[s] }} aria-hidden="true" />;

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
  const aktif = (byStage.NEW?.count || 0) + (byStage.PROSPECT?.count || 0);
  const mandek = data.stages.reduce((n, s) => n + s.stale, 0);
  const pctMandek = aktif > 0 ? Math.round((mandek / aktif) * 100) : 0;
  const nilaiPasti = data.stages.reduce((n, s) => n + s.value, 0);
  const nilaiMenunggu = data.stages.reduce((n, s) => n + s.pendingValue, 0);
  const tampilSales = semuaSales ? data.sales : data.sales.slice(0, SALES_AWAL);
  const maxStage = Math.max(1, ...data.stages.filter((s) => s.stage !== "SPAM").map((s) => s.count));

  return (
    <section className="crm-ss" aria-labelledby="judul-sales-stage">
      <div className="crm-ss-kepala">
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

      <div className="crm-ss-atas">
        {/* ── Sebaran Tahap (≈65%) ─────────────────────────────────────────────── */}
        <Tile className="crm-ss-sebaran">
          <div className="crm-ss-judul">
            <h3 className="t-card-title">Sebaran Tahap</h3>
            <p className="crm-ss-total"><strong>{data.totalLeads.toLocaleString("id-ID")}</strong> lead <InfoTooltip text={INFO.totalLeads} /></p>
          </div>
          <div role="table" aria-label="Sebaran lead per tahap" className="crm-ss-tabel">
            <div role="row" className="crm-ss-baris crm-ss-baris--kepala">
              <span role="columnheader">Tahap</span>
              <span role="columnheader" className="crm-ss-kanan">Lead</span>
              <span role="columnheader" className="crm-ss-kol-bar">Sebaran</span>
              <span role="columnheader" className="crm-ss-kanan">Nilai <InfoTooltip text={INFO.stageValue} /></span>
              <span role="columnheader" className="crm-ss-kanan">Mandek <InfoTooltip text={INFO.stageMandek} /></span>
            </div>
            {STAGES.map((s) => {
              const st = byStage[s] || { count: 0, value: 0, pendingValue: 0, stale: 0 };
              const adaMandek = STAGE_BISA_MANDEK.has(s) || st.stale > 0;
              return (
                <div role="row" className="crm-ss-baris" key={s} data-stage={s}>
                  <span role="cell" className="crm-ss-tahap">
                    <Titik s={s} />
                    <span className="crm-ss-nama">{STAGE_LABELS[s]}</span>
                    <InfoTooltip text={STAGE_INFO[s]} />
                  </span>
                  <span role="cell" className="crm-ss-lead crm-ss-kanan">{st.count.toLocaleString("id-ID")}</span>
                  <span role="cell" className="crm-ss-bar" title={INFO.stageBar}>
                    <span style={{ width: `${Math.min((st.count / maxStage) * 100, 100)}%`, background: STAGE_COLOR[s] }} />
                  </span>
                  <span role="cell" className="crm-ss-nilai crm-ss-kanan" data-label="Nilai"><Rp n={st.value} /></span>
                  <span role="cell" className="crm-ss-mandek crm-ss-kanan" data-label="Mandek">
                    {adaMandek
                      ? <b className="crm-ss-chip" data-ada={st.stale > 0 ? "1" : "0"}>{st.stale > 0 && <AlertTriangle size={11} aria-hidden="true" />}{st.stale.toLocaleString("id-ID")}</b>
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </Tile>

        {/* ── Perlu Perhatian (≈35%) ───────────────────────────────────────────── */}
        <Tile className="crm-ss-perhatian">
          <div className="crm-ss-judul">
            <span className="crm-ss-ikon" data-ada={mandek > 0 ? "1" : "0"} aria-hidden="true"><AlertTriangle size={18} /></span>
            <h3 className="t-card-title">Perlu Perhatian</h3>
          </div>
          <div className="crm-ss-blok">
            <p className="crm-ss-angka">{mandek.toLocaleString("id-ID")}</p>
            <p className="crm-ss-label">Lead mandek ≥{data.staleDays} hari <InfoTooltip text={INFO.mandek} /></p>
            <p className="crm-ss-sub">{pctMandek}% dari {aktif.toLocaleString("id-ID")} lead New + Prospek <InfoTooltip text={INFO.pctMandek} /></p>
          </div>
          <div className="crm-ss-blok">
            <p className="crm-ss-label">Nilai order pasti <InfoTooltip text={INFO.nilaiPasti} /></p>
            <p className="crm-ss-angka crm-ss-angka--rp"><Rp n={nilaiPasti} /></p>
          </div>
          <div className="crm-ss-blok">
            <p className="crm-ss-label">Menunggu <InfoTooltip text={INFO.menunggu} /></p>
            <p className="crm-ss-angka crm-ss-angka--rp"><Rp n={nilaiMenunggu} /></p>
            <p className="crm-ss-sub">Belum dihitung omset</p>
          </div>
        </Tile>
      </div>

      {/* ── Per sales: tabel perbandingan ─────────────────────────────────────── */}
      <Tile className="crm-ss-persales">
        <div className="crm-ss-judul">
          <h3 className="t-card-title">Per sales</h3>
          <span className="crm-ss-pil">{data.sales.length} orang</span>
          <InfoTooltip text={INFO.perSales} />
        </div>
        {data.sales.length === 0 ? (
          <p className="text-sm text-ink3">Belum ada lead di periode ini.</p>
        ) : (
          <>
            {/* HP: tabel digulir mendatar di dalam panel (kolom Sales menempel di kiri) — teks TIDAK dikecilkan. */}
            <div className="crm-ss-gulir" tabIndex={0} role="region" aria-label="Tabel per sales; gulir mendatar untuk kolom lain">
              <table className="crm-ss-tabel-sales">
                <thead>
                  <tr>
                    <th scope="col" className="crm-ss-kiri">Sales</th>
                    <th scope="col">Total Lead</th>
                    {STAGES.map((s) => (
                      <th scope="col" key={s}><Titik s={s} />{STAGE_LABELS[s]} <InfoTooltip text={STAGE_INFO[s]} /></th>
                    ))}
                    <th scope="col">Nilai <InfoTooltip text={INFO.salesNilai} /></th>
                    <th scope="col">Mandek <InfoTooltip text={INFO.salesMandek} /></th>
                  </tr>
                </thead>
                <tbody>
                  {tampilSales.map((r) => (
                    <tr key={r.userId || "none"}>
                      <th scope="row" className="crm-ss-kiri">
                        <span className="crm-ss-orang"><Avatar name={r.name} url={r.avatarUrl} /><span className="crm-ss-nama-sales" title={r.name}>{r.name}</span></span>
                      </th>
                      <td className="crm-ss-tebal">{r.total.toLocaleString("id-ID")}</td>
                      {STAGES.map((s) => <td key={s}>{(r.byStage[s] || 0).toLocaleString("id-ID")}</td>)}
                      <td><Rp n={r.value} /></td>
                      <td><b className="crm-ss-chip" data-ada={r.stale > 0 ? "1" : "0"}>{r.stale > 0 && <AlertTriangle size={11} aria-hidden="true" />}{r.stale.toLocaleString("id-ID")}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="crm-ss-kaki">
              <span>Menampilkan {tampilSales.length} dari {data.sales.length} sales</span>
              <span>Nilai = nilai order pasti per sales, bukan uang yang sudah diterima.</span>
            </div>
          </>
        )}
        {data.sales.length > SALES_AWAL && (
          <button
            type="button" onClick={() => setSemuaSales((v) => !v)}
            className="crm-ss-semua"
          >
            {semuaSales ? "Tampilkan lebih sedikit" : `Tampilkan semua ${data.sales.length} sales`}
          </button>
        )}
      </Tile>
    </section>
  );
}
