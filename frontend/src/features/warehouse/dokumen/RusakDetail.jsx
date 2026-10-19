import React from "react";
import { api } from "@/api.js";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import { HalamanDokumen, KartuStatusDokumen, KartuAksiDokumen, useDokumen } from "./KartuDokumen.jsx";
import { KATEGORI_RUSAK, RESOLUSI_RUSAK } from "./labelDokumen.js";
import { teksJumlah, waktuTeks } from "./dokumenLogic.js";

// DETAIL BARANG RUSAK — halaman. Hanya penyelesaian "Dibuang" dan "Retur ke supplier" yang MENGURANGI stok (satu pergerakan WASTE); "Perbaiki ulang" dan "Kembalikan ke tersedia" hanya dicatat.
// Pilihan penyelesaian memuat dampak stoknya di labelnya, dan panel konfirmasi menyebut jumlah yang akan berkurang.
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();

export default function RusakDetail({ id, onTutup, onBerubah }) {
  const { r, galat, memuat, sibuk, setSibuk, versi, muat } = useDokumen(api.getDamagedStockRecord, id, onBerubah);
  const jalankan = async (kode, v = {}) => {
    setSibuk(true);
    try {
      if (kode === "MULAI_PERIKSA") await api.requestDamagedStockInspection(id);
      else if (kode === "SELESAIKAN") await api.resolveDamagedStock(id, { resolution: v.resolution, resolutionNote: v.catatan || undefined });
      await muat();
    } catch (e) { await muat(); throw e; } finally { setSibuk(false); }
  };
  if (!r) return <HalamanDokumen r={r} memuat={memuat} galat={galat} onTutup={onTutup} nama="laporan barang rusak" />;
  const t = r.tampilan; const u = satuan(r.material?.unit);
  const SPEC = {
    SELESAIKAN: { panel: { judul: "Selesaikan penanganan barang rusak", tombol: "Simpan penyelesaian", peringatan: `Dibuang atau Retur ke supplier: stok BERKURANG ${teksJumlah(r.qty)} ${u} sekarang (satu pergerakan, tidak bisa dibatalkan dari sini; salah input lewat jalur koreksi resmi). Pilihan lain hanya dicatat.`,
      bidang: [{ nama: "resolution", label: "Penyelesaian", tipe: "pilih", wajib: true, awal: "", opsi: [{ nilai: "", label: "Pilih penyelesaian…" }, ...RESOLUSI_RUSAK.map((x) => ({ nilai: x.nilai, label: x.label }))] }, { nama: "catatan", label: "Catatan penyelesaian", tipe: "area", maks: 300 }] } },
  };
  const selesai = r.status === "RESOLVED"; const res = RESOLUSI_RUSAK.find((x) => x.nilai === r.resolution);
  const identitas = [
    { label: "No. laporan", isi: r.recordNumber, testid: "id-nomor" }, { label: "Kategori", isi: KATEGORI_RUSAK[r.damageCategory] ?? r.damageCategory }, { label: "Lokasi", isi: r.location?.code }, { label: "Dilaporkan", isi: waktuTeks(r.reportedAt) },
    { label: "Bahan", isi: `${r.material?.code} — ${r.material?.name}`, lebar: true, testid: "id-bahan" }, { label: "Jumlah rusak", isi: `${teksJumlah(r.qty)} ${u}`, testid: "id-jumlah" }, { label: "Dilaporkan oleh", isi: r.reportedBy?.name },
    ...(selesai ? [{ label: "Penyelesaian", isi: res ? res.label.split(" — ")[0] : r.resolution, testid: "id-penyelesaian" }, { label: "Diselesaikan oleh", isi: r.resolvedBy?.name }, { label: "Diselesaikan", isi: waktuTeks(r.resolvedAt) }] : []),
  ];
  return (
    <HalamanDokumen judul={r.recordNumber} subjudul={`${r.material?.code} · ${teksJumlah(r.qty)} ${u} · ${KATEGORI_RUSAK[r.damageCategory] ?? r.damageCategory}`} onTutup={onTutup} r={r} memuat={memuat} galat={galat} onMuat={muat} nama="laporan barang rusak">
      <KartuStatusDokumen tampilan={t} identitas={identitas} alurLabel="Alur penanganan barang rusak" catatan={[r.notes, r.resolutionNote && `Catatan penyelesaian: ${r.resolutionNote}`].filter(Boolean).join(" — ") || undefined} />
      <KartuAksiDokumen tampilan={t} izin={r.izin} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} versi={versi} namaDokumen="laporan ini" kaki="Barang yang hilang di perjalanan transfer tidak diselesaikan lewat sini (saldonya sudah berkurang); lihat Selisih pada Transfer Stok." />
      <KartuJalurKoreksi tipe="DAMAGED_STOCK" id={id} versi={`${r.status}-${versi}`} ringkas />
      <JejakDokumen jejak={r.jejak} basePath="/warehouse/adjustments/damaged" />
    </HalamanDokumen>
  );
}
