import React, { useRef, useState } from "react";
import { Pencil, Undo2 } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { formatJumlah, kunciIdempoten, waktuWib } from "@/features/production/orderProduksiModel.js";
import { tglIndo, uraiDilaporkan } from "@/features/production/bahan/pembetulanModel.js";
import { SUMBER, asalKomponen } from "@/features/production/bahan/bahanModel.js";
import FormKomponenLama from "@/features/production/bahan/FormKomponenLama.jsx";

// Daftar komponen lama (versi terkini) + koreksi berjejak / batal (salah input). Total pemakaian kembali dipisah dari komponen yang dilepas tanpa dipakai. Tidak ada tombol hapus: riwayat tidak dihapus.
const NADA_HASIL = { REUSED: "accent", RETURNED_TO_CUSTOMER: "neutral", KEPT_WITH_UNIT: "neutral", DISCARDED: "neutral" };

function Batal({ unitId, item, bisa, onSelesai, onTutup }) {
  const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(""); const kunci = useRef(null); const sig = useRef("");
  if (sig.current !== alasan) { sig.current = alasan; kunci.current = null; }
  async function kirim() {
    if (sibuk || alasan.trim().length < 3) return; setSibuk(true); setGalat("");
    try { kunci.current ??= kunciIdempoten("komp-batal"); await api.batalKomponenLama(unitId, item.itemId, { expectedVersion: item.version, reason: alasan.trim() }, kunci.current); await onSelesai(); }
    catch (e) { setGalat(e.message || "Gagal membatalkan."); } finally { setSibuk(false); }
  }
  return (
    <div className="space-y-2 rounded-btn bg-inset px-3 py-3" data-testid="komp-batal-form">
      <p className="m-0 text-[12.5px] text-ink2">Batalkan karena salah input. Catatan ini <b>tidak dihapus</b>: tetap tampil di riwayat sebagai “dibatalkan” dengan alasan Anda.</p>
      <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} disabled={sibuk || !bisa} placeholder="Alasan (wajib)" aria-label="Alasan pembatalan" data-testid="komp-batal-alasan" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[13.5px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
      {galat && <p role="alert" className="m-0 text-[12px] text-red">{galat}</p>}
      <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" onClick={onTutup} disabled={sibuk}>Batal</Button><Button className="bh-cta min-h-[44px]" data-testid="komp-batal-kirim" disabled={sibuk || alasan.trim().length < 3} onClick={kirim}>{sibuk ? "Memproses…" : "Batalkan catatan ini"}</Button></div>
    </div>
  );
}

export default function KomponenLamaDaftar({ unitId, kodeUnit, data, bolehUbah, aktif, meta, onDone }) {
  const [mode, setMode] = useState(null); // { itemId, aksi: "koreksi" | "batal" }
  const [lihatBatal, setLihatBatal] = useState(false);
  const { items = [], dibatalkan = [], total } = data;
  const selesai = async () => { setMode(null); await onDone(); };
  if (!items.length && !dibatalkan.length) return null;
  return (
    <div className="space-y-3" data-testid="komponen-lama-daftar">
      {total && (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink2" data-testid="komponen-lama-total">
          <span><b className="text-ink">{total.pemakaianKembali.jumlahItem}</b> dipakai kembali{total.pemakaianKembali.perSatuan.length > 0 && ` (${total.pemakaianKembali.perSatuan.map((p) => `${formatJumlah(p.qty)} ${p.uom}`).join(" + ")})`}</span>
          <span><b className="text-ink">{total.dilepasTidakDipakai.jumlahItem}</b> dilepas tanpa dipakai{total.dilepasTidakDipakai.jumlahItem > 0 && ` (${[total.dilepasTidakDipakai.dikembalikan && `${total.dilepasTidakDipakai.dikembalikan} dikembalikan`, total.dilepasTidakDipakai.disimpan && `${total.dilepasTidakDipakai.disimpan} disimpan`, total.dilepasTidakDipakai.dibuang && `${total.dilepasTidakDipakai.dibuang} dibuang`].filter(Boolean).join(", ")})`}</span>
          <span className="text-ink3">Tidak dijumlahkan dengan bahan baru; tidak memengaruhi stok.</span>
        </p>
      )}
      <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0">
        {items.map((it) => (
          <li key={it.itemId} className="space-y-2 px-3 py-2.5" data-testid="komponen-lama-baris" data-outcome={it.outcome}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">{it.name}</span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{formatJumlah(it.qty)} {it.uom}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]"><Badge variant={NADA_HASIL[it.outcome]}>{it.outcomeLabel}</Badge><Badge variant="neutral" className="text-ink" title={SUMBER.LAMA.dampak}>Bukan stok</Badge>{it.version > 1 && <Badge variant="orange">Dikoreksi · versi {it.version}</Badge>}</div>
            <p className="m-0 text-[12px] text-ink3">{asalKomponen(kodeUnit)} · kondisi: {it.condition}{it.workPart ? ` · dipakai di: ${it.workPart}` : ""}{it.note ? ` · ${it.note}` : ""}</p>
            <p className="m-0 text-[12px] text-ink3">{it.oleh || "—"} · {uraiDilaporkan(it.note) ? "dicatat " : ""}{waktuWib(it.at)}{uraiDilaporkan(it.note) ? <> · <b className="text-ink2" data-testid="komponen-dilaporkan">dilaporkan dipakai {tglIndo(uraiDilaporkan(it.note))}</b></> : null}{it.reason ? ` · alasan koreksi: ${it.reason}` : ""}</p>
            {it.photos?.length > 0 && <ul className="m-0 flex list-none gap-1.5 p-0">{it.photos.map((p, i) => <li key={p.url}><a href={p.previewUrl || p.url} target="_blank" rel="noreferrer" aria-label={`Lihat foto bukti ${i + 1}`}><img src={p.previewUrl || p.url} alt={`Foto bukti ${it.name} ${i + 1}`} className="h-14 w-14 rounded-btn object-cover" loading="lazy" /></a></li>)}</ul>}
            {bolehUbah && aktif && mode?.itemId !== it.itemId && (
              <div className="flex flex-wrap gap-2">
                <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={() => setMode({ itemId: it.itemId, aksi: "koreksi" })} data-testid="komp-koreksi-buka"><Pencil size={13} aria-hidden /> Koreksi</Button>
                <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={() => setMode({ itemId: it.itemId, aksi: "batal" })} data-testid="komp-batal-buka"><Undo2 size={13} aria-hidden /> Salah input, batalkan</Button>
              </div>
            )}
            {mode?.itemId === it.itemId && mode.aksi === "koreksi" && <FormKomponenLama unitId={unitId} kodeUnit={kodeUnit} awal={it} versi={it.version} itemId={it.itemId} meta={meta} onSelesai={selesai} onBatal={() => setMode(null)} />}
            {mode?.itemId === it.itemId && mode.aksi === "batal" && <Batal unitId={unitId} item={it} bisa onSelesai={selesai} onTutup={() => setMode(null)} />}
          </li>
        ))}
      </ul>
      {dibatalkan.length > 0 && (
        <div>
          <button type="button" className="text-[12.5px] font-medium text-accent underline-offset-2 hover:underline" onClick={() => setLihatBatal((v) => !v)} aria-expanded={lihatBatal} data-testid="komp-dibatalkan-toggle">{lihatBatal ? "Sembunyikan" : "Tampilkan"} yang dibatalkan ({dibatalkan.length})</button>
          {lihatBatal && <ul className="m-0 mt-2 list-none space-y-1 p-0" data-testid="komponen-lama-dibatalkan">{dibatalkan.map((d) => <li key={d.itemId} className="text-[12px] text-ink3">Dibatalkan: {d.name} {formatJumlah(d.qty)} {d.uom} · {d.oleh || "—"} · {waktuWib(d.at)} · alasan: {d.reason}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
