import React from "react";
import { useParams } from "react-router-dom";
import ReturSupplierWorkspace from "@/features/returSupplier/ReturSupplierWorkspace.jsx";
import { useJendelaFokus } from "@/features/warehouse/dokumen/useJendelaFokus.js";

// RETUR SUPPLIER (Gudang): kondisi barang + konfirmasi barang keluar. Tanpa nilai rupiah. Status identik dengan Finance (data yang sama).
// UX Gudang Tahap 4: detail retur dikendalikan rute /warehouse/retur-supplier/:id (daftar tetap di belakang; Back/Tutup mengembalikan daftar).
export default function WarehouseReturSupplier() {
  const { id } = useParams(); const { buka, tutup } = useJendelaFokus("/warehouse/retur-supplier");
  return <ReturSupplierWorkspace workspace="GUDANG" bukaIdRute={id} bukaRute={(rid) => (rid ? buka(rid) : tutup())} />;
}
