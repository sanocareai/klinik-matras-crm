import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, PauseCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Card } from "@/components/ui/card.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { cn } from "@/lib/utils.js";
import { alasanGagal, angka, labelStatusBatch, labelStatusOrder, ringkasHpp, ringkasProgres, rupiah, saringOrder } from "./postingHistorisModel.js";

export const Stat = ({ label, nilai, nada, sub, testid }) => (
  <div className="min-w-0 rounded-card border border-line bg-surface px-3 py-2.5" data-testid={testid}>
    <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-ink3">{label}</p>
    <p className={cn("m-0 mt-0.5 break-words text-[18px] font-semibold leading-tight text-ink", nada === "orange" && "text-orange", nada === "red" && "text-red", nada === "green" && "text-green")}>{nilai}</p>
    {sub && <p className="m-0 mt-0.5 text-[11.5px] leading-snug text-ink3">{sub}</p>}
  </div>
);

const IKON_ORDER = { MENUNGGU: CircleDashed, DIPOSTING: CheckCircle2, DILEWATI: CheckCircle2, GAGAL: XCircle };

/** Kartu HPP: PARSIAL dan selisih belum dijurnal tidak pernah disembunyikan. */
export function KartuHpp({ hpp, judul = "HPP dan jurnal" }) {
  const h = ringkasHpp(hpp);
  if (!h) return null;
  return (
    <Card className="space-y-2 px-3 py-3" data-testid="kartu-hpp">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[14px] font-semibold text-ink">{judul}</h3>
        <Badge variant={h.nada} data-testid="hpp-label">{h.label}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Nilai berbukti" nilai={h.nilai} testid="hpp-nilai" />
        <Stat label="Belum dijurnal" nilai={h.belumDijurnal} nada="orange" sub="selisih stok fisik vs buku besar" testid="hpp-belum-jurnal" />
        <Stat label="Tanpa harga / tertahan" nilai={`${h.tanpaHarga} / ${h.tertahan}`} nada={h.tanpaHarga || h.tertahan ? "orange" : undefined} sub="transaksi / catatan" testid="hpp-parsial" />
      </div>
      <p className="m-0 flex items-start gap-2 text-[12.5px] leading-snug text-ink2" data-testid="hpp-penjelasan"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />{h.penjelasan} {h.jurnal}.</p>
    </Card>
  );
}

/** Baris order pada manifest (sebelum dimulai): centang pilihan, ringkasan, rincian transaksi + catatan tertahan dengan alasannya. */
export function BarisManifest({ o, dipilih, onPilih, bolehPilih }) {
  const [buka, setBuka] = useState(false);
  return (
    <li className="border-b border-line last:border-0" data-testid="baris-manifest" data-order={o.orderNumber}>
      <div className="flex min-h-[48px] items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3">
        {bolehPilih && <input type="checkbox" className="h-5 w-5 shrink-0" checked={dipilih} onChange={(e) => onPilih(o.unitId, e.target.checked)} aria-label={`Pilih ${o.orderNumber}`} data-testid="pilih-order" />}
        <button type="button" onClick={() => setBuka((b) => !b)} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-expanded={buka}>
          {buka ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-ink">{o.orderNumber}</span>
            <span className="block text-[11.5px] text-ink3">{o.trx.length} transaksi · {rupiah(o.nilaiBerbukti)}{o.trxTanpaHarga ? ` · ${o.trxTanpaHarga} tanpa harga` : ""}</span></span>
        </button>
        {o.jumlahTertahan > 0 && <Badge variant="orange" data-testid="badge-tertahan">{o.jumlahTertahan} tertahan</Badge>}
      </div>
      {buka && (
        <div className="space-y-2 bg-inset/50 px-3 py-2 text-[12.5px]" data-testid="rincian-order">
          <ul className="m-0 list-none space-y-0.5 p-0">{o.trx.map((t) => <li key={t.kunci} className="flex flex-wrap justify-between gap-x-3 text-ink2"><span className="min-w-0 break-words"><b>{t.kodeBahan}</b> — {angka(t.qty)} {t.satuan} · {t.tanggal}</span><span>{t.nilai == null ? <span className="text-orange">tanpa harga</span> : rupiah(t.nilai)}</span></li>)}</ul>
          {o.tertahan.length > 0 && (
            <div className="rounded-btn bg-orangebg px-2 py-1.5" data-testid="tertahan-order"><p className="m-0 font-semibold text-ink">Tertahan di order ini (tidak ikut diposting):</p>
              <ul className="m-0 mt-1 list-disc pl-4">{o.tertahan.map((t, i) => <li key={i} className="text-ink2"><b>{t.nama}</b> {t.nilaiAsli}{t.alasan.length ? ` — ${t.alasan.join("; ")}` : ""}</li>)}</ul></div>
          )}
        </div>
      )}
    </li>
  );
}

/** Kartu progres batch: status dari server, bilah, hitung berhasil/gagal/menunggu, banner basi/koneksi. */
export function KartuProgres({ s, galat, diperbaruiPada, aksi }) {
  const st = labelStatusBatch(s.status); const p = ringkasProgres(s);
  const waktu = diperbaruiPada ? new Date(diperbaruiPada).toLocaleTimeString("id-ID", { hour12: false }) : "—";
  const aktif = s.status === "BERJALAN" || s.status === "MENUNGGU";
  return (
    <Card className="space-y-3 px-3 py-3" data-testid="kartu-progres" data-status={s.status} data-batch-id={s.batchId}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[14px] font-semibold text-ink">Batch posting</h3>
        <Badge variant={st.nada} data-testid="status-batch">{aktif && <Loader2 size={11} className="animate-spin" aria-hidden />}{st.label}</Badge>
        <span className="ml-auto text-[11.5px] text-ink3" data-testid="diperbarui">Diperbarui {waktu}</span>
      </div>
      <ProgressBar value={p.persen} variant={s.status === "SELESAI_SEBAGIAN" || p.gagal ? "orange" : s.status === "SELESAI" ? "green" : "accent"} aria-label="Progres batch" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Berhasil" nilai={p.berhasil} nada="green" sub={`dari ${p.total} order`} testid="hitung-berhasil" />
        <Stat label="Gagal" nilai={p.gagal} nada={p.gagal ? "red" : undefined} sub="tidak diposting" testid="hitung-gagal" />
        <Stat label="Menunggu" nilai={p.menunggu} testid="hitung-menunggu" />
        <Stat label="Transaksi" nilai={`${s.transaksiDiposting}/${s.transaksiTotal}`} sub={`${p.persen}%`} testid="hitung-trx" />
      </div>
      <p className="m-0 text-[12.5px] leading-snug text-ink2" data-testid="teks-status">{st.teks}</p>
      {galat && <p role="alert" className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-2 py-1.5 text-[12.5px] text-ink" data-testid="banner-koneksi"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />{galat}</p>}
      {s.basi && !galat && <p className="m-0 text-[12px] text-ink3">Menampilkan status terakhir yang diketahui.</p>}
      {aksi}
      <p className="m-0 text-[11.5px] text-ink3">Batch ini milik server: Anda boleh pindah halaman, membuka tab lain, memuat ulang, atau menutup tab — status yang sama akan tampil lagi saat kembali. Diajukan oleh {s.disetujuiOleh ?? "—"} · rujukan {s.rujukan ?? "—"}.</p>
    </Card>
  );
}

/** Daftar order batch dengan filter dan alasan per order. */
export function DaftarOrderBatch({ unit }) {
  const [filter, setFilter] = useState("semua");
  const hitung = useMemo(() => ({ semua: unit.length, berhasil: saringOrder(unit, "berhasil").length, gagal: saringOrder(unit, "gagal").length, menunggu: saringOrder(unit, "menunggu").length }), [unit]);
  const tampil = useMemo(() => saringOrder(unit, filter), [unit, filter]);
  return (
    <Card className="px-0 py-0" data-testid="daftar-order-batch">
      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2" role="tablist" aria-label="Saring order">
        {[["semua", "Semua"], ["berhasil", "Berhasil"], ["gagal", "Gagal"], ["menunggu", "Menunggu"]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} data-testid={`filter-${k}`} onClick={() => setFilter(k)}
            className={cn("min-h-[36px] rounded-chip px-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50", filter === k ? "bg-accentbg font-semibold text-accent" : "text-ink2 hover:bg-hovertint")}>{l} <span className="text-ink3">{hitung[k]}</span></button>
        ))}
      </div>
      {tampil.length === 0 ? <p className="m-0 px-3 py-4 text-[13px] text-ink3">Tidak ada order pada filter ini.</p> : (
        <ul className="m-0 max-h-[420px] list-none overflow-y-auto p-0">
          {tampil.map((u) => {
            const so = labelStatusOrder(u.status); const Ikon = u.status === "MENUNGGU" ? CircleDashed : IKON_ORDER[u.status] ?? PauseCircle;
            return (
              <li key={u.unitId} className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-0" data-testid="baris-order-batch" data-order={u.order} data-status={u.status}>
                <Ikon size={16} className={cn("mt-0.5 shrink-0", u.status === "GAGAL" ? "text-red" : u.status === "MENUNGGU" ? "text-ink3" : "text-green")} aria-hidden />
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold text-ink">{u.order}</span><Badge variant={so.nada}>{so.label}</Badge><span className="text-[11.5px] text-ink3">{u.trx ?? "—"} transaksi</span></div>
                  {u.status === "GAGAL" && <p className="m-0 mt-0.5 text-[12.5px] leading-snug text-red" data-testid="alasan-gagal">{alasanGagal(u.kode, u.pesan)} <span className="text-ink3">({u.kode})</span></p>}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
