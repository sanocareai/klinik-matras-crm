import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CalendarClock, GripVertical, MoreHorizontal, Target, User } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { UnitPhotoThumb } from "@/features/production/UnitPhotoThumb.jsx";
import { SUMBER, aksiUtama, badgeBahan, badgePosisi, labelHari } from "@/features/production/rencana/rencanaModel.js";

// Kartu unit RINGKAS untuk antrean dan kalender: pelanggan, kode unit, pekerjaan, target, PIC/meja, bahan, posisi fisik, SATU tindakan berikutnya.
// Foto hanya thumbnail kecil. Klik badan kartu membuka ruang kerja unit yang sudah live. Semua tindakan tersedia lewat tombol (tanpa seret).
const mejaTeks = (m) => (m ? `Meja ${String(m).replace("TABLE_", "")}` : null);

function MenuLainnya({ item, izin, onMenu }) {
  const [open, setOpen] = useState(false); const [pos, setPos] = useState(null); const ref = useRef(null); const listRef = useRef(null);
  const toggle = () => { if (!open && ref.current) { const r = ref.current.getBoundingClientRect(); setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 200) }); } setOpen((v) => !v); };
  useEffect(() => {
    if (!open) return undefined;
    const tutup = (e) => { if (!ref.current?.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false); };
    const tutupGulir = () => setOpen(false); window.addEventListener("scroll", tutupGulir, true); window.addEventListener("resize", tutupGulir);
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", tutup); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", tutup); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", tutupGulir, true); window.removeEventListener("resize", tutupGulir); };
  }, [open]);
  const isi = [
    { k: "BUKA", t: "Buka ruang kerja unit" },
    ...(item.sumber === "ADMIN" || item.jadwal?.sumber === "ADMIN" ? [{ k: "RIWAYAT", t: "Riwayat jadwal" }] : []),
    ...(izin.jadwalkan && (item.sumber === "ADMIN" || item.jadwal?.sumber === "ADMIN") ? [{ k: "KELUARKAN", t: "Keluarkan dari jadwal" }] : []),
    ...(izin.aktivasiV2 && item.sumber !== "V2" && item.jalur !== "V2" && !item.perluKeputusan ? [{ k: "AKTIVASI", t: "Aktifkan Pelaksanaan Meja…" }] : []),
    ...(item.sumber === "V2" ? [{ k: "PAPAN_V2", t: "Kelola di Papan Meja" }] : []),
  ];
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" className="min-h-[36px] min-w-[36px] px-1.5" aria-label={`Tindakan lain untuk ${item.unitCode}`} aria-haspopup="menu" aria-expanded={open} data-testid="kartu-menu" onClick={toggle}><MoreHorizontal size={16} aria-hidden /></Button>
      {open && pos && createPortal(
        <ul role="menu" ref={listRef} style={{ position: "fixed", top: pos.top, left: pos.left }} className="z-[9999] min-w-[190px] rounded-btn border border-line bg-surface p-1 shadow-lg" data-testid="kartu-menu-isi">
          {isi.map((m) => <li key={m.k} role="none"><button type="button" role="menuitem" className="block w-full rounded-btn px-3 py-2 text-left text-[13px] text-ink hover:bg-inset focus-visible:bg-inset" data-aksi={m.k} onClick={() => { setOpen(false); onMenu(m.k, item); }}>{m.t}</button></li>)}
        </ul>, document.body)}
    </div>
  );
}

export default function KartuUnit({ item, izin = {}, mode = "antrean", onAksi, onBuka, draggable = false, onDragStart, onDragEnd, dense = false }) {
  const aksi = aksiUtama(item, izin);
  const bahan = badgeBahan(item.bahan); const posisi = badgePosisi(item.diterima, item.posisi?.label);
  const sumber = item.sumber || item.jadwal?.sumber || null;
  const jadwal = item.jadwal || (item.tanggal ? { sumber: item.sumber, tanggal: item.tanggal, meja: item.meja } : null);
  const meja = mejaTeks(jadwal?.meja || item.meja);
  const perhatian = (item.perhatian || []).filter((f) => !String(f.code).startsWith("BAHAN")); // bahan sudah tampil sebagai badge berwarna
  return (
    <article
      className={`group relative flex gap-2.5 rounded-card border bg-surface p-2.5 ${perhatian.length ? "border-orange/50" : "border-line"} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      data-testid="kartu-unit" data-unit={item.unitCode} data-sumber={sumber || ""} data-tab={item.tab || ""}
      draggable={draggable || undefined} onDragStart={draggable ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.unitId); onDragStart?.(item); } : undefined} onDragEnd={draggable ? () => onDragEnd?.() : undefined}
    >
      {draggable && <GripVertical size={14} className="mt-1 shrink-0 text-ink3" aria-hidden />}
      {!dense && <UnitPhotoThumb photoUrl={item.photoUrl} size={40} />}
      <div className="min-w-0 flex-1">
        <button type="button" className="block w-full min-w-0 text-left" onClick={() => onBuka?.(item)} aria-label={`Buka ruang kerja ${item.unitCode}`} data-testid="kartu-buka">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13.5px] font-semibold text-ink">{item.customerName || "Pelanggan tanpa nama"}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink3">{item.unitCode}</span>
          </span>
          <span className="block truncate text-[12px] text-ink2">{(item.pekerjaan || []).join(" · ") || "Layanan belum tercatat"}{item.ukuran ? ` · ${item.ukuran}` : ""}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {sumber && <Badge variant={sumber === "V2" ? "green" : "accent"} className={sumber === "V2" ? "" : "rc-b-accent"} title={SUMBER[sumber]?.dampak} data-testid="kartu-sumber">{SUMBER[sumber]?.label}</Badge>}
          {jadwal?.tanggal && mode === "antrean" && <Badge variant="neutral"><CalendarClock size={11} aria-hidden /> {labelHari(jadwal.tanggal)}{meja ? ` · ${meja}` : ""}</Badge>}
          {mode !== "antrean" && meja && <Badge variant="neutral">{meja}</Badge>}
          {item.targetSelesai && <Badge variant="neutral" title="Target selesai"><Target size={11} aria-hidden /> {labelHari(item.targetSelesai)}</Badge>}
          {item.pic && <Badge variant="neutral" title="PIC"><User size={11} aria-hidden /> {item.pic}</Badge>}
          <Badge variant={posisi.tone}>{posisi.text}</Badge>
          <Badge variant={bahan.tone} className={bahan.tone === "red" ? "rc-b-red" : ""}>{bahan.text}</Badge>
          {item.prioritas?.key && item.prioritas.key !== "NORMAL" && <Badge variant="red" className="rc-b-red">{item.prioritas.label}</Badge>}
        </div>
        {mode === "antrean" && item.alasan && <p className="m-0 mt-1 line-clamp-2 text-[12px] text-ink3" data-testid="kartu-alasan">{item.alasan}</p>}
        {perhatian.length > 0 && <p className="m-0 mt-1 flex items-start gap-1 text-[12px] text-orange" data-testid="kartu-perhatian"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {perhatian.map((f) => f.text).join(" · ")}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        <MenuLainnya item={item} izin={izin} onMenu={(k, it) => onAksi?.(k, it)} />
        <Button size="sm" variant={aksi.kind === "JADWALKAN" ? "primary" : "secondary"} className={`min-h-[36px] whitespace-nowrap ${aksi.kind === "JADWALKAN" ? "rc-cta" : "rc-sek"}`} data-testid="kartu-aksi" data-kind={aksi.kind} onClick={() => onAksi?.(aksi.kind, item)}>{aksi.label}</Button>
      </div>
    </article>
  );
}
