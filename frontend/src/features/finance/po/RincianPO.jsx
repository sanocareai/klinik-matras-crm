import React, { useCallback, useEffect, useId, useState } from "react";
import { Ban, CheckCircle2, Download, Eye, FileText, ListChecks, Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import JejakBiayaPO from "@/features/finance/JejakBiayaPO.jsx";
import TerminFaktur from "@/features/finance/TerminFaktur.jsx";
import { StatusEmpatPO, RincianPerhitunganPO, RiwayatPembayaranPO, PeringatanUangMukaPO, DaftarUangMukaPO, ModalBayarUangMuka, ModalTerapkanUangMuka } from "@/features/finance/UangMukaPO.jsx";
import { TERMIN_AWAL, galatTermin, teksTermin } from "@/features/finance/terminLogic.js";
import { Uang, formatUang, TombolAksi, Pilihan, InputUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { adalahAdminKeuangan } from "@/features/finance/matriksAksi.js";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { IkAlur, IkBahan, IkHarga, IkKedatangan } from "@/components/financeIconsPO.jsx";
import { IkJam } from "@/components/financeIconsBiaya.jsx";
import { ChipStatusPO, BarPenerimaan } from "./DaftarPO.jsx";
import { BagianFakturSupplier, DialogNomorFaktur, PeringatanDuplikatNomor, useTagihanSupplier } from "./FakturSupplierPO.jsx";
import { RiwayatVersiDialog } from "@/features/finance/KoreksiAman.jsx";
import { aksiRincian, statusTampil, ringkasPenerimaan, angkaBaris, langkahBerikut, keteranganTermin, nomorSupplierBermakna, TEKS_NOMOR_BELUM_DIISI } from "./poTampilan.js";
import PanelKedatangan, { LegendaProgres } from "@/features/kedatangan/PanelKedatangan.jsx";
import {
  LABEL_STATUS_PENERIMAAN, teksJumlah, kalimatEvent, labelSatuan, nilaiBelumDiterima,
  FAKTUR_TERBUKA, formFakturAwal, formFakturDariEvaluasi, galatFaktur, subtotalFaktur, totalFaktur, petunjukBaris, bodyFaktur, statusFaktur,
} from "@/features/finance/purchaseOrderLogic.js";

const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tgl = (v) => (v ? tanggalPendek(String(v).slice(0, 10)) : "—");
const tglJam = (iso) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const idKunci = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
function penggunaAdminKeuangan() {
  try { return adalahAdminKeuangan(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; }
}

// ── Rincian PO ───────────────────────────────────────────────────────────
// Hierarki: (1) nomor/supplier/status/tanggal, (2) ringkasan nilai & penerimaan, (3) item, (4) kedatangan & penerimaan Gudang, (5) faktur/uang muka/pembayaran, (6) riwayat.
// Status pesanan, barang, faktur, dan pembayaran SELALU dipisah (StatusEmpatPO, server). Semua tindakan & konfirmasi lama dipertahankan; izin hanya menjelaskan (server tetap menegakkan).

/** Tombol tindakan yang mengikuti izin: tidak berizin → tetap tampil, nonaktif, dengan alasan yang dibaca pembaca layar. */
function TombolIzin({ a, children, className, ...rest }) {
  const id = useId();
  if (!a?.tampil) return null;
  return (
    <>
      <Button variant="neutral" disabled={!a.aktif} aria-describedby={a.aktif ? undefined : id} title={a.aktif ? undefined : a.alasan} className={cn("fin-pod-btn max-sm:min-h-11 max-sm:px-4", className)} {...rest}>{children}</Button>
      {!a.aktif && <span id={id} className="fin-sr-saja">{a.alasan}</span>}
    </>
  );
}

export function ModalDetailPO({ id, izin, onClose, onChanged, onUbah }) {
  const [po, setPo] = useState(null);
  const [galat, setGalat] = useState("");
  const [gagalMuat, setGagalMuat] = useState(false);
  const [dialog, setDialog] = useState(null); // "batal" | "revisi"
  const [infoHarga, setInfoHarga] = useState("");
  const [faktur, setFaktur] = useState(null); // { editBillId? } — formulir faktur
  const [nomorUntuk, setNomorUntuk] = useState(null); // faktur yang nomor supplier-nya dilengkapi/diubah (metadata saja)
  const [riwayatUntuk, setRiwayatUntuk] = useState(null);
  const [setujuiFaktur, setSetujuiFaktur] = useState(null); // evaluasi faktur yang butuh catatan tinjauan harga
  const [tolakFaktur, setTolakFaktur] = useState(null);
  const [bayarUm, setBayarUm] = useState(false); // dialog Bayar Uang Muka
  const [terapkanUm, setTerapkanUm] = useState(null); // { billId, nomor } dialog Terapkan Uang Muka
  const [batalUm, setBatalUm] = useState(null); // penerapan yang akan dibatalkan (admin)
  const [segar, setSegar] = useState(0);

  const muat = useCallback(async () => {
    try { setPo(await api.getPurchaseOrder(id)); setGalat(""); setGagalMuat(false); } catch (e) { setGalat(e.message || "Gagal memuat PO"); setGagalMuat(true); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);
  const segarkan = useCallback(async () => { await muat(); await onChanged(); setSegar((n) => n + 1); }, [muat, onChanged]);

  async function jalankan(fn) {
    setGalat("");
    try { const baru = await fn(); setPo(baru); setDialog(null); await onChanged(); } catch (e) { setGalat(e.message || "Aksi gagal"); }
  }

  const aksi = po ? aksiRincian(po, izin) : null;

  // Pratinjau (tab baru) dan unduh PDF — murni baca; pola sama dengan Invoice Sales.
  const [sibukPdf, setSibukPdf] = useState(null);
  async function bukaPdf(unduh) {
    setSibukPdf(unduh ? "unduh" : "lihat"); setGalat("");
    try {
      const { blob, namaFile } = await api.getPurchaseOrderPdf(id);
      const url = URL.createObjectURL(blob);
      if (unduh) { const a = document.createElement("a"); a.href = url; a.download = namaFile; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
      else { window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    } catch (e) { setGalat(e.message || "Gagal membuat PDF"); } finally { setSibukPdf(null); }
  }
  const bolehUangMuka = !!po?.keuangan?.bolehBayarUangMuka;
  return (
    <>
      <Modal
        open onOpenChange={(v) => !v && onClose()}
        title={po ? <span className="fin-pod-judul"><span className="fin-pod-nomor">{po.poNumber}</span><ChipStatusPO status={po.status} /></span> : "Memuat PO…"}
        description={po ? `${po.supplier.name} · tanggal ${tgl(po.orderDate)}${po.expectedDate ? ` · perkiraan datang ${tgl(po.expectedDate)}` : ""}` : undefined}
        className="fin-po-modal fin-po-modal-rincian w-[1180px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
        footer={
          po && aksi ? (
            <div className="fin-pod-kaki">
              {infoHarga && <p role="status" data-testid="info-harga-po" className="fin-pod-info">{infoHarga}</p>}
              {galat && <p role="alert" data-testid="galat-detail-po" className="fin-pod-galat">{galat}</p>}
              <div className="fin-pod-aksi">
                <div className="fin-pod-aksi-baca">
                  <Button variant="neutral" onClick={() => bukaPdf(false)} disabled={!!sibukPdf} data-testid="po-pdf-lihat" className="fin-pod-btn max-sm:min-h-11 max-sm:px-4"><Eye size={15} aria-hidden="true" /> {sibukPdf === "lihat" ? "Membuat…" : "Pratinjau PDF"}</Button>
                  <Button variant="neutral" onClick={() => bukaPdf(true)} disabled={!!sibukPdf} data-testid="po-pdf-unduh" className="fin-pod-btn max-sm:min-h-11 max-sm:px-4"><Download size={15} aria-hidden="true" /> {sibukPdf === "unduh" ? "Membuat…" : "Unduh PDF"}</Button>
                </div>
                <div className="fin-pod-aksi-tulis">
                  {bolehUangMuka && <TombolIzin a={{ tampil: true, aktif: izin.catat, alasan: "Akun Anda tidak punya izin mencatat pembayaran (Finance/Akuntan)." }} onClick={() => setBayarUm(true)} data-testid="bayar-uang-muka"><Wallet size={15} aria-hidden="true" /> Bayar uang muka</TombolIzin>}
                  <TombolIzin a={aksi.faktur} onClick={() => setFaktur({})}><FileText size={15} aria-hidden="true" /> Catat faktur</TombolIzin>
                  <TombolIzin a={aksi.batalkan} onClick={() => setDialog("batal")}><Ban size={15} aria-hidden="true" /> Batalkan PO</TombolIzin>
                  <TombolIzin a={aksi.revisi} onClick={() => setDialog("revisi")}><ListChecks size={15} aria-hidden="true" /> Revisi jumlah</TombolIzin>
                  <TombolIzin a={aksi.ubah} onClick={() => onUbah(po)}><Pencil size={15} aria-hidden="true" /> Ubah draf</TombolIzin>
                  {aksi.setujui.tampil && (
                    <TombolAksi disabled={!aksi.setujui.aktif} title={aksi.setujui.aktif ? undefined : aksi.setujui.alasan} confirmText={`Setujui ${po.poNumber} senilai ${formatUang(po.totalDipesan)}? Setelah disetujui, Gudang bisa membuat Penerimaan dari PO ini dan harga tidak bisa diubah lagi. Harga Berlaku sudah diperbarui saat PO disimpan; menyetujui tidak menulis harga lagi.`} onClick={() => jalankan(() => api.approvePurchaseOrder(po.id))}>
                      <CheckCircle2 size={15} aria-hidden="true" /> Setujui
                    </TombolAksi>
                  )}
                </div>
              </div>
            </div>
          ) : null
        }
      >
        {!po ? (
          gagalMuat ? (
            <div className="fin-pod-gagal" role="alert"><p>{galat || "Gagal memuat PO"}</p><Button size="sm" onClick={muat}>Coba lagi</Button></div>
          ) : <p className="fin-pod-memuat" role="status">Memuat rincian PO…</p>
        ) : (
          <IsiDetail
            po={po} segar={segar} izin={izin}
            onBayarUangMuka={() => setBayarUm(true)}
            onUbahFaktur={(billId) => setFaktur({ editBillId: billId })}
            onCatatFaktur={() => setFaktur({})}
            onEditNomor={setNomorUntuk}
            onRiwayatFaktur={setRiwayatUntuk}
            onSetujuiFaktur={setSetujuiFaktur}
            onTolakFaktur={setTolakFaktur}
            onTerapkanUangMuka={(fk) => setTerapkanUm({ billId: fk.id, nomor: fk.supplierRef || fk.billNumber })}
            onBatalkanPenerapan={setBatalUm}
            admin={penggunaAdminKeuangan()}
            onGalat={setGalat}
            onSegarkan={segarkan}
          />
        )}
      </Modal>
      {bayarUm && po && <ModalBayarUangMuka po={po} admin={penggunaAdminKeuangan()} onClose={() => setBayarUm(false)} onSaved={async () => { setBayarUm(false); await segarkan(); }} />}
      {terapkanUm && <ModalTerapkanUangMuka billId={terapkanUm.billId} nomorFaktur={terapkanUm.nomor} onClose={() => setTerapkanUm(null)} onSaved={async () => { setTerapkanUm(null); await segarkan(); }} />}
      {batalUm && (
        <ModalAlasan
          judul={`Batalkan penerapan uang muka ${batalUm.uangMuka.nomor}`}
          deskripsi={`Penerapan ke faktur ${batalUm.faktur.nomor} sebesar ${formatUang(batalUm.jumlah)} dibatalkan lewat jurnal pembalik. Sisa utang faktur naik kembali dan saldo uang muka pulih.`}
          label="Alasan pembatalan" tombol="Batalkan Penerapan" galat={galat}
          onClose={() => setBatalUm(null)}
          onSubmit={async (alasan) => { try { await api.batalkanPenerapanUangMuka(batalUm.id, alasan, `umb-${idKunci()}`); setBatalUm(null); await segarkan(); } catch (e) { setGalat(e.message || "Gagal membatalkan penerapan"); } }}
        />
      )}
      {nomorUntuk && po && (
        <DialogNomorFaktur faktur={nomorUntuk} supplier={po.supplier} poNumber={po.poNumber} onClose={() => setNomorUntuk(null)} onSaved={async () => { setNomorUntuk(null); await segarkan(); }} />
      )}
      {riwayatUntuk && <RiwayatVersiDialog jenis="bills" id={riwayatUntuk.id} nomor={riwayatUntuk.nomorInternal} onClose={() => setRiwayatUntuk(null)} />}
      {faktur && po && (
        <ModalFaktur
          key={faktur.editBillId || "baru"} po={po} editBillId={faktur.editBillId} onClose={() => setFaktur(null)}
          onSaved={async () => { setFaktur(null); await segarkan(); }}
        />
      )}
      {setujuiFaktur && (
        <ModalSetujuiFaktur ev={setujuiFaktur} onClose={() => setSetujuiFaktur(null)} onSetujui={async (catatan) => { await api.approveFinanceBill(setujuiFaktur.billId, { catatanTinjauanHarga: catatan }); setSetujuiFaktur(null); await segarkan(); }} />
      )}
      {tolakFaktur && (
        <ModalAlasan
          judul={`Tolak faktur ${tolakFaktur.supplierRef || tolakFaktur.billNumber}`}
          deskripsi="Faktur yang ditolak tidak mengklaim barang apa pun. Catat faktur baru bila perlu."
          label="Alasan penolakan" tombol="Tolak Faktur" galat={galat}
          onClose={() => setTolakFaktur(null)}
          onSubmit={async (alasan) => { try { await api.rejectFinanceBill(tolakFaktur.billId, alasan); setTolakFaktur(null); await segarkan(); } catch (e) { setGalat(e.message || "Gagal menolak faktur"); } }}
        />
      )}
      {dialog === "batal" && po && (
        <ModalAlasan
          judul={`Batalkan ${po.poNumber}`}
          deskripsi="PO yang dibatalkan tidak bisa dibuatkan Penerimaan lagi. Tidak ada stok atau jurnal yang berubah. Harga Berlaku yang sudah diperbarui dari PO ini TIDAK dikembalikan otomatis dan riwayatnya tetap ada."
          label="Alasan pembatalan" tombol="Batalkan PO" galat={galat}
          onClose={() => setDialog(null)}
          onSubmit={(alasan) => jalankan(async () => { const r = await api.cancelPurchaseOrder(po.id, alasan); setInfoHarga(r.peringatanHarga || ""); return r; })}
        />
      )}
      {dialog === "revisi" && po && (
        <ModalRevisi po={po} galat={galat} onClose={() => setDialog(null)} onSubmit={(d) => jalankan(() => api.revisiJumlahPurchaseOrder(po.id, d))} />
      )}
    </>
  );
}

function KartuRingkas({ label, nilai, ket, children, testid }) {
  return (
    <div className="fin-pod-kartu" data-testid={testid}>
      <p className="fin-pod-kartu-label">{label}</p>
      <p className="fin-pod-kartu-nilai">{nilai}</p>
      {children}
      {ket && <p className="fin-pod-kartu-ket">{ket}</p>}
    </div>
  );
}

function BagianPO({ judul, Ikon, id, children, aksi = null }) {
  return (
    <section className="fin-pod-bagian" aria-labelledby={id}>
      <div className="fin-pod-bagian-kepala">
        <h3 id={id}>{Ikon && <span className="fin-pod-bagian-ikon" aria-hidden="true"><Ikon size={20} /></span>}{judul}</h3>
        {aksi}
      </div>
      {children}
    </section>
  );
}

function ItemPO({ po, barisLaku }) {
  const [buka, setBuka] = useState(() => new Set());
  const toggle = (id) => setBuka((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <div className="fin-pod-item-tabel" role="table" aria-label="Item PO dan progres">
        <div className="fin-pod-item-kepala" role="row">
          <span role="columnheader">Item</span>
          <span role="columnheader" className="kanan" title="Jumlah yang dipesan di PO">Dipesan</span>
          <span role="columnheader" className="kanan" title="Total yang benar-benar tiba di semua pengiriman, termasuk yang kemudian ditolak">Sudah datang</span>
          <span role="columnheader" className="kanan" title="Barang baik yang sudah disimpan ke stok (bruto, sebelum retur)">Masuk stok</span>
          <span role="columnheader" className="kanan" title="Dipesan dikurangi masuk stok">Belum masuk stok</span>
          <span role="columnheader" className="kanan">Nilai PO</span>
          <span role="columnheader" className="fin-sr-saja">Rincian jumlah</span>
        </div>
        {po.lines.map((l) => {
          const a = angkaBaris(l);
          const idR = `ir-${l.id}`;
          const terbuka = buka.has(l.id);
          return (
            <div key={l.id} className="fin-pod-item-baris" role="rowgroup" data-testid="baris-item-po">
              <div className="fin-pod-item-utama" role="row">
                <div className="fin-pod-item-nama" role="cell">
                  <span className="fin-pod-item-kode">{l.kode}</span><span className="fin-pod-item-teks">{l.nama}</span>
                  <span className="fin-pod-item-harga tabular-nums" data-testid="harga-satuan-item">Harga satuan <Uang value={l.hargaSatuan} /> / {labelSatuan(l.satuan) || l.satuan}</span>
                  {l.konversi && <span data-testid="konversi-detail" className="fin-pod-item-konversi">1 {labelSatuan(l.konversi.satuanBeli)} = {teksJumlah(l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)} · setara {teksJumlah(l.dipesan * l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)}</span>}
                </div>
                <span role="cell" className="kanan">{teksJumlah(a.dipesan)} {labelSatuan(l.satuan) || l.satuan}</span>
                <span role="cell" className="kanan">{teksJumlah(a.sudahDatang)}</span>
                <span role="cell" className="kanan">{teksJumlah(a.masukStok)}</span>
                <span role="cell" className={cn("kanan", a.belumMasukStok > 0 && barisLaku && "tegas")}>{teksJumlah(a.belumMasukStok)}</span>
                <span role="cell" className="kanan"><Uang value={l.nilaiDipesan} /></span>
                <span role="cell" className="aksi"><Pembuka buka={terbuka} onToggle={() => toggle(l.id)} id={idR} className="fin-pod-rinci-tombol" aria-label={`Rincian jumlah ${l.kode}`}>Rincian</Pembuka></span>
              </div>
              {terbuka && <RincianJumlah id={idR} l={l} a={a} />}
            </div>
          );
        })}
      </div>
      <ul className="fin-pod-item-kartu">
        {po.lines.map((l) => {
          const a = angkaBaris(l); const idR = `ik-${l.id}`; const terbuka = buka.has(`k${l.id}`);
          return (
            <li key={l.id} className="fin-pod-kartu-item">
              <p className="fin-pod-item-kode">{l.kode}</p><p className="fin-pod-item-teks">{l.nama}</p>
              {l.konversi && <p className="fin-pod-item-konversi">1 {labelSatuan(l.konversi.satuanBeli)} = {teksJumlah(l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)} · setara {teksJumlah(l.dipesan * l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)}</p>}
              <dl className="fin-pod-dl">
                <div><dt>Dipesan</dt><dd>{teksJumlah(a.dipesan)} {labelSatuan(l.satuan) || l.satuan}</dd></div>
                <div><dt>Sudah datang</dt><dd>{teksJumlah(a.sudahDatang)}</dd></div>
                <div><dt>Masuk stok</dt><dd>{teksJumlah(a.masukStok)}</dd></div>
                <div><dt>Belum masuk stok</dt><dd>{teksJumlah(a.belumMasukStok)}</dd></div>
                <div><dt>Harga satuan</dt><dd>{formatUang(l.hargaSatuan)}</dd></div>
                <div><dt>Nilai PO</dt><dd>{formatUang(l.nilaiDipesan)}</dd></div>
              </dl>
              <Pembuka buka={terbuka} onToggle={() => toggle(`k${l.id}`)} id={idR} className="fin-pod-rinci-tombol" aria-label={`Rincian jumlah ${l.kode}`}>Rincian jumlah</Pembuka>
              {terbuka && <RincianJumlah id={idR} l={l} a={a} kartu />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Definisi lengkap angka per baris (sama dengan tabel lama): belum datang, menunggu pengganti, diretur, diterima bersih, sudah ditagih. */
function RincianJumlah({ id, l, a, kartu = false }) {
  return (
    <dl id={id} className={cn("fin-pod-rinci", kartu && "kartu")}>
      <div title="Dipesan dikurangi datang pengiriman asli. Barang ditolak tetap dihitung sudah datang."><dt>Belum datang</dt><dd>{teksJumlah(a.belumDatang)}</dd></div>
      <div title="Jumlah ditolak yang belum diganti supplier"><dt>Menunggu pengganti</dt><dd className={a.menungguPengganti > 0 ? "perhatian" : ""}>{teksJumlah(a.menungguPengganti)}</dd></div>
      <div title="Barang yang sudah masuk stok lalu dikembalikan ke supplier lewat Retur Supplier"><dt>Diretur</dt><dd className={a.diretur > 0 ? "perhatian" : ""} data-testid="kolom-diretur">{teksJumlah(a.diretur)}</dd></div>
      <div title="Masuk stok dikurangi diretur. Bukan stok tersedia: belum dikurangi pemakaian Produksi."><dt>Diterima bersih dari PO</dt><dd data-testid="kolom-diterima-bersih">{teksJumlah(a.diterimaBersih)}</dd></div>
      <div title="Dihitung dari penerimaan yang tagihan supplier-nya sudah disetujui"><dt>Sudah ditagih</dt><dd>{teksJumlah(a.ditagih)}</dd></div>
    </dl>
  );
}

function IsiDetail({ po, segar, izin, onBayarUangMuka, onCatatFaktur, onEditNomor, onRiwayatFaktur, onUbahFaktur, onSetujuiFaktur, onTolakFaktur, onTerapkanUangMuka, onBatalkanPenerapan, admin, onGalat, onSegarkan }) {
  const barisLaku = po.status !== "DRAFT";
  const st = statusTampil(po.status);
  const ring = ringkasPenerimaan(po);
  const berjalan = ["DISETUJUI", "DITERIMA_SEBAGIAN"].includes(po.status);
  const fakturPO = po.faktur || [];
  return (
    <div className="fin-pod">
      <section className="fin-pod-ringkas" aria-label="Ringkasan PO">
        <KartuRingkas label="Nilai PO" nilai={formatUang(po.totalDipesan)} ket={`${po.lines.length} item · menurut harga PO`} testid="ringkas-nilai-po" />
        <KartuRingkas label="Penerimaan (masuk stok)" nilai={ring.judul} testid="ringkas-penerimaan">
          <BarPenerimaan r={ring} />
          {ring.sub && <p className="fin-pod-kartu-ket">{ring.sub}</p>}
        </KartuRingkas>
        {berjalan && <KartuRingkas label="Estimasi belum masuk stok" nilai={formatUang(nilaiBelumDiterima(po))} ket="Sisa jumlah × harga PO — bukan utang" testid="ringkas-estimasi" />}
        {po.status === "SELESAI" && <KartuRingkas label="Nilai masuk stok" nilai={formatUang(po.totalDiterima)} ket="Barang baik yang sudah disimpan, menurut harga PO" testid="ringkas-masuk" />}
        <KartuRingkas label="Termin pembayaran" nilai={po.termin ? teksTermin({ label: po.termin.label, sumber: po.termin.sumber }) : "Belum ditetapkan"} ket={keteranganTermin(po.termin)} testid="termin-po" />
      </section>

      <div className="fin-pod-status">
        <p className="fin-pod-status-arti"><b>{st.label}.</b> {st.arti} {langkahBerikut(po)}</p>
        <p className="fin-pod-meta">Dibuat oleh {po.createdBy?.name || "—"}{po.approvedBy ? ` · disetujui ${po.approvedBy.name} (${tglJam(po.approvedAt)})` : ""}</p>
        {po.notes && <p className="fin-pod-catatan">Catatan: {po.notes}</p>}
      </div>
      {po.status === "DIBATALKAN" && <p className="fin-pod-batal" role="note">Dibatalkan {tglJam(po.cancelledAt)} — {po.cancelReason}</p>}
      <PeringatanUangMukaPO po={po} />
      {po.status === "DRAFT" && <p className="fin-pod-draf" data-testid="draf-belum-bisa-dibayar">PO masih draf — setujui PO dulu. Uang muka baru bisa dibayar setelah PO disetujui; tidak perlu menunggu barang datang, Simpan ke Stok, atau faktur supplier.</p>}

      {po.status !== "DRAFT" && (
        <BagianPO judul="Progres barang, faktur, utang, dan pembayaran" Ikon={IkAlur} id="pod-empat">
          <p className="fin-pod-ket">Status pesanan ada di atas. Barang, faktur, utang, dan pembayaran adalah empat hal berbeda: PO yang selesai masuk stok tidak berarti fakturnya sudah masuk atau sudah dibayar.</p>
          <StatusEmpatPO po={po} onBayarUangMuka={onBayarUangMuka} />
          <RincianPerhitunganPO po={po} />
        </BagianPO>
      )}

      <BagianPO judul="Item bahan" Ikon={IkBahan} id="pod-item">
        <ItemPO po={po} barisLaku={barisLaku} />
        <div className="fin-pod-item-kaki" data-testid="ringkas-nilai-lama">
          {po.totalDiretur > 0 && <span data-testid="nilai-diretur">Nilai diretur <strong className="tabular-nums">−{formatUang(po.totalDiretur)}</strong> · diterima bersih dari PO <strong className="tabular-nums">{formatUang(po.totalDiterimaBersih)}</strong></span>}
        </div>
        {po.progresDefinisi && <div className="fin-pod-legenda"><LegendaProgres definisi={po.progresDefinisi} /></div>}
        <p className="fin-pod-ket">“Sudah ditagih” dihitung dari penerimaan yang tagihan supplier-nya sudah disetujui. Tagihan menempel ke satu penerimaan, bukan ke baris.</p>
      </BagianPO>

      {po.kedatangan && po.status !== "DRAFT" && (
        <BagianPO judul="Kedatangan dan penerimaan Gudang" Ikon={IkKedatangan} id="pod-datang">
          <section data-testid="seksi-kedatangan">
            <div className="fin-pod-bendera">
              {po.kedatangan.bendera.map((b) => <Badge key={b.kode} variant={b.kode === "TERLAMBAT" || b.kode === "DIBATALKAN" ? "red" : b.kode === "SELESAI" ? "green" : "accent"}>{b.label}</Badge>)}
              <span className="fin-pod-ket" data-testid="status-termin-po">{po.kedatangan.terminStatus === "MENUNGGU_TANGGAL_PENERIMAAN" ? "Termin: menunggu tanggal penerimaan (termin berjalan dari tanggal barang tiba, bukan dari tanggal PO)" : "Termin berjalan per penerimaan dari tanggal barang tiba"}</span>
            </div>
            <PanelKedatangan
              po={po.kedatangan} workspace="FINANCE" bolehTulis={po.status !== "DIBATALKAN"} onChanged={onSegarkan}
              ekstraPenerimaan={(r) => {
                const lama = (po.penerimaan || []).find((x) => x.id === r.id);
                return (
                  <p className="fin-pod-tagihan-terima" data-testid="tagihan-penerimaan">
                    {!lama || lama.finSupplierBills.length === 0 ? "Belum ada tagihan" : lama.finSupplierBills.map((t) => `${t.billNumber} (${t.status === "DISETUJUI" ? "disetujui" : String(t.status).toLowerCase().replace(/_/g, " ")})`).join(", ")}
                  </p>
                );
              }}
            />
          </section>
        </BagianPO>
      )}
      <section hidden={!!po.kedatangan && po.status !== "DRAFT"} className="fin-pod-bagian">
        <h3 className="fin-pod-sub">Penerimaan Gudang dari PO ini</h3>
        {(po.penerimaan || []).length === 0 ? (
          <p className="fin-pod-ket">{po.status === "DRAFT" ? "Draf belum bisa diterima Gudang." : "Belum ada penerimaan. Gudang memilih PO ini saat membuat Penerimaan Baru."}</p>
        ) : (
          <ul className="fin-pod-terima-daftar">
            {po.penerimaan.map((r) => (
              <li key={r.id}>
                <div className="fin-pod-terima-atas">
                  <span className="fin-pod-item-kode">{r.receiptNumber}</span>
                  <Badge variant={r.status === "COMPLETED" ? "green" : r.status === "REJECTED" ? "red" : "accent"}>{LABEL_STATUS_PENERIMAAN[r.status] || r.status}</Badge>
                  {r.deliveryNote && <span className="fin-pod-ket">Surat jalan {r.deliveryNote}</span>}
                  <span className="fin-pod-ket kanan">{r.finSupplierBills.length === 0 ? "Belum ada tagihan" : r.finSupplierBills.map((t) => `${t.billNumber} (${t.status === "DISETUJUI" ? "disetujui" : t.status.toLowerCase().replace(/_/g, " ")})`).join(", ")}</span>
                </div>
                <p className="fin-pod-ket">
                  {r.lines.map((x) => {
                    const l = po.lines.find((b) => b.id === x.purchaseOrderLineId);
                    return `${l?.kode ?? "—"}: datang ${teksJumlah(x.receivedQty)} · baik ${teksJumlah(x.acceptedQty)} · ditolak ${teksJumlah(x.rejectedQty)}`;
                  }).join("  |  ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BagianPO judul="Uang muka, faktur, dan pembayaran" Ikon={IkHarga} id="pod-dok">
        <DaftarUangMukaPO po={po} admin={admin} onBatalkan={onBatalkanPenerapan} />

        <BagianFakturSupplier
          po={po} izin={izin} segar={segar} onCatat={onCatatFaktur} onEditNomor={onEditNomor} onRiwayat={onRiwayatFaktur}
          renderRincian={(fk) => (
            <KartuFaktur fk={fk} ringkas={(po.keuangan?.faktur || []).find((x) => x.id === fk.id)} adaUangMuka={(po.keuangan?.uangMukaBelumDiterapkan ?? 0) > 0} segar={segar} onUbah={onUbahFaktur} onSetujui={onSetujuiFaktur} onTolak={onTolakFaktur} onTerapkanUangMuka={onTerapkanUangMuka} onGalat={onGalat} onSegarkan={onSegarkan} />
          )}
        />

        <RiwayatPembayaranPO po={po} />

        {po.status !== "DRAFT" && (po.penerimaan || []).length > 0 && (
          <section className="fin-pod-jejak">
            <h4 className="fin-pod-sub">Jejak Biaya Bahan</h4>
            <JejakBiayaPO poId={po.id} segar={segar} />
          </section>
        )}
      </BagianPO>

      <BagianPO judul="Riwayat PO" Ikon={IkJam} id="pod-riwayat">
        <ol className="fin-pod-riwayat">
          {(po.riwayat || []).map((e) => (
            <li key={e.id}><span className="fin-pod-riwayat-waktu tabular-nums">{tglJam(e.createdAt)}</span><span className="fin-pod-riwayat-isi"><b>{e.actor?.name || "Sistem"}</b> · {kalimatEvent(e)}</span></li>
          ))}
        </ol>
      </BagianPO>
    </div>
  );
}

// Satu faktur: status pencocokan + tabel per baris (dipesan, diterima baik, sudah ditagih, diajukan, harga PO, harga faktur, selisih).
function KartuFaktur({ fk, ringkas, adaUangMuka, segar, onUbah, onSetujui, onTolak, onTerapkanUangMuka, onGalat, onSegarkan }) {
  const [ev, setEv] = useState(null);
  const [galat, setGalat] = useState("");
  const [buka, setBuka] = useState(FAKTUR_TERBUKA.includes(fk.status));
  useEffect(() => {
    let batal = false;
    api.getFakturPurchaseOrder(fk.id).then((d) => { if (!batal) setEv(d); }).catch((e) => { if (!batal) setGalat(e.message); });
    return () => { batal = true; };
  }, [fk.id, fk.status, segar]);
  const st = statusFaktur(ev);
  const terbuka = FAKTUR_TERBUKA.includes(fk.status);

  async function setujui() {
    setGalat(""); onGalat("");
    if (ev?.perluTinjauanHarga) { onSetujui(ev); return; }
    try { await api.approveFinanceBill(fk.id, {}); await onSegarkan(); } catch (e) { setGalat(e.message); }
  }

  return (
    <div className="rounded-lg border border-line p-3 text-[12.5px]" data-testid="kartu-faktur">
      <div className="flex flex-wrap items-center gap-2">
        {nomorSupplierBermakna(fk.supplierRef)
          ? <span className="font-mono text-[12px] font-semibold text-ink">{fk.supplierRef}</span>
          : <span className="text-[12px] font-semibold text-orange">{TEKS_NOMOR_BELUM_DIISI}</span>}
        <span className="text-ink3" title="Nomor tagihan SANSS">{fk.billNumber}</span>
        <Badge variant={st.variant}>{st.label}</Badge>
        <span className="ml-auto tabular-nums text-ink">{formatUang(fk.amount)}</span>
        <button type="button" className="text-[12px] font-semibold text-accent" onClick={() => setBuka((v) => !v)}>{buka ? "Sembunyikan" : "Pencocokan"}</button>
      </div>
      {ev?.tertahan && (
        <ul className="mt-2 list-none space-y-1 p-0" data-testid="alasan-tertahan">
          {ev.alasanTertahan.map((a, i) => <li key={i} className="rounded-lg bg-redbg px-3 py-1.5 text-[12px] text-red">{a}</li>)}
        </ul>
      )}
      {buka && ev && (
        <>
          <TableWrap className="mt-2 hidden md:block">
            <Table>
              <THead><TR><TH>Item</TH><TH numeric>Dipesan</TH><TH numeric>Diterima baik</TH><TH numeric>Sudah ditagih</TH><TH numeric>Diajukan di faktur ini</TH><TH numeric>Harga PO</TH><TH numeric>Harga faktur</TH><TH numeric>Selisih</TH></TR></THead>
              <TBody>
                {ev.barisFaktur.map((b) => (
                  <TR key={b.id}>
                    <TD><div className="font-medium text-ink">{b.kode}</div></TD>
                    <TD numeric>{teksJumlah(b.dipesan)} {b.satuan}</TD>
                    <TD numeric>{teksJumlah(b.diterimaBaik)}</TD>
                    <TD numeric>{teksJumlah(b.sudahDitagih)}</TD>
                    <TD numeric className={b.melebihi ? "font-semibold text-red" : "font-semibold text-ink"}>{teksJumlah(b.diajukanIni)}</TD>
                    <TD numeric><Uang value={b.hargaPO} /></TD>
                    <TD numeric><Uang value={b.hargaFaktur} /></TD>
                    <TD numeric className={b.selisihHarga !== 0 ? "font-semibold text-orange" : ""}>{b.selisihHarga === 0 ? "—" : <><Uang value={b.selisihHarga} /> / sat · <Uang value={b.selisihNilai} /></>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <ul className="mt-2 list-none space-y-2 p-0 md:hidden">
            {ev.barisFaktur.map((b) => (
              <li key={b.id} className="rounded-lg border border-line p-2.5">
                <div className="font-medium text-ink">{b.kode}</div>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div><dt className="text-ink3">Dipesan</dt><dd className="ml-0 tabular-nums">{teksJumlah(b.dipesan)} {b.satuan}</dd></div>
                  <div><dt className="text-ink3">Diterima baik</dt><dd className="ml-0 tabular-nums">{teksJumlah(b.diterimaBaik)}</dd></div>
                  <div><dt className="text-ink3">Sudah ditagih</dt><dd className="ml-0 tabular-nums">{teksJumlah(b.sudahDitagih)}</dd></div>
                  <div><dt className="text-ink3">Diajukan di faktur ini</dt><dd className={cn("ml-0 tabular-nums", b.melebihi && "font-semibold text-red")}>{teksJumlah(b.diajukanIni)}</dd></div>
                  <div><dt className="text-ink3">Harga PO</dt><dd className="ml-0 tabular-nums">{formatUang(b.hargaPO)}</dd></div>
                  <div><dt className="text-ink3">Harga faktur</dt><dd className="ml-0 tabular-nums">{formatUang(b.hargaFaktur)}</dd></div>
                  <div className="col-span-2"><dt className="text-ink3">Selisih</dt><dd className={cn("ml-0 tabular-nums", b.selisihHarga !== 0 && "font-semibold text-orange")}>{b.selisihHarga === 0 ? "—" : `${formatUang(b.selisihHarga)} per satuan · ${formatUang(b.selisihNilai)}`}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          {ev.perluTinjauanHarga && terbuka && <p className="mt-2 rounded-lg bg-orangebg px-3 py-1.5 text-[12px] text-orange" data-testid="perlu-tinjauan">Harga faktur berbeda dari harga PO (selisih {formatUang(ev.selisihHargaTotal)}). Wajib ditinjau Finance saat menyetujui; selisihnya masuk Selisih Harga Pembelian.</p>}
          {ev.catatanTinjauan && <p className="mt-2 text-[12px] text-ink2">Catatan tinjauan: {ev.catatanTinjauan}</p>}
          {ev.alokasi?.length > 0 && <p className="mt-1 text-[11.5px] text-ink3">Menagih penerimaan: {[...new Set(ev.alokasi.map((a) => a.receiptNumber))].join(", ")}</p>}
          {ev.termBasis === "TANGGAL_TIBA" && (
            <div className="mt-2" data-testid="jadwal-jatuh-tempo-faktur">
              <h5 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Jadwal jatuh tempo per penerimaan</h5>
              {(ev.jadwalJatuhTempo || []).length === 0 ? <p className="m-0 text-[12px] text-ink2">Menunggu tanggal penerimaan — jatuh tempo dihitung dari tanggal barang tiba yang dicatat pada penerimaan.</p> : (
                <ul className="m-0 list-none space-y-1 p-0">
                  {ev.jadwalJatuhTempo.map((j) => (
                    <li key={j.penerimaanId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-inset px-2.5 py-1.5 text-[12px]" data-testid="jadwal-item">
                      <span className="font-mono font-semibold text-ink">{j.nomorPenerimaan}</span>
                      <span className="text-ink2">tiba {j.tanggalTiba ? tgl(j.tanggalTiba) : "—"}</span>
                      <span className="text-ink">{j.jatuhTempo ? `jatuh tempo ${tgl(j.jatuhTempo)}` : j.statusLabel}</span>
                      <span className="ml-auto tabular-nums text-ink2">{formatUang(j.nilai)} · dibayar {formatUang(j.dibayar)} · sisa {formatUang(j.sisa)}</span>
                      <Badge variant={j.status === "LUNAS" ? "green" : j.terlambat ? "red" : "neutral"}>{j.terlambat ? "Terlambat" : j.statusLabel}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11.5px] text-ink3">Total jadwal sama dengan nilai faktur — utang tetap satu per faktur; pembayaran menutup jadwal yang paling awal jatuh tempo lebih dulu.</p>
            </div>
          )}
        </>
      )}
      {ringkas && ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"].includes(fk.status) && (
        <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-inset px-2.5 py-2 text-[12px] sm:grid-cols-5" data-testid="uang-faktur">
          <div><dt className="text-ink3">Nilai faktur</dt><dd className="ml-0 tabular-nums">{formatUang(ringkas.nilai)}</dd></div>
          <div><dt className="text-ink3">Uang muka dialokasikan</dt><dd className="ml-0 tabular-nums">{formatUang(ringkas.uangMukaDiterapkan)}</dd></div>
          <div><dt className="text-ink3">Kredit lain (Debit Note)</dt><dd className="ml-0 tabular-nums">{formatUang(ringkas.pengurangLain)}</dd></div>
          <div><dt className="text-ink3">Dibayar</dt><dd className="ml-0 tabular-nums">{formatUang(ringkas.dibayar)}</dd></div>
          <div><dt className="text-ink3">Sisa utang</dt><dd className="ml-0 font-semibold tabular-nums text-ink">{formatUang(ringkas.sisa)}</dd></div>
        </dl>
      )}
      {["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(fk.status) && adaUangMuka && ringkas?.sisa > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <span className="text-[12px] text-ink2">Ada uang muka yang belum diterapkan untuk PO ini.</span>
          <Button size="sm" variant="neutral" onClick={() => onTerapkanUangMuka(fk)} data-testid="terapkan-uang-muka"><Wallet size={13} /> Terapkan Uang Muka</Button>
        </div>
      )}
      {galat && <p role="alert" className="mt-2 rounded-lg bg-redbg px-3 py-1.5 text-[12px] text-red">{galat}</p>}
      {terbuka && (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="neutral" onClick={() => onTolak({ ...fk, billId: fk.id })}>Tolak</Button>
          <Button size="sm" variant="neutral" onClick={() => onUbah(fk.id)}><Pencil size={13} /> Ubah</Button>
          <TombolAksi size="sm" disabled={!ev || ev.tertahan} title={ev?.tertahan ? "Faktur tertahan — lihat alasan di atas" : undefined} onClick={setujui}>Setujui</TombolAksi>
        </div>
      )}
    </div>
  );
}

// Formulir faktur atas PO: per baris jumlah & harga faktur, dengan petunjuk dini (akan tertahan / beda harga). Server tetap memutuskan.
function ModalFaktur({ po, editBillId, onClose, onSaved }) {
  const mengubah = !!editBillId;
  const [kunci] = useState(idKunci);
  const [termin, setTermin] = useState(TERMIN_AWAL);
  const [p, setP] = useState(null);
  const [f, setF] = useState(null);
  const [galat, setGalat] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setBaris = (i, patch) => setF((s) => ({ ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const pandangan = await api.getPenagihanPurchaseOrder(po.id);
        const ev = mengubah ? await api.getFakturPurchaseOrder(editBillId) : null;
        if (batal) return;
        setP(pandangan);
        setF(mengubah ? { ...formFakturDariEvaluasi({ ...ev, billDate: ev.billDate }, pandangan), billDate: ev.billDate ? String(ev.billDate).slice(0, 10) : hariIniISO() } : formFakturAwal(pandangan, hariIniISO()));
      } catch (e) { if (!batal) setGalat(e.message || "Gagal memuat data penagihan"); }
    })();
    return () => { batal = true; };
  }, [po.id, editBillId, mengubah]);

  const tagihanSupplier = useTagihanSupplier(po.supplier?.id);
  const galatForm = f ? (galatFaktur(f, { edit: mengubah }) || galatTermin(termin, { perluTanggal: false })) : "Memuat…";
  const total = f ? totalFaktur(f.lines) : 0;
  const barisPO = new Map((p?.barisPO || []).map((b) => [b.purchaseOrderLineId, b]));

  async function simpan() {
    setGalat("");
    try {
      const body = bodyFaktur({ ...f, termin }, { edit: mengubah });
      if (mengubah) await api.updateFakturPurchaseOrder(editBillId, body); else await api.createFakturPurchaseOrder(po.id, body, `fak-${kunci}`);
      await onSaved();
    } catch (e) { setGalat(e.message || "Gagal menyimpan faktur"); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={mengubah ? "Ubah Faktur atas PO" : `Catat Faktur atas ${po.poNumber}`}
      description="Faktur dicocokkan per baris dengan PO. Disimpan sebagai Menunggu Persetujuan. Faktur dan pembayarannya tidak menambah stok."
      className="w-[860px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || (galatForm && f && f.supplierRef)) && <p role="alert" data-testid="galat-faktur" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatForm}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink2">Total faktur <strong className="tabular-nums text-ink">{formatUang(total)}</strong></span>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
              <TombolAksi disabled={!!galatForm} onClick={simpan}>{mengubah ? "Simpan Perubahan" : "Simpan Faktur"}</TombolAksi>
            </div>
          </div>
        </div>
      }
    >
      {!f ? <p className="py-6 text-[13px] text-ink3">{galat || "Memuat…"}</p> : (
        <div className="flex flex-col gap-3">
          <dl className="fin-pof-asal" data-testid="asal-faktur-po">
            <div><dt>Supplier</dt><dd>{po.supplier?.name}</dd></div>
            <div><dt>Faktur atas</dt><dd className="font-mono">{po.poNumber}</dd></div>
          </dl>
          <p className="fin-pof-dampak" data-testid="dampak-catat-faktur">Mencatat faktur tidak berarti barang sudah diterima atau sudah dibayar. Faktur disimpan sebagai Menunggu Persetujuan: belum ada jurnal sampai disetujui, tidak menambah stok, dan tidak membuat pembayaran.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Nomor faktur supplier" required hint="Nomor yang tertera di faktur dari supplier. Bukan nomor tagihan SANSS (BILL-…) dan bukan nomor PO."><Input value={f.supplierRef} onChange={(e) => set("supplierRef", e.target.value)} placeholder="mis. 2327/CR/EB/10/2026" aria-label="Nomor faktur supplier" /></Field>
            <Field label="Tanggal faktur" required><Input type="date" value={f.billDate} onChange={(e) => set("billDate", e.target.value)} /></Field>
          </div>
          <PeringatanDuplikatNomor supplierId={po.supplier?.id} nomor={f.supplierRef} kecualiId={editBillId || null} tagihan={tagihanSupplier} />
          <TerminFaktur purchaseOrderId={po.id} supplierId={po.supplier?.id} tanggalFaktur={f.billDate} value={termin} onChange={setTermin} />

          {p.penerimaan.length > 0 && (
            <div>
              <span className="mb-1 block text-[12px] font-semibold text-ink2">Penerimaan yang ditagih <span className="font-normal text-ink3">(kosong = semua penerimaan PO yang masih punya barang baik belum ditagih)</span></span>
              <div className="flex flex-wrap gap-2">
                {p.penerimaan.map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px]">
                    <input type="checkbox" checked={f.receiptIds.includes(r.id)} onChange={(e) => set("receiptIds", e.target.checked ? [...f.receiptIds, r.id] : f.receiptIds.filter((x) => x !== r.id))} />
                    <span className="font-mono">{r.receiptNumber}</span><span className="text-ink3">baik {teksJumlah(r.diterimaBaik)} · belum ditagih {teksJumlah(r.tersedia)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {f.lines.map((l, i) => {
              const b = barisPO.get(l.purchaseOrderLineId);
              const petunjuk = petunjukBaris(l, b) || [];
              return (
                <div key={l.purchaseOrderLineId} className="rounded-lg border border-line p-2.5" data-testid="baris-faktur">
                  <label className="flex items-start gap-2 text-[12.5px]">
                    <input type="checkbox" checked={l.pakai} onChange={(e) => setBaris(i, { pakai: e.target.checked, ...(e.target.checked && !l.qty && b.tersedia > 0 && { qty: String(b.tersedia) }) })} className="mt-0.5" aria-label={`Faktur baris ${b.kode}`} />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink">{b.kode}</span> <span className="text-ink2">{b.nama}</span>
                      <span className="mt-0.5 block text-[11.5px] text-ink3">Dipesan {teksJumlah(b.dipesan)} {b.satuan} · diterima baik {teksJumlah(b.diterimaBaik)} · sudah ditagih {teksJumlah(b.sudahDitagih)} · <strong className="text-ink2">tersedia {teksJumlah(b.tersedia)}</strong> · harga PO {formatUang(b.hargaPO)}</span>
                    </span>
                  </label>
                  {l.pakai && (
                    <div className="mt-2 grid grid-cols-1 gap-2 pl-6 sm:grid-cols-[120px_160px_1fr] sm:items-end">
                      <Field label={`Jumlah (${b.satuan})`}>
                        <input type="number" inputMode="decimal" min="0" step="any" value={l.qty} aria-label={`Jumlah faktur ${b.kode}`} onChange={(e) => setBaris(i, { qty: e.target.value })}
                          className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                      </Field>
                      <Field label="Harga faktur (Rp)"><InputUang value={l.unitPrice} onChange={(v) => setBaris(i, { unitPrice: v })} aria-label={`Harga faktur ${b.kode}`} /></Field>
                      <div className="text-[12px] text-ink2">Subtotal <strong className="tabular-nums text-ink">{formatUang(subtotalFaktur(l))}</strong></div>
                    </div>
                  )}
                  {petunjuk.map((x) => <p key={x.jenis} className={cn("mt-1.5 pl-6 text-[11.5px]", x.jenis === "tertahan" ? "text-red" : "text-orange")} data-testid={`petunjuk-${x.jenis}`}>{x.teks}</p>)}
                </div>
              );
            })}
          </div>

          {mengubah && <Field label="Alasan perubahan" required><Input value={f.reason} onChange={(e) => set("reason", e.target.value)} aria-label="Alasan perubahan" /></Field>}
        </div>
      )}
    </Modal>
  );
}

// Persetujuan faktur yang harganya berbeda dari PO: Finance wajib menulis catatan tinjauan (tidak ada toleransi otomatis).
function ModalSetujuiFaktur({ ev, onClose, onSetujui }) {
  const [catatan, setCatatan] = useState("");
  const [galat, setGalat] = useState("");
  const berbeda = ev.barisFaktur.filter((b) => b.selisihHarga !== 0);
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Tinjau selisih harga — ${ev.supplierRef || ev.billNumber}`} className="w-[560px]"
      description="Harga faktur berbeda dari harga PO. Setelah disetujui, selisihnya dijurnal ke Selisih Harga Pembelian (kebijakan yang sudah berlaku); GRNI ditutup sebesar harga PO."
      footer={
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Kembali</Button>
            <TombolAksi disabled={catatan.trim().length < 5} onClick={async () => { try { await onSetujui(catatan.trim()); } catch (e) { setGalat(e.message); } }}>Setujui dengan tinjauan</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-orangebg px-3 py-2 text-[13px] text-orange" data-testid="selisih-total">
          <div>Selisih harga total: <strong className="tabular-nums">{formatUang(Math.abs(ev.selisihHargaTotal))}</strong> {ev.selisihHargaTotal > 0 ? "LEBIH MAHAL dari PO (menjadi beban Selisih Harga Pembelian)" : "LEBIH MURAH dari PO (menjadi keuntungan Selisih Harga Pembelian)"}</div>
          <div className="mt-0.5 text-[12px]">Nilai faktur <span className="tabular-nums">{formatUang(ev.amount)}</span> · nilai menurut harga PO <span className="tabular-nums">{formatUang(ev.amount - ev.selisihHargaTotal)}</span></div>
        </div>
        <ul className="list-none space-y-1 p-0 text-[12.5px]">
          {berbeda.map((b) => (
            <li key={b.id} className="rounded-lg bg-inset px-3 py-1.5 text-ink2" data-testid="selisih-baris">{b.kode}: harga PO {formatUang(b.hargaPO)} → faktur {formatUang(b.hargaFaktur)} × {teksJumlah(b.diajukanIni)} = selisih <strong className="tabular-nums text-ink">{formatUang(b.selisihNilai)}</strong></li>
          ))}
        </ul>
        <Field label="Catatan tinjauan Finance" required hint={`Minimal 5 karakter (${catatan.trim().length}/5). Tersimpan permanen bersama nama peninjau.`}>
          <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. kenaikan harga disetujui Owner" aria-label="Catatan tinjauan" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

function ModalAlasan({ judul, deskripsi, label, tombol, galat, onClose, onSubmit }) {
  const [alasan, setAlasan] = useState("");
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={judul} description={deskripsi} className="w-[480px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Kembali</Button>
            <TombolAksi disabled={alasan.trim().length < 3} onClick={() => onSubmit(alasan.trim())}>{tombol}</TombolAksi>
          </div>
        </div>
      }
    >
      <Field label={label} required><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function ModalRevisi({ po, galat, onClose, onSubmit }) {
  const [lineId, setLineId] = useState(po.lines[0].id);
  const baris = po.lines.find((l) => l.id === lineId);
  const [qty, setQty] = useState(String(baris.dipesan));
  const [alasan, setAlasan] = useState("");
  const q = Number(qty);
  const valid = q > 0 && q >= baris.progres.masukStok && q !== baris.dipesan && alasan.trim().length >= 3;
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Revisi jumlah ${po.poNumber}`} className="w-[520px]"
      description="Cara resmi menangani selisih: menaikkan jumlah bila supplier mengirim lebih, atau menurunkannya bila sisanya tidak akan dikirim. Harga satuan tidak berubah. Tidak mengubah stok atau jurnal."
      footer={
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Kembali</Button>
            <TombolAksi disabled={!valid} onClick={() => onSubmit({ lineId, qty: q, reason: alasan.trim() })}>Simpan Revisi</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Item">
          <Pilihan value={lineId} onChange={(v) => { setLineId(v); setQty(String(po.lines.find((l) => l.id === v).dipesan)); }} aria-label="Item yang direvisi">
            {po.lines.map((l) => <option key={l.id} value={l.id}>{l.kode} — dipesan {teksJumlah(l.dipesan)} {l.satuan}</option>)}
          </Pilihan>
        </Field>
        <Field label={`Jumlah baru (${baris.satuan})`} hint={`Sudah masuk stok ${teksJumlah(baris.progres.masukStok)}; jumlah baru tidak boleh lebih kecil.`}>
          <Input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Alasan revisi" required><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. supplier hanya sanggup kirim 8" /></Field>
      </div>
    </Modal>
  );
}
