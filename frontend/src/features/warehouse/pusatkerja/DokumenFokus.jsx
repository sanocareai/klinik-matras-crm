import React, { Suspense, lazy } from "react";
import { bisaFokus } from "./urlFokus.js";

// REGISTRI JENDELA FOKUS (UX Gudang Tahap 4): satu pintu yang memetakan jenis dokumen ke komponen detail yang SAMA dengan halaman daftarnya masing-masing — tidak ada detail kedua.
// Semua komponen menerima { id, onTutup, onBerubah } dan menampilkan FokusOverlay (satu lapisan, URL sudah berubah oleh pemanggil, Esc/Tutup memanggil onTutup).
const Penerimaan = lazy(() => import("@/features/warehouse/penerimaan/PenerimaanDetail.jsx"));
const PO = lazy(() => import("@/features/kedatangan/DetailPOFokus.jsx"));
const MI = lazy(() => import("@/features/warehouse/dokumen/MaterialIssueDetail.jsx"));
const Transfer = lazy(() => import("@/features/warehouse/dokumen/TransferDetail.jsx"));
const Opname = lazy(() => import("@/features/warehouse/dokumen/OpnameDetail.jsx"));
const Restok = lazy(() => import("@/features/warehouse/dokumen/RestokDetail.jsx"));
const Rusak = lazy(() => import("@/features/warehouse/dokumen/RusakDetail.jsx"));
const Retur = lazy(() => import("@/features/warehouse/dokumen/ReturDetail.jsx"));
const Penyesuaian = lazy(() => import("@/features/warehouse/dokumen/PenyesuaianDetail.jsx"));
const Koreksi = lazy(() => import("@/features/warehouse/koreksi/KoreksiFokus.jsx"));

const PoAdapter = ({ id, onTutup, onBerubah }) => <PO id={id} onClose={onTutup} onChanged={onBerubah} />;
const REGISTRI = { penerimaan: Penerimaan, po: PoAdapter, "pengeluaran-material": MI, transfer: Transfer, opname: Opname, restok: Restok, rusak: Rusak, retur: Retur, penyesuaian: Penyesuaian, koreksi: Koreksi };

export default function DokumenFokus({ jenis, id, onTutup, onBerubah }) {
  if (!id || !bisaFokus(jenis)) return null;
  const Komponen = REGISTRI[jenis];
  return <Suspense fallback={null}><Komponen key={`${jenis}:${id}`} id={id} onTutup={onTutup} onBerubah={onBerubah} /></Suspense>;
}
