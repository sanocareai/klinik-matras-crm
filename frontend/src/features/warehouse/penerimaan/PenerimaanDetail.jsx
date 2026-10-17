import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Info, AlertTriangle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import SumberPO from "@/features/warehouse/components/SumberPO.jsx";
import JejakPemakaianPenerimaan from "@/features/warehouse/components/JejakPemakaianPenerimaan.jsx";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import KoreksiPenerimaanModal from "@/features/warehouse/koreksi/KoreksiPenerimaanModal.jsx";
import AksiDokumen from "@/features/warehouse/aksi/AksiDokumen.jsx";
import AlurPenerimaan from "./AlurPenerimaan.jsx";
import TabelPerItem from "./TabelPerItem.jsx";
import { ModalCatatKedatangan, ModalKoreksiKedatangan } from "@/features/kedatangan/PanelKedatangan.jsx";
import { LABEL_WORKSPACE, tanggalTeks, waktuTeks } from "@/features/kedatangan/kedatanganLogic.js";
import { teksJumlah } from "@/features/finance/purchaseOrderLogic.js";
import { barisPerItem, galatIsianPemeriksaan, identitasPenerimaan, penerimaanLainSamaPO, tanggalPendek } from "./penerimaanLogic.js";
import { UNIT_LABEL } from "../inventoryReal.js";

// DETAIL PENERIMAAN BARANG — satu HALAMAN (bukan drawer yang ditimpa modal). Urutan baca petugas: identitas dokumen → alur (PO → jadwal → tiba → periksa → stok) → pengaruh ke stok →
// per item (pesan · dijadwalkan · tiba · diterima · masuk stok) → aksi yang relevan untuk status ini → progres pemakaian. Status, tahap, dan aksi datang dari server (`tampilan`).
// Sesudah masuk stok tidak ada Undo/Hapus: satu aksi "Koreksi" yang menjelaskan dampak (Koreksi Kedatangan resmi untuk PO; koreksi bertaut untuk non-PO).
// Satuan tampil: label Indonesia bila ada, selain itu kode huruf kecil.
const satuanTampil = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const BADGE = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };

// Aksi → isian kecil di tempat (tanpa modal).
const SPEC = {
  UBAH_JADWAL: { panel: { judul: "Ubah jadwal kedatangan", tombol: "Simpan jadwal", peringatan: "Hanya jadwal penerimaan ini (Gudang). Estimasi tiba pada PO tetap milik Finance.", bidang: [{ nama: "tanggal", label: "Jadwal kedatangan baru", tipe: "date", wajib: true }] } },
  KEMBALI_DRAFT: { panel: { judul: "Kembalikan ke Draf?", tombol: "Kembalikan ke Draf", peringatan: "Penerimaan menjadi Draf lagi (belum dijadwalkan). Stok tidak berubah.", bidang: [{ nama: "alasan", label: "Alasan (opsional)", maks: 300 }] } },
  BATALKAN_JADWAL: { panel: { judul: "Batalkan penerimaan ini?", tombol: "Ya, batalkan", peringatan: "Dokumen tidak dihapus: tersimpan sebagai Dibatalkan beserta alasan. PO tidak berubah dan jadwal baru bisa dibuat dari PO.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
  TOLAK: { panel: { judul: "Tolak barang ini?", tombol: "Tolak penerimaan", peringatan: "Dipakai bila barang sudah tiba lalu ditolak seluruhnya. Tidak menambah stok.", bidang: [{ nama: "alasan", label: "Alasan penolakan", wajib: true, min: 3, maks: 300 }] } },
};

export default function PenerimaanDetail() {
  const { id } = useParams();
  const [r, setR] = useState(null); const [semua, setSemua] = useState([]); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [sibuk, setSibuk] = useState(false);
  const [isian, setIsian] = useState({}); const [versi, setVersi] = useState(0);
  const [tibaPO, setTibaPO] = useState(null); const [koreksiPO, setKoreksiPO] = useState(null); const [koreksiGR, setKoreksiGR] = useState(false);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try {
      const d = await api.getGoodsReceipt(id); setR(d); setIsian({});
      if (d.purchaseOrderId) { const l = await api.getGoodsReceipts({}); setSemua(l.receipts ?? []); } else setSemua([]);
    } catch (e) { setGalat(e.message || "Gagal memuat penerimaan"); } finally { setMemuat(false); setVersi((v) => v + 1); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);

  const t = r?.tampilan; const baris = useMemo(() => (r ? barisPerItem(r) : []), [r]);
  const ident = r ? identitasPenerimaan(r) : null; const lain = r ? penerimaanLainSamaPO(r, semua) : [];
  const bisaPeriksa = !!t?.aksi.some((a) => a.kode === "ISI_PEMERIKSAAN"); const tibaBisaDiisi = bisaPeriksa && !r?.purchaseOrderId;
  const galatDini = galatIsianPemeriksaan(Object.assign({}, ...Object.values(isian)));
  const adaIsian = Object.keys(isian).length > 0;

  async function simpanIsian() {
    const ops = Object.entries(isian).map(([lineId, p]) => { const body = {}; for (const k of ["receivedQty", "acceptedQty", "rejectedQty", "condition"]) if (k in p) body[k] = p[k]; return api.updateGoodsReceiptLine(id, lineId, body); });
    await Promise.all(ops);
  }
  const jalankan = async (kode, v = {}) => {
    if (galatDini && ["SIMPAN_KE_STOK", "MAJUKAN", "ISI_PEMERIKSAAN", "TANDAI_TIBA"].includes(kode)) throw new Error(galatDini); // isian pemeriksaan belum valid
    setSibuk(true);
    try {
      if (kode === "UBAH_JADWAL") await api.updateGoodsReceipt(id, { expectedDate: v.tanggal });
      else if (kode === "KEMBALI_DRAFT") await api.kembaliDraftGoodsReceipt(id, v.alasan);
      else if (kode === "BATALKAN_JADWAL") await api.batalkanJadwalGoodsReceipt(id, v.alasan);
      else if (kode === "TOLAK") await api.rejectGoodsReceipt(id, v.alasan);
      else if (kode === "JADWALKAN") await api.updateGoodsReceipt(id, { status: "SCHEDULED" });
      else if (kode === "TANDAI_TIBA" || kode === "MAJUKAN") { if (adaIsian) await simpanIsian(); const urut = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]; await api.updateGoodsReceipt(id, { status: urut[urut.indexOf(r.status) + 1] }); }
      else if (kode === "SIMPAN_KE_STOK") { if (adaIsian) await simpanIsian(); await api.putawayGoodsReceipt(id); }
      else if (kode === "ISI_PEMERIKSAAN") { await simpanIsian(); }
      else if (kode === "CATAT_TIBA") { setTibaPO(await api.getBarangAkanDatangDetail(r.purchaseOrderId)); return; }
      else if (kode === "KOREKSI_KEDATANGAN") { setKoreksiPO(await api.getBarangAkanDatangDetail(r.purchaseOrderId)); return; }
      else if (kode === "KOREKSI_PENERIMAAN") { setKoreksiGR(true); return; }
      await muat();
    } finally { setSibuk(false); }
  };
  // Aksi pemeriksaan tampil sebagai tombol simpan isian hanya bila ada isian; selebihnya isian langsung di tabel.
  const aksiTampil = (t?.aksi ?? []).filter((a) => !(a.kode === "ISI_PEMERIKSAAN" && !adaIsian));
  const aksiLabel = aksiTampil.map((a) => (a.kode === "SIMPAN_KE_STOK" ? { ...a, label: "Simpan ke Stok" } : a.kode === "ISI_PEMERIKSAAN" ? { ...a, label: "Simpan hasil pemeriksaan" } : a));

  if (memuat && !r) return <PageContainer><PageBody><p className="flex items-center gap-1.5 py-8 text-[13px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat penerimaan…</p></PageBody></PageContainer>;
  if (galat && !r) return <PageContainer><PageBody><p role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{galat}</p><Link to="/warehouse/goods-receipt" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent"><ArrowLeft size={13} /> Kembali ke Penerimaan Barang</Link></PageBody></PageContainer>;
  if (!r) return null;
  const koreksiRelevan = r.status === "COMPLETED";

  return (
    <PageContainer>
      <PageHeader
        title={r.receiptNumber}
        subtitle={<span data-testid="identitas-ringkas">{ident.nomorPO ? <>PO <strong>{ident.nomorPO}</strong> · </> : "Tanpa PO · "}{ident.supplier ?? "supplier belum diisi"}</span>}
        actions={<Link to="/warehouse/goods-receipt" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent max-sm:min-h-11"><ArrowLeft size={13} /> Penerimaan Barang</Link>}
      />
      <PageBody>
        <Card className="space-y-3 p-4" data-testid="kartu-identitas">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE[t.warna] ?? "neutral"} data-testid="status-penerimaan" data-kode={t.kode}>{t.label}</Badge>
            <SumberPO receipt={r} />
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
            <div><dt className="text-ink3">No. penerimaan</dt><dd className="m-0 font-semibold text-ink" data-testid="id-nomor">{ident.nomor}</dd></div>
            <div><dt className="text-ink3">No. PO</dt><dd className="m-0 font-semibold text-ink" data-testid="id-po">{ident.nomorPO ?? "—"}</dd></div>
            <div><dt className="text-ink3">Supplier</dt><dd className="m-0 font-medium text-ink">{ident.supplier ?? "—"}</dd></div>
            <div><dt className="text-ink3">Jadwal kedatangan</dt><dd className="m-0 font-medium text-ink" data-testid="id-jadwal">{tanggalPendek(ident.jadwal)}</dd></div>
            <div><dt className="text-ink3">Dibuat oleh</dt><dd className="m-0 font-medium text-ink" data-testid="id-pembuat">{ident.pembuat ?? "—"}</dd></div>
            <div><dt className="text-ink3">Dibuat pada</dt><dd className="m-0 font-medium text-ink">{ident.dibuat ?? "—"}</dd></div>
            <div><dt className="text-ink3">Jumlah item</dt><dd className="m-0 font-medium text-ink">{ident.jumlahItem}</dd></div>
            <div><dt className="text-ink3">Tanggal diterima</dt><dd className="m-0 font-medium text-ink">{r.receivedDate ? tanggalPendek(r.receivedDate) : "—"}</dd></div>
          </dl>
          <AlurPenerimaan tampilan={t} dariPO={!!r.purchaseOrderId} />
          <p className={`m-0 flex items-start gap-1.5 rounded-btn px-3 py-2 text-[12.5px] leading-snug ${t.pengaruhStok === "SUDAH" ? "bg-greenbg text-green" : "bg-inset text-ink2"}`} data-testid="penjelasan-status"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /><span>{t.penjelasan}</span></p>
          {r.notes && <p className="m-0 text-[12px] text-ink2" data-testid="catatan-dokumen">{r.notes}</p>}
        </Card>

        {lain.length > 0 && (
          <div className="flex items-start gap-2 rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5 text-[12.5px] text-ink2" data-testid="penerimaan-lain-po" role="note">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />
            <div>
              <p className="m-0 font-semibold text-ink">PO {ident.nomorPO} punya {lain.length} penerimaan lain yang masih berjalan</p>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                {lain.map((x) => <li key={x.id}><Link to={`/warehouse/goods-receipt/${x.id}`} className="font-semibold text-accent">{x.receiptNumber}</Link> · {x.tampilan?.label ?? x.status} · dibuat {x.createdBy?.name ?? "—"} · jadwal {tanggalPendek(x.expectedDate)}</li>)}
              </ul>
              <p className="m-0 mt-1 text-ink3">Ini dokumen yang berbeda. Jumlah baik tidak boleh melebihi sisa PO, dan sistem tidak menggabungkan atau menganggapnya duplikat.</p>
            </div>
          </div>
        )}

        {r.purchaseOrderId && r.arrivedDate && (
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-btn bg-inset px-3 py-2 text-[12px]" data-testid="info-kedatangan">
            <div><dt className="text-ink3">Tanggal barang tiba</dt><dd className="m-0 font-medium text-ink">{tanggalTeks(r.arrivedDate)}</dd></div>
            <div><dt className="text-ink3">PIC / penerima</dt><dd className="m-0 font-medium text-ink">{r.arrivalReceiver}</dd></div>
            <div><dt className="text-ink3">Dicatat dari</dt><dd className="m-0 font-medium text-ink">{LABEL_WORKSPACE[r.arrivalWorkspace] ?? r.arrivalWorkspace} · {waktuTeks(r.arrivalRecordedAt)}</dd></div>
            <div><dt className="text-ink3">Surat jalan</dt><dd className="m-0 font-medium text-ink">{r.deliveryNote || "—"}</dd></div>
            <div className="col-span-2"><dt className="text-ink3">Catatan kedatangan</dt><dd className="m-0 font-medium text-ink">{r.arrivalNote}</dd></div>
          </dl>
        )}
        {r.purchaseOrderId ? (
          <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[12px] text-accent" data-testid="sumber-po">Dari <strong>{r.purchaseOrder?.poNumber}</strong>. Supplier dan item berasal dari PO (milik Finance). Jumlah baik tidak boleh melebihi sisa PO; kelebihan ditangani Finance lewat revisi jumlah PO. Pembayaran PO tidak bergantung pada barang tiba.</p>
        ) : (
          <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="sumber-tanpa-po">Penerimaan ini <strong>tanpa PO</strong>: tidak ada pencocokan jumlah dan harga terhadap pesanan.</p>
        )}

        <Card className="space-y-3 p-4">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Per item — cocokkan pesanan, jadwal, kedatangan, dan stok</h3>
          <TabelPerItem rows={baris} editable={bisaPeriksa ? { tiba: tibaBisaDiisi } : null} nilai={isian} onUbah={(lineId, f, v) => setIsian((x) => ({ ...x, [lineId]: { ...x[lineId], [f]: v } }))} />
          {r.lines.filter((l) => l.purchaseOrderLine?.purchaseUnit).map((l) => (
            <p key={l.id} className="m-0 text-[11.5px] font-medium text-accent" data-testid="konversi-penerimaan">
              {l.material.code}: hitung dalam {satuanTampil(l.purchaseOrderLine.purchaseUnit)} sesuai PO. 1 {satuanTampil(l.purchaseOrderLine.purchaseUnit)} = {teksJumlah(Number(l.purchaseOrderLine.conversionFactor))} {satuanTampil(l.material.unit)}
              {" — "}Simpan ke Stok menambah {teksJumlah(Math.round(Number(l.acceptedQty ?? 0) * Number(l.purchaseOrderLine.conversionFactor) * 1e4) / 1e4)} {satuanTampil(l.material.unit)}.
            </p>
          ))}
          {r.poRingkas?.lines?.map((q) => <p key={q.id} className="m-0 text-[11px] text-ink2" data-testid="progres-po-baris">PO {r.lines.find((x) => x.purchaseOrderLineId === q.id)?.material?.code ?? ""}: dipesan {teksJumlah(q.progres.dipesan)} · datang {teksJumlah(q.progres.datang)} · belum datang {teksJumlah(q.progres.belumDatang)} · masuk stok {teksJumlah(q.progres.masukStok)} · <strong>belum masuk stok {teksJumlah(q.progres.belumMasukStok)}</strong></p>)}
          {galatDini && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-isian">{galatDini}</p>}
        </Card>

        <Card className="space-y-2 p-4" data-testid="kartu-aksi">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Yang bisa dilakukan sekarang</h3>
          {t.status === "READY_FOR_PUTAWAY" && <p className="m-0 text-[11.5px] leading-snug text-ink2">Hanya barang yang dinyatakan baik yang masuk ke stok. Tindakan ini menambah persediaan dan membuat jurnal penerimaan secara otomatis.</p>}
          {t.status === "READY_FOR_PUTAWAY" && <p className="m-0 text-[11.5px] leading-snug text-ink3" data-testid="petunjuk-simpan-ke-stok-gudang">Simpan ke Stok hanya menambah stok. Faktur supplier dicatat dan disetujui Finance secara terpisah — bukan dari tombol ini.</p>}
          {aksiLabel.length === 0 ? <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-aksi">Tidak ada aksi untuk dokumen ini. {t.penjelasan}</p> : (
            <AksiDokumen aksi={aksiLabel} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} ikutiVersi={versi} />
          )}
          {r.purchaseOrderId && r.status === "SCHEDULED" && <p className="m-0 text-[11.5px] text-ink3">“Catat barang tiba” membuka formulir kedatangan resmi (tanggal tiba, penerima, surat jalan). Menjadwalkan atau membatalkan tidak mengubah PO.</p>}
        </Card>

        {(koreksiRelevan || ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"].includes(r.status)) && (
          <KartuJalurKoreksi tipe="GOODS_RECEIPT" id={id} versi={`${r.status}-${versi}`} ringkas aksi={{ KOREKSI_PENERIMAAN: () => setKoreksiGR(true), KOREKSI_KEDATANGAN: async () => { setKoreksiPO(await api.getBarangAkanDatangDetail(r.purchaseOrderId)); } }} />
        )}

        {["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"].includes(r.status) && (
          <Card className="p-4"><h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Progres bahan ini</h3><JejakPemakaianPenerimaan receiptId={id} status={r.status} /></Card>
        )}
        {galat && <p role="alert" className="text-[12px] text-red">{galat}</p>}
        <Button variant="ghost" size="sm" onClick={muat} disabled={memuat} className="self-start max-sm:min-h-11" data-testid="muat-ulang">{memuat ? <Loader2 size={14} className="animate-spin" /> : null} Muat ulang</Button>
      </PageBody>

      {koreksiGR && <KoreksiPenerimaanModal receiptId={id} onClose={() => setKoreksiGR(false)} onDone={() => muat()} />}
      {koreksiPO && <ModalKoreksiKedatangan po={koreksiPO} receipt={koreksiPO.penerimaan.find((x) => x.id === id) ?? null} workspace="GUDANG" onClose={() => setKoreksiPO(null)} onDone={() => { setKoreksiPO(null); muat(); }} />}
      {tibaPO && <ModalCatatKedatangan po={tibaPO} receipt={tibaPO.penerimaan.find((x) => x.id === id) ?? null} workspace="GUDANG" onClose={() => setTibaPO(null)} onDone={() => { setTibaPO(null); muat(); }} />}
    </PageContainer>
  );
}
