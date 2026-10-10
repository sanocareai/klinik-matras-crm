import React from "react";
import ReturSupplierWorkspace from "@/features/returSupplier/ReturSupplierWorkspace.jsx";

// RETUR SUPPLIER (Gudang): kondisi barang + konfirmasi barang keluar. Tanpa nilai rupiah. Status identik dengan Finance (data yang sama).
export default function WarehouseReturSupplier() {
  return <ReturSupplierWorkspace workspace="GUDANG" />;
}
