import React from "react";
import { api } from "@/api.js";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import { HalamanDokumen, KartuStatusDokumen, KartuAksiDokumen, useDokumen } from "./KartuDokumen.jsx";
import { JENIS_PENYESUAIAN } from "./labelDokumen.js";
import { teksJumlah, waktuTeks } from "./dokumenLogic.js";
import { TriangleAlert } from "lucide-react";

// DETAIL PENYESUAIAN STOK — halaman. Stok baru berubah saat DIPOSTING. Persetujuan WAJIB orang lain berperan penyetuju (Owner/Finance) — aturan pemisahan tugas yang berlaku; tombol Setujui hanya ditawarkan kepada yang berhak,
// dan bila tidak ada, halaman menjelaskan mengapa. Saldo "sesudah" hanya perkiraan: saldo diperiksa ulang saat posting.
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const STATUS_MAJU = { AJUKAN: "WAITING_APPROVAL", SETUJUI: "APPROVED" };
const tanda = (n) => `${n > 0 ? "+" : ""}${teksJumlah(n)}`;

export default function PenyesuaianDetail({ id, onTutup, onBerubah }) {
  const { r, galat, memuat, sibuk, setSibuk, versi, muat } = useDokumen(api.getAdjustmentRequest, id, onBerubah);
  const jalankan = async (kode, v = {}) => {
    setSibuk(true);
    try {
      if (STATUS_MAJU[kode]) await api.updateAdjustmentRequest(id, { status: STATUS_MAJU[kode] });
      else if (kode === "UBAH") await api.updateAdjustmentRequest(id, { reason: v.reason, notes: v.notes });
      else if (kode === "POSTING") await api.postAdjustmentRequest(id);
      else if (kode === "BATALKAN") await api.cancelAdjustmentRequest(id, v.alasan);
      await muat();
    } catch (e) { await muat(); throw e; } finally { setSibuk(false); }
  };
  if (!r) return <HalamanDokumen r={r} memuat={memuat} galat={galat} onTutup={onTutup} nama="penyesuaian stok" />;
  const t = r.tampilan; const u = satuan(r.material?.unit); const perkiraan = Math.round((Number(r.beforeQty) + Number(r.adjustmentQty)) * 10000) / 10000;
  const SPEC = {
    SETUJUI: { panel: { judul: "Setujui penyesuaian ini?", tombol: "Setujui", peringatan: "Persetujuan belum mengubah stok; stok berubah saat diposting.", ringkasan: [`${r.material?.code}: ${tanda(Number(r.adjustmentQty))} ${u} (saldo saat dibuat ${teksJumlah(r.beforeQty)} → perkiraan ${teksJumlah(perkiraan)})`], judulRingkasan: "Yang akan diposting nanti", bidang: [] } },
    POSTING: { panel: { judul: "Posting penyesuaian ke stok?", tombol: "Posting ke stok", peringatan: "Saldo berubah SEKARANG dan tidak bisa dibatalkan dari sini; salah input diperbaiki lewat jalur koreksi resmi. Sistem memeriksa saldo terbaru; bila hasilnya minus, posting ditolak.", ringkasan: [`${r.material?.code}: stok ${tanda(Number(r.adjustmentQty))} ${u}`], bidang: [] } },
    UBAH: { panel: { judul: "Ubah alasan / catatan", tombol: "Simpan perubahan", peringatan: "Jenis, bahan, dan jumlah tidak bisa diubah; bila salah, batalkan lalu buat penyesuaian baru. Perubahan tercatat di riwayat.", bidang: [{ nama: "reason", label: "Alasan", tipe: "area", wajib: true, min: 3, maks: 300, awal: r.reason ?? "" }, { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } },
    BATALKAN: { panel: { judul: "Batalkan penyesuaian ini?", tombol: "Ya, batalkan", peringatan: "Dokumen tersimpan sebagai Dibatalkan beserta alasan. Stok tidak berubah.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
  };
  const identitas = [
    { label: "No. penyesuaian", isi: r.adjustmentNumber, testid: "id-nomor" }, { label: "Jenis", isi: JENIS_PENYESUAIAN[r.adjustmentType] ?? r.adjustmentType }, { label: "Diajukan oleh", isi: r.requestedBy?.name, testid: "id-pemohon" }, { label: "Dibuat", isi: waktuTeks(r.createdAt) },
    { label: "Bahan", isi: `${r.material?.code} — ${r.material?.name}`, lebar: true, testid: "id-bahan" }, { label: "Perubahan stok", isi: `${tanda(Number(r.adjustmentQty))} ${u}`, testid: "id-perubahan" },
    { label: "Saldo saat dibuat", isi: `${teksJumlah(r.beforeQty)} ${u}` }, { label: "Perkiraan sesudah", isi: `${teksJumlah(perkiraan)} ${u}`, testid: "id-perkiraan" },
    { label: "Alasan", isi: r.reason, lebar: true }, ...(r.originType ? [{ label: "Asal koreksi", isi: `${r.asal?.label ?? r.originType}${r.asal?.unitCode ? ` · unit ${r.asal.unitCode}` : ""}`, lebar: true, testid: "id-asal" }] : []), { label: "Disetujui oleh", isi: r.approvedBy?.name, testid: "id-penyetuju" }, { label: "Diposting oleh", isi: r.postedBy?.name }, { label: "Diposting", isi: r.postedAt ? waktuTeks(r.postedAt) : "—" },
  ];
  return (
    <HalamanDokumen judul={r.adjustmentNumber} subjudul={`${JENIS_PENYESUAIAN[r.adjustmentType] ?? r.adjustmentType} · ${r.material?.code} · ${tanda(Number(r.adjustmentQty))} ${u}`} onTutup={onTutup} r={r} memuat={memuat} galat={galat} onMuat={muat} nama="penyesuaian stok" footer={<KartuAksiDokumen tampilan={t} izin={r.izin} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} versi={versi} namaDokumen="penyesuaian ini" kaki="Pemisahan tugas: pemohon tidak boleh menyetujui dokumennya sendiri, dan penyetuju harus berperan Owner/Finance." />}>
      <KartuStatusDokumen tampilan={t} identitas={identitas} alurLabel="Alur penyesuaian stok" catatan={r.notes} />
      {r.koreksiSaldo && (
        <div className="rounded-btn border border-line p-3 text-[12.5px]" data-testid="kartu-koreksi-saldo">
          <h4 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Koreksi saldo per bahan (dari Stok &amp; Lokasi)</h4>
          <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt className="text-ink3">Jumlah fisik yang dinyatakan pengaju</dt><dd className="text-right font-semibold tabular-nums text-ink" data-testid="ks-fisik">{teksJumlah(r.koreksiSaldo.jumlahFisik)} {u}</dd>
            <dt className="text-ink3">Saldo yang dilihat pengaju</dt><dd className="text-right tabular-nums text-ink2" data-testid="ks-dilihat">{teksJumlah(r.koreksiSaldo.saldoDilihat)} {u}</dd>
            <dt className="text-ink3">Keadaan saldo saat diajukan</dt><dd className="text-right text-ink2">{r.koreksiSaldo.keadaanAwalTeks}</dd>
            {["WAITING_APPROVAL", "APPROVED", "DRAFT"].includes(r.status) && <><dt className="text-ink3">Saldo di catatan sekarang</dt><dd className="text-right tabular-nums text-ink2" data-testid="ks-sekarang">{teksJumlah(r.koreksiSaldo.saldoSekarang)} {u}</dd></>}
          </dl>
          {r.koreksiSaldo.kedaluwarsa && <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-btn bg-redbg px-2.5 py-2 text-[12px] text-red" data-testid="ks-kedaluwarsa"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{r.koreksiSaldo.kedaluwarsaTeks}</p>}
        </div>
      )}
      <KartuJalurKoreksi tipe="STOCK_ADJUSTMENT" id={id} versi={`${r.status}-${versi}`} ringkas />
      <JejakDokumen jejak={r.jejak} basePath="/warehouse/adjustments/stock" />
    </HalamanDokumen>
  );
}
