import React, { useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { DasarTanggal, Galat, KartuAngka, Memuat, Paginasi, selectCls, useMuat } from "./parts.jsx";
import { angka, durasiTeks, rupiah } from "./laporanModel.js";

const PAGE_SIZE = 25;
/** Bahan & Gudang: permintaan bahan, kelengkapan pencatatan, dan pemakaian per bahan (bersih = dipakai − dikembalikan ± koreksi; susut terpisah). */
export default function TabBahan({ qs, meta, filters, onFilters, page, onPage, onKeOrderProduksi }) {
  const k = `${qs}&page=${page}&pageSize=${PAGE_SIZE}`;
  const { data: d, loading, error } = useMuat(() => api.getLaporan("bahan-gudang", k), `g:${k}`);
  const [kata, setKata] = useState(filters.qBahan ?? "");
  if (error) return <Galat pesan={error} />;
  if (!d) return <Memuat tampil={loading} />;
  const info = (key) => { const x = meta?.definisi?.find((y) => y.key === key); return x && `${x.formula} · Dasar tanggal: ${x.basis}`; };
  const top = d.rows.slice(0, 8).map((r) => ({ label: r.kode, nilai: Math.max(0, r.bersih) }));
  const maks = Math.max(0, ...top.map((t) => t.nilai));
  const kirim = () => { if (kata !== (filters.qBahan ?? "")) { onFilters({ ...filters, qBahan: kata }); onPage(1); } };
  return (
    <div className={`min-w-0 space-y-3 ${loading ? "opacity-60" : ""}`} data-testid="tab-bahan">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KartuAngka testid="gdg-menunggu" label="Permintaan bahan menunggu" nilai={angka(d.permintaan.menungguSaatIni)} sub="posisi saat ini" info={info("permintaan_menunggu")} />
        <KartuAngka testid="gdg-diterbitkan" label="Permintaan diterbitkan" nilai={angka(d.permintaan.diterbitkanPeriode)} sub={`${angka(d.permintaan.dibuatPeriode)} dibuat pada periode · respons ${durasiTeks(d.permintaan.responPermintaan)}`} />
        <KartuAngka testid="gdg-tanpa-catatan" label="Bahan belum dicatat" nilai={angka(d.kelengkapan.bahanBelumDicatat)} sub={`unit · ${angka(d.kelengkapan.bahanPerluDicek)} perlu dicek · ${angka(d.kelengkapan.hppBelumLengkap)} HPP belum lengkap`} info={info("kelengkapan")} nada={d.kelengkapan.bahanBelumDicatat > 0 ? "text-orange" : ""} onClick={onKeOrderProduksi} />
        <KartuAngka testid="gdg-masalah" label="Pemakaian bermasalah" nilai={angka(d.total.masalah)} sub={d.izinHarga ? `HPP diketahui ${rupiah(d.total.nilaiDiketahui)}` : `${angka(d.totalBahan)} bahan dipakai`} info={info("hpp_diketahui")} />
      </div>
      <form className="relative max-w-md text-[11px] font-medium text-ink3" onSubmit={(e) => { e.preventDefault(); kirim(); }}>Cari bahan
        <Search size={14} className="absolute left-2.5 top-[27px] text-ink3" aria-hidden />
        <input className={`${selectCls} mt-0.5 pl-8`} value={kata} onChange={(e) => setKata(e.target.value)} onBlur={kirim} placeholder="kode atau nama bahan" data-testid="cari-bahan" />
      </form>
      <div className="min-w-0 overflow-x-auto rounded-card bg-surface" data-testid="tabel-bahan">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink3">
            <th className="px-3 py-2">Bahan</th><th className="px-3 py-2 text-right">Dipakai</th><th className="px-3 py-2 text-right">Dikembalikan</th><th className="px-3 py-2 text-right">Koreksi</th><th className="px-3 py-2 text-right">Pemakaian bersih</th><th className="px-3 py-2 text-right">Susut</th><th className="px-3 py-2 text-right">Unit</th>{d.izinHarga && <th className="px-3 py-2 text-right">Nilai diketahui</th>}<th className="px-3 py-2 text-right">Masalah</th>
          </tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.materialId} className="border-b border-line/60" data-testid={`bahan-${r.kode}`}>
                <td className="px-3 py-2"><b>{r.bahan}</b><span className="block text-[11px] text-ink3">{r.kode}{r.guard ? " · SANO GUARD: nilai tercatat ikut dihitung; biaya perakitan belum tersedia" : ""}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{angka(r.dipakai)} {r.satuan}</td><td className="px-3 py-2 text-right tabular-nums">{angka(r.dikembalikan)}</td><td className="px-3 py-2 text-right tabular-nums">{angka(r.koreksi)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{angka(r.bersih)}</td><td className="px-3 py-2 text-right tabular-nums">{angka(r.susut)}</td><td className="px-3 py-2 text-right tabular-nums">{angka(r.unit)}</td>
                {d.izinHarga && <td className="px-3 py-2 text-right tabular-nums">{rupiah(r.nilaiDiketahui)}</td>}
                <td className="px-3 py-2 text-right tabular-nums">{r.masalah || "—"}</td>
              </tr>
            ))}
            {d.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-[13px] text-ink3">Belum ada pemakaian bahan pada periode ini.</td></tr>}
          </tbody>
        </table>
      </div>
      <Paginasi page={d.page} pageSize={d.pageSize} total={d.totalBahan} onPage={onPage} />
      {maks > 0 && (
        <Card className="p-3" data-testid="grafik-bahan"><h3 className="m-0 mb-1 text-[13.5px] font-bold text-ink">Pemakaian bersih — 8 bahan teratas pada halaman ini</h3>
          <ul className="m-0 list-none space-y-1 p-0">
            {top.map((t) => (
              <li key={t.label} className="flex items-center gap-2 text-[12px]"><span className="w-28 shrink-0 truncate text-ink2" title={t.label}>{t.label}</span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-inset"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((t.nilai / maks) * 100)}%` }} /></span>
                <span className="w-16 shrink-0 text-right tabular-nums">{angka(t.nilai)}</span></li>
            ))}
          </ul>
        </Card>
      )}
      <DasarTanggal teks={`pemakaian: ${d.dasarTanggal}; permintaan: ${d.dasarPermintaan}`} />
    </div>
  );
}
