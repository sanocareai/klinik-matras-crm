import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { FokusOverlay } from "@/components/ui/fokus-overlay.jsx";
import { cn } from "@/lib/utils.js";
import { MODE_LABEL, MODE_DESKRIPSI } from "./opnameLogic.js";

// BUAT SESI STOCK OPNAME (sesi model 2): tiga pilihan jelas — Opname penuh (sekali pilih), Per kelompok (centang kelompok), Cycle Count (cari + centang bahan, maks. 50).
// Pratinjau cakupan SELALU tampil sebelum sesi dibuat (dari server, baca-saja). Daftar Material ID disimpan di sesi saat dibuat; perubahan master sesudahnya tidak mengubah cakupan.
// Opname penuh / per kelompok mengikutkan bahan aktif yang SALDONYA DILACAK secara fisik (ada jejak stok) — bukan ditebak dari nama kategori. Bahan tidak dilacak tampil dengan alasannya dan bisa diikutkan beralasan.
const inputCls = "w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent max-sm:min-h-11";

export default function BuatSesiOpname({ open, onClose, onCreated }) {
  const [mode, setMode] = useState(""); const [groups, setGroups] = useState([]); const [ikutkan, setIkutkan] = useState(new Set()); const [ikutkanAlasan, setIkutkanAlasan] = useState(""); const [pilihan, setPilihan] = useState(new Map());
  const [q, setQ] = useState(""); const [bahan, setBahan] = useState({ items: [], total: 0, kelompok: [] }); const [kelFilter, setKelFilter] = useState("");
  const [pratinjau, setPratinjau] = useState(null); const [memuat, setMemuat] = useState(false); const [galat, setGalat] = useState("");
  const [tgl, setTgl] = useState(""); const [blind, setBlind] = useState(true); const [catatan, setCatatan] = useState(""); const [mulai, setMulai] = useState(false); const [petugas, setPetugas] = useState(""); const [staf, setStaf] = useState([]);
  const [sibuk, setSibuk] = useState(false); const [semuaKel, setSemuaKel] = useState([]);
  const urut = useRef(0);

  useEffect(() => { if (!open) return; setMode(""); setGroups([]); setIkutkan(new Set()); setIkutkanAlasan(""); setPilihan(new Map()); setQ(""); setPratinjau(null); setGalat(""); setTgl(""); setBlind(true); setCatatan(""); setMulai(false); setPetugas(""); setSibuk(false);
    api.getUsers().then(setStaf).catch(() => {});
    api.pratinjauCakupanOpname({ mode: "FULL" }).then((r) => setSemuaKel(r.ringkasan.perKelompok)).catch(() => {}); // jumlah bahan aktif per kelompok untuk kartu kelompok
  }, [open]);

  // Pratinjau (baca-saja) tidak boleh hilang hanya karena alasan belum diketik: server menolak "ikutkan" tanpa alasan, jadi pratinjau memakai alasan sementara. Membuat sesi tetap WAJIB alasan asli (bisaBuat).
  const alasanAsli = ikutkanAlasan.trim();
  const badan = useMemo(() => ({ mode, groups, ...(ikutkan.size ? { ikutkanTakDilacak: [...ikutkan], ikutkanAlasan: alasanAsli.length >= 3 ? alasanAsli : "(alasan belum diisi)" } : {}), materialIds: [...pilihan.keys()] }), [mode, groups, ikutkan, alasanAsli, pilihan]);
  const lengkap = mode === "FULL" || (mode === "GROUP" && groups.length > 0) || (mode === "ITEMS" && pilihan.size > 0);
  useEffect(() => {
    if (!open || !lengkap) { setPratinjau(null); return undefined; }
    const n = ++urut.current; setMemuat(true); setGalat("");
    const t = setTimeout(async () => {
      try { const r = await api.pratinjauCakupanOpname(badan); if (n === urut.current) setPratinjau(r); } catch (e) { if (n === urut.current) { setPratinjau(null); setGalat(e.message); } } finally { if (n === urut.current) setMemuat(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [open, lengkap, badan]);

  useEffect(() => {
    if (!open || mode !== "ITEMS") return undefined;
    const t = setTimeout(() => { api.getBahanOpname({ q, kelompok: kelFilter, limit: 40 }).then(setBahan).catch((e) => setGalat(e.message)); }, 250);
    return () => clearTimeout(t);
  }, [open, mode, q, kelFilter]);

  const ubahGrup = (k) => setGroups((g) => (g.includes(k) ? g.filter((x) => x !== k) : [...g, k]));
  const ubahIkutkan = (id) => setIkutkan((s0) => { const n = new Set(s0); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alasanIkutkanKurang = ikutkan.size > 0 && ikutkanAlasan.trim().length < 3;
  const ubahBahan = (b) => setPilihan((p) => { const n = new Map(p); if (n.has(b.id)) n.delete(b.id); else if (n.size < (pratinjau?.batasCycleCount ?? 50)) n.set(b.id, b); return n; });
  const penuhAktif = pratinjau?.sesiPenuhAktif && mode === "FULL";
  const bisaBuat = lengkap && !!pratinjau && !memuat && !sibuk && pratinjau.ringkasan.masuk > 0 && !penuhAktif && !alasanIkutkanKurang;

  async function buat() {
    if (!bisaBuat) return; setSibuk(true); setGalat("");
    try {
      const r = await api.createStockCount({ ...badan, ...(ikutkan.size ? { ikutkanAlasan: alasanAsli } : {}), scheduledDate: tgl || undefined, blindCount: blind, assignedToId: petugas || undefined, notes: catatan || undefined, langsungMulai: mulai });
      onCreated?.(r);
    } catch (e) { setGalat(e.message); setSibuk(false); }
  }

  const r = pratinjau?.ringkasan;
  return (
    <FokusOverlay open={open} onClose={onClose} title="Jadwalkan Stock Opname" subtitle="Pilih cakupan, cek pratinjau, lalu buat sesi." testid="fokus-buat-opname"
      footer={<div className="flex flex-wrap items-center justify-end gap-2">
        {galat && <p role="alert" className="mr-auto m-0 text-[12px] text-red" data-testid="galat-buat">{galat}</p>}
        <Button variant="ghost" size="sm" onClick={onClose} className="max-sm:min-h-11">Batal</Button>
        <Button size="sm" onClick={buat} disabled={!bisaBuat} className="max-sm:min-h-11" data-testid="buat-sesi">{sibuk ? <Loader2 size={14} className="animate-spin" /> : null} {mode === "FULL" ? "Buat sesi opname penuh" : "Buat sesi"}{r ? ` (${r.masuk} bahan)` : ""}</Button>
      </div>}>
      <div className="space-y-4">
        <fieldset className="m-0 space-y-2 border-0 p-0">
          <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">1 · Cakupan</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Cakupan sesi">
            {Object.keys(MODE_LABEL).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} data-testid={`mode-${k}`}
                className={cn("rounded-btn border px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11", mode === k ? "border-accent bg-accentbg" : "border-line bg-surface hover:bg-hovertint")}>
                <span className="block text-[13.5px] font-semibold text-ink">{MODE_LABEL[k]}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink2">{MODE_DESKRIPSI[k]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {mode === "GROUP" && (
          <fieldset className="m-0 space-y-1.5 border-0 p-0" data-testid="pilih-kelompok">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Pilih kelompok bahan</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{semuaKel.map((k) => (
              <label key={k.kode} className={cn("flex items-center gap-2 rounded-btn border px-2.5 py-2 text-[12.5px] max-sm:min-h-11", groups.includes(k.kode) ? "border-accent bg-accentbg" : "border-line bg-surface")}>
                <input type="checkbox" checked={groups.includes(k.kode)} onChange={() => ubahGrup(k.kode)} data-testid={`kelompok-${k.kode}`} /> <span className="min-w-0 flex-1">{k.label}</span><span className="text-ink3">{k.aktif}</span>
              </label>))}</div>
          </fieldset>
        )}

        {mode === "ITEMS" && (
          <fieldset className="m-0 space-y-2 border-0 p-0" data-testid="pilih-bahan">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Cari dan centang bahan ({pilihan.size} dipilih, maksimal 50)</legend>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-0 flex-1"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode atau nama bahan…" aria-label="Cari bahan" data-testid="cari-bahan" className={cn(inputCls, "pl-8")} /></div>
              <select value={kelFilter} onChange={(e) => setKelFilter(e.target.value)} aria-label="Saring kelompok" className={cn(inputCls, "w-auto")}><option value="">Semua kelompok</option>{bahan.kelompok.map((k) => <option key={k.kode} value={k.kode}>{k.label}</option>)}</select>
            </div>
            {pilihan.size > 0 && <div className="flex flex-wrap gap-1.5" data-testid="bahan-terpilih">{[...pilihan.values()].map((b) => <button key={b.id} type="button" onClick={() => ubahBahan(b)} className="rounded-chip bg-accentbg px-2 py-1 text-[11.5px] font-semibold text-accent max-sm:min-h-9" aria-label={`Hapus ${b.kode}`}>{b.kode} ✕</button>)}</div>}
            <ul className="m-0 max-h-[34vh] list-none space-y-1 overflow-y-auto rounded-btn border border-line p-1.5" data-testid="daftar-bahan">
              {bahan.items.map((b) => (
                <li key={b.id}><label className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] hover:bg-hovertint max-sm:min-h-11"><input type="checkbox" checked={pilihan.has(b.id)} onChange={() => ubahBahan(b)} data-testid="centang-bahan" />
                  <span className="font-semibold text-ink">{b.kode}</span><span className="min-w-0 flex-1 truncate text-ink2">{b.nama}</span><span className="text-[11px] text-ink3">{b.kelompok.label}</span></label></li>))}
              {bahan.items.length === 0 && <li className="px-2 py-3 text-[12.5px] text-ink3">Tidak ada bahan yang cocok.</li>}
            </ul>
            {bahan.total > bahan.items.length && <p className="m-0 text-[11.5px] text-ink3">Menampilkan {bahan.items.length} dari {bahan.total}. Persempit dengan pencarian atau kelompok.</p>}
            <p className="m-0 text-[11.5px] text-ink3">Untuk cakupan lebih besar dari 50 bahan, pakai Per kelompok atau Opname penuh.</p>
          </fieldset>
        )}

        {lengkap && (
          <section aria-label="Pratinjau cakupan" className="space-y-2 rounded-btn border border-line bg-inset p-3" data-testid="pratinjau-cakupan" aria-busy={memuat}>
            <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">2 · Pratinjau (belum ada yang dibuat)</h3>{memuat && <Loader2 size={13} className="animate-spin text-ink3" aria-label="Memuat pratinjau" />}</div>
            {r && (
              <>
                <p className="m-0 text-[13.5px] text-ink" data-testid="pratinjau-masuk"><b className="text-[18px]">{r.masuk}</b> bahan akan masuk sesi {MODE_LABEL[r.mode].toLowerCase()} <span className="text-ink3">(dari {r.bahanAktif} bahan aktif)</span></p>
                <div className="flex flex-wrap gap-1.5 text-[12px]">
                  <Badge variant="neutral" data-testid="pratinjau-belum-kelompok">Belum dikelompokkan: {r.belumDikelompokkan.masuk} (tetap ikut)</Badge>
                  <Badge variant="neutral" data-testid="pratinjau-nonaktif">Nonaktif: {r.nonaktif.jumlah} (tidak ikut)</Badge>
                  {r.pengecualian.totalBahanDikecualikan > 0 && <Badge variant="orange" data-testid="pratinjau-pengecualian">Dikecualikan: {r.pengecualian.totalBahanDikecualikan}</Badge>}
                  {r.tanpaCatatanStok > 0 && <Badge variant="neutral">Belum ada catatan stok: {r.tanpaCatatanStok}</Badge>}
                  {r.saldoMinus > 0 && <Badge variant="red">Saldo minus: {r.saldoMinus}</Badge>}
                </div>
                {r.mode !== "ITEMS" && <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-0.5 p-0 text-[12px] text-ink2 sm:grid-cols-3" data-testid="pratinjau-kelompok">{r.perKelompok.filter((k) => k.masuk > 0).map((k) => <li key={k.kode} className="flex justify-between"><span>{k.label}</span><b className="text-ink">{k.masuk}</b></li>)}</ul>}
                {r.dasarCakupan && <p className="m-0 text-[12px] text-ink2" data-testid="dasar-cakupan">{r.dasarCakupan}</p>}
                {r.mode !== "ITEMS" && r.tidakDilacak.jumlah > 0 && (
                  <details className="rounded-btn border border-line bg-surface px-3 py-1" data-testid="pratinjau-tak-dilacak" open={ikutkan.size > 0}>
                    <summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-semibold text-ink">{r.tidakDilacak.jumlah} bahan aktif tidak dilacak — {ikutkan.size ? `${ikutkan.size} diikutkan` : "tidak ikut sesi"}</summary>
                    <p className="m-0 mb-1.5 text-[11.5px] text-ink3">{r.tidakDilacak.alasanUmum} Centang bila ternyata barangnya ada di rak.</p>
                    <ul className="m-0 max-h-[30vh] list-none space-y-0.5 overflow-y-auto p-0">{r.tidakDilacak.daftar.map((x) => (
                      <li key={x.materialId}><label className="flex cursor-pointer items-center gap-2 rounded-btn px-1.5 py-1 text-[12.5px] hover:bg-hovertint max-sm:min-h-11"><input type="checkbox" checked={ikutkan.has(x.materialId)} onChange={() => ubahIkutkan(x.materialId)} data-testid="centang-ikutkan" /><span className="font-semibold text-ink">{x.kode}</span><span className="min-w-0 flex-1 truncate text-ink2">{x.nama}</span></label></li>))}</ul>
                    {ikutkan.size > 0 && <label className="mt-1.5 block pb-2 text-[12px] text-ink2">Alasan mengikutkan (wajib)<input value={ikutkanAlasan} onChange={(e) => setIkutkanAlasan(e.target.value)} placeholder="mis. ada barangnya di rak C" data-testid="alasan-ikutkan" className={cn(inputCls, "mt-1")} /></label>}
                  </details>)}
                {r.mode === "ITEMS" && r.peringatanItems?.length > 0 && <p role="status" className="m-0 text-[12px] text-orange" data-testid="peringatan-items">{r.peringatanItems.length} bahan pilihan tidak punya jejak stok ({r.peringatanItems.map((x) => x.kode).join(", ")}). Tetap boleh dihitung.</p>}
                <p className="m-0 text-[11.5px] text-ink3">Daftar bahan disimpan di sesi saat dibuat; perubahan master sesudahnya tidak mengubah cakupan (bahan baru tampil sebagai “di luar cakupan sesi” untuk diputuskan).</p>
                {penuhAktif && <p role="alert" className="m-0 flex items-start gap-1.5 text-[12.5px] font-semibold text-red" data-testid="sesi-penuh-aktif"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Sudah ada sesi Opname penuh berjalan ({pratinjau.sesiPenuhAktif.countNumber}). Selesaikan atau batalkan dulu.</p>}
                {!penuhAktif && r.masuk > 0 && <p className="m-0 flex items-center gap-1.5 text-[12px] text-green"><CheckCircle2 size={13} aria-hidden /> Cakupan siap dibuat.</p>}
              </>
            )}
          </section>
        )}

        {lengkap && (
          <fieldset className="m-0 space-y-2 border-0 p-0">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">3 · Jadwal dan pengaturan</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-[12px] text-ink2">Tanggal jadwal<input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} className={cn(inputCls, "mt-1")} data-testid="tgl-jadwal" /></label>
              <label className="block text-[12px] text-ink2">Ditugaskan ke<select value={petugas} onChange={(e) => setPetugas(e.target.value)} className={cn(inputCls, "mt-1")}><option value="">Belum ditugaskan</option>{staf.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} data-testid="blind" /> Blind count — penghitung tidak melihat saldo sistem sampai hitungan diserahkan</label>
            <label className="flex items-center gap-2 text-[12.5px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={mulai} onChange={(e) => setMulai(e.target.checked)} data-testid="langsung-mulai" /> Langsung mulai hitung</label>
            <label className="block text-[12px] text-ink2">Catatan<textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} className={cn(inputCls, "mt-1")} /></label>
          </fieldset>
        )}
      </div>
    </FokusOverlay>
  );
}
