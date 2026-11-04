import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { History, Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { tautanKeuangan } from "@/features/finance/uangMukaLogic.js";
import { LABEL_STATUS_FAKTUR, FAKTUR_TERBUKA } from "@/features/finance/purchaseOrderLogic.js";
import { IkDokumen } from "@/components/financeIconsBiaya.jsx";
import {
  daftarFakturPO, ringkasKelengkapanFaktur, periksaNomorSupplier, cariDuplikatNomor, ALASAN_IZIN, ALASAN_LENGKAPI, TEKS_NOMOR_BELUM_DIISI, NOMOR_SUPPLIER_MAKS,
} from "./poTampilan.js";

// Bagian "Faktur supplier" pada Rincian PO + dialog nomor faktur supplier.
// Nomor faktur supplier = atribut FAKTUR/TAGIHAN (fin_supplier_bills.supplier_ref), bukan kolom header PO: satu PO boleh punya banyak faktur.
// Mengubah nomor memakai endpoint yang sudah ada (POST /finance/bills/:id/info: finance:post, alasan wajib, Idempotency-Key, audit sebelum/sesudah) — tanpa jurnal, tanpa mengubah
// nilai, status, jatuh tempo, penerimaan, atau pembayaran. Nomor internal (BILL-…) dan nomor PO tidak pernah diganti.

const tglPendek = (v) => (v ? tanggalPendek(String(v).slice(0, 10)) : "—");
const NADA_STATUS = { DRAFT: "neutral", MENUNGGU_APPROVAL: "orange", DISETUJUI: "biru", DIBAYAR_SEBAGIAN: "biru", LUNAS: "green", DITOLAK: "red", DIBATALKAN: "neutral" };

/** Tagihan milik supplier PO (untuk tanggal faktur dan pemeriksaan duplikat). Satu permintaan baca; server tetap penentu aturan duplikat saat menyimpan. */
export function useTagihanSupplier(supplierId, versi = 0) {
  const [tagihan, setTagihan] = useState(null);
  useEffect(() => {
    if (!supplierId) return undefined;
    let batal = false;
    api.getFinanceBills({ supplierId }).then((r) => { if (!batal) setTagihan(r.bills || []); }).catch(() => { if (!batal) setTagihan([]); });
    return () => { batal = true; };
  }, [supplierId, versi]);
  return tagihan;
}

/** Peringatan potensi duplikat dengan akses ke dokumen terkait. Menjelaskan, tidak memblokir sendiri (server yang memutuskan saat menyimpan/menyetujui). */
export function PeringatanDuplikatNomor({ supplierId, nomor, kecualiId = null, tagihan }) {
  const dobel = useMemo(() => cariDuplikatNomor({ tagihan, supplierId, nomor, kecualiId }), [tagihan, supplierId, nomor, kecualiId]);
  if (dobel.length === 0) return null;
  return (
    <div className="fin-pof-dobel" role="alert" data-testid="peringatan-duplikat-nomor">
      <p className="fin-pof-dobel-judul">Nomor ini sudah tercatat di tagihan lain dari supplier yang sama.</p>
      <ul>
        {dobel.map((b) => (
          <li key={b.id}><Link to={tautanKeuangan("tagihan", b.billNumber)} className="fin-pof-tautan">{b.billNumber}</Link> · {LABEL_STATUS_FAKTUR[b.status] || b.status} · {tglPendek(b.billDate)} · {formatUang(b.amount)}</li>
        ))}
      </ul>
      <p className="fin-pof-dobel-ket">Satu nomor faktur supplier tidak boleh ditagihkan dua kali. Bila ini faktur yang berbeda, periksa nomor yang tertera di faktur asli. Bila memang duplikat, tolak atau batalkan salah satunya.</p>
    </div>
  );
}

/** Dialog melengkapi/mengubah nomor faktur supplier. Hanya metadata: nilai, jurnal, stok, pembayaran, jatuh tempo, dan status tidak ikut berubah. */
export function DialogNomorFaktur({ faktur, supplier, poNumber, onClose, onSaved }) {
  const awal = faktur.nomorSupplier || "";
  const lengkapi = !faktur.nomorSupplier;
  const [nilai, setNilai] = useState(awal);
  const [alasan, setAlasan] = useState(lengkapi ? ALASAN_LENGKAPI : "");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef(null);
  const tagihan = useTagihanSupplier(supplier?.id);
  const cek = periksaNomorSupplier(nilai, awal);
  const dobel = cariDuplikatNomor({ tagihan, supplierId: supplier?.id, nomor: cek.nilai, kecualiId: faktur.id });
  const siap = !cek.galat && !cek.sama && alasan.trim().length >= 3 && dobel.length === 0 && !sibuk;
  const idPetunjuk = useId();

  async function simpan() {
    setGalat(""); setSibuk(true);
    try {
      kunci.current ||= `info-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
      await api.editInfoFinanceDoc("bills", faktur.id, { supplierRef: cek.nilai, reason: alasan.trim() }, kunci.current);
      await onSaved();
    } catch (e) { setGalat(e.message || "Gagal menyimpan nomor faktur supplier"); } finally { setSibuk(false); }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && onClose()}
      title={lengkapi ? "Lengkapi nomor faktur supplier" : "Ubah nomor faktur supplier"}
      description={`${supplier?.name || ""} · ${poNumber} · tagihan ${faktur.nomorInternal}`}
      className="fin-po-modal fin-pof-modal w-[520px]"
      footer={
        <div className="fin-pof-kaki">
          {galat && <p role="alert" className="fin-pof-galat" data-testid="galat-nomor-faktur">{galat}</p>}
          <div className="fin-pof-tombol">
            <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <Button onClick={simpan} disabled={!siap} className="max-sm:min-h-11 max-sm:px-4" data-testid="simpan-nomor-faktur">{sibuk ? "Menyimpan…" : "Simpan nomor"}</Button>
          </div>
        </div>
      }
    >
      <div className="fin-pof-isi">
        <dl className="fin-pof-id">
          <div><dt>Nomor tagihan SANSS</dt><dd className="font-mono">{faktur.nomorInternal}</dd></div>
          <div><dt>Nomor PO</dt><dd className="font-mono">{poNumber}</dd></div>
        </dl>
        <Field label="Nomor faktur supplier" required hint="Salin persis dari faktur supplier (nol di depan, garis miring, dan tanda hubung dipertahankan). Bukan nomor tagihan SANSS atau nomor PO.">
          <Input value={nilai} onChange={(e) => setNilai(e.target.value)} maxLength={NOMOR_SUPPLIER_MAKS + 20} aria-label="Nomor faktur supplier" aria-describedby={idPetunjuk} autoFocus autoComplete="off" inputMode="text" />
        </Field>
        {nilai !== "" && cek.galat && <p role="status" className="fin-pof-galat-kecil" data-testid="galat-isian-nomor">{cek.galat}</p>}
        <PeringatanDuplikatNomor supplierId={supplier?.id} nomor={cek.nilai} kecualiId={faktur.id} tagihan={tagihan} />
        <Field label="Alasan" required hint="Tercatat di riwayat perubahan bersama nilai lama dan baru.">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} aria-label="Alasan perubahan nomor" placeholder="mis. salah ketik nomor faktur" />
        </Field>
        <p id={idPetunjuk} className="fin-pof-dampak" data-testid="dampak-nomor-faktur">Hanya nomor faktur supplier yang berubah. Nilai, jatuh tempo, status, penerimaan, pembayaran, jurnal, dan stok tidak berubah; nomor tagihan {faktur.nomorInternal} tetap.</p>
      </div>
    </Modal>
  );
}

function TombolNomor({ izin, children, className, ...rest }) {
  const id = useId();
  return (
    <>
      <button type="button" className={cn("fin-pof-aksi", className)} disabled={!izin.catat} aria-describedby={izin.catat ? undefined : id} title={izin.catat ? undefined : ALASAN_IZIN.catat} {...rest}>{children}</button>
      {!izin.catat && <span id={id} className="fin-sr-saja">{ALASAN_IZIN.catat}</span>}
    </>
  );
}

function BarisFaktur({ f, info, izin, buka, onToggle, onEditNomor, onRiwayat, renderRincian, renderPeringatan, po }) {
  const idR = `pof-${f.id}`;
  const nilai = info?.amount ?? f.nilai;
  const label = LABEL_STATUS_FAKTUR[f.status] || f.status;
  return (
    <div className="fin-pof-item" role="rowgroup" data-testid="baris-faktur-po" data-ada-nomor={f.nomorSupplier ? "ya" : "tidak"}>
      <div className="fin-pof-baris" role="row">
        <div className="fin-pof-sel fin-pof-nomor" role="cell">
          <span className="fin-pof-label-kecil">Nomor supplier</span>
          {f.nomorSupplier
            ? <span className="fin-pof-no" data-testid="nomor-supplier">{f.nomorSupplier}</span>
            : <span className="fin-pof-kosong" data-testid="nomor-supplier-kosong" title={f.mentah ? `Isian lama: “${f.mentah}”` : undefined}>{TEKS_NOMOR_BELUM_DIISI}</span>}
          {f.nomorSupplier
            ? <TombolNomor izin={izin} onClick={() => onEditNomor(f)} aria-label={`Ubah nomor faktur supplier ${f.nomorSupplier}`} data-testid="ubah-nomor-faktur"><Pencil size={14} aria-hidden="true" /><span>Ubah</span></TombolNomor>
            : <TombolNomor izin={izin} onClick={() => onEditNomor(f)} aria-label={`Lengkapi nomor faktur supplier untuk tagihan ${f.nomorInternal}`} className="lengkapi" data-testid="lengkapi-nomor-faktur"><Pencil size={14} aria-hidden="true" /><span>Lengkapi nomor</span></TombolNomor>}
        </div>
        <div className="fin-pof-sel fin-pof-internal" role="cell"><span className="fin-pof-label-kecil">Nomor internal</span><span className="font-mono">{f.nomorInternal}</span>{f.sumber === "PENERIMAAN" && <span className="fin-pof-sub">tagihan lama via {f.penerimaan}</span>}</div>
        <div className="fin-pof-sel fin-pof-tgl" role="cell"><span className="fin-pof-label-kecil">Tanggal</span>{tglPendek(info?.billDate)}</div>
        <div className="fin-pof-sel fin-pof-nilai" role="cell"><span className="fin-pof-label-kecil">Nilai</span>{nilai == null ? "—" : formatUang(nilai)}</div>
        <div className="fin-pof-sel fin-pof-status" role="cell"><span className="fin-pof-label-kecil">Status</span><span className={`fin-chip fin-chip-${NADA_STATUS[f.status] || "neutral"}`}>{label}</span></div>
        <div className="fin-pof-sel fin-pof-rincian" role="cell">
          <Pembuka buka={buka} onToggle={onToggle} id={idR} className="fin-pod-rinci-tombol" aria-label={`Rincian faktur ${f.nomorSupplier || f.nomorInternal}`}>Rincian</Pembuka>
        </div>
      </div>
      {renderPeringatan && <div className="px-3.5 pb-3" data-testid="peringatan-baris-faktur">{renderPeringatan(f)}</div>}
      {buka && (
        <div id={idR} className="fin-pof-buka">
          {f.sumber === "PO" ? renderRincian(po.faktur.find((x) => x.id === f.id)) : (
            <p className="fin-pof-lama">Tagihan lama ini tertaut ke PO lewat penerimaan barang {f.penerimaan}, bukan sebagai faktur atas PO. Persetujuan dan pembayarannya dikelola di <Link className="fin-pof-tautan" to={tautanKeuangan("tagihan", f.nomorInternal)}>Supplier &amp; Utang</Link>.</p>
          )}
          <div className="fin-pof-aksi-baris">
            <button type="button" className="fin-pof-aksi" onClick={() => onRiwayat(f)} data-testid="riwayat-nomor-faktur"><History size={14} aria-hidden="true" /><span>Riwayat perubahan</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Bagian "Faktur supplier": semua faktur terkait PO (nomor supplier, nomor internal, tanggal, nilai, status), kelengkapan nomor, dan jalan ke Catat faktur. */
export function BagianFakturSupplier({ po, izin, segar, renderRincian, renderPeringatan, onCatat, onEditNomor, onRiwayat }) {
  const daftar = useMemo(() => daftarFakturPO(po), [po]);
  const ringkas = ringkasKelengkapanFaktur(daftar);
  const tagihan = useTagihanSupplier(po.supplier?.id, segar);
  const infoTagihan = useMemo(() => new Map((tagihan || []).map((b) => [b.id, b])), [tagihan]);
  const [buka, setBuka] = useState(() => new Set(daftar.filter((d) => FAKTUR_TERBUKA.includes(d.status)).map((d) => d.id)));
  const toggle = (id) => setBuka((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bisaDifakturkan = ["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"].includes(po.status);

  return (
    <section id="seksi-faktur" data-testid="seksi-faktur" className="fin-pod-faktur fin-pof" aria-labelledby="pof-judul">
      <div className="fin-pof-kepala">
        <h4 id="pof-judul" className="fin-pod-sub">Faktur supplier atas PO ini</h4>
        {daftar.length > 0 && (
          <p className="fin-pof-ringkas" data-testid="ringkas-faktur" aria-live="polite">
            {ringkas.jumlah} faktur
            {ringkas.belumBernomor > 0 ? <span className="fin-chip fin-chip-orange">{ringkas.belumBernomor} nomor supplier belum diisi</span> : <span className="fin-chip fin-chip-green">Nomor supplier lengkap</span>}
          </p>
        )}
      </div>
      {daftar.length === 0 ? (
        <div className="fin-pof-kosong-blok" data-testid="belum-ada-faktur">
          <span className="fin-pof-ikon" aria-hidden="true"><IkDokumen size={22} /></span>
          <div>
            <p className="fin-pof-kosong-judul">Belum ada faktur tercatat</p>
            <p className="fin-pof-ket">
              {bisaDifakturkan ? "Ini berarti faktur supplier belum dicatat untuk PO ini; bukan berarti nomornya kosong. " : "Faktur bisa dicatat setelah PO disetujui. "}
              Mencatat faktur menyimpannya sebagai <strong>Menunggu Persetujuan</strong>: belum ada jurnal sampai disetujui, tidak menambah stok, dan tidak membayar.
            </p>
            {bisaDifakturkan && <p className="fin-pof-ket">Bila tagihan supplier ini sebenarnya sudah ada di <Link className="fin-pof-tautan" to={tautanKeuangan("tagihan", po.supplier?.name || po.poNumber)}>Supplier &amp; Utang</Link> tetapi belum terhubung ke PO, jangan dicatat ulang. Penautan tagihan yang sudah ada ke PO belum tersedia; nomor fakturnya dapat dilengkapi di sana lewat Edit Informasi.</p>}
            {bisaDifakturkan && <button type="button" className="fin-pof-aksi lengkapi" onClick={onCatat} disabled={!izin.catat} title={izin.catat ? undefined : ALASAN_IZIN.catat} data-testid="catat-faktur-dari-kosong"><Plus size={14} aria-hidden="true" /><span>Catat faktur</span></button>}
          </div>
        </div>
      ) : (
        <div className="fin-pof-tabel" role="table" aria-label="Faktur supplier">
          <div className="fin-pof-judul-kolom" role="row">
            <span role="columnheader">Nomor supplier</span><span role="columnheader">Nomor internal</span><span role="columnheader">Tanggal</span>
            <span role="columnheader" className="kanan">Nilai</span><span role="columnheader">Status</span><span role="columnheader" className="fin-sr-saja">Rincian</span>
          </div>
          {daftar.map((f) => <BarisFaktur key={f.id} f={f} info={infoTagihan.get(f.id)} izin={izin} buka={buka.has(f.id)} onToggle={() => toggle(f.id)} onEditNomor={onEditNomor} onRiwayat={onRiwayat} renderRincian={renderRincian} renderPeringatan={renderPeringatan} po={po} />)}
        </div>
      )}
      <p className="fin-pod-ket">Faktur dan pembayarannya tidak menambah stok. Jumlah yang menagih lebih dari barang baik yang belum ditagih akan <strong>tertahan</strong>; beda harga wajib tinjauan Finance (tanpa toleransi otomatis). Status penerimaan barang dan pembayaran dilihat di bagian terpisah.</p>
    </section>
  );
}

