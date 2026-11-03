import React, { useRef, useState } from "react";
import { Modal } from "@/components/ui/modal.jsx";
import { AngkaGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { IkAwas, IkCentang, IkMuatUlang } from "@/components/gudangIcons.jsx";
import { galatBarisPemeriksaan, kodeSekunder, progresItemPO, tanggalPendek, teksAngka } from "./penerimaanLogic.js";

// DIALOG PEMERIKSAAN (redesain Penerimaan, 4 Nov 2026) — pengisian jumlah Tiba / Baik / Ditolak per item untuk SATU penerimaan. Dialog kerja lebar di desktop, layar penuh di HP; panel samping tetap untuk MEMBACA rincian.
// Informasi pengiriman di atas; baris item ringkas (nama penuh di atas, angka di bawah/di samping menurut lebar dialog); footer tindakan selalu terjangkau. Galat muncul setelah pengguna berinteraksi dengan kolom itu atau mencoba menyimpan
// (penanda wajib tetap); isian bertahan saat gagal (state milik PenerimaanDetail); klik ganda dicegah dengan kunci sinkron. Aturan TIDAK berubah: PATCH /goods-receipts/:id/lines/:lineId; server tetap penentu
// (baik wajib ada sebelum Simpan ke Stok; baik + ditolak ≤ tiba; stok baru bertambah hanya saat Simpan ke Stok).
export default function DialogPemeriksaan({ r, baris, isian, onUbah, tibaBisaDiisi, galat = "", onSimpan, onTutup }) {
  const [sentuh, setSentuh] = useState({}); const [coba, setCoba] = useState(false); const [sibuk, setSibuk] = useState(false); const kunci = useRef(false);
  const nilaiBaris = (b) => isian[b.id] ?? {};
  const isi = (b, f, awal) => (f in nilaiBaris(b) ? nilaiBaris(b)[f] : awal ?? "");
  const ubah = (b, f, v) => { setSentuh((s) => ({ ...s, [b.id]: true })); onUbah(b.id, f, v); };
  const galatBaris = (b) => galatBarisPemeriksaan(b, nilaiBaris(b));
  const adaGalat = baris.some((b) => !!galatBaris(b));
  const simpan = async (e) => {
    e?.preventDefault();
    if (kunci.current) return; setCoba(true);
    if (adaGalat) return;
    kunci.current = true; setSibuk(true);
    try { await onSimpan(); } finally { kunci.current = false; setSibuk(false); }
  };
  const nomorPO = r.purchaseOrder?.poNumber ?? null;
  return (
    <Modal portalToBody dialogBilaTempel open onOpenChange={(o) => (o ? null : onTutup())} title={`Pemeriksaan ${r.receiptNumber}`}
      description="Isi jumlah tiba, baik, dan ditolak per item. Stok baru bertambah saat Simpan ke Stok, bukan di sini."
      className="sm:w-[980px] gud-modal gud-dlg-penuh"
      footer={(
        <>
          {galat && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-pemeriksaan">{galat}</p>}
          <button type="button" className="gud-tombol" onClick={onTutup}>Batal</button>
          <button type="button" className="gud-tombol gud-tombol-utama" onClick={simpan} disabled={sibuk} data-testid="simpan-pemeriksaan">{sibuk ? <IkMuatUlang size={14} className="animate-spin" /> : <IkCentang size={16} />} Simpan hasil pemeriksaan</button>
        </>
      )}>
      <form onSubmit={simpan} noValidate className="gud-form gud-dlg-form" data-testid="form-pemeriksaan">
        <dl className="gud-dlg-info" data-testid="info-pengiriman">
          <div><dt>Supplier</dt><dd>{r.supplier ?? "—"}</dd></div>
          <div><dt>PO</dt><dd>{nomorPO ?? "Tanpa PO"}</dd></div>
          <div><dt>Barang tiba</dt><dd>{r.arrivedDate ? tanggalPendek(r.arrivedDate) : "—"}</dd></div>
          <div><dt>PIC / penerima</dt><dd>{r.arrivalReceiver ?? "—"}</dd></div>
          <div><dt>Surat jalan</dt><dd>{r.deliveryNote || "Belum dilampirkan"}</dd></div>
        </dl>
        <div className="gud-dlg-kepala-kolom" aria-hidden>
          <span>Item</span><span>Tiba</span><span>Baik <b className="gud-f-wajib">*</b></span><span>Ditolak</span>
        </div>
        <ul className="gud-dlg-daftar" data-testid="baris-pemeriksaan">
          {baris.map((b) => {
            const kode = kodeSekunder(b); const po = progresItemPO(b); const g = galatBaris(b); const tampilGalat = g && (sentuh[b.id] || coba);
            const belumBaik = coba && isi(b, "acceptedQty", b.baik) === "";
            return (
              <li key={b.id} className="gud-dlg-baris" data-testid="baris-periksa" data-kode={b.kode} data-invalid={tampilGalat ? "ya" : undefined}>
                <div className="gud-dlg-item">
                  <span className="gud-pi-nama">{b.nama || b.kode}</span>
                  {kode && <span className="gud-pi-kode">{kode}</span>}
                  <span className="gud-dlg-ket">{po ? `Dipesan ${teksAngka(po[0].nilai)} · belum datang ${teksAngka(po.find((s) => s.kunci === "belumDatang")?.nilai)} · dijadwalkan di dokumen ini ${teksAngka(b.dijadwalkan)}` : `Dijadwalkan ${teksAngka(b.dijadwalkan)}`} {b.satuan}</span>
                </div>
                <label className="gud-dlg-isi"><span className="gud-dlg-label">Tiba</span>
                  {tibaBisaDiisi && !b.dariPO ? <AngkaGud value={isi(b, "receivedQty", b.tiba)} onChange={(v) => ubah(b, "receivedQty", v)} satuan={b.satuan} aria-label={`Tiba ${b.kode}`} data-testid={`isian-receivedQty-${b.kode}`} invalid={tampilGalat} /> : <strong className="gud-dlg-tetap" data-testid={`tiba-${b.kode}`}>{teksAngka(b.tiba)} <span className="gud-pi-satuan-kecil">{b.satuan}</span></strong>}
                </label>
                <label className="gud-dlg-isi"><span className="gud-dlg-label">Baik <b className="gud-f-wajib">*</b></span>
                  <AngkaGud value={isi(b, "acceptedQty", b.baik)} onChange={(v) => ubah(b, "acceptedQty", v)} satuan={b.satuan} aria-label={`Diterima baik ${b.kode}`} data-testid={`isian-acceptedQty-${b.kode}`} invalid={tampilGalat} />
                </label>
                <label className="gud-dlg-isi"><span className="gud-dlg-label">Ditolak</span>
                  <AngkaGud value={isi(b, "rejectedQty", b.ditolak)} onChange={(v) => ubah(b, "rejectedQty", v)} satuan={b.satuan} aria-label={`Ditolak ${b.kode}`} data-testid={`isian-rejectedQty-${b.kode}`} invalid={tampilGalat} />
                </label>
                {tampilGalat && <p className="gud-f-galat gud-dlg-lebar" role="alert" data-testid="galat-baris"><IkAwas size={14} aria-hidden /> {g}</p>}
                {!tampilGalat && belumBaik && <p className="gud-f-hint gud-dlg-lebar" data-testid="belum-baik">Jumlah baik belum diisi — wajib sebelum Simpan ke Stok (isi 0 bila tidak ada yang lolos).</p>}
              </li>
            );
          })}
        </ul>
        <p className="gud-petunjuk" data-testid="catatan-pemeriksaan">* Wajib sebelum Simpan ke Stok. Kolom bertanda hanya diperiksa dini di layar (angka ≥ 0, baik + ditolak ≤ tiba); server tetap penentu. Hasil yang disimpan tidak mengubah stok.</p>
      </form>
    </Modal>
  );
}
