import React, { useRef, useState } from "react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, parseJumlah, pesanGalatAdopsi, waktuWib } from "@/features/production/orderProduksiModel.js";
import { tglIndo, uraiDilaporkan } from "@/features/production/bahan/pembetulanModel.js";
import { ASAL_UMUM, SATUAN_KOMPONEN } from "@/features/production/bahan/bahanModel.js";
import RekonsiliasiPanel from "@/features/production/bahan/RekonsiliasiPanel.jsx";
import "@/features/production/bahan/bahan.css";

// Daftar pemakaian SEMENTARA pada satu unit (sumber terpisah dari bahan baru dan komponen lama; tidak dijumlahkan). Status jelas pada tiap baris.
// Salah input: KOREKSI (lama dibatalkan + baru dibuat, alasan wajib) atau BATALKAN (alasan wajib). Catatan yang dibatalkan tidak lagi menjadi bukti "Sudah dikerjakan".
const NADA = { PERLU_REKONSILIASI: "orange", DIREKONSILIASI: "green", DIBATALKAN: "neutral" };
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

function FormKoreksi({ item, onBatal, onSelesai }) {
  const [qty, setQty] = useState(String(item.qty).replace(".", ",")); const [uom, setUom] = useState(item.uom); const [asal, setAsal] = useState(item.originNote || ""); const [catatan, setCatatan] = useState(item.note || ""); const [alasan, setAlasan] = useState("");
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const kirimRef = useRef(false); const kunciRef = useRef(null); const sidikRef = useRef("");
  const jumlah = parseJumlah(qty); const tertaut = !!item.tertautKatalog; const terkunci = !!item.proposalId || tertaut;
  const berubah = jumlah !== item.qty || uom !== item.uom || asal.trim() !== (item.originNote || "") || catatan.trim() !== (item.note || "");
  const valid = jumlah !== null && jumlah > 0 && berubah && alasan.trim().length >= 3 && (!tertaut || asal.trim().length >= 2);
  const sidik = `${jumlah}|${uom}|${asal.trim()}|${catatan.trim()}|${alasan.trim()}`;
  if (sidikRef.current !== sidik) { sidikRef.current = sidik; kunciRef.current = null; } // isian berubah = niat baru; isian sama (klik ulang/retry) = kunci sama
  async function kirim() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null); kunciRef.current ??= kunciIdempoten("koreksi-sem");
    try { await api.koreksiPemakaianSementara(item.id, { qty: jumlah, uom, originNote: asal.trim() || undefined, note: catatan.trim() || undefined, alasan: alasan.trim() }, kunciRef.current); await onSelesai?.(); } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  return (
    <div className="mt-2 space-y-2 rounded-btn bg-surface px-3 py-3" data-testid="sementara-koreksi-form">
      <p className="m-0 text-[12.5px] text-ink2">Koreksi membuat catatan BARU dan membatalkan yang lama (tetap tersimpan, dengan alasan). Stok tidak berubah. Nama bahan{terkunci ? " dan satuan" : ""} tidak diubah di sini.{tertaut ? " Bahan katalog tetap sama; asal barang wajib." : ""}</p>
      <div className="flex gap-2">
        <label className="flex-1"><span className="mb-1 block text-[12px] text-ink3">Jumlah dipakai</span><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="koreksi-qty" className={cn(kolom, "text-right tabular-nums")} /></label>
        <label className="w-32"><span className="mb-1 block text-[12px] text-ink3">Satuan</span><select value={uom} onChange={(e) => setUom(e.target.value)} disabled={terkunci} className={cn(kolom, "pr-1")}>{SATUAN_KOMPONEN.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Asal barang">{ASAL_UMUM.map((a) => <button key={a} type="button" aria-pressed={asal === a} onClick={() => setAsal(asal === a ? "" : a)} className={cn("min-h-[40px] rounded-chip px-3 text-[12.5px] font-medium", asal === a ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{a}</button>)}</div>
      <input value={asal} onChange={(e) => setAsal(e.target.value)} maxLength={300} placeholder="Asal barang" aria-label="Asal barang" className={kolom} />
      <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={500} placeholder="Catatan (opsional)" aria-label="Catatan" className={kolom} />
      <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder="Alasan koreksi (wajib)" aria-label="Alasan koreksi" data-testid="koreksi-alasan" className={kolom} />
      {galat && <p role="alert" data-testid="koreksi-galat" className="m-0 text-[12.5px] text-red">{pesanGalatAdopsi(galat).teks}</p>}
      <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" disabled={sibuk} onClick={onBatal}>Kembali</Button><Button className="bh-cta min-h-[44px]" data-testid="koreksi-simpan" disabled={sibuk || !valid} onClick={kirim}>{sibuk ? "Menyimpan…" : "Simpan koreksi"}</Button></div>
    </div>
  );
}

function Baris({ item, bolehCatat, bolehGudang, aktif, onDone }) {
  const [mode, setMode] = useState(null); // null | "batal" | "koreksi" | "rekon"
  const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const kirimRef = useRef(false);
  async function batalkan() {
    if (kirimRef.current || alasan.trim().length < 3) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    try { await api.batalPemakaianSementara(item.id, alasan.trim()); setMode(null); await onDone?.(); } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }
  const perlu = item.status === "PERLU_REKONSILIASI";
  const bisaBatalSelesai = item.status === "DIREKONSILIASI" && item.resolusi === "TANPA_STOK" && bolehGudang;
  const labelStatus = item.dikoreksi ? "Dikoreksi (diganti catatan baru)" : item.statusLabel;
  return (
    <li className="px-3 py-2.5" data-testid="sementara-baris" data-status={item.status} data-dikoreksi={item.dikoreksi ? "1" : "0"}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1"><span className={cn("block text-[13px] font-medium text-ink", item.status === "DIBATALKAN" && "line-through decoration-ink3")}>{item.name}</span>
          {item.tertautKatalog && <span className="block text-[12px] font-medium text-ink" data-testid="sementara-tertaut-katalog">Bahan katalog {item.bahanKatalog?.kode ?? ""} · stok belum diketahui</span>}
          <span className="block text-[12px] text-ink2">{formatJumlah(item.qty)} {item.uom} · asal: {item.originNote || "belum diisi"}{item.hasilKoreksi ? " · hasil koreksi" : ""}</span></span>
        <Badge variant={NADA[item.status] || "neutral"} className={perlu ? "bh-b-orange" : undefined} data-testid="sementara-status">{labelStatus}</Badge>
      </div>
      <p className="m-0 mt-0.5 text-[11.5px] text-ink3">Dicatat {item.oleh || "—"}{uraiDilaporkan(item.note) ? <> {waktuWib(item.recordedAt)} · <b className="text-ink2" data-testid="sementara-dilaporkan">dilaporkan dipakai {tglIndo(uraiDilaporkan(item.note))}</b></> : <> · dipakai {waktuWib(item.usedAt)}</>}{item.note ? ` · ${item.note}` : ""}</p>
      {item.status === "DIREKONSILIASI" && <p className="m-0 mt-0.5 text-[12px] text-ink2" data-testid="sementara-selesai">{item.resolusiLabel} oleh {item.diselesaikanOleh || "—"}, {waktuWib(item.diselesaikanAt)}{item.catatanPenyelesaian ? ` — ${item.catatanPenyelesaian}` : ""}</p>}
      {item.status === "DIBATALKAN" && <p className="m-0 mt-0.5 text-[12px] text-ink2" data-testid="sementara-batal-info">{item.dikoreksi ? "Dikoreksi" : "Dibatalkan (salah input)"} oleh {item.dibatalkanOleh || "—"}, {waktuWib(item.dibatalkanAt)} — {String(item.alasanBatal || "").replace(/^Dikoreksi:\s*/, "")}. Tidak lagi dihitung sebagai bukti pekerjaan.</p>}
      {(perlu || bisaBatalSelesai) && !mode && (bolehCatat || bolehGudang) && aktif && (
        <div className="mt-2 flex flex-wrap gap-2">
          {perlu && bolehGudang && <Button variant="secondary" size="sm" className="min-h-[40px]" data-testid="sementara-selesaikan" onClick={() => setMode("rekon")}>Selesaikan (Gudang)</Button>}
          {perlu && bolehCatat && <Button variant="secondary" size="sm" className="min-h-[40px]" data-testid="sementara-koreksi-buka" onClick={() => setMode("koreksi")}>Koreksi</Button>}
          {(bolehCatat || bisaBatalSelesai) && <Button variant="tertiary" size="sm" className="min-h-[40px]" data-testid="sementara-batal-buka" onClick={() => setMode("batal")}>Batalkan (salah input)</Button>}
        </div>
      )}
      {perlu && !mode && !bolehGudang && <p className="m-0 mt-1 text-[11.5px] text-ink3">Menunggu Gudang menyelesaikan sumber stoknya.</p>}
      {mode === "batal" && (
        <div className="mt-2 space-y-2 rounded-btn bg-inset px-3 py-2" data-testid="sementara-batal-form">
          <p className="m-0 text-[12px] text-ink2">Catatan ini tidak lagi dihitung sebagai bukti “Sudah dikerjakan”. Baris tetap tersimpan dengan alasan.</p>
          <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder="Alasan pembatalan (wajib)" aria-label="Alasan pembatalan" data-testid="sementara-batal-alasan" className={kolom} />
          {galat && <p role="alert" className="m-0 text-[12.5px] text-red">{pesanGalatAdopsi(galat).teks}</p>}
          <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" disabled={sibuk} onClick={() => setMode(null)}>Kembali</Button><Button className="min-h-[44px]" data-testid="sementara-batal-ya" disabled={sibuk || alasan.trim().length < 3} onClick={batalkan}>{sibuk ? "Membatalkan…" : "Batalkan catatan"}</Button></div>
        </div>
      )}
      {mode === "koreksi" && <FormKoreksi item={item} onBatal={() => setMode(null)} onSelesai={async () => { setMode(null); await onDone?.(); }} />}
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
