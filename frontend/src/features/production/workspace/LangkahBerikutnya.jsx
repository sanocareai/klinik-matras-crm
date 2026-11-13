import React, { useRef, useState } from "react";
import { ArrowRight, Hourglass, User } from "lucide-react";
import { api } from "@/api.js";
import KonfirmasiCepat from "@/features/production/rencana/KonfirmasiCepat.jsx";
import PenerimaanWorkshopModal from "@/features/production/PenerimaanWorkshopModal.jsx";
import { Hasil } from "@/features/production/workspace/Hasil.jsx";
import { aksiLangkah, penjelasanTertahan, teksKonfirmasi } from "@/features/production/workspace/profilModel.js";

// KARTU "BERIKUTNYA" — satu langkah dari server, satu tombol. Tindakan kecil (tandai tiba, ubah ke Diproses, Siap Kirim, pekerjaan selesai) = SATU ketukan + konfirmasi
// singkat, jalur API yang SAMA dengan Rencana Produksi (tiba ikut menutup pickup yang belum ditutup driver). Tindakan yang butuh layar lain hanya membuka bagiannya.
const IK = { strokeWidth: 1.75 };

export default function LangkahBerikutnya({ data, aktif, adaMeja, onDone, onBagian, onFokus, onPesan }) {
  const { adopsi: ad, izin = {}, unit: u, kerjaManual: km } = data;
  const t = ad.tindakan || {};
  const aksi = aksiLangkah(t, { izin, aktif, km, adaMeja });
  const tahan = penjelasanTertahan(data);
  const [konf, setKonf] = useState(null); // { jenis, anchor }
  const [modalTerima, setModalTerima] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);
  const kunci = useRef(false); // klik ganda: satu permintaan

  async function jalankan(jenis) {
    if (kunci.current) return; kunci.current = true; setSibuk(true); setGalat(null);
    try {
      let pesan = "";
      if (jenis === "tiba") { const r = await api.catatPenerimaanWorkshop(u.id, { fisikDiterima: true, tutupPickup: true }); pesan = `${u.unitCode} diterima di workshop${r?.pickup?.ditutup ? " · pickup driver ditutup otomatis" : ""}.`; }
      else if (jenis === "diproses") { await api.updateOrder(u.order.id, { status: "PROCESSING", statusOverrideNote: "Unit sudah diterima di workshop — diubah dari profil unit Produksi." }); pesan = `Order ${u.order.orderNumber} kini Diproses.`; }
      else if (jenis === "siapKirim") { await api.updateOrder(u.order.id, { status: "READY", statusOverrideNote: "Diubah dari profil unit Produksi" }); pesan = `Order ${u.order.orderNumber} kini Siap Kirim.`; }
      else if (jenis === "selesai") { await api.postStatusKerjaManual(u.id, { status: "SELESAI", expectedLatestId: km?.terakhirId ?? null }); pesan = `Pekerjaan ${u.unitCode} dicatat selesai.`; }
      setKonf(null); onPesan?.(pesan); await onDone();
    } catch (e) { setKonf(null); setGalat(e); } finally { setSibuk(false); kunci.current = false; }
  }

  function tekan(e) {
    if (!aksi) return;
    if (aksi.jenis === "bagian") return onBagian(aksi.bagian);
    if (aksi.jenis === "fokus") return onFokus(aksi.target);
    setGalat(null); setKonf({ jenis: aksi.jenis, anchor: e.currentTarget });
  }

  const k = konf ? teksKonfirmasi(konf.jenis, { unitCode: u.unitCode, orderNumber: u.order?.orderNumber, jumlahUnit: u.order?.jumlahUnit }) : null;
  const tunggu = t.aksi === "WAIT" || !t.aksi;
  return (
    <section className="pf-langkah" data-testid="tindakan-utama" aria-label="Langkah berikutnya">
      <div className="pf-langkah-baris">
        <span className={`pf-langkah-ikon${tunggu ? " tenang" : ""}`} aria-hidden>{tunggu ? <Hourglass {...IK} size={17} /> : <ArrowRight {...IK} size={18} />}</span>
        <div className="min-w-0 flex-1">
          <p className="pf-langkah-cap">Berikutnya</p>
          <p className="pf-langkah-judul" data-testid="tindakan-label">{t.label || "Tidak ada langkah tertunda"}</p>
          {(tahan?.teks || t.detail) && <p className="pf-langkah-detail">{tahan?.teks || t.detail}</p>}
        </div>
      </div>
      {t.penghalang && t.aksi !== "UBAH_ORDER_DIPROSES" && <p role="note" className="pf-catatan" data-testid="tindakan-penghalang">{t.penghalang.teks}</p>}
      {(aksi || (t.aktor && t.aktor !== "—")) && (
        <div className="pf-langkah-aksi">
          {aksi && <button type="button" className={`pf-cta${aksi.sekunder ? " sekunder" : ""}`} data-testid="tindakan-tombol" data-jenis={aksi.jenis} disabled={sibuk} onClick={tekan}>{sibuk ? "Menyimpan…" : aksi.label}</button>}
          {aksi?.jenis === "tiba" && <button type="button" className="pf-tautan" data-testid="tindakan-tiba-rinci" onClick={() => setModalTerima(true)}>Pilih lokasi / catatan…</button>}
          {t.aktor && t.aktor !== "—" && !aksi && <span className="pf-aktor" data-testid="tindakan-aktor"><User {...IK} size={14} aria-hidden /> {t.aktor}</span>}
        </div>
      )}
      <Hasil hasil={{ galat, ok: "" }} onMuat={onDone} />
      {konf && k && <KonfirmasiCepat anchor={konf.anchor} testid={`konfirmasi-${konf.jenis}`} judul={k.judul} isi={k.isi} labelYa={k.ya} sibuk={sibuk} onYa={() => jalankan(konf.jenis)} onClose={() => !sibuk && setKonf(null)} />}
      {modalTerima && <PenerimaanWorkshopModal unit={{ unitId: u.id, unitCode: u.unitCode, orderNumber: u.order?.orderNumber, customerName: u.order?.customer?.name }} onClose={() => setModalTerima(false)} onDone={async (ok) => { setModalTerima(false); onPesan?.(ok); await onDone(); }} />}
    </section>
  );
}
