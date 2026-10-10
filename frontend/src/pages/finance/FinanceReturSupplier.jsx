import React from "react";
import ReturSupplierWorkspace from "@/features/returSupplier/ReturSupplierWorkspace.jsx";

// RETUR SUPPLIER & DEBIT NOTE (Finance): nilai, persetujuan Debit Note, saldo kredit supplier. Pergerakan fisik tetap dikonfirmasi Gudang.
export default function FinanceReturSupplier() {
  return <ReturSupplierWorkspace workspace="FINANCE" />;
}
