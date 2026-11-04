import React, { useRef, useState } from "react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { JENIS_HASIL_SO, bangunBodyHasilSO, periksaFormHasilSO } from "./nilaiPersediaanLogic.js";

// CATAT HASIL SO PER BAHAN (berizin inventory:write, beraudit, append-only). TIDAK menulis stok/ledger, harga, valuasi, jurnal, PSA, GR, maupun pengaturan Finance.
// Dua jenis: fisik nol dikonfirmasi (belum tercatat sebagai hasil SO di ledger) dan terukur dalam satuan lain (mis. ROLL; tidak dikonversi). Jam SO sengaja tidak diminta: belum dikonfirmasi, tidak ditebak.
// Satu Idempotency-Key per niat (bahan + isi): klik ganda = satu catatan. Bila bahan sudah punya hasil SO terkini, penyimpanan menjadi KOREKSI yang menunjuk catatan terkini (riwayat lama tetap).
// Dialog di-portal ke body: warna ditulis eksplisit per tema (kelas .nipf-*), tidak bergantung variabel --crm-*.
const KOSONG = { jenis: "NOL_DIKONFIRMASI", jumlah: "", satuan: "", soTanggal: "", sumber: "", alasan: "" };
export default function CatatHasilSOModal({ open, onClose, bahan, onTersimpan }) {
  const [f, setF] = useState(() => (bahan?.hasilSO ? { jenis: bahan.hasilSO.jenis, jumlah: String(bahan.hasilSO.jumlah ?? ""), satuan: bahan.hasilSO.jenis === "PENGAMATAN_SATUAN" ? bahan.hasilSO.satuan : "", soTanggal: bahan.hasilSO.soTanggal ?? "", sumber: bahan.hasilSO.sumber ?? "", alasan: "" } : KOSONG));
  const [e, setE] = useState({}); const [galat, setGalat] = useState(""); const [sibuk, setSibuk] = useState(false); const [selesai, setSelesai] = useState(null);
  const kunci = useRef({ niat: null, nilai: null }); const kirimRef = useRef(false);
  if (!bahan) return null;
  const ubah = (k) => (ev) => { setF({ ...f, [k]: ev.target.value }); setE({ ...e, [k]: undefined }); setGalat(""); };
  const koreksi = !!bahan.hasilSO?.id;
  const simpan = async () => {
    if (kirimRef.current) return; const er = periksaFormHasilSO(f, { satuanStok: bahan.satuan }); setE(er); if (Object.values(er).some(Boolean)) return;
    const body = bangunBodyHasilSO(f, bahan); const niat = JSON.stringify(body);
    if (kunci.current.niat !== niat) kunci.current = { niat, nilai: `hasil-so-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}` };
    kirimRef.current = true; setSibuk(true); setGalat("");
    try { const r = await api.catatHasilSO(body, kunci.current.nilai); setSelesai(r); onTersimpan?.(r); } catch (err) { setGalat(err.message || "Gagal menyimpan"); } finally { kirimRef.current = false; setSibuk(false); }
  };
  return (
    <Modal open={open} onOpenChange={(v) => { if (!v) onClose?.(); }} title={koreksi ? "Koreksi hasil SO" : "Catat hasil SO"} description={`${bahan.nama} · ${bahan.kode} · satuan stok ${bahan.satuan}`}
      footer={selesai ? <Button onClick={onClose} data-testid="hso-tutup">Tutup</Button> : (<><Button variant="secondary" onClick={onClose} disabled={sibuk}>Batal</Button><Button onClick={simpan} disabled={sibuk} data-testid="hso-simpan">{sibuk ? "Menyimpan…" : koreksi ? "Simpan koreksi" : "Simpan hasil SO"}</Button></>)}>
      {selesai ? (
        <div className="nipf-info" data-testid="hso-selesai">Hasil SO tersimpan. <b>Stok, harga, nilai Finance, dan jurnal tidak berubah.</b> Laporan memakai catatan ini pada pemuatan berikutnya.</div>
      ) : (
        <div className="nipf" data-testid="hso-form">
          <p className="nipf-info">Pencatatan ini <b>tidak menulis stok</b> dan tidak membuat penyesuaian. Siapa, kapan, sumber, dan alasan tersimpan sebagai riwayat; koreksi menambah catatan baru, tidak menghapus yang lama.{koreksi ? ` Catatan terkini: ${bahan.hasilSO.jenis === "NOL_DIKONFIRMASI" ? "fisik nol dikonfirmasi" : `${bahan.hasilSO.jumlah} ${bahan.hasilSO.satuan}`} (SO ${bahan.hasilSO.soTanggal}).` : ""}</p>
          <label className="nipf-l">Jenis hasil
            <select value={f.jenis} onChange={ubah("jenis")} data-testid="hso-jenis">{Object.entries(JENIS_HASIL_SO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          {f.jenis === "PENGAMATAN_SATUAN" && (<div className="nipf-dua">
            <label className="nipf-l">Jumlah terukur<input inputMode="decimal" value={f.jumlah} onChange={ubah("jumlah")} aria-invalid={!!e.jumlah} data-testid="hso-jumlah" />{e.jumlah && <span className="nipf-e">{e.jumlah}</span>}</label>
            <label className="nipf-l">Satuan pengamatan<input value={f.satuan} onChange={ubah("satuan")} placeholder="ROLL" aria-invalid={!!e.satuan} data-testid="hso-satuan" />{e.satuan && <span className="nipf-e">{e.satuan}</span>}</label></div>)}
          <label className="nipf-l">Tanggal SO<input type="date" value={f.soTanggal} onChange={ubah("soTanggal")} aria-invalid={!!e.soTanggal} data-testid="hso-tanggal" />{e.soTanggal && <span className="nipf-e">{e.soTanggal}</span>}<span className="nipf-b">Jam SO belum dicatat (belum dikonfirmasi).</span></label>
          <label className="nipf-l">Sumber<input value={f.sumber} onChange={ubah("sumber")} placeholder="mis. KIRIM GILANG.xlsx, sheet GILANG, sel O4" aria-invalid={!!e.sumber} data-testid="hso-sumber" />{e.sumber && <span className="nipf-e">{e.sumber}</span>}</label>
          <label className="nipf-l">Alasan<textarea rows={3} value={f.alasan} onChange={ubah("alasan")} aria-invalid={!!e.alasan} data-testid="hso-alasan" />{e.alasan && <span className="nipf-e">{e.alasan}</span>}</label>
          {galat && <div className="nipf-galat" role="alert" data-testid="hso-galat">{galat}</div>}
        </div>
      )}
    </Modal>
  );
}
