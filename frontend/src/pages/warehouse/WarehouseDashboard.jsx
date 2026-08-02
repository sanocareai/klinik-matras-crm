import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import KpiCard from "@/features/laporan/components/KpiCard.jsx";
import { formatRupiahShort } from "@/utils/format.js";
import MockBadge from "@/features/warehouse/components/MockBadge.jsx";
import { StockHealthBars, CategoryBars } from "@/features/warehouse/components/StockDistribution.jsx";
import LowStockTable from "@/features/warehouse/components/LowStockTable.jsx";
import {
  IncomingGoodsTable, MaterialRequestTable, RecentMovementList, InventoryIssuesGrid,
} from "@/features/warehouse/components/DashboardQueues.jsx";
import {
  WAREHOUSE_KPI, STOCK_HEALTH, INVENTORY_BY_CATEGORY, lowStockItems,
  INCOMING_GOODS, MATERIAL_REQUESTS, RECENT_MOVEMENTS, INVENTORY_ISSUES,
} from "@/features/warehouse/data/warehouseMock.js";

// Warehouse Dashboard — Tahap 1.
//
// ⚠️ SELURUH angka di halaman ini DATA CONTOH (lihat catatan panjang di
// features/warehouse/data/warehouseMock.js). Badge "Contoh" dipasang di
// header DAN di tiap kartu yang memuat angka, bukan sekali saja di atas —
// orang jarang membaca halaman dari atas ke bawah.
//
// Judul "Warehouse & Inventory Control" TIDAK diulang di hero banner sesuai
// ketentuan; hero-nya dipakai sebagai ringkasan inventory yang benar-benar
// memberi informasi baru.

// Selector masih statis — belum ada entitas Warehouse/periode di backend, dan
// membuat dropdown yang tidak menyaring apa pun akan terbaca sebagai rusak.
const WAREHOUSES = [{ code: "WH-JKT", name: "Gudang Jakarta" }];

export default function WarehouseDashboard() {
  const navigate = useNavigate();
  const [warehouse, setWarehouse] = useState("WH-JKT");
  const lowStock = useMemo(() => lowStockItems(), []);

  return (
    <PageContainer>
      <PageHeader
        title={<span className="flex items-center gap-2">Warehouse &amp; Inventory Control <MockBadge /></span>}
        subtitle="Kelola stock, material movement, receiving, dan inventory accuracy dalam satu workspace."
        actions={
          <>
            <select
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              aria-label="Pilih warehouse"
              className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
            </select>
            <Button size="sm" onClick={() => navigate("/warehouse/goods-receipt")}>
              <Plus size={14} /> New Transaction
            </Button>
          </>
        }
      />

      <PageBody>
        {/* Hero = ringkasan inventory, BUKAN pengulangan judul halaman */}
        <Card className="bg-blue-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink2">Inventory Overview</h2>
              <MockBadge />
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink">
              <strong>{WAREHOUSE_KPI.totalActiveItems.toLocaleString("id-ID")}</strong> item aktif ·{" "}
              <strong>{WAREHOUSE_KPI.belowMinimumStock}</strong> item di bawah minimum stock ·{" "}
              <strong>{WAREHOUSE_KPI.pendingGoodsReceipt + WAREHOUSE_KPI.pendingMaterialIssue}</strong> transaksi menunggu approval ·{" "}
              <strong>{WAREHOUSE_KPI.openDiscrepancy}</strong> stock discrepancy membutuhkan review
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Active Items" numericValue={WAREHOUSE_KPI.totalActiveItems} sub="Item aktif" index={0} />
          <KpiCard label="Available Stock Value" numericValue={WAREHOUSE_KPI.availableStockValue} format={formatRupiahShort} sub="Nilai stok tersedia" index={1} />
          <KpiCard label="Below Minimum Stock" numericValue={WAREHOUSE_KPI.belowMinimumStock} sub="Perlu replenishment" index={2} />
          <KpiCard label="Out of Stock" numericValue={WAREHOUSE_KPI.outOfStock} sub="Stok habis" index={3} />
          <KpiCard label="Pending Goods Receipt" numericValue={WAREHOUSE_KPI.pendingGoodsReceipt} sub="Penerimaan tertunda" index={4} />
          <KpiCard label="Pending Material Issue" numericValue={WAREHOUSE_KPI.pendingMaterialIssue} sub="Pengeluaran tertunda" index={5} />
          <KpiCard label="Stock Accuracy" numericValue={WAREHOUSE_KPI.stockAccuracy} format={(n) => `${n.toFixed(1)}%`} sub="Akurasi stok" index={6} />
          <KpiCard label="Open Discrepancy" numericValue={WAREHOUSE_KPI.openDiscrepancy} sub="Selisih belum selesai" index={7} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Stock Health <MockBadge /></CardTitle>
              <CardDescription>Sebaran status stok seluruh item.</CardDescription>
            </CardHeader>
            <CardContent><StockHealthBars data={STOCK_HEALTH} /></CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Inventory by Category <MockBadge /></CardTitle>
              <CardDescription>Jumlah item dan nilai stok per kategori.</CardDescription>
            </CardHeader>
            <CardContent><CategoryBars data={INVENTORY_BY_CATEGORY} /></CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Low Stock Alert <MockBadge /></CardTitle>
            <CardDescription>Item yang sudah menyentuh atau di bawah minimum stock.</CardDescription>
          </CardHeader>
          <LowStockTable items={lowStock} onCreateReplenishment={() => navigate("/warehouse/replenishment")} />
        </Card>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Incoming Goods <MockBadge /></CardTitle>
              <CardDescription>Penerimaan barang yang dijadwalkan masuk.</CardDescription>
            </CardHeader>
            <IncomingGoodsTable rows={INCOMING_GOODS} />
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Recent Stock Movement <MockBadge /></CardTitle>
              <CardDescription>Pergerakan stok terbaru.</CardDescription>
            </CardHeader>
            <RecentMovementList rows={RECENT_MOVEMENTS} />
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Material Request Queue <MockBadge /></CardTitle>
            <CardDescription>Permintaan material dari Production yang perlu ditindak.</CardDescription>
          </CardHeader>
          <MaterialRequestTable rows={MATERIAL_REQUESTS} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Inventory Issues <MockBadge /></CardTitle>
            <CardDescription>Masalah inventory yang perlu ditindaklanjuti.</CardDescription>
          </CardHeader>
          <CardContent><InventoryIssuesGrid rows={INVENTORY_ISSUES} /></CardContent>
        </Card>
      </PageBody>
    </PageContainer>
  );
}
