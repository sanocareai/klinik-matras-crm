import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, pesanGalatAdopsi, waktuWib } from "@/features/production/orderProduksiModel.js";
import { unitDetailPath } from "@/lib/legacyProductionRoutes.js";
import RekonsiliasiPanel from "@/features/production/bahan/RekonsiliasiPanel.jsx";
import "@/features/production/bahan/bahan.css";

// USULAN BAHAN & PEMAKAIAN SEMENTARA (Gudang). Dua antrean dengan status jelas:
//   • Usulan bahan baru dari Produksi — Gudang menyetujui (bahan dibuat di katalog TANPA saldo/penerimaan/pergerakan/biaya/jurnal), menggabung ke bahan yang sudah ada, atau menolak.
//   • Pemakaian sementara — bahan yang sudah terlanjur dipakai tetapi belum punya sumber stok resmi. Gudang menyelesaikan lewat jalur resmi yang sudah ada lalu menautkannya, atau menyatakan bukan stok Gudang.
// Halaman ini TIDAK menulis pergerakan stok. Stok baru hanya lewat Penerimaan Barang / Pengeluaran Material yang resmi.
const NADA_USULAN = { MENUNGGU_GUDANG: "orange", DISETUJUI: "green", DIGABUNG: "accent", DITOLAK: "neutral" };
const NADA_SEMENTARA = { PERLU_REKONSILIASI: "orange", DIREKONSILIASI: "green", DIBATALKAN: "neutral" };
const JENIS = [["RAW_MATERIAL", "Bahan baku"], ["WIP", "Setengah jadi"], ["FINISHED_GOODS", "Barang jadi"], ["CONSUMABLE", "Habis pakai"]];
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

function Keputusan({ usulan, onSelesai }) {
  const [mode, setMode] = useState(null); // setujui | gabung | tolak
  const [kode, setKode] = useState(usulan.saranKode || ""); const [sub, setSub] = useState(usulan.itemGroup || usulan.subJenisBawaan || ""); const [jenis, setJenis] = useState("RAW_MATERIAL"); const [catatan, setCatatan] = useState("");
  const [cari, setCari] = useState(""); const [hasil, setHasil] = useState([]); const [tujuan, setTujuan] = useState(null);
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const kirimRef = useRef(false);

  useEffect(() => {
    if (mode !== "gabung" || cari.trim().length < 2) { setHasil([]); return undefined; }
    let batal = false; const t = setTimeout(() => { api.getKatalogBahanProduksi({ q: cari.trim(), limit: "8" }).then((d) => { if (!batal) setHasil(d.rows || []); }).catch(() => { if (!batal) setHasil([]); }); }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [mode, cari]);

  const valid = mode === "setujui" ? kode.trim().length >= 2 && !!sub : mode === "gabung" ? !!tujuan && tujuan.satuan === usulan.unit : mode === "tolak" ? catatan.trim().length >= 3 : false;
  async function kirim() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    try {
      const body = mode === "setujui" ? { keputusan: "SETUJUI", kode: kode.trim().toUpperCase(), itemGroup: sub, category: jenis, catatan: catatan.trim() || undefined }
        : mode === "gabung" ? { keputusan: "GABUNG", materialId: tujuan.materialId, catatan: catatan.trim() || undefined } : { keputusan: "TOLAK", catatan: catatan.trim() };
      await api.putuskanUsulanBahan(usulan.id, body); await onSelesai?.();
    } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;
  if (!mode) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="bh-cta min-h-[44px]" data-testid="usulan-setujui" onClick={() => setMode("setujui")}>Setujui (buat di katalog)</Button>
        <Button variant="secondary" className="min-h-[44px]" data-testid="usulan-gabung" onClick={() => setMode("gabung")}>Gabung ke bahan yang ada</Button>
        <Button variant="tertiary" className="min-h-[44px]" data-testid="usulan-tolak" onClick={() => setMode("tolak")}>Tolak</Button>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-3 rounded-btn border border-line bg-surface px-3 py-3" data-testid="usulan-keputusan">
      {mode === "setujui" && (
        <>
          <p className="m-0 text-[12.5px] text-ink2">Bahan dibuat di katalog <b>tanpa saldo awal</b>. Tidak ada penerimaan, pergerakan stok, biaya, atau jurnal. Stok masuk hanya lewat Penerimaan Barang yang resmi.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label><span className="mb-1 block text-[12px] text-ink3">Kode bahan</span><input value={kode} onChange={(e) => setKode(e.target.value.toUpperCase())} maxLength={60} data-testid="keputusan-kode" className={kolom} /></label>
            <label><span className="mb-1 block text-[12px] text-ink3">Sub-jenis katalog</span>
              <select value={sub} onChange={(e) => setSub(e.target.value)} data-testid="keputusan-subjenis" className={cn(kolom, "pr-1")}><option value="">— pilih —</option>{(usulan.subJenis || []).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label><span className="mb-1 block text-[12px] text-ink3">Jenis persediaan</span>
              <select value={jenis} onChange={(e) => setJenis(e.target.value)} className={cn(kolom, "pr-1")}>{JENIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
        </>
      )}
      {mode === "gabung" && (
        <div className="space-y-2">
          <p className="m-0 text-[12.5px] text-ink2">Usulan ini sama dengan bahan yang sudah ada. Tidak ada bahan baru dan tidak ada perubahan saldo. Satuan harus sama ({usulan.unit}).</p>
          <input type="search" value={cari} onChange={(e) => { setCari(e.target.value); setTujuan(null); }} placeholder="Cari bahan di katalog…" aria-label="Cari bahan tujuan" data-testid="gabung-cari" className={kolom} />
          <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0">
            {hasil.map((b) => (
              <li key={b.materialId}><button type="button" onClick={() => setTujuan(b)} aria-pressed={tujuan?.materialId === b.materialId} className={cn("flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-hovertint", tujuan?.materialId === b.materialId && "bg-accentbg")}>
                <span className="min-w-0 flex-1 text-[13px] text-ink"><b>{b.nama}</b> ({b.kode})</span><span className={cn("text-[12px]", b.satuan === usulan.unit ? "text-ink3" : "bh-bad")}>{b.satuan}{b.satuan === usulan.unit ? "" : " · beda satuan"}</span></button></li>
            ))}
            {cari.trim().length >= 2 && !hasil.length && <li className="px-3 py-3 text-center text-[13px] text-ink3">Tidak ada bahan cocok.</li>}
          </ul>
        </div>
      )}
      {mode === "tolak" && <p className="m-0 text-[12.5px] text-ink2">Usulan ditolak dengan alasan. Catatan pemakaian sementara yang terkait harus diselesaikan sebagai “bukan stok Gudang” atau dibatalkan.</p>}
      <label className="block"><span className="mb-1 block text-[12px] text-ink3">{mode === "tolak" ? "Alasan (wajib)" : "Catatan (opsional)"}</span>
        <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={500} data-testid="keputusan-catatan" className={kolom} /></label>
      {g && <p role="alert" data-testid="keputusan-galat" className="m-0 text-[12.5px] text-red">{g.teks}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px]" onClick={() => setMode(null)} disabled={sibuk}>Kembali</Button>
        <Button className="bh-cta min-h-[44px]" data-testid="keputusan-simpan" disabled={sibuk || !valid} onClick={kirim}>{sibuk ? "Menyimpan…" : mode === "setujui" ? "Setujui & buat bahan" : mode === "gabung" ? "Gabungkan" : "Tolak usulan"}</Button>
      </div>
    </div>
  );
}

function TabUsulan({ izinPutuskan }) {
  const [status, setStatus] = useState("MENUNGGU_GUDANG"); const [data, setData] = useState({ rows: [], jumlah: {}, memuat: true, galat: null });
  const muat = useCallback(async () => {
    setData((d) => ({ ...d, memuat: true }));
    try { const d = await api.getUsulanBahan({ status: status === "SEMUA" ? undefined : status }); setData({ rows: d.rows || [], jumlah: d.jumlah || {}, memuat: false, galat: null }); } catch (e) { setData((d) => ({ ...d, memuat: false, galat: e })); }
  }, [status]);
  useEffect(() => { muat(); }, [muat]);
  return (
    <div className="space-y-3" data-testid="tab-usulan">
      <div role="group" aria-label="Status usulan" className="flex flex-wrap gap-1">
        {[["MENUNGGU_GUDANG", "Menunggu Gudang"], ["DISETUJUI", "Disetujui"], ["DIGABUNG", "Digabung"], ["DITOLAK", "Ditolak"], ["SEMUA", "Semua"]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} data-testid={`usulan-filter-${k}`} className={cn("min-h-[40px] rounded-chip px-3 text-[13px] font-medium", status === k ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{l}{k !== "SEMUA" && data.jumlah[k] != null ? <span className="bh-count">{data.jumlah[k]}</span> : null}</button>
        ))}
      </div>
      {data.galat && <p role="alert" className="m-0 text-[13px] text-red">{pesanGalatAdopsi(data.galat).teks}</p>}
      {!data.memuat && !data.galat && !data.rows.length && <Card className="p-4 text-[13px] text-ink2" data-testid="usulan-kosong">{status === "MENUNGGU_GUDANG" ? "Tidak ada usulan bahan yang menunggu keputusan." : "Tidak ada usulan pada status ini."}</Card>}
      <ul className="m-0 list-none space-y-3 p-0">
        {data.rows.map((u) => (
          <li key={u.id}>
            <Card className="space-y-1 p-4" data-testid="usulan-kartu" data-status={u.status}>
              <div className="flex flex-wrap items-center gap-2"><p className="m-0 text-[15px] font-bold text-ink">{u.name}</p><Badge variant={NADA_USULAN[u.status] || "neutral"} data-testid="usulan-status">{u.statusLabel}</Badge></div>
              <p className="m-0 text-[13px] text-ink2">Kategori {u.kelompok.label} · satuan {u.unit}{u.itemGroup ? ` · ${u.itemGroup}` : ""}{u.description ? ` — ${u.description}` : ""}</p>
              <p className="m-0 text-[12px] text-ink3">Diajukan {u.diajukanOleh || "—"}, {waktuWib(u.diajukanAt)}{u.unitCode ? ` · dari unit ${u.unitCode}` : ""}</p>
              {u.status !== "MENUNGGU_GUDANG" && <p className="m-0 text-[12px] text-ink2">Diputuskan {u.diputuskanOleh || "—"}, {waktuWib(u.diputuskanAt)}{u.material ? ` · bahan ${u.material.kode}` : ""}{u.catatanKeputusan ? ` — ${u.catatanKeputusan}` : ""}</p>}
              <p className="m-0 text-[11.5px] text-ink3">{u.dampakStok}</p>
              {u.status === "MENUNGGU_GUDANG" && izinPutuskan && <Keputusan usulan={u} onSelesai={muat} />}
              {u.status === "MENUNGGU_GUDANG" && !izinPutuskan && <p className="m-0 text-[12px] text-ink3">Akun Anda hanya bisa melihat usulan ini.</p>}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabSementara({ izinRekon }) {
  const [status, setStatus] = useState("PERLU_REKONSILIASI"); const [data, setData] = useState({ rows: [], jumlah: {}, memuat: true, galat: null }); const [buka, setBuka] = useState(null);
  const muat = useCallback(async () => {
    setData((d) => ({ ...d, memuat: true }));
    try { const d = await api.getPemakaianSementara({ status }); setData({ rows: d.rows || [], jumlah: d.jumlah || {}, memuat: false, galat: null }); } catch (e) { setData((d) => ({ ...d, memuat: false, galat: e })); }
  }, [status]);
  useEffect(() => { muat(); }, [muat]);
  return (
    <div className="space-y-3" data-testid="tab-sementara">
      <p className="m-0 text-[12.5px] text-ink2">Fakta bahan yang sudah dipakai pada unit tetapi belum punya sumber stok resmi. <b>Bukan Material Issue</b> — saldo, biaya, dan jurnal belum berubah. Selesaikan dengan menautkan ke pengeluaran stok resmi, atau nyatakan bukan stok Gudang.</p>
      <div role="group" aria-label="Status pemakaian sementara" className="flex flex-wrap gap-1">
        {[["PERLU_REKONSILIASI", "Perlu rekonsiliasi"], ["DIREKONSILIASI", "Sudah direkonsiliasi"], ["DIBATALKAN", "Dibatalkan"], ["SEMUA", "Semua"]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} data-testid={`sementara-filter-${k}`} className={cn("min-h-[40px] rounded-chip px-3 text-[13px] font-medium", status === k ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{l}{k !== "SEMUA" && data.jumlah[k] != null ? <span className="bh-count">{data.jumlah[k]}</span> : null}</button>
        ))}
      </div>
      {data.galat && <p role="alert" className="m-0 text-[13px] text-red">{pesanGalatAdopsi(data.galat).teks}</p>}
      {!data.memuat && !data.galat && !data.rows.length && <Card className="p-4 text-[13px] text-ink2" data-testid="sementara-kosong">Tidak ada catatan pemakaian sementara pada status ini.</Card>}
      <ul className="m-0 list-none space-y-3 p-0">
        {data.rows.map((r) => (
          <li key={r.id}>
            <Card className="space-y-1 p-4" data-testid="sementara-kartu" data-status={r.status}>
              <div className="flex flex-wrap items-center gap-2"><p className="m-0 text-[15px] font-bold text-ink">{r.name} — {formatJumlah(r.qty)} {r.uom}</p><Badge variant={NADA_SEMENTARA[r.status] || "neutral"}>{r.statusLabel}</Badge></div>
              <p className="m-0 text-[13px] text-ink2">Unit <Link to={unitDetailPath(r.unitId)} className="text-accent underline-offset-2 hover:underline">{r.unitCode}</Link>{r.orderNumber ? ` · order ${r.orderNumber}` : ""}</p>
              <p className="m-0 text-[13px] text-ink" data-testid="sementara-asal-gudang"><b>Asal barang:</b> {r.originNote || "belum diisi oleh pencatat"}</p>
              {r.note && <p className="m-0 text-[13px] text-ink" data-testid="sementara-alasan-gudang">{r.note}</p>}
              <p className="m-0 text-[12px] text-ink3">Dicatat {r.oleh || "—"}, dipakai {waktuWib(r.usedAt)}{r.usulan ? ` · usulan bahan: ${r.usulan.status === "MENUNGGU_GUDANG" ? "menunggu keputusan" : r.usulan.status === "DITOLAK" ? "ditolak" : "sudah di katalog"}` : ""}</p>
              {r.status === "DIREKONSILIASI" && <p className="m-0 text-[12px] text-ink2">{r.resolusiLabel} oleh {r.diselesaikanOleh || "—"}, {waktuWib(r.diselesaikanAt)}{r.catatanPenyelesaian ? ` — ${r.catatanPenyelesaian}` : ""}</p>}
              {r.status === "DIBATALKAN" && <p className="m-0 text-[12px] text-ink2">Dibatalkan {r.dibatalkanOleh || "—"} — {r.alasanBatal}</p>}
              {r.status === "PERLU_REKONSILIASI" && izinRekon && buka !== r.id && <Button variant="secondary" className="mt-2 min-h-[44px]" data-testid="sementara-selesaikan" onClick={() => setBuka(r.id)}>Selesaikan</Button>}
              {r.status === "PERLU_REKONSILIASI" && !izinRekon && <p className="m-0 text-[12px] text-ink3">Akun Anda hanya bisa melihat catatan ini.</p>}
              {buka === r.id && <div className="mt-2"><RekonsiliasiPanel usage={r} onBatal={() => setBuka(null)} onSelesai={async () => { setBuka(null); await muat(); }} /></div>}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function WarehouseUsulanBahan() {
  const [tab, setTab] = useState("usulan"); const [izin, setIzin] = useState({ putuskan: false, rekonsiliasi: false }); const [versi, setVersi] = useState(0);
  useEffect(() => {
    let batal = false;
    Promise.allSettled([api.getUsulanBahan({ limit: "1" }), api.getPemakaianSementara({ limit: "1" })]).then(([u, s]) => { if (!batal) setIzin({ putuskan: !!u.value?.izin?.putuskan, rekonsiliasi: !!s.value?.izin?.rekonsiliasi }); });
    return () => { batal = true; };
  }, []);
  return (
    <PageContainer>
      <PageHeader title="Usulan Bahan" subtitle="Bahan baru yang diusulkan Produksi dan pemakaian sementara yang menunggu rekonsiliasi. Halaman ini tidak mengubah saldo stok."
        actions={<Button variant="ghost" size="sm" onClick={() => setVersi((v) => v + 1)} className="max-sm:min-h-11" data-testid="usulan-muat-ulang"><RefreshCw size={14} aria-hidden /> Muat ulang</Button>} />
      <PageBody>
        <div role="tablist" aria-label="Antrean" className="mb-4 flex gap-1">
          {[["usulan", "Usulan bahan"], ["sementara", "Pemakaian sementara"]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`tab-${k}`} onClick={() => setTab(k)} className={cn("min-h-[44px] rounded-btn px-4 text-[14px] font-medium", tab === k ? "bg-accent text-white bh-chip-on" : "bg-inset text-ink hover:bg-hovertint")}>{l}</button>
          ))}
        </div>
        {tab === "usulan" ? <TabUsulan key={`u${versi}`} izinPutuskan={izin.putuskan} /> : <TabSementara key={`s${versi}`} izinRekon={izin.rekonsiliasi} />}
      </PageBody>
    </PageContainer>
  );
}
