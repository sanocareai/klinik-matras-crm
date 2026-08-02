import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "@/lib/dateRange.js";
import { KpiRowSkeleton, ChartGridSkeleton } from "@/features/laporan/components/LaporanSkeleton.jsx";
import ChartCard from "@/features/laporan/components/ChartCard.jsx";
import KpiCard from "@/features/laporan/components/KpiCard.jsx";
import BarRow from "@/features/laporan/components/BarRow.jsx";
import { formatRupiahShort } from "@/utils/format.js";
import {
  CATEGORY_REAL, DAMAGE_CATEGORY_REAL, ADJUSTMENT_TYPE_REAL,
} from "@/features/warehouse/inventoryReal.js";

// Warehouse Reports — Tahap 8, terakhir. Murni agregasi read-only di atas
// tabel yang sudah ada — TIDAK ADA migrasi schema.
//
// ⚠️ Inventory Value/Stock Adjustment Value/Damaged Stock Value dari
// spesifikasi TIDAK dihitung sebagai Rupiah lengkap — Material tidak
// punya kolom harga/costing. Inventory Value tampil PARSIAL (hanya item
// dengan unit cost tercatat, jumlah yang dikecualikan ditampilkan
// eksplisit); Adjustment & Damaged dilaporkan berbasis QUANTITY. Lihat
// catatan panjang di routes/warehouseReports.js.
function toneOf(t) {
  return t === "neutral" ? "muted" : t;
}

export default function WarehouseReports() {
  const [range, setRange] = useState(() => makeRange("last_30_days"));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const params = toApiParams(range);
    const setengahJadi = (!!range.from) !== (!!range.to);
    if (setengahJadi) return;
    setLoading(true);
    setError("");
    api.getWarehouseReportSummary(params)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const byCategoryMax = Math.max(1, ...(data?.byCategory || []).map((c) => c.count));
  const damageMax = Math.max(1, ...(data?.damageByCategory || []).map((c) => c.count));
  const adjustmentMax = Math.max(1, ...(data?.adjustmentByType || []).map((c) => c.count));

  return (
    <PageContainer>
      <PageHeader
        title="Warehouse Reports"
        subtitle="Nilai inventory, akurasi stok, dan pergerakan material."
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <PageBody>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {loading ? (
          <>
            <KpiRowSkeleton count={4} />
            <ChartGridSkeleton cols={2} height={260} />
          </>
        ) : data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Total Active Items" numericValue={data.totals.totalItems} index={0} />
              <KpiCard label="Low Stock Items" numericValue={data.totals.lowStock} index={1} />
              <KpiCard label="Out of Stock Items" numericValue={data.totals.outOfStock} index={2} />
              <KpiCard
                label="Stock Accuracy"
                numericValue={data.stockAccuracy.percentage ?? 0}
                format={(n) => (data.stockAccuracy.percentage == null ? "—" : `${n.toFixed(1)}%`)}
                sub={data.stockAccuracy.totalCounted ? `dari ${data.stockAccuracy.totalCounted} baris count` : "Belum ada Stock Count selesai"}
                index={3}
              />
              <KpiCard
                label="Inventory Value (Partial)"
                numericValue={data.inventoryValuePartial.value}
                format={formatRupiahShort}
                sub={`${data.inventoryValuePartial.itemsWithCost} item punya unit cost · ${data.inventoryValuePartial.itemsWithoutCost} tidak`}
                index={4}
              />
              <KpiCard
                label="Receipt Lead Time"
                numericValue={data.receiptLeadTime.avgDays ?? 0}
                format={(n) => (data.receiptLeadTime.avgDays == null ? "—" : `${n.toFixed(1)} hari`)}
                sub={data.receiptLeadTime.count ? `dari ${data.receiptLeadTime.count} receipt` : "Belum ada receipt dengan expected+received date"}
                index={5}
              />
              <KpiCard
                label="Material Issue Fulfillment"
                numericValue={data.issueFulfillment.percentage ?? 0}
                format={(n) => (data.issueFulfillment.percentage == null ? "—" : `${n.toFixed(1)}%`)}
                sub={data.issueFulfillment.totalLines ? `dari ${data.issueFulfillment.totalLines} baris` : "Belum ada Material Issue selesai"}
                index={6}
              />
              <KpiCard label="Slow/Dead Moving Items" numericValue={data.slowMoving.length} sub="≥60 hari tanpa pergerakan (top 20)" index={7} />
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <ChartCard title="Movement Trend" description="Jumlah dokumen selesai per jenis, dalam rentang tanggal terpilih." index={0}>
                <div className="space-y-2.5">
                  {[
                    { label: "Goods Receipt", value: data.movementTrend.goodsReceipt },
                    { label: "Material Issue", value: data.movementTrend.materialIssue },
                    { label: "Stock Transfer", value: data.movementTrend.stockTransfer },
                    { label: "Stock Adjustment", value: data.movementTrend.stockAdjustment },
                    { label: "Damaged Stock", value: data.movementTrend.damagedStock },
                  ].map((row) => (
                    <BarRow key={row.label} label={row.label} value={row.value}
                      max={Math.max(1, ...Object.values(data.movementTrend))} display={row.value} />
                  ))}
                </div>
              </ChartCard>

              <ChartCard
                title="Inventory by Category"
                description="Jumlah item aktif per kategori."
                index={1}
                empty={!data.byCategory.length ? "Belum ada item aktif." : null}
              >
                <div className="space-y-2.5">
                  {data.byCategory.map((c) => (
                    <BarRow key={c.category || "none"} label={c.category ? CATEGORY_REAL[c.category]?.label || c.category : "Tanpa Kategori"}
                      value={c.count} max={byCategoryMax} display={c.count} />
                  ))}
                </div>
              </ChartCard>

              <ChartCard
                title="Damage Category"
                description="Barang rusak dilaporkan per kategori, dalam rentang tanggal terpilih."
                index={2}
                empty={!data.damageByCategory.length ? "Belum ada damaged stock pada rentang ini." : null}
              >
                <div className="space-y-2.5">
                  {data.damageByCategory.map((d) => (
                    <BarRow key={d.category} label={DAMAGE_CATEGORY_REAL[d.category]?.label || d.category}
                      value={d.count} max={damageMax} display={`${d.count} record`} sub={`${d.qty} qty`} tone="orange" />
                  ))}
                </div>
              </ChartCard>

              <ChartCard
                title="Adjustment Reason"
                description="Stock Adjustment yang sudah diposting per tipe, dalam rentang tanggal terpilih."
                index={3}
                empty={!data.adjustmentByType.length ? "Belum ada adjustment yang diposting pada rentang ini." : null}
              >
                <div className="space-y-2.5">
                  {data.adjustmentByType.map((a) => (
                    <BarRow key={a.type} label={ADJUSTMENT_TYPE_REAL[a.type]?.label || a.type}
                      value={a.count} max={adjustmentMax} display={`${a.count} request`}
                      sub={`${a.qty > 0 ? "+" : ""}${a.qty}`} tone={a.qty >= 0 ? "green" : "red"} />
                  ))}
                </div>
              </ChartCard>
            </div>

            <ChartCard
              title="Slow Moving / Dead Stock"
              description={`Item tanpa pergerakan ≥${60} hari (kondisi sekarang, tidak terikat rentang tanggal di atas). Tandai "dead" pada ≥180 hari atau tidak pernah bergerak sama sekali.`}
              index={4}
              empty={!data.slowMoving.length ? "Tidak ada item yang stagnan saat ini." : null}
            >
              <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
                {data.slowMoving.map((s) => (
                  <div key={s.code} className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-[12px] last:border-0">
                    <span className="min-w-0 truncate font-medium text-ink">{s.code} — {s.name}</span>
                    <span className="shrink-0 text-ink3">{s.balance} unit</span>
                    <span className={`shrink-0 font-semibold ${s.dead ? "text-red" : "text-orange"}`}>
                      {s.daysSinceMovement == null ? "belum pernah bergerak" : `${s.daysSinceMovement} hari`}
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
