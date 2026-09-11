import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import ActiveComplaintsWidget from "@/features/complaints/ActiveComplaintsWidget.jsx";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import KpiCard from "@/features/laporan/components/KpiCard.jsx";
import { formatRupiahShort } from "@/utils/format.js";
import { StockHealthBars, CategoryBars } from "@/features/warehouse/components/StockDistribution.jsx";
import LowStockTable from "@/features/warehouse/components/LowStockTable.jsx";
import {
  IncomingGoodsTable, MaterialRequestTable, RecentMovementList, InventoryIssuesGrid,
} from "@/features/warehouse/components/DashboardQueues.jsx";
import { deriveStockStatusReal } from "@/features/warehouse/inventoryReal.js";
import { api } from "@/api.js";

// Warehouse Dashboard — data NYATA (audit end-to-end 12 Sept 2026).
//
// SEBELUM INI seluruh halaman memakai features/warehouse/data/warehouseMock.js
// (badge "Contoh" di setiap kartu). Backend sudah lengkap sejak Tahap 1-8
// (GET /inventory/stock, /reports/summary, /goods-receipts, /material-issues,
// /movements, /damaged-stock, /returns) — halaman ini sekarang menariknya
// langsung, tidak ada satu pun angka contoh yang tersisa.
//
// Judul "Warehouse & Inventory Control" TIDAK diulang di hero banner sesuai
// ketentuan; hero-nya dipakai sebagai ringkasan inventory yang benar-benar
// memberi informasi baru.

// Selector masih statis — belum ada entitas Warehouse/periode di backend, dan
// membuat dropdown yang tidak menyaring apa pun akan terbaca sebagai rusak.
const WAREHOUSES = [{ code: "WH-JKT", name: "Gudang Jakarta" }];

const GOODS_RECEIPT_OPEN = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"];
const MATERIAL_ISSUE_OPEN = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"];

export default function WarehouseDashboard() {
  const navigate = useNavigate();
  const [warehouse, setWarehouse] = useState("WH-JKT");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [summary, stock, receipts, issues, movements, damaged, returns] = await Promise.all([
          api.getWarehouseReportSummary(),
          api.getStock(),
          api.getGoodsReceipts(),
          api.getMaterialIssues(),
          api.getStockMovements({ limit: 8 }),
          api.getDamagedStock(),
          api.getReturns(),
        ]);
        if (cancelled) return;
        setData({ summary, stock, receipts: receipts.receipts, issues: issues.issues, movements, damaged: damaged.records, returns: returns.records });
      } catch (err) {
        if (!cancelled) setError(err.message || "Gagal memuat data gudang");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const lowStock = useMemo(() => {
    if (!data) return [];
    return data.stock
      .filter((r) => {
        const status = deriveStockStatusReal(r);
        return status === "LOW_STOCK" || status === "OUT_OF_STOCK";
      })
      .map((r) => ({
        id: r.materialId, itemCode: r.code, name: r.name, category: r.category,
        available: r.available, unit: r.unit,
        minimumStock: r.reorderPoint ?? 0,
        shortage: Math.max(0, (r.reorderPoint ?? 0) - r.available),
      }))
      .sort((a, b) => a.available - b.available);
  }, [data]);

  const incomingGoods = useMemo(() => {
    if (!data) return [];
    return data.receipts
      .filter((r) => GOODS_RECEIPT_OPEN.includes(r.status))
      .slice(0, 8)
      .map((r) => ({
        id: r.receiptNumber, reference: r.sourceReference, supplier: r.supplier,
        expectedDate: r.expectedDate, itemCount: r.lines?.length ?? 0, status: r.status,
      }));
  }, [data]);

  const materialRequests = useMemo(() => {
    if (!data) return [];
    return data.issues
      .filter((i) => MATERIAL_ISSUE_OPEN.includes(i.status))
      .slice(0, 8)
      .map((i) => ({
        id: i.issueNumber, department: i.department, requestedBy: i.requestedBy?.name || "—",
        totalItems: i.lines?.length ?? 0, requiredDate: i.requiredDate, priority: i.priority, status: i.status,
      }));
  }, [data]);

  const recentMovements = useMemo(() => {
    if (!data) return [];
    return data.movements.map((m) => ({
      id: m.id, type: m.type, itemName: m.material?.name || "—",
      reference: m.note || m.reason || "—", user: m.createdBy?.name || "Sistem",
      at: m.createdAt, qty: Number(m.qty), unit: m.material?.unit || "",
    }));
  }, [data]);

  const stockHealth = useMemo(() => {
    if (!data) return [];
    const counts = { IN_STOCK: 0, LOW_STOCK: 0, OUT_OF_STOCK: 0, INACTIVE: 0 };
    for (const r of data.stock) counts[deriveStockStatusReal(r)]++;
    return Object.entries(counts).map(([key, count]) => ({ key, count }));
  }, [data]);

  const inventoryIssues = useMemo(() => {
    if (!data) return [];
    const damagedOpen = data.damaged.filter((d) => d.status !== "RESOLVED").length;
    const returnsOpen = data.returns.filter((r) => r.status !== "COMPLETED" && r.status !== "CANCELLED").length;
    const rows = [
      { id: "out", count: data.summary.totals.outOfStock, severity: "red", label: "Out of Stock", labelId: "Stok habis" },
      { id: "low", count: data.summary.totals.lowStock, severity: "orange", label: "Low Stock", labelId: "Stok menipis" },
      { id: "damaged", count: damagedOpen, severity: "orange", label: "Damaged Stock", labelId: "Barang rusak belum selesai" },
      { id: "returns", count: returnsOpen, severity: "accent", label: "Open Returns", labelId: "Retur belum selesai" },
      { id: "discrepancy", count: data.summary.totals.openDiscrepancy, severity: "accent", label: "Open Discrepancy", labelId: "Selisih menunggu review" },
    ];
    return rows;
  }, [data]);

  if (loading) {
    return (
      <PageContainer>
        <PageHeader title="Operasional Gudang" subtitle="Memuat data..." />
        <PageBody><Card><CardContent className="py-10 text-center text-ink2">Memuat ringkasan gudang…</CardContent></Card></PageBody>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <PageHeader title="Operasional Gudang" subtitle="Kelola stok, pergerakan material, penerimaan barang, dan akurasi inventory dalam satu workspace." />
        <PageBody>
          <Card><CardContent className="py-10"><EmptyState title="Gagal memuat data gudang" description={error} /></CardContent></Card>
        </PageBody>
      </PageContainer>
    );
  }

  const t = data.summary.totals;
  const pendingTransactions = t.pendingGoodsReceipt + t.pendingMaterialIssue;

  return (
    <PageContainer>
      <PageHeader
        title="Operasional Gudang"
        subtitle="Kelola stok, pergerakan material, penerimaan barang, dan akurasi inventory dalam satu workspace."
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
              <Plus size={14} /> Transaksi Baru
            </Button>
          </>
        }
      />

      <PageBody>
        {/* Kasus Komplain Aktif (D-116, 11 September 2026) — "komplain itu
            prioritas". currentOwner="WAREHOUSE" — Material Requirement yang
            butuh diproses SEKARANG, bukan seluruh kasus lintas divisi (itu
            ada di /komplain). */}
        <ActiveComplaintsWidget currentOwner="WAREHOUSE" title="Kasus Komplain Butuh Material" />

        {/* Hero = ringkasan inventory, BUKAN pengulangan judul halaman */}
        <Card className="bg-blue-50">
          <CardContent className="py-4">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink2">Ringkasan Inventory</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink">
              <strong>{t.totalItems.toLocaleString("id-ID")}</strong> item aktif ·{" "}
              <strong>{t.lowStock}</strong> item di bawah titik pesan ulang ·{" "}
              <strong>{pendingTransactions}</strong> transaksi menunggu tindak lanjut ·{" "}
              <strong>{t.openDiscrepancy}</strong> selisih stok butuh review
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Item Aktif" numericValue={t.totalItems} sub="Item aktif" index={0} />
          <KpiCard
            label="Nilai Stok (Sebagian)"
            numericValue={data.summary.inventoryValuePartial.value}
            format={formatRupiahShort}
            sub={`${data.summary.inventoryValuePartial.itemsWithCost} dari ${t.totalItems} item punya data harga`}
            index={1}
          />
          <KpiCard label="Di Bawah Minimum" numericValue={t.lowStock} sub="Perlu restok" index={2} />
          <KpiCard label="Stok Habis" numericValue={t.outOfStock} sub="Out of stock" index={3} />
          <KpiCard label="Penerimaan Tertunda" numericValue={t.pendingGoodsReceipt} sub="Goods receipt belum selesai" index={4} />
          <KpiCard label="Pengeluaran Tertunda" numericValue={t.pendingMaterialIssue} sub="Material issue belum selesai" index={5} />
          <KpiCard
            label="Akurasi Stok Opname"
            numericValue={data.summary.stockAccuracy.percentage ?? 0}
            format={(n) => (data.summary.stockAccuracy.percentage == null ? "—" : `${n.toFixed(1)}%`)}
            sub={`${data.summary.stockAccuracy.totalCounted} baris dihitung`}
            index={6}
          />
          <KpiCard label="Selisih Terbuka" numericValue={t.openDiscrepancy} sub="Stock count + penyesuaian menunggu" index={7} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Kesehatan Stok</CardTitle>
              <CardDescription>Sebaran status stok seluruh item.</CardDescription>
            </CardHeader>
            <CardContent><StockHealthBars data={stockHealth} /></CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory per Kategori</CardTitle>
              <CardDescription>Jumlah item aktif per kategori.</CardDescription>
            </CardHeader>
            <CardContent><CategoryBars data={data.summary.byCategory.map((c) => ({ key: c.category, items: c.count }))} /></CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Stok Menipis</CardTitle>
            <CardDescription>Item yang sudah menyentuh atau di bawah titik pesan ulang (reorder point).</CardDescription>
          </CardHeader>
          <LowStockTable items={lowStock} onCreateReplenishment={() => navigate("/warehouse/replenishment")} />
        </Card>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Penerimaan Barang</CardTitle>
              <CardDescription>Goods receipt yang belum selesai (draft s/d siap ditempatkan).</CardDescription>
            </CardHeader>
            <IncomingGoodsTable rows={incomingGoods} />
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Pergerakan Stok Terbaru</CardTitle>
              <CardDescription>8 pergerakan ledger paling baru.</CardDescription>
            </CardHeader>
            <RecentMovementList rows={recentMovements} />
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Antrean Permintaan Material</CardTitle>
            <CardDescription>Permintaan material dari Produksi yang perlu ditindak.</CardDescription>
          </CardHeader>
          <MaterialRequestTable rows={materialRequests} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Masalah Inventory</CardTitle>
            <CardDescription>Masalah inventory yang perlu ditindaklanjuti.</CardDescription>
          </CardHeader>
          <CardContent><InventoryIssuesGrid rows={inventoryIssues} /></CardContent>
        </Card>
      </PageBody>
    </PageContainer>
  );
}
