import React from "react";
import { useParams } from "react-router-dom";
import { api } from "@/api.js";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import { HalamanDokumen, KartuStatusDokumen, KartuAksiDokumen, useDokumen } from "./KartuDokumen.jsx";
import { JENIS_RETUR, RESOLUSI_RETUR } from "./labelDokumen.js";
import { teksJumlah, waktuTeks } from "./dokumenLogic.js";

// DETAIL RETUR — halaman. Alur: Dicatat → Diterima → Diperiksa → Selesai. Hanya penyelesaian "Kembalikan ke tersedia" yang MENAMBAH stok (satu pergerakan RETURN); pilihan lain hanya dicatat.
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();

export default function ReturDetail() {
  const { id } = useParams();
  const { r, galat, memuat, sibuk, setSibuk, versi, muat } = useDokumen(api.getReturnRecord, id);
  const jalankan = async (kode, v = {}) => {
    setSibuk(true);
    try {
      if (kode === "TERIMA_RETUR") await api.updateReturnRecord(id, { status: "RECEIVED" });
      else if (kode === "PERIKSA_RETUR") await api.updateReturnRecord(id, { status: "INSPECTION", inspectionNote: v.catatan || undefined });
      else if (kode === "SELESAIKAN") await api.completeReturnRecord(id, v.resolution);
      else if (kode === "UBAH") await api.updateReturnRecord(id, { condition: v.condition, notes: v.notes, ...(r.status === "INSPECTION" && { inspectionNote: v.inspectionNote }) });
      else if (kode === "BATALKAN") await api.cancelReturnRecord(id, v.alasan);
      await muat();
    } catch (e) { await muat(); throw e; } finally { setSibuk(false); }
  };
  if (!r) return <HalamanDokumen r={r} memuat={memuat} galat={galat} kembali={{ to: "/warehouse/adjustments?tab=returns", label: "Retur" }} nama="retur" />;
  const t = r.tampilan; const u = satuan(r.material?.unit);
  const SPEC = {
    PERIKSA_RETUR: { panel: { judul: "Mulai periksa barang retur?", tombol: "Mulai periksa", peringatan: "Belum memengaruhi stok. Hasil pemeriksaan boleh diisi sekarang atau nanti lewat Ubah data.", bidang: [{ nama: "catatan", label: "Catatan pemeriksaan (opsional)", tipe: "area", maks: 300 }] } },
    SELESAIKAN: { panel: { judul: "Selesaikan retur", tombol: "Simpan penyelesaian", peringatan: `Hanya "Kembalikan ke tersedia" yang MENAMBAH stok sebesar ${teksJumlah(r.qty)} ${u} sekarang (satu pergerakan; salah input lewat jalur koreksi resmi). Pilihan lain hanya dicatat.`,
      bidang: [{ nama: "resolution", label: "Penyelesaian", tipe: "pilih", wajib: true, awal: "", opsi: [{ nilai: "", label: "Pilih penyelesaian…" }, ...RESOLUSI_RETUR.map((x) => ({ nilai: x.nilai, label: x.label }))] }] } },
    UBAH: { panel: { judul: "Ubah data retur", tombol: "Simpan perubahan", peringatan: "Kondisi dan catatan boleh diperbaiki selama belum selesai; perubahan tercatat di riwayat.", bidang: [{ nama: "condition", label: "Kondisi barang", maks: 200, awal: r.condition ?? "" }, { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }, ...(r.status === "INSPECTION" ? [{ nama: "inspectionNote", label: "Hasil pemeriksaan", tipe: "area", maks: 300, awal: r.inspectionNote ?? "" }] : [])] } },
    BATALKAN: { panel: { judul: "Batalkan retur ini?", tombol: "Ya, batalkan", peringatan: "Dokumen tersimpan sebagai Dibatalkan beserta alasan. Stok tidak berubah.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
  };
  const selesai = r.status === "COMPLETED"; const res = RESOLUSI_RETUR.find((x) => x.nilai === r.resolution);
  const identitas = [
    { label: "No. retur", isi: r.returnNumber, testid: "id-nomor" }, { label: "Jenis", isi: JENIS_RETUR[r.returnType] ?? r.returnType }, { label: "Referensi", isi: r.reference || "—" }, { label: "Dicatat", isi: waktuTeks(r.createdAt) },
    { label: "Bahan", isi: `${r.material?.code} — ${r.material?.name}`, lebar: true, testid: "id-bahan" }, { label: "Jumlah retur", isi: `${teksJumlah(r.qty)} ${u}`, testid: "id-jumlah" }, { label: "Kondisi", isi: r.condition || "—" },
    { label: "Dicatat oleh", isi: r.createdBy?.name }, { label: "Diterima", isi: r.receivedAt ? waktuTeks(r.receivedAt) : "—" }, { label: "Diperiksa", isi: r.inspectedAt ? waktuTeks(r.inspectedAt) : "—" },
    ...(selesai ? [{ label: "Penyelesaian", isi: res ? res.label.split(" — ")[0] : r.resolution, testid: "id-penyelesaian" }] : []),
  ];
  return (
    <HalamanDokumen judul={r.returnNumber} subjudul={`${JENIS_RETUR[r.returnType] ?? r.returnType} · ${r.material?.code} · ${teksJumlah(r.qty)} ${u}`} kembali={{ to: "/warehouse/adjustments?tab=returns", label: "Retur" }} r={r} memuat={memuat} galat={galat} onMuat={muat} nama="retur">
      <KartuStatusDokumen tampilan={t} identitas={identitas} alurLabel="Alur retur" catatan={[r.notes, r.inspectionNote && `Hasil pemeriksaan: ${r.inspectionNote}`].filter(Boolean).join(" — ") || undefined} />
      <KartuAksiDokumen tampilan={t} izin={r.izin} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} versi={versi} namaDokumen="retur ini" />
      <KartuJalurKoreksi tipe="RETURN_RECORD" id={id} versi={`${r.status}-${versi}`} ringkas />
      <JejakDokumen jejak={r.jejak} basePath="/warehouse/adjustments/returns" />
    </HalamanDokumen>
  );
}
