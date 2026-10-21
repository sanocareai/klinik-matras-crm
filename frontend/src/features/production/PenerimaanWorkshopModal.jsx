import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { DAMPAK_PENERIMAAN, bolehKirimPenerimaan, kunciIdempoten, lokasiAwalPenerimaan, pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";

// "Catat unit diterima di workshop" — satu formulir untuk petugas Gudang (Penerimaan Unit) dan Admin (panel Order Produksi).
// Mencatat PENERIMAAN FISIK nyata (pelaku, waktu, lokasi). Tidak mengaktifkan Produksi V2 / Run / tahap / QC / stok — dampaknya ditulis di layar sebelum tombol ditekan.
// Satu niat = satu kunci idempotensi: klik ganda atau ulang karena sinyal putus tidak membuat catatan kedua (server juga menjaga UNIQUE per unit).

export default function PenerimaanWorkshopModal({ unit, onClose, onDone }) {
  // unit: { unitId, unitCode, orderNumber?, customerName? }
  const [pilihan, setPilihan] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [fisik, setFisik] = useState(false);
  const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);
  const kunciRef = useRef(null);
  const dikirimRef = useRef(false); // penjaga klik ganda/tiga kali yang lebih cepat dari render ulang: SATU permintaan per niat

  useEffect(() => {
    let batal = false;
    api.getPenerimaanWorkshopPilihan()
      .then((d) => { if (!batal) { setPilihan(d); setLocationId(lokasiAwalPenerimaan(d)); } })
      .catch((e) => { if (!batal) setGalat(e); });
    return () => { batal = true; };
  }, []);

  async function kirim() {
    if (dikirimRef.current || !bolehKirimPenerimaan({ fisik, locationId, sibuk })) return;
    dikirimRef.current = true;
    kunciRef.current ??= kunciIdempoten("penerimaan");
    setSibuk(true); setGalat(null);
    try {
      const hasil = await api.catatPenerimaanWorkshop(unit.unitId, { fisikDiterima: true, locationId, note: catatan.trim() || undefined }, kunciRef.current);
      onDone?.(hasil.alreadyReceived ? `Unit ${unit.unitCode} sudah tercatat diterima sebelumnya — tidak ada catatan ganda.` : `Unit ${unit.unitCode} tercatat diterima di workshop.`);
    } catch (e) { setGalat(e); } finally { dikirimRef.current = false; setSibuk(false); }
  }

  const g = galat ? pesanGalatAdopsi(galat) : null;
  const tanpaLokasi = pilihan && !pilihan.lokasi?.length;
  const field = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";
  return (
    <Modal open onOpenChange={(v) => !v && !sibuk && onClose()} title={`Unit diterima di workshop — ${unit.unitCode}`}
      description={[unit.orderNumber, unit.customerName].filter(Boolean).join(" · ") || "Catat setelah unit benar-benar sudah diterima fisik."}
      contentProps={{ "data-testid": "penerimaan-modal" }}>
      <div className="space-y-4">
        <div className="space-y-2 rounded-btn bg-inset px-3 py-3 text-[12.5px] text-ink2" data-testid="penerimaan-dampak">
          <p className="m-0 font-semibold text-ink">Yang dicatat</p>
          <ul className="m-0 list-disc space-y-0.5 pl-5">{DAMPAK_PENERIMAAN.dicatat.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="m-0 mt-2 font-semibold text-ink">Yang TIDAK terjadi</p>
          <ul className="m-0 list-disc space-y-0.5 pl-5">{DAMPAK_PENERIMAAN.tidak.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>

        <label className="block space-y-1">
          <span className="block text-[12px] font-medium text-ink3">Lokasi unit diletakkan</span>
          {pilihan === null && !galat ? <span className="block text-[12.5px] text-ink3">Memuat lokasi…</span> : tanpaLokasi
            ? <span className="block text-[12.5px] text-red">Belum ada lokasi Receiving/WIP yang aktif. Hubungi Admin Gudang.</span>
            : (
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={sibuk} data-testid="penerimaan-lokasi" className={field}>
                <option value="">— Pilih lokasi —</option>
                {(pilihan?.lokasi || []).map((l) => <option key={l.id} value={l.id}>{l.code}{l.zone ? ` · ${l.zone}` : ""}</option>)}
              </select>
            )}
          {pilihan?.bawaan && <span className="block text-[11.5px] text-ink3">Lokasi workshop bawaan: {pilihan.bawaan.code}.</span>}
        </label>

        <label className="block space-y-1"><span className="block text-[12px] font-medium text-ink3">Catatan (opsional)</span>
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={500} disabled={sibuk} data-testid="penerimaan-catatan" placeholder="Mis. kondisi kasur, jumlah sarung" className={field} /></label>

        <label className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2.5 text-[13px] text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={fisik} onChange={(e) => setFisik(e.target.checked)} disabled={sibuk} data-testid="penerimaan-fisik" />
          <span>Saya sudah memeriksa: unit ini <b>benar-benar sudah diterima secara fisik</b> di workshop.</span>
        </label>

        {g && (
          <div role="alert" data-testid="penerimaan-galat" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">
            <p className="m-0 flex items-start gap-2 font-medium"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />{g.teks}</p>
            {g.petunjuk && <p className="m-0 mt-0.5 pl-6">{g.petunjuk}</p>}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" className="min-h-[44px]" onClick={onClose} disabled={sibuk}>Batal</Button>
        <Button className="min-h-[44px]" data-testid="penerimaan-simpan" disabled={!bolehKirimPenerimaan({ fisik, locationId, sibuk })} onClick={kirim}>
          {sibuk ? "Mencatat…" : <><CheckCircle2 size={15} aria-hidden /> Catat diterima</>}
        </Button>
      </div>
    </Modal>
  );
}
