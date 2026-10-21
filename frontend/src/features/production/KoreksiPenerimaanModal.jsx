import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { JENIS_KOREKSI, bolehKirimKoreksi, kunciIdempoten, pesanGalatAdopsi, teksKoreksi, waktuWib } from "@/features/production/orderProduksiModel.js";

// "Koreksi penerimaan" — dua hal yang BERBEDA dan tidak boleh tertukar: "Lokasi salah" (unit memang diterima) dan "Ternyata belum diterima fisik" (penerimaan tidak berlaku).
// Catatan asli tidak dihapus/ditimpa: koreksi tersimpan permanen (siapa, kapan, alasan, nilai lama → baru). Dampak diambil dari server SEBELUM tombol ditekan; bila sudah ada pekerjaan/serah-terima
// yang bergantung pada penerimaan ini, "belum diterima" tidak ditawarkan (server menolak) dan alasannya dijelaskan.

export default function KoreksiPenerimaanModal({ unit, onClose, onDone }) {
  // unit: { unitId, unitCode }
  const [pra, setPra] = useState(null);
  const [pilihan, setPilihan] = useState(null);
  const [jenis, setJenis] = useState("");
  const [locationId, setLocationId] = useState("");
  const [alasan, setAlasan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);
  const kunciRef = useRef(null); const sidikRef = useRef("");
  const dikirimRef = useRef(false); // penjaga klik ganda yang lebih cepat dari render ulang

  const muat = () => {
    setPra(null); setGalat(null);
    Promise.all([api.getPratinjauKoreksiPenerimaan(unit.unitId), api.getPenerimaanWorkshopPilihan()])
      .then(([p, l]) => { setPra(p); setPilihan(l); }).catch((e) => setGalat(e));
  };
  useEffect(muat, [unit.unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Satu niat = satu kunci: isian sama dikirim ulang (klik ganda / sinyal putus) = satu koreksi; isian berubah = niat baru.
  const sidik = `${jenis}|${locationId}|${alasan}|${pra?.revisi}`;
  if (sidikRef.current !== sidik) { sidikRef.current = sidik; kunciRef.current = null; }

  async function kirim() {
    if (dikirimRef.current || !bolehKirimKoreksi({ jenis, locationId, alasan, sibuk })) return;
    dikirimRef.current = true;
    kunciRef.current ??= kunciIdempoten("koreksi-terima");
    setSibuk(true); setGalat(null);
    try {
      await api.koreksiPenerimaanWorkshop(unit.unitId, { jenis, locationId: jenis === "LOCATION" ? locationId : undefined, alasan: alasan.trim(), expectedRevisi: pra.revisi }, kunciRef.current);
      onDone?.(jenis === "LOCATION" ? `Lokasi penerimaan ${unit.unitCode} dikoreksi.` : `Penerimaan ${unit.unitCode} dinyatakan belum diterima — unit kembali ke daftar menunggu diterima.`);
    } catch (e) { setGalat(e); } finally { dikirimRef.current = false; setSibuk(false); }
  }

  const g = galat ? pesanGalatAdopsi(galat) : null;
  const p = pra?.penerimaan;
  const field = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";
  const lokasiLain = (pilihan?.lokasi || []).filter((l) => l.id !== p?.location?.id);
  const boleh = (k) => !!pra?.izin?.[k] && !!pra?.boleh?.[k];
  const alasanTutup = (k) => (!pra?.izin?.[k] ? "Hanya Admin, Owner, atau Kepala Produksi yang boleh menyatakan unit belum diterima." : k === "NOT_RECEIVED" && !pra?.boleh?.NOT_RECEIVED ? pra?.dampak?.alasanNotReceivedTertolak : null);

  return (
    <Modal open onOpenChange={(v) => !v && !sibuk && onClose()} title={`Koreksi penerimaan — ${unit.unitCode}`}
      description="Catatan asli tidak dihapus. Koreksi tersimpan permanen bersama nama Anda, waktu, dan alasannya."
      contentProps={{ "data-testid": "koreksi-modal" }}>
      <div className="space-y-4">
        {!pra && !g && <p className="m-0 text-[13px] text-ink3">Memuat catatan penerimaan…</p>}
        {p && (
          <div className="rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2" data-testid="koreksi-catatan-kini">
            <p className="m-0 font-semibold text-ink">Catatan saat ini</p>
            <p className="m-0 mt-0.5">Diterima oleh <b className="text-ink">{p.receivedBy?.name || "petugas"}</b> · {waktuWib(p.receivedAt)} · lokasi <b className="text-ink">{p.location?.code}</b>{p.koreksi?.length ? ` · sudah dikoreksi ${p.koreksi.length}×` : ""}</p>
          </div>
        )}

        {pra && (
          <fieldset className="m-0 space-y-2 border-0 p-0" data-testid="koreksi-jenis">
            <legend className="mb-1 text-[12px] font-medium text-ink3">Apa yang salah?</legend>
            {JENIS_KOREKSI.map((j) => {
              const tutup = alasanTutup(j.key); const aktif = boleh(j.key);
              return (
                <label key={j.key} className={`flex items-start gap-2 rounded-btn border px-3 py-2.5 text-[13px] ${jenis === j.key ? "border-accent bg-accentbg" : "border-line bg-surface"} ${aktif ? "cursor-pointer" : "opacity-70"}`}>
                  <input type="radio" name="jenis-koreksi" className="mt-1 h-4 w-4" value={j.key} checked={jenis === j.key} disabled={!aktif || sibuk} onChange={() => { setJenis(j.key); setGalat(null); }} data-testid={`koreksi-jenis-${j.key}`} />
                  <span className="min-w-0"><b className="block text-ink">{j.label}</b><span className="block text-ink3">{j.bantu}</span>
                    {tutup && <span className="mt-1 flex items-start gap-1.5 text-orange" data-testid={`koreksi-tutup-${j.key}`}><Info size={14} className="mt-0.5 shrink-0" aria-hidden />{tutup}</span>}</span>
                </label>
              );
            })}
          </fieldset>
        )}

        {jenis === "LOCATION" && (
          <label className="block space-y-1"><span className="block text-[12px] font-medium text-ink3">Lokasi yang benar</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={sibuk} data-testid="koreksi-lokasi" className={field}>
              <option value="">— Pilih lokasi —</option>
              {lokasiLain.map((l) => <option key={l.id} value={l.id}>{l.code}{l.zone ? ` · ${l.zone}` : ""}</option>)}
            </select></label>
        )}

        {pra && jenis && (
          <label className="block space-y-1"><span className="block text-[12px] font-medium text-ink3">Alasan koreksi (wajib)</span>
            <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} disabled={sibuk} data-testid="koreksi-alasan" placeholder={jenis === "LOCATION" ? "Mis. ternyata diletakkan di rak WIP" : "Mis. kasur belum sampai, yang datang hanya foto"} className={field} /></label>
        )}

        {pra?.dampak?.butir?.length > 0 && (
          <div role="note" className="space-y-1 rounded-btn bg-orangebg px-3 py-2.5 text-[12.5px] text-ink2" data-testid="koreksi-dampak">
            <p className="m-0 font-semibold text-orange">Yang sudah bergantung pada penerimaan ini</p>
            <ul className="m-0 list-disc space-y-0.5 pl-5">{pra.dampak.butir.map((b) => <li key={b.kode}>{b.teks}</li>)}</ul>
            {jenis === "LOCATION" && pra.dampak.handoffDariPenerimaan && <p className="m-0 mt-1">Lokasi serah-terima unit ikut dikoreksi; status pekerjaan tidak berubah.</p>}
          </div>
        )}

        {p?.koreksi?.length > 0 && (
          <div className="space-y-1" data-testid="koreksi-riwayat-lama">
            <p className="m-0 text-[12px] font-medium text-ink3">Koreksi sebelumnya</p>
            <ul className="m-0 list-none space-y-1 p-0 text-[12px] text-ink2">{p.koreksi.map((k) => <li key={k.id}>{teksKoreksi(k)}</li>)}</ul>
          </div>
        )}

        {g && (
          <div role="alert" data-testid="koreksi-galat" className={`rounded-btn px-3 py-2 text-[12.5px] ${g.jenis === "konflik" || g.jenis === "info" ? "bg-orangebg text-orange" : "bg-redbg text-red"}`}>
            <p className="m-0 flex items-start gap-2 font-medium"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />{g.teks}</p>
            {g.petunjuk && <p className="m-0 mt-0.5 pl-6">{g.petunjuk}</p>}
            {g.muatUlang && <Button variant="secondary" size="sm" className="ml-6 mt-2 min-h-[40px]" onClick={() => { setJenis(""); setLocationId(""); setAlasan(""); muat(); }}>Muat ulang</Button>}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" className="min-h-[44px]" onClick={onClose} disabled={sibuk}>Batal</Button>
        <Button className="min-h-[44px]" data-testid="koreksi-simpan" disabled={!pra || !bolehKirimKoreksi({ jenis, locationId, alasan, sibuk })} onClick={kirim}>{sibuk ? "Menyimpan…" : "Simpan koreksi"}</Button>
      </div>
    </Modal>
  );
}
