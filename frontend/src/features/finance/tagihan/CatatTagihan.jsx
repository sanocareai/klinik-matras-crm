import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { InputUang, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { IkPesanan, IkKotak } from "@/components/financeIconsPO.jsx";
import { IkDokumen } from "@/components/financeIconsBiaya.jsx";
import TerminFaktur from "@/features/finance/TerminFaktur.jsx";
import PilihJenisTagihan, { bodyJenis, jenisLengkap } from "@/features/finance/JenisTagihan.jsx";
import { TERMIN_AWAL, bodyTermin, galatTermin } from "@/features/finance/terminLogic.js";
import { PemilihSupplier, TanggalPO } from "@/features/finance/po/KontrolPO.jsx";
import { ModalFaktur } from "@/features/finance/po/RincianPO.jsx";
import { PeringatanDuplikatNomor, useTagihanSupplier } from "@/features/finance/po/FakturSupplierPO.jsx";
import {
  FILTER_STATUS_PO, ringkasPOPemilih, kelompokPenerimaan, ketPenerimaan, perluKonfirmasiPenerimaan, penjagaPermintaan, cocokSupplierPenerimaan, BATAS_PENERIMAAN_BELUM_DITAGIH,
} from "./tagihanLogika.js";

// "Catat tagihan": SATU pintu dengan tiga asal. Pilihan asal hanya mengarahkan ke kontrak yang sudah ada — tidak membuat dokumen tambahan:
//   Dari PO          → daftar PO supplier → form faktur atas PO yang sudah ada (ModalFaktur: pencocokan per baris, termin, nomor faktur, duplikat).
//   Dari penerimaan  → POST /finance/bills dengan billType BAHAN_BAKU + satu goodsReceiptId (tanpa pencocokan per item).
//   Tanpa PO         → POST /finance/bills dengan jenis tagihan & klasifikasi seperti sebelumnya.
// Tagihan disimpan "Menunggu persetujuan": belum ada jurnal, tidak mengubah stok, tidak membuat pembayaran, tidak menerapkan uang muka, tidak mengubah Harga Berlaku.

const ASAL = [
  { key: "PO", Ikon: IkPesanan, judul: "Dari PO", ket: "Faktur atas pesanan pembelian, dicocokkan per baris" },
  { key: "PENERIMAAN", Ikon: IkKotak, judul: "Dari penerimaan", ket: "Tagihan untuk satu dokumen penerimaan barang" },
  { key: "TANPA_PO", Ikon: IkDokumen, judul: "Tanpa PO", ket: "Jasa, biaya, aset, atau tagihan tanpa referensi PO" },
];
const LABEL_STATUS_PO = { DISETUJUI: "Disetujui", DITERIMA_SEBAGIAN: "Diterima sebagian", SELESAI: "Selesai" };
const tgl = (v) => (v ? tanggalPendek(String(v).slice(0, 10)) : "—");
const FORM_AWAL = { supplierRef: "", billDate: "", amount: "", description: "", billType: "", goodsReceiptId: "", expenseCategoryId: "", purchaseCategoryId: "" };

function KartuPilih({ aktif, onPilih, nama, children, testid, mati = false }) {
  return (
    <label className={cn("fin-tg-pilihan", aktif && "aktif", mati && "mati")} data-testid={testid}>
      <input type="radio" name={nama} checked={aktif} onChange={onPilih} disabled={mati} />
      <span className="fin-tg-pilihan-isi">{children}</span>
      <span className="fin-tg-pilihan-centang" aria-hidden="true">{aktif && <Check size={15} />}</span>
    </label>
  );
}

/** Jalur Dari PO: pilih supplier → PO → lanjut ke form faktur PO yang sudah ada. */
function JalurPO({ supplier, onLanjut }) {
  const [daftar, setDaftar] = useState(null);
  const [galat, setGalat] = useState("");
  const [poId, setPoId] = useState("");
  const penjaga = useRef(penjagaPermintaan());
  const nama = useId();
  useEffect(() => {
    setPoId(""); setDaftar(null); setGalat("");
    if (!supplier) return undefined;
    const id = penjaga.current.mulai();
    api.getPurchaseOrders({ status: FILTER_STATUS_PO, supplierId: supplier.id })
      .then((r) => { if (penjaga.current.sahkan(id)) setDaftar((r.purchaseOrders || []).filter((p) => p.supplier?.id === supplier.id)); })
      .catch((e) => { if (penjaga.current.sahkan(id)) { setDaftar([]); setGalat(e.message || "Gagal memuat PO supplier"); } });
    return () => penjaga.current.batalkan();
  }, [supplier?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- hanya identitas supplier
  const po = (daftar || []).find((p) => p.id === poId);
  return (
    <div className="fin-tg-jalur" data-testid="jalur-po">
      {!supplier ? <p className="fin-tg-ket">Pilih supplier untuk melihat PO yang bisa difakturkan.</p> : galat ? <p role="alert" className="fin-tg-galat">{galat}</p> : daftar === null ? <p className="fin-tg-ket" role="status">Memuat PO {supplier.name}…</p> : daftar.length === 0 ? (
        <p className="fin-tg-ket" data-testid="po-kosong">Tidak ada PO {supplier.name} yang bisa difakturkan. Faktur hanya untuk PO yang sudah disetujui. Untuk tagihan tanpa PO, pilih “Tanpa PO”.</p>
      ) : (
        <>
          <p className="fin-tg-label">Pilih pesanan pembelian <span className="fin-tg-hint">({daftar.length} PO disetujui, diterima sebagian, atau selesai)</span></p>
          <div className="fin-tg-daftar" role="radiogroup" aria-label="Pesanan pembelian">
            {daftar.map((p) => {
              const r = ringkasPOPemilih(p);
              return (
                <KartuPilih key={p.id} nama={nama} aktif={p.id === poId} onPilih={() => setPoId(p.id)} testid="pilihan-po">
                  <span className="fin-tg-pilihan-atas"><strong className="fin-tg-kode">{p.poNumber}</strong><span className="fin-tg-chip-kecil">{LABEL_STATUS_PO[p.status] || p.status}</span></span>
                  <span className="fin-tg-pilihan-bawah">{tgl(p.orderDate)} · nilai PO {formatUang(p.totalDipesan)}</span>
                  <span className="fin-tg-pilihan-bawah">Penerimaan: {r.teks}</span>
                  {r.peringatan && <span className="fin-tg-pilihan-peringatan">{r.peringatan}</span>}
                </KartuPilih>
              );
            })}
          </div>
          <p className="fin-tg-ket">Jumlah yang masih bisa ditagih per item, harga PO sebagai pembanding, dan penerimaan yang ditagih ditampilkan di langkah berikut. Satu PO boleh punya beberapa penerimaan dan beberapa faktur.</p>
        </>
      )}
      <div className="fin-tg-langkah">
        <Button disabled={!po} onClick={() => onLanjut(po)} data-testid="lanjut-faktur-po" className="max-sm:min-h-11">Lanjut ke faktur {po ? po.poNumber : "PO"}</Button>
      </div>
    </div>
  );
}

/** Jalur Dari penerimaan & Tanpa PO: form tunggal ke POST /finance/bills (payload identik dengan form lama). */
function JalurManual({ asal, supplier, suppliers, unbilled, kategori, kategoriBeli, metodeInfo, onSimpan, onBatal }) {
  const [f, setF] = useState({ ...FORM_AWAL, billType: asal === "PENERIMAAN" ? "BAHAN_BAKU" : "" });
  const [termin, setTermin] = useState(TERMIN_AWAL);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  const kunciKirim = useRef(false); // penjaga sinkron: klik ganda sebelum React sempat menonaktifkan tombol tetap hanya mengirim satu permintaan
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const nama = useId();
  const tagihanSupplier = useTagihanSupplier(supplier?.id);
  const kelompok = useMemo(() => kelompokPenerimaan(unbilled, supplier), [unbilled, supplier]);
  const gr = (unbilled || []).find((r) => r.id === f.goodsReceiptId);
  const perluKonfirmasi = asal === "PENERIMAAN" && perluKonfirmasiPenerimaan(gr, supplier);
  const selisih = gr && Number(f.amount) > 0 ? Number(f.amount) - Number(gr.nilaiTerima || 0) : null;
  // Ganti supplier atau asal membersihkan pilihan yang sudah tidak valid (termin, penerimaan, konfirmasi).
  useEffect(() => { setF((s) => ({ ...s, goodsReceiptId: "" })); setKonfirmasi(false); setTermin(TERMIN_AWAL); }, [supplier?.id]);
  useEffect(() => { setKonfirmasi(false); }, [f.goodsReceiptId]);

  const kurang = [];
  if (!supplier) kurang.push("supplier");
  if (asal === "PENERIMAAN" && !f.goodsReceiptId) kurang.push("penerimaan");
  if (perluKonfirmasi && !konfirmasi) kurang.push("konfirmasi penerimaan");
  if (!f.description.trim()) kurang.push("keterangan");
  if (!(Number(f.amount) > 0)) kurang.push("nominal tagihan");
  if (!jenisLengkap(f, metodeInfo)) kurang.push(asal === "TANPA_PO" && f.billType === "BAHAN_BAKU" ? "jenis tagihan (bahan baku wajib lewat penerimaan pada metode perpetual)" : "jenis tagihan");
  if (galatTermin(termin, { perluTanggal: false })) kurang.push("alasan/isian termin");
  const valid = kurang.length === 0;

  async function simpan() {
    if (!valid || sibuk || kunciKirim.current) return;
    kunciKirim.current = true;
    setSibuk(true); setGalat("");
    try {
      const { goodsReceiptId, expenseCategoryId, purchaseCategoryId, billType, ...dasar } = f;
      await onSimpan({ supplierId: supplier.id, ...dasar, ...bodyJenis(f), ...bodyTermin(termin) });
    } catch (e) { setGalat(e.message || "Gagal menyimpan tagihan"); kunciKirim.current = false; setSibuk(false); }
  }

  return (
    <div className="fin-tg-jalur fin-tg-manual" data-testid={asal === "PENERIMAAN" ? "jalur-penerimaan" : "jalur-tanpa-po"}>
      <div className="fin-tg-kolom-utama">
        {asal === "PENERIMAAN" && (
          <section className="fin-tg-bagian">
            <p className="fin-tg-label">Penerimaan barang yang belum ditagih</p>
            {!supplier ? <p className="fin-tg-ket">Pilih supplier dulu.</p> : (kelompok.cocok.length + kelompok.beda.length + kelompok.kosong.length) === 0 ? <p className="fin-tg-ket" data-testid="penerimaan-kosong">Tidak ada penerimaan yang belum ditagih.</p> : (
              <>
                <p className="fin-tg-ket" data-testid="ket-penerimaan">{ketPenerimaan(kelompok, supplier)}</p>
                <div className="fin-tg-daftar" role="radiogroup" aria-label="Penerimaan barang">
                  {[["cocok", "Nama cocok dengan supplier ini", kelompok.cocok], ["beda", "Nama supplier berbeda", kelompok.beda], ["kosong", "Tanpa nama supplier di dokumen Gudang", kelompok.kosong]].filter(([, , l]) => l.length > 0).map(([k, judul, l]) => (
                    <div key={k} className="fin-tg-grup" data-grup={k}>
                      <p className="fin-tg-grup-judul">{judul}</p>
                      {l.map((r) => (
                        <KartuPilih key={r.id} nama={nama} aktif={r.id === f.goodsReceiptId} onPilih={() => set("goodsReceiptId", r.id)} testid="pilihan-penerimaan">
                          <span className="fin-tg-pilihan-atas"><strong className="fin-tg-kode">{r.receiptNumber}</strong><span className="fin-tg-chip-kecil" data-nada={k === "cocok" ? "biru" : "jingga"}>{k === "cocok" ? "Nama cocok" : k === "beda" ? "Nama berbeda" : "Tanpa nama"}</span></span>
                          <span className="fin-tg-pilihan-bawah">{r.supplier || "tanpa nama supplier"} · diterima {tgl(r.receivedDate)} · nilai {formatUang(r.nilaiTerima)}</span>
                          {r.barisTanpaHarga > 0 && <span className="fin-tg-pilihan-peringatan">{r.barisTanpaHarga} baris belum punya harga: lengkapi di Gudang dulu, tagihan belum bisa disetujui.</span>}
                        </KartuPilih>
                      ))}
                    </div>
                  ))}
                </div>
                {kelompok.terpotong && <p className="fin-tg-ket" data-testid="penerimaan-terpotong">Server hanya memberi {BATAS_PENERIMAAN_BELUM_DITAGIH} penerimaan terbaru; yang lebih lama mungkin tidak tampil.</p>}
              </>
            )}
            {perluKonfirmasi && (
              <label className="fin-tg-konfirmasi" data-testid="konfirmasi-penerimaan">
                <input type="checkbox" checked={konfirmasi} onChange={(e) => setKonfirmasi(e.target.checked)} />
                <span>Saya sudah memeriksa bahwa penerimaan <strong>{gr.receiptNumber}</strong> memang milik <strong>{supplier.name}</strong>, meskipun namanya {cocokSupplierPenerimaan(gr.supplier, supplier) === "kosong" ? "tidak tercatat di dokumen Gudang" : `tertulis “${gr.supplier}”`}.</span>
              </label>
            )}
            <p className="fin-tg-ket">Tagihan ini menaut satu dokumen penerimaan; nilai faktur dibandingkan dengan nilai penerimaan, bukan per item. Penerimaan yang berasal dari PO lebih tepat difakturkan lewat “Dari PO”, yang mencocokkan per baris.</p>
          </section>
        )}

        <section className="fin-tg-bagian">
          <p className="fin-tg-label">Rincian faktur</p>
          <div className="fin-tg-grid">
            <Field label="Nomor faktur supplier" hint="Nomor di faktur dari supplier. Bukan nomor tagihan SANSS (BILL-…) dan bukan nomor PO.">
              <Input value={f.supplierRef} onChange={(e) => set("supplierRef", e.target.value)} placeholder="mis. 2327/CR/EB/10/2026" aria-label="Nomor faktur supplier" />
            </Field>
            <Field label="Tanggal faktur" hint="Kosong = hari ini (WIB).">
              <TanggalPO value={f.billDate} onChange={(v) => set("billDate", v)} bolehKosong ariaLabel="Tanggal faktur" />
            </Field>
            <Field label="Nominal tagihan" required hint="Dari dokumen faktur supplier.">
              <InputUang value={f.amount} onChange={(v) => set("amount", v)} aria-label="Nominal tagihan" />
            </Field>
          </div>
          <PeringatanDuplikatNomor supplierId={supplier?.id} nomor={f.supplierRef} tagihan={tagihanSupplier} />
          <Field label="Keterangan" required>
            <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="mis. Busa rebonded 10 lembar" aria-label="Keterangan" />
          </Field>
          <TerminFaktur supplierId={supplier?.id || ""} tanggalFaktur={f.billDate} value={termin} onChange={setTermin} />
        </section>

        {asal === "TANPA_PO" && (
          <section className="fin-tg-bagian">
            <p className="fin-tg-ket" data-testid="ket-tanpa-po">Gunakan jalur ini untuk jasa, biaya operasional, biaya produksi non-stok, mesin/peralatan, uang muka pembelian, atau bahan baku yang memang tidak punya PO. Ini bukan cara melewati penerimaan barang: pada metode persediaan perpetual, bahan baku wajib menaut penerimaan Gudang.</p>
            <PilihJenisTagihan f={f} set={set} kategori={kategori} kategoriBeli={kategoriBeli} unbilled={[]} metodeInfo={metodeInfo} namaSupplier={supplier?.name || ""} sembunyikanPenerimaan />
          </section>
        )}
      </div>

      <aside className="fin-tg-ringkas" aria-label="Ringkasan tagihan">
        <h3>Ringkasan tagihan</h3>
        <dl>
          <div><dt>Nilai faktur</dt><dd className="fin-tg-besar" data-testid="nilai-faktur">{Number(f.amount) > 0 ? formatUang(Number(f.amount)) : "Rp0"}</dd></div>
          {asal === "PENERIMAAN" && (
            <div><dt>Selisih terhadap nilai penerimaan</dt><dd className="fin-tg-besar" data-testid="selisih-penerimaan">{selisih === null ? "—" : Math.abs(selisih) < 0.005 ? "Rp0" : formatUang(selisih)}</dd></div>
          )}
        </dl>
        {asal === "PENERIMAAN" && selisih !== null && (
          <p className="fin-tg-info" data-nada={Math.abs(selisih) < 0.005 ? "biru" : "jingga"}>{Math.abs(selisih) < 0.005 ? "Nilai sesuai penerimaan." : `Selisih dengan nilai penerimaan (${formatUang(gr.nilaiTerima)}) dicatat ke Selisih Harga Pembelian saat disetujui; nilai persediaan tidak diubah.`}</p>
        )}
        {asal === "TANPA_PO" && <p className="fin-tg-info" data-nada="biru">Tidak ada dokumen pembanding: nilai mengikuti dokumen supplier.</p>}
        {gr && <div className="fin-tg-terkait"><p className="fin-tg-label">Dokumen terkait</p><p className="fin-tg-kode">{gr.receiptNumber}</p></div>}
        <p className="fin-tg-info" data-nada="netral">Disimpan sebagai <strong>Menunggu persetujuan</strong>. Belum ada jurnal, tidak mengubah stok, dan tidak membuat pembayaran.</p>
      </aside>

      <div className="fin-tg-kaki-form">
        {galat && <p role="alert" className="fin-tg-galat" data-testid="galat-tagihan"><AlertCircle size={16} aria-hidden="true" />{galat}</p>}
        {!valid && supplier && <p className="fin-tg-ket" data-testid="kurang">Lengkapi: {kurang.join(", ")}.</p>}
        <div className="fin-tg-tombol-kaki">
          <Button variant="neutral" onClick={onBatal} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <Button onClick={simpan} disabled={!valid || sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="simpan-tagihan">{sibuk ? "Menyimpan…" : "Simpan tagihan"}</Button>
        </div>
      </div>
    </div>
  );
}

export default function CatatTagihan({ asalAwal = "PO", suppliers, unbilled, kategori, kategoriBeli, metodeInfo, onClose, onTersimpan }) {
  const [asal, setAsal] = useState(asalAwal);
  const [supplierId, setSupplierId] = useState("");
  const [poLanjut, setPoLanjut] = useState(null);
  const idSupplier = useId();
  const supplier = suppliers.find((s) => s.id === supplierId) || null;
  const namaAsal = useId();

  if (poLanjut) {
    return <ModalFaktur po={{ id: poLanjut.id, poNumber: poLanjut.poNumber, supplier: { id: poLanjut.supplier.id, name: poLanjut.supplier.name } }} onClose={() => setPoLanjut(null)} onSaved={async () => { setPoLanjut(null); await onTersimpan(); }} />;
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Catat tagihan"
      description="Pilih asal tagihan, lalu cocokkan dengan faktur dari supplier."
      className="fin-tg-modal w-[1040px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
    >
      <div className="fin-tg-catat">
        <div className="fin-tg-asal-pilih" role="radiogroup" aria-label="Asal tagihan">
          {ASAL.map((a) => (
            <label key={a.key} className={cn("fin-tg-asal-kartu", asal === a.key && "aktif")} data-testid={`asal-${a.key}`}>
              <input type="radio" name={namaAsal} checked={asal === a.key} onChange={() => setAsal(a.key)} />
              <span className="fin-tg-asal-ikon" aria-hidden="true"><a.Ikon size={22} /></span>
              <span className="fin-tg-asal-teks"><strong>{a.judul}</strong><span>{a.ket}</span></span>
            </label>
          ))}
        </div>
        <Field label="Supplier" required htmlFor={idSupplier}>
          <PemilihSupplier id={idSupplier} suppliers={suppliers} value={supplierId} memuat={false} onPilih={setSupplierId} />
        </Field>
        {asal === "PO" && <JalurPO key="po" supplier={supplier} onLanjut={setPoLanjut} />}
        {asal !== "PO" && (
          <JalurManual
            key={asal} asal={asal} supplier={supplier} suppliers={suppliers} unbilled={unbilled} kategori={kategori} kategoriBeli={kategoriBeli} metodeInfo={metodeInfo}
            onBatal={onClose} onSimpan={async (body) => { await api.createFinanceBill(body); await onTersimpan(); }}
          />
        )}
      </div>
    </Modal>
  );
}
