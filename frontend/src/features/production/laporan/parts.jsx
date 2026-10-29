import React, { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Button } from "@/components/ui/button.jsx";
import { NADA_STATUS, angka, tglPendek } from "./laporanModel.js";

/** Ikon info kecil: definisi/rumus dipindah ke sini (bukan paragraf di bawah kartu). */
export const Info = ({ text }) => (text ? <InfoTooltip text={text} lebar={300} /> : null);

/** Kartu angka. Hanya angka yang membantu keputusan; definisi lewat ikon info, rincian lewat klik. */
export function KartuAngka({ label, nilai, sub, info, onClick, nada = "", testid, kecil = false }) {
  const isi = (
    <>
      <p className="m-0 flex items-center gap-1 text-[11.5px] font-medium text-ink3"><span className="min-w-0 break-words">{label}</span><Info text={info} /></p>
      <p className={`m-0 mt-1 break-words font-bold tabular-nums ${kecil ? "text-[15px]" : "text-[22px]"} ${nada || "text-ink"}`} data-testid={testid ? `${testid}-nilai` : undefined}>{nilai}</p>
      {sub && <p className="m-0 mt-0.5 break-words text-[11.5px] leading-snug text-ink3">{sub}</p>}
    </>
  );
  const cls = "min-w-0 rounded-card bg-surface p-3 text-left";
  return onClick
    ? <button type="button" onClick={onClick} data-testid={testid} className={`${cls} w-full cursor-pointer border-0 hover:bg-hovertint focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}>{isi}</button>
    : <div className={cls} data-testid={testid}>{isi}</div>;
}

export function BadgeBiaya({ status, label }) {
  return <span className={`inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[11.5px] font-semibold ${NADA_STATUS[status] ?? "bg-inset text-ink2"}`} data-testid={`status-${status}`}>{label ?? status}</span>;
}

/** Grafik batang tunggal (maksimal dua per tampilan). Data = seri yang SAMA dengan tabel/Excel; tombol Detail membuka data yang sama. */
export function Grafik({ judul, info, seri, format = angka, warna = "var(--color-accent, #4f46e5)", onDetail, labelDetail = "Detail", testid, kosongTeks = "Belum ada data pada periode ini." }) {
  const ada = seri?.some((s) => s.nilai > 0);
  const data = (seri ?? []).map((s) => ({ ...s, label: tglPendek(s.tanggal ?? s.label) }));
  return (
    <section className="min-w-0 rounded-card bg-surface p-3" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-1 text-[13.5px] font-bold text-ink">{judul}<Info text={info} /></h3>
        {onDetail && <Button size="sm" variant="secondary" className="min-h-[32px]" onClick={onDetail} data-testid={testid ? `${testid}-detail` : undefined}>{labelDetail}</Button>}
      </div>
      {ada ? (
        <div className="mt-2 h-[170px] w-full min-w-0" role="img" aria-label={`${judul}: ${data.length} hari, total ${format(data.reduce((a, s) => a + s.nilai, 0))}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line, #e5e7eb)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={18} />
              <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => (v >= 1e6 ? `${v / 1e6}jt` : v >= 1e3 ? `${v / 1e3}rb` : v)} allowDecimals={false} />
              <Tooltip formatter={(v) => [format(v), judul]} labelFormatter={(l) => `Tanggal ${l}`} />
              <Bar dataKey="nilai" fill={warna} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="m-0 mt-3 text-[12.5px] text-ink3" data-testid={testid ? `${testid}-kosong` : undefined}>{kosongTeks}</p>}
    </section>
  );
}

/** Filter lanjutan di panel terlipat; jumlah filter aktif tampil di judul. */
export function PanelLanjut({ jumlah = 0, children, testid = "filter-lanjut" }) {
  return (
    <details className="min-w-0 rounded-card bg-surface px-3 py-2" data-testid={testid}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-semibold text-ink2"><ChevronDown size={14} aria-hidden />Filter lanjutan{jumlah > 0 ? ` (${jumlah} aktif)` : ""}</summary>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </details>
  );
}

export const selectCls = "h-9 min-w-0 w-full rounded-btn border border-line bg-transparent px-2.5 text-[13px] text-ink";

export function Paginasi({ page, pageSize, total, onPage }) {
  const akhir = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between gap-2 text-[12.5px] text-ink2" aria-label="Halaman" data-testid="paginasi">
      <span>{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} dari {angka(total)}</span>
      <span className="flex items-center gap-1">
        <Button size="sm" variant="secondary" className="min-h-[34px]" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={14} aria-hidden /></Button>
        <span className="px-1 tabular-nums">{page}/{akhir}</span>
        <Button size="sm" variant="secondary" className="min-h-[34px]" disabled={page >= akhir} onClick={() => onPage(page + 1)} aria-label="Halaman berikutnya"><ChevronRight size={14} aria-hidden /></Button>
      </span>
    </nav>
  );
}

/** Pemuat data bergaya "kunci query": hanya respons terbaru yang dipakai (tab/periode berganti cepat tidak menimpa). */
export function useMuat(muat, kunci, aktif = true) {
  const [s, setS] = useState({ data: null, loading: false, error: "" });
  const seq = useRef(0);
  useEffect(() => {
    if (!aktif) return undefined;
    const mine = ++seq.current;
    setS((p) => ({ data: p.data, loading: true, error: "" }));
    muat().then((d) => { if (mine === seq.current) setS({ data: d, loading: false, error: "" }); }).catch((e) => { if (mine === seq.current) setS({ data: null, loading: false, error: e.message || "Gagal memuat" }); });
    return () => { seq.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci, aktif]);
  return s;
}

export function Galat({ pesan }) { return pesan ? <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" role="alert">{pesan}</div> : null; }
export function Memuat({ tampil }) { return tampil ? <p className="m-0 text-[12.5px] text-ink3" data-testid="memuat">Memuat laporan…</p> : null; }
export function DasarTanggal({ teks, testid = "dasar-tanggal" }) { return teks ? <p className="m-0 text-[11.5px] leading-snug text-ink3" data-testid={testid}>Dasar tanggal: {teks}</p> : null; }
