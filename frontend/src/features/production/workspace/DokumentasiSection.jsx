import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ImagePlus, Info } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { DOC_GROUP_KEYS, DOC_GROUP_LABEL, DOC_SOURCE_LABEL, DOC_STATUS, docFriendlyError, suggestCategory, thumbMeta } from "@/features/production/documentation.js";
import { UnitPhotoPanel } from "@/features/production/UnitPhotoThumb.jsx";
import { kunciIdempoten } from "@/features/production/orderProduksiModel.js";

// DOKUMENTASI dari Ruang Kerja Unit. Sumber bukti RESMI = Aplikasi Dokumentasi (production-v2/documentation): matriks kategori dari server, foto disimpan sebagai baris dokumentasi
// (DOC_*) yang TIDAK menyelesaikan tahap, TIDAK meluluskan QC, dan TIDAK membuat bukti serah ke Gudang. Unggahan Admin tercatat sumber "Manual" dengan kategori yang dipilih jelas.
// Unit tanpa pekerjaan di alur Meja tidak punya matriks: bagian ini menjelaskan alasannya (bukan tombol yang pasti gagal) dan hanya menawarkan foto identitas unit.

export const CATATAN_DOKUMENTASI = "Foto di sini tercatat sebagai dokumentasi (sumber Manual) pada kategori yang Anda pilih. Tidak menyelesaikan tahap, tidak meluluskan QC, dan tidak membuat bukti serah ke Gudang.";

function Thumb({ item, label }) {
  const m = thumbMeta(item);
  return (
    <li className="min-w-0" data-testid="doc-thumb">
      <a href={item.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-btn bg-inset outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={`Lihat foto ${label}`}>
        {item.kind === "video" ? <span className="flex h-full items-center justify-center text-[12px] text-ink3">Video</span> : <img src={item.url} alt={item.caption || label} loading="lazy" className="h-full w-full object-cover" />}
      </a>
      <p className="m-0 mt-1 truncate text-[11.5px] text-ink3" title={`${m.source} · ${m.time} · ${m.actor}`}>{m.source} · {m.time}</p>
    </li>
  );
}

export default function DokumentasiSection({ unitId, ruang, unit, onDone, onKeBagian }) {
  const dok = ruang?.dokumentasi; const runId = dok?.runId;
  const [detail, setDetail] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(false);
  const [kategori, setKategori] = useState(""); const [berkas, setBerkas] = useState([]); const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false); const [ok, setOk] = useState(""); const [kirimGalat, setKirimGalat] = useState("");
  const kunciRef = useRef(null); const sidikRef = useRef(""); const kirimRef = useRef(false);

  const muat = useCallback(async () => {
    if (!dok?.tersedia || !runId) return;
    setMemuat(true); setGalat("");
    try { const d = await api.getProductionV2DocDetail(runId); setDetail(d); setKategori((k) => k || suggestCategory(d.categories, "BEFORE")?.key || ""); } catch (e) { setGalat(docFriendlyError(e)); } finally { setMemuat(false); }
  }, [dok?.tersedia, runId]);
  useEffect(() => { muat(); }, [muat]);

  const pratinjau = useMemo(() => berkas.map((f) => ({ f, url: URL.createObjectURL(f) })), [berkas]);
  useEffect(() => () => pratinjau.forEach((p) => URL.revokeObjectURL(p.url)), [pratinjau]);

  const sidik = `${kategori}|${berkas.map((f) => `${f.name}:${f.size}`).join(",")}|${catatan}`;
  if (sidikRef.current !== sidik) { sidikRef.current = sidik; kunciRef.current = null; }

  async function kirim() {
    if (kirimRef.current || !kategori || !berkas.length) return;
    kirimRef.current = true; setSibuk(true); setKirimGalat(""); setOk("");
    try {
      kunciRef.current ??= kunciIdempoten("doc-admin");
      const up = await api.uploadProductionV2Documentation(runId, berkas);
      const items = (up.items || []).map((i, idx) => ({ url: i.url, caption: catatan.trim() || undefined, order: idx + 1 }));
      await api.submitProductionV2Documentation(runId, { category: kategori, items }, kunciRef.current);
      setOk(`${items.length} foto tercatat di kategori ${detail?.categories?.find((c) => c.key === kategori)?.label ?? kategori}.`); setBerkas([]); setCatatan(""); kunciRef.current = null;
      await muat(); onDone?.();
    } catch (e) { setKirimGalat(docFriendlyError(e)); } finally { kirimRef.current = false; setSibuk(false); }
  }

  // Tanpa matriks: alasan jujur + foto identitas (jalur resmi lain).
  if (!dok?.tersedia) {
    return (
      <div className="space-y-4" data-testid="dok-tidak-tersedia">
        <p role="note" className="m-0 flex items-start gap-2 rounded-btn bg-inset px-4 py-3 text-[13.5px] text-ink2"><Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />{dok?.alasan || "Dokumentasi belum tersedia untuk unit ini."}</p>
        {ruang?.izin?.unggahFotoIdentitas && <UnitPhotoPanel unitId={unitId} photoUrl={null} canUpload onUploaded={() => onDone?.()} />}
      </div>
    );
  }

  const kategoriDipilih = detail?.categories?.find((c) => c.key === kategori);
  return (
    <div className="space-y-5" data-testid="dok-bagian">
      {dok.alasan && <p role="note" data-testid="dok-alasan" className="m-0 flex items-start gap-2 rounded-btn bg-inset px-4 py-3 text-[13px] text-ink2"><Info size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />{dok.alasan}</p>}
      {galat && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{galat} <button type="button" className="ml-2 font-semibold underline" onClick={muat}>Coba lagi</button></p>}
      {memuat && !detail && <div className="h-32 animate-pulse rounded-card bg-inset motion-reduce:animate-none" aria-label="Memuat dokumentasi" />}

      {dok.bolehUnggah && detail && (
        <section className="space-y-3 rounded-card border border-line px-4 py-4" aria-label="Tambah dokumentasi" data-testid="dok-form">
          <h3 className="m-0 flex items-center gap-2 text-[14.5px] font-semibold text-ink"><Camera size={16} aria-hidden /> Tambah dokumentasi</h3>
          <p className="m-0 text-[12.5px] text-ink3">{CATATAN_DOKUMENTASI}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="block text-[12px] font-medium text-ink3">Kategori foto</span>
              <select value={kategori} onChange={(e) => { setKategori(e.target.value); setOk(""); }} disabled={sibuk} data-testid="dok-kategori" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
                {DOC_GROUP_KEYS.map((g) => (
                  <optgroup key={g} label={DOC_GROUP_LABEL[g]}>
                    {(detail.categories || []).filter((c) => c.group === g && c.applicable).map((c) => <option key={c.key} value={c.key}>{c.label}{c.status === "KURANG" ? ` (kurang ${c.missing})` : ""}</option>)}
                  </optgroup>
                ))}
              </select></label>
            <label className="block space-y-1"><span className="block text-[12px] font-medium text-ink3">Keterangan (opsional)</span>
              <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={200} disabled={sibuk} data-testid="dok-keterangan" placeholder="Mis. kondisi pegas setelah dibongkar" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
          </div>
          <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-btn border-2 border-dashed border-line px-3 py-3 text-[13.5px] font-medium text-ink2 hover:bg-hovertint focus-within:ring-2 focus-within:ring-accent/40">
            <ImagePlus size={16} aria-hidden /> {berkas.length ? `${berkas.length} foto dipilih — ganti pilihan` : "Pilih foto (JPG, PNG, atau WEBP)"}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={sibuk} data-testid="dok-berkas" onChange={(e) => { setBerkas([...e.target.files].slice(0, 6)); setOk(""); setKirimGalat(""); }} />
          </label>
          {pratinjau.length > 0 && <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-6">{pratinjau.map((p, i) => <li key={p.url} className="aspect-square overflow-hidden rounded-btn bg-inset"><img src={p.url} alt={`Pratinjau ${i + 1}`} className="h-full w-full object-cover" /></li>)}</ul>}
          {kategoriDipilih && <p className="m-0 text-[12.5px] text-ink3">Kategori <b className="text-ink2">{kategoriDipilih.label}</b>: {kategoriDipilih.count} dari minimum {kategoriDipilih.min} foto.</p>}
          {kirimGalat && <p role="alert" data-testid="dok-galat" className="m-0 flex items-start gap-2 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />{kirimGalat}</p>}
          {ok && <p role="status" data-testid="dok-ok" className="m-0 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />{ok}</p>}
          <div className="flex justify-end"><Button type="button" className="min-h-[44px]" data-testid="dok-kirim" disabled={sibuk || !kategori || !berkas.length} onClick={kirim}>{sibuk ? "Mengirim…" : `Kirim ${berkas.length || ""} foto`.trim()}</Button></div>
        </section>
      )}

      {detail && (
        <div className="space-y-4" data-testid="dok-matriks">
          <p className="m-0 text-[12.5px] text-ink3">Kelengkapan: <b className="text-ink2">{detail.docs?.satisfied ?? 0}</b> dari <b className="text-ink2">{detail.docs?.required ?? 0}</b> foto minimum yang sudah waktunya. Foto dari tahap, QC, dan driver dihitung otomatis; tidak perlu diunggah ulang.</p>
          {DOC_GROUP_KEYS.map((g) => {
            const cats = (detail.categories || []).filter((c) => c.group === g);
            if (!cats.length) return null;
            return (
              <section key={g} aria-label={DOC_GROUP_LABEL[g]} className="space-y-2">
                <h3 className="m-0 text-[13px] font-semibold uppercase tracking-[0.05em] text-ink3">{DOC_GROUP_LABEL[g]}</h3>
                <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2" >
                  {cats.map((c) => {
                    const st = DOC_STATUS[c.status] || DOC_STATUS.MENUNGGU;
                    return (
                      <li key={c.key} className={cn("rounded-btn bg-inset px-3 py-3", !c.applicable && "opacity-60")} data-testid="dok-kategori-baris" data-kategori={c.key} data-status={c.status}>
                        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="m-0 text-[13.5px] font-semibold text-ink">{c.label}</p><p className="m-0 text-[12px] tabular-nums text-ink3">{c.count} / min {c.min} foto{c.status === "KURANG" ? ` · kurang ${c.missing}` : ""}</p></div><Badge variant={st.variant}>{st.label}</Badge></div>
                        {c.applicable && c.items?.length > 0 && <ul className="m-0 mt-2 grid list-none grid-cols-4 gap-1.5 p-0 sm:grid-cols-5">{c.items.slice(0, 10).map((it, i) => <Thumb key={`${it.url}-${i}`} item={it} label={`${c.label} ${i + 1}`} />)}</ul>}
                        {c.applicable && c.items?.length > 10 && <p className="m-0 mt-1 text-[11.5px] text-ink3">+{c.items.length - 10} foto lain di Aplikasi Dokumentasi.</p>}
                        {!c.applicable && <p className="m-0 mt-1 text-[12px] text-ink3">Tidak berlaku untuk unit ini.</p>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <p className="m-0 text-[11.5px] text-ink3">Sumber: {Object.values(DOC_SOURCE_LABEL).join(" · ")}. Koreksi foto dilakukan lewat Aplikasi Dokumentasi.</p>
        </div>
      )}
    </div>
  );
}
