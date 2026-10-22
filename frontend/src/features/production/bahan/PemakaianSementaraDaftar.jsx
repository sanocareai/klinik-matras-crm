import React, { useRef, useState } from "react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { formatJumlah, pesanGalatAdopsi, waktuWib } from "@/features/production/orderProduksiModel.js";
import RekonsiliasiPanel from "@/features/production/bahan/RekonsiliasiPanel.jsx";
import "@/features/production/bahan/bahan.css";

// Daftar pemakaian SEMENTARA pada satu unit (sumber terpisah dari bahan baru dan komponen lama; tidak dijumlahkan). Status jelas pada tiap baris.
const NADA = { PERLU_REKONSILIASI: "orange", DIREKONSILIASI: "green", DIBATALKAN: "neutral" };

function Baris({ item, bolehCatat, bolehGudang, aktif, onDone }) {
  const [mode, setMode] = useState(null); // null | "batal" | "rekon"
  const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const kirimRef = useRef(false);
  async function batalkan() {
    if (kirimRef.current || alasan.trim().length < 3) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    try { await api.batalPemakaianSementara(item.id, alasan.trim()); setMode(null); await onDone?.(); } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  const perlu = item.status === "PERLU_REKONSILIASI";
  return (
    <li className="px-3 py-2.5" data-testid="sementara-baris" data-status={item.status}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-ink">{item.name}</span>
          <span className="block text-[12px] text-ink2">{formatJumlah(item.qty)} {item.uom}{item.originNote ? ` · asal: ${item.originNote}` : ""}</span></span>
        <Badge variant={NADA[item.status] || "neutral"} className={item.status === "PERLU_REKONSILIASI" ? "bh-b-orange" : undefined} data-testid="sementara-status">{item.statusLabel}</Badge>
      </div>
      <p className="m-0 mt-0.5 text-[11.5px] text-ink3">Dicatat {item.oleh || "—"} · dipakai {waktuWib(item.usedAt)}{item.note ? ` · ${item.note}` : ""}</p>
      {item.status === "DIREKONSILIASI" && <p className="m-0 mt-0.5 text-[12px] text-ink2" data-testid="sementara-selesai">{item.resolusiLabel} oleh {item.diselesaikanOleh || "—"}, {waktuWib(item.diselesaikanAt)}{item.catatanPenyelesaian ? ` — ${item.catatanPenyelesaian}` : ""}</p>}
      {item.status === "DIBATALKAN" && <p className="m-0 mt-0.5 text-[12px] text-ink2">Dibatalkan oleh {item.dibatalkanOleh || "—"}, {waktuWib(item.dibatalkanAt)} — {item.alasanBatal}</p>}
      {perlu && !mode && (bolehCatat || bolehGudang) && aktif && (
        <div className="mt-2 flex flex-wrap gap-2">
          {bolehGudang && <Button variant="secondary" size="sm" className="min-h-[40px]" data-testid="sementara-selesaikan" onClick={() => setMode("rekon")}>Selesaikan (Gudang)</Button>}
          {bolehCatat && <Button variant="tertiary" size="sm" className="min-h-[40px]" data-testid="sementara-batal-buka" onClick={() => setMode("batal")}>Batalkan (salah input)</Button>}
        </div>
      )}
      {perlu && !mode && !bolehGudang && <p className="m-0 mt-1 text-[11.5px] text-ink3">Menunggu Gudang menyelesaikan sumber stoknya.</p>}
      {mode === "batal" && (
        <div className="mt-2 space-y-2 rounded-btn bg-inset px-3 py-2" data-testid="sementara-batal-form">
          <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder="Alasan pembatalan (wajib)" aria-label="Alasan pembatalan" data-testid="sementara-batal-alasan" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
          {galat && <p role="alert" className="m-0 text-[12.5px] text-red">{pesanGalatAdopsi(galat).teks}</p>}
          <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" disabled={sibuk} onClick={() => setMode(null)}>Kembali</Button><Button className="min-h-[44px]" data-testid="sementara-batal-ya" disabled={sibuk || alasan.trim().length < 3} onClick={batalkan}>{sibuk ? "Membatalkan…" : "Batalkan catatan"}</Button></div>
        </div>
      )}
      {mode === "rekon" && <div className="mt-2"><RekonsiliasiPanel usage={item} onBatal={() => setMode(null)} onSelesai={async () => { setMode(null); await onDone?.(); }} /></div>}
    </li>
  );
}

export default function PemakaianSementaraDaftar({ data, bolehCatat, bolehGudang, aktif, onDone }) {
  return (
    <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0" data-testid="sementara-daftar">
      {data.items.map((it) => <Baris key={it.id} item={it} bolehCatat={bolehCatat} bolehGudang={bolehGudang} aktif={aktif} onDone={onDone} />)}
    </ul>
  );
}
