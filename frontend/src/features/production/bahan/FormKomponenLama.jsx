import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ImagePlus, X } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { kunciIdempoten, parseJumlah } from "@/features/production/orderProduksiModel.js";
import { HASIL_KOMPONEN, SATUAN_KOMPONEN, SUMBER, asalKomponen } from "@/features/production/bahan/bahanModel.js";

// KOMPONEN LAMA dari unit INI (bukan stok). Nama bebas (katalog hanya saran, tidak wajib), jumlah + satuan, kondisi singkat, hasil nyata (dipakai kembali / dikembalikan / disimpan / dibuang),
// bagian pekerjaan (hanya bila dipakai kembali), catatan, foto bukti (opsional). Dipakai untuk mencatat BARU dan untuk KOREKSI berjejak (alasan wajib, isian dimulai dari versi terkini).
const FIELD = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-ink3";

export default function FormKomponenLama({ unitId, kodeUnit, awal = null, versi = null, itemId = null, meta, onSelesai, onBatal, pembetulan = null }) { // pembetulan: { alasan, tanggal, siap } hanya untuk unit TERKIRIM (alasan + tanggal pemakaian dilaporkan wajib; dampak sudah dilihat)
  const koreksi = !!itemId;
  const [f, setF] = useState(() => ({ name: awal?.name ?? "", qty: awal ? String(awal.qty) : "", uom: awal?.uom ?? "PCS", condition: awal?.condition ?? "", workPart: awal?.workPart ?? "", outcome: awal?.outcome ?? "REUSED", note: awal?.note ?? "", materialId: awal?.materialId ?? null }));
  const [foto, setFoto] = useState(() => (awal?.photos ?? []).map((p) => ({ url: p.url, previewUrl: p.previewUrl }))); const [alasan, setAlasan] = useState("");
  const [saran, setSaran] = useState([]); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(""); const [ok, setOk] = useState("");
  const kunciRef = useRef(null); const sigRef = useRef(""); const kirimRef = useRef(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setGalat(""); };
  const dipakai = f.outcome === "REUSED";
  const satuan = useMemo(() => (meta?.satuan?.length ? meta.satuan : SATUAN_KOMPONEN), [meta]);

  // Saran dari katalog (opsional): tidak mengubah apa pun, hanya mengisi nama + satuan + tautan katalog bila dipilih.
  useEffect(() => {
    const q = f.name.trim(); if (q.length < 3 || f.materialId) { setSaran([]); return undefined; }
    let batal = false; const t = setTimeout(async () => { try { const d = await api.getKatalogBahanProduksi({ q, limit: "5" }); if (!batal) setSaran(d.rows || []); } catch { if (!batal) setSaran([]); } }, 300);
    return () => { batal = true; clearTimeout(t); };
  }, [f.name, f.materialId]);

  const sig = JSON.stringify([f, foto.map((p) => p.url), alasan, itemId, versi, pembetulan?.alasan ?? null, pembetulan?.tanggal ?? null]);
  if (sigRef.current !== sig) { sigRef.current = sig; kunciRef.current = null; }
  const v = parseJumlah(f.qty);
  const lengkap = (!pembetulan || pembetulan.siap) && f.name.trim().length >= 2 && v !== null && v > 0 && f.condition.trim().length >= 2 && (!dipakai || f.workPart.trim().length >= 2) && (!koreksi || alasan.trim().length >= 3);

  async function pilihFoto(e) {
    const files = [...(e.target.files || [])].slice(0, Math.max(0, (meta?.fotoMaks ?? 3) - foto.length)); if (!files.length) return;
    setSibuk(true); setGalat("");
    try { const fd = new FormData(); files.forEach((x) => fd.append("files", x)); const r = await api.unggahFotoKomponenLama(unitId, fd); setFoto((x) => [...x, ...(r.items || [])].slice(0, meta?.fotoMaks ?? 3)); }
    catch (er) { setGalat(er.message || "Foto gagal diunggah."); } finally { setSibuk(false); e.target.value = ""; }
  }

  async function kirim() {
    if (kirimRef.current || !lengkap) return;
    kirimRef.current = true; setSibuk(true); setGalat(""); setOk("");
    const data = { name: f.name.trim(), qty: v, uom: f.uom, condition: f.condition.trim(), outcome: f.outcome, workPart: dipakai ? f.workPart.trim() : f.workPart.trim() || undefined, note: f.note.trim() || undefined, materialId: f.materialId || undefined, photoUrls: foto.map((p) => p.url), ...(pembetulan ? { alasanPembetulan: pembetulan.alasan, tanggalPemakaian: pembetulan.tanggal } : {}) };
    try {
      kunciRef.current ??= kunciIdempoten("komp");
      const r = koreksi ? await api.koreksiKomponenLama(unitId, itemId, { expectedVersion: versi, data, reason: alasan.trim() }, kunciRef.current) : await api.catatKomponenLama(unitId, data, kunciRef.current);
      setOk(koreksi ? "Koreksi tercatat sebagai versi baru. Catatan sebelumnya tetap ada di riwayat." : `Tercatat: ${data.name}. Bukan stok.${pembetulan ? ` Dilaporkan dipakai ${pembetulan.tanggal}; waktu pencatatan = sekarang.` : ""}`); kunciRef.current = null;
      await onSelesai?.(r);
    } catch (e) { setGalat(e.code === "RIWAYAT_BERUBAH" ? `${e.message}` : e.message || "Gagal mencatat."); } finally { kirimRef.current = false; setSibuk(false); }
  }

  return (
    <div className="space-y-3" data-testid={koreksi ? "form-komponen-koreksi" : "form-komponen-lama"}>
      {!koreksi && <p className="m-0 flex items-start gap-2 rounded-btn bg-accentbg px-3 py-2 text-[12.5px] text-ink"><CheckCircle2 size={15} className="bh-b-accent mt-0.5 shrink-0" aria-hidden /><span><b>{asalKomponen(kodeUnit)}</b>. {SUMBER.LAMA.dampak}</span></p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="relative block space-y-1 sm:col-span-2"><span className={LABEL}>Nama komponen</span>
          <input value={f.name} onChange={(e) => { set("name", e.target.value); set("materialId", null); }} maxLength={120} disabled={sibuk} data-testid="komp-nama" placeholder="Mis. Pegas bongkaran sisi kiri" className={FIELD} />
          {saran.length > 0 && (
            <span className="block rounded-btn border border-line bg-surface" data-testid="komp-saran"><span className="block px-3 pt-2 text-[11.5px] text-ink3">Cocok dengan katalog? (opsional — boleh abaikan, komponen bongkaran sering tidak sama dengan bahan baru)</span>
              {saran.map((b) => <button key={b.materialId} type="button" onClick={() => { setF((x) => ({ ...x, name: b.nama, uom: SATUAN_KOMPONEN.includes(b.satuan) ? b.satuan : x.uom, materialId: b.materialId })); setSaran([]); }} className="flex min-h-[40px] w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-hovertint"><span className="truncate">{b.nama}</span><span className="text-[11.5px] text-ink3">{b.kode}</span></button>)}
            </span>
          )}
          {f.materialId && <span className="flex items-center gap-2 text-[11.5px] text-ink3">Ditautkan ke katalog (hanya rujukan nama; tidak mengurangi stok). <button type="button" className="font-medium text-accent underline" onClick={() => set("materialId", null)}>Lepas</button></span>}
        </label>
        <div className="flex gap-2"><label className="block flex-1 space-y-1"><span className={LABEL}>Jumlah</span><input inputMode="decimal" value={f.qty} onChange={(e) => set("qty", e.target.value)} disabled={sibuk} data-testid="komp-qty" className={cn(FIELD, "text-right tabular-nums")} /></label>
          <label className="block w-28 space-y-1"><span className={LABEL}>Satuan</span><select value={f.uom} onChange={(e) => set("uom", e.target.value)} disabled={sibuk} data-testid="komp-satuan" className={FIELD}>{satuan.map((s) => <option key={s} value={s}>{s}</option>)}</select></label></div>
        <label className="block space-y-1"><span className={LABEL}>Kondisi singkat</span><input value={f.condition} onChange={(e) => set("condition", e.target.value)} maxLength={200} disabled={sibuk} data-testid="komp-kondisi" placeholder="Mis. bagus, aus ringan, berkarat" className={FIELD} /></label>
      </div>
      <fieldset className="space-y-1.5" disabled={sibuk}><legend className={LABEL}>Apa yang terjadi pada komponen ini?</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {HASIL_KOMPONEN.map((h) => (
            <label key={h.key} className={cn("flex min-h-[44px] cursor-pointer items-center gap-2 rounded-btn border px-3 py-2 text-[13.5px]", f.outcome === h.key ? "border-accent bg-accentbg text-ink" : "border-line text-ink hover:bg-hovertint")}>
              <input type="radio" name="komp-hasil" value={h.key} checked={f.outcome === h.key} onChange={() => set("outcome", h.key)} data-testid={`komp-hasil-${h.key}`} className="h-4 w-4 accent-[var(--accent)]" />{h.label}
            </label>
          ))}
        </div>
        <p className="m-0 text-[12px] text-ink3" data-testid="komp-hasil-bantu">{HASIL_KOMPONEN.find((h) => h.key === f.outcome)?.bantu}</p>
      </fieldset>
      {dipakai && <label className="block space-y-1"><span className={LABEL}>Bagian pekerjaan tempat dipakai</span><input value={f.workPart} onChange={(e) => set("workPart", e.target.value)} maxLength={120} disabled={sibuk} data-testid="komp-bagian" placeholder="Mis. rangka pegas bawah, lapisan atas" className={FIELD} /></label>}
      <label className="block space-y-1"><span className={LABEL}>Catatan (opsional)</span><input value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={500} disabled={sibuk} data-testid="komp-catatan" className={FIELD} /></label>
      <div className="space-y-2">
        <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-btn border-2 border-dashed border-line px-3 py-2 text-[13px] font-medium text-ink2 hover:bg-hovertint focus-within:ring-2 focus-within:ring-accent/40">
          <ImagePlus size={16} aria-hidden /> {foto.length ? `${foto.length} foto bukti — tambah` : "Tambah foto bukti (opsional)"}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={sibuk || foto.length >= (meta?.fotoMaks ?? 3)} data-testid="komp-foto" onChange={pilihFoto} />
        </label>
        {foto.length > 0 && <ul className="m-0 flex list-none gap-2 p-0">{foto.map((p, i) => <li key={p.url} className="relative h-16 w-16 overflow-hidden rounded-btn bg-inset"><img src={p.previewUrl || p.url} alt={`Foto bukti ${i + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => setFoto((x) => x.filter((y) => y.url !== p.url))} aria-label={`Hapus foto ${i + 1}`} className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-bl bg-surface/90 text-ink"><X size={12} aria-hidden /></button></li>)}</ul>}
      </div>
      {koreksi && <label className="block space-y-1"><span className={LABEL}>Alasan koreksi (wajib)</span><input value={alasan} onChange={(e) => { setAlasan(e.target.value); setGalat(""); }} maxLength={500} disabled={sibuk} data-testid="komp-alasan" placeholder="Mis. salah hitung jumlah, seharusnya 4" className={FIELD} /></label>}
      {galat && <p role="alert" data-testid="komp-galat" className="m-0 flex items-start gap-2 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />{galat}</p>}
      {ok && <p role="status" data-testid="komp-ok" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{ok}</p>}
      <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" onClick={onBatal} disabled={sibuk}>Batal</Button>
        <Button className="bh-cta min-h-[44px]" data-testid="komp-simpan" disabled={sibuk || !lengkap} onClick={kirim}>{sibuk ? "Menyimpan…" : koreksi ? "Simpan koreksi" : "Catat komponen lama (bukan stok)"}</Button></div>
    </div>
  );
}
