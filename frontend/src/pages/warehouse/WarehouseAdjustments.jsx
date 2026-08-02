import React, { useState } from "react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import DamagedStockTab from "@/features/warehouse/components/DamagedStockTab.jsx";
import ReturnsTab from "@/features/warehouse/components/ReturnsTab.jsx";
import AdjustmentsTab from "@/features/warehouse/components/AdjustmentsTab.jsx";

// Damaged, Return & Adjustment — Warehouse Tahap 6. DATA NYATA.
//
// Ketiga sub-fitur memakai tipe movement yang SUDAH ADA sejak v1 (WASTE,
// RETURN, ADJUSTMENT) — tidak ada tipe movement baru. Bedanya dengan
// endpoint satu-langkah yang sudah ada (routes/inventory.js — TIDAK
// diubah): tiga dokumen di sini membungkus keputusan yang perlu ditinjau
// dulu sebelum ledger benar-benar tertulis. Lihat catatan panjang di
// schema.prisma di atas ketiga model untuk konsekuensi & batasan yang
// diakui sadar (terutama soal saldo yang tidak dipecah per lokasi/status).
export default function WarehouseAdjustments() {
  const [tab, setTab] = useState("damaged");

  return (
    <PageContainer>
      <PageHeader title="Damaged, Return & Adjustment" subtitle="Barang rusak, retur, dan penyesuaian stok yang perlu ditinjau." />
      <PageBody>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="damaged">Damaged Stock</TabsTrigger>
            <TabsTrigger value="returns">Returns</TabsTrigger>
            <TabsTrigger value="adjustments">Stock Adjustment</TabsTrigger>
          </TabsList>
          <TabsContent value="damaged" className="mt-4"><DamagedStockTab /></TabsContent>
          <TabsContent value="returns" className="mt-4"><ReturnsTab /></TabsContent>
          <TabsContent value="adjustments" className="mt-4"><AdjustmentsTab /></TabsContent>
        </Tabs>
      </PageBody>
    </PageContainer>
  );
}
