import React from "react";
import { Badge } from "@/components/ui/badge.jsx";

// Penanda sumber penerimaan: bertaut ke Purchase Order terdaftar, atau TANPA PO (jalur lama / dokumen historis).
// Dokumen lama TIDAK diubah — penanda ini murni turunan dari ada/tidaknya purchaseOrderId.
export default function SumberPO({ receipt, className }) {
  return receipt.purchaseOrderId ? (
    <Badge variant="accent" className={className} title={`Dari ${receipt.purchaseOrder?.poNumber || "Purchase Order"}`}>Dari PO</Badge>
  ) : (
    <Badge variant="neutral" className={className} title="Penerimaan ini tidak tertaut Purchase Order terdaftar">Tanpa PO</Badge>
  );
}
