import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Plus, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import StatusBadge from "@/features/warehouse/components/StatusBadge.jsx";
import ItemDetailDrawer from "@/features/warehouse/components/ItemDetailDrawer.jsx";
import ItemFormModal from "@/features/warehouse/components/ItemFormModal.jsx";
import {
  STOCK_STATUS_REAL, CATEGORY_REAL, deriveStockStatusReal, formatQty,
} from "@/features/warehouse/inventoryReal.js";

// Stock & Material — Warehouse Tahap 2. DATA NYATA.
//
// ⚠️ TIDAK ADA BADGE "Contoh" DI HALAMAN INI. Saldo diambil dari
// GET /inventory/stock, yang menghitungnya lewat SUM(qty) atas seluruh baris
// ledger — sumber kebenaran yang sama dengan halaman lama /gudang. Data
// contoh Tahap 1 sudah DICABUT dari halaman ini (warehouseMock.js sekarang
// cuma dipakai Dashboard, yang KPI agregatnya memang belum ada di backend).
//
// Kolom yang diminta spesifikasi tapi TIDAK ada di sini (Reserved, Location,
// Batch, Supplier per item, Variant): tidak ada kolomnya di database —
// daftar lengkap beserta alasan & phase-nya ada di FIELDS_NOT_IN_BACKEND
// (features/warehouse/inventoryReal.js). Menampilkan kolom yang selalu
// kosong terbaca sebagai sistem rusak.

const TABS = [
  { key: "",               label: "Semua" },
  { key: "RAW_MATERIAL",   label: "Raw Material" },
  { key: "WIP",            label: "WIP" },
  { key: "FINISHED_GOODS", label: "Finished Goods" },
  { key: "CONSUMABLE",     label: "Consumables" },
  { key: "none",           label: "Tanpa Kategori" },
];

export default function WarehouseInventory() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState("");
  const [cari, setCari] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [tampilkanNonaktif, setTampilkanNonaktif] = useState(false);

  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getStock()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter di klien: GET /stock mengembalikan seluruh katalog dalam satu
  // agregat (satu baris per material). Menyaring di server berarti kehilangan
  // hitungan total per tab — dan volumenya kecil, katalog material bukan
  // tabel jutaan baris.
  const terfilter = useMemo(() => {
    if (!rows) return null;
    const q = cari.trim().toLowerCase();
    return rows
      .map((r) => ({ ...r, stockStatus: deriveStockStatusReal(r) }))
      .filter((r) => {
        if (!tampilkanNonaktif && !r.active) return false;
        if (tab === "none" && r.category) return false;
        if (tab && tab !== "none" && r.category !== tab) return false;
        if (fStatus && r.stockStatus !== fStatus) return false;
        if (q && !`${r.code} ${r.name}`.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [rows, tab, cari, fStatus, tampilkanNonaktif]);

  const kosong = !loading && terfilter && terfilter.length === 0;
  const katalogKosong = !loading && rows && rows.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Stock & Material"
        subtitle="Saldo stok dihitung langsung dari ledger pergerakan barang."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus size={14} /> Add Item
            </Button>
          </>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring kategori item" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}
            >
              {t.label}
            </button>
          ))}
          {terfilter && <span className="ml-auto self-center text-[11.5px] text-ink3">{terfilter.length} item</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Cari item code atau nama…" aria-label="Cari item"
            className="h-9 min-w-[220px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          <select
            value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter status stok"
            className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            <option value="">Semua status</option>
            {Object.entries(STOCK_STATUS_REAL).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-ink2">
            <input
              type="checkbox" checked={tampilkanNonaktif}
              onChange={(e) => setTampilkanNonaktif(e.target.checked)}
            />
            Tampilkan nonaktif
          </label>
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {katalogKosong ? (
            <EmptyState
              icon={Package}
              title="Katalog material masih kosong"
              description="Tambahkan item pertama untuk mulai mencatat penerimaan dan pengeluaran stok."
              action={
                <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  <Plus size={14} /> Add Item
                </Button>
              }
            />
          ) : kosong ? (
            <EmptyState
              icon={Package}
              title="Tidak ada item yang cocok"
              description="Coba ubah kata kunci pencarian, kategori, atau filter status."
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Item Code</TH><TH>Item Name</TH><TH>Category</TH>
                      <TH numeric>On Hand</TH><TH numeric>Reserved</TH><TH numeric>Available</TH>
                      <TH numeric>Minimum</TH><TH>Unit</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={9} />}
                    {!loading && terfilter?.map((r) => (
                      <TR key={r.materialId} clickable onClick={() => setSelected(r)}>
                        <TD className="font-semibold text-ink">{r.code}</TD>
                        <TD truncate>{r.name}</TD>
                        <TD className="whitespace-nowrap text-ink2">
                          {r.category ? CATEGORY_REAL[r.category]?.label : <span className="text-ink3">—</span>}
                        </TD>
                        <TD numeric className="text-ink2">{r.balance}</TD>
                        <TD numeric className={r.reserved > 0 ? "font-semibold text-orange" : "text-ink3"}>
                          {r.reserved > 0 ? r.reserved : "—"}
                        </TD>
                        <TD numeric className={r.available <= 0 ? "font-bold text-red" : "font-semibold text-ink"}>
                          {formatQty(r.available, r.unit)}
                        </TD>
                        <TD numeric className="text-ink3">
                          {r.reorderPoint != null ? r.reorderPoint : "—"}
                        </TD>
                        <TD className="text-ink2">{r.unit.toLowerCase()}</TD>
                        <TD><StatusBadge map={STOCK_STATUS_REAL} value={r.stockStatus} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line md:hidden">
                {!loading && terfilter?.map((r) => (
                  <li key={r.materialId}>
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{r.code}</span>
                        <StatusBadge map={STOCK_STATUS_REAL} value={r.stockStatus} className="ml-auto shrink-0" />
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{r.name}</div>
                      <div className="mt-1 text-[11.5px] text-ink2">
                        <strong className="text-ink">{formatQty(r.available, r.unit)}</strong> available
                        {r.reserved > 0 && ` · ${r.reserved} reserved`}
                        {r.reorderPoint != null && ` · minimum ${r.reorderPoint}`}
                        {r.category && ` · ${CATEGORY_REAL[r.category]?.label}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <ItemDetailDrawer
        item={selected}
        onClose={() => setSelected(null)}
        onEdit={(it) => { setSelected(null); setEditing(it); setFormOpen(true); }}
        onChanged={load}
      />
      <ItemFormModal
        open={formOpen}
        item={editing}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={load}
      />
    </PageContainer>
  );
}
