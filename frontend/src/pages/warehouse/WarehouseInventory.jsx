import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, ExternalLink } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import MockBadge from "@/features/warehouse/components/MockBadge.jsx";
import StatusBadge from "@/features/warehouse/components/StatusBadge.jsx";
import {
  INVENTORY_ITEMS, ITEM_CATEGORY, STOCK_STATUS, deriveStockStatus,
} from "@/features/warehouse/data/warehouseMock.js";

// Stock & Material — Tahap 1 (daftar saja; detail item menyusul Tahap 2).
//
// ⚠️ DATA CONTOH. Halaman berdata NYATA sudah ada dan TETAP BERFUNGSI di
// /gudang (pages/Gudang.jsx) — terhubung ke ledger sungguhan lewat
// GET /inventory/stock. Halaman ini BELUM menggantikannya; Tahap 2 yang
// menyambungkan struktur baru ini ke backend yang sama.
//
// ⚠️ ANGKA STOK TETAP TURUNAN, TIDAK PERNAH DISIMPAN. Available dihitung
// sebagai On Hand − Reserved, dan status stok dihitung dari angka itu
// (deriveStockStatus) — bukan kolom tersendiri. Ini menjaga disiplin yang
// sama dengan backend (PRD §8.1: "Never store current_qty as a mutable
// column") supaya Tahap 2 tinggal menukar sumber datanya tanpa mengubah
// bentuk UI.

const TABS = [
  { key: "",               label: "Semua" },
  { key: "RAW_MATERIAL",   label: "Raw Material" },
  { key: "WIP",            label: "WIP" },
  { key: "FINISHED_GOODS", label: "Finished Goods" },
  { key: "CONSUMABLE",     label: "Consumables" },
];

export default function WarehouseInventory() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("");
  const [cari, setCari] = useState("");
  const [fStatus, setFStatus] = useState("");

  const rows = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return INVENTORY_ITEMS
      .map((i) => ({ ...i, stockStatus: deriveStockStatus(i) }))
      .filter((i) => {
        if (tab && i.category !== tab) return false;
        if (fStatus && i.stockStatus !== fStatus) return false;
        if (q && !`${i.itemCode} ${i.name} ${i.supplier || ""}`.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [tab, cari, fStatus]);

  return (
    <PageContainer>
      <PageHeader
        title={<span className="flex items-center gap-2">Stock &amp; Material <MockBadge /></span>}
        subtitle="Pantau saldo, lokasi penyimpanan, dan status seluruh inventory."
        actions={
          <Button variant="secondary" size="sm" onClick={() => navigate("/gudang")}>
            <ExternalLink size={14} /> Buka data nyata
          </Button>
        }
      />

      <PageBody>
        <div className="rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5 text-[12px] leading-relaxed text-ink">
          Angka di halaman ini <strong>data contoh</strong> untuk menguji rancangan.
          Saldo stok sungguhan (dari ledger) ada di halaman{" "}
          <button type="button" onClick={() => navigate("/gudang")} className="font-bold text-accent underline">
            Stok &amp; Material lama
          </button>{" "}
          dan tetap berfungsi penuh.
        </div>

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
          <span className="ml-auto self-center text-[11.5px] text-ink3">{rows.length} item</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Cari item code, nama, atau supplier…" aria-label="Cari item"
            className="h-9 min-w-[220px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          <select
            value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter status stok"
            className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            <option value="">Semua status</option>
            {Object.entries(STOCK_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </div>

        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Tidak ada item yang cocok"
              description="Coba ubah kata kunci pencarian atau filter status."
            />
          ) : (
            <>
              <TableWrap className="hidden lg:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Item Code</TH><TH>Item Name</TH><TH>Category</TH>
                      <TH numeric>On Hand</TH><TH numeric>Reserved</TH><TH numeric>Available</TH>
                      <TH numeric>Minimum</TH><TH>Unit</TH><TH>Location</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((i) => (
                      <TR key={i.id}>
                        <TD className="font-semibold text-ink">{i.itemCode}</TD>
                        <TD truncate>{i.name}</TD>
                        <TD className="whitespace-nowrap text-ink2">{ITEM_CATEGORY[i.category]?.label}</TD>
                        <TD numeric className="text-ink2">{i.onHand}</TD>
                        <TD numeric className="text-ink2">{i.reserved}</TD>
                        <TD numeric className={i.available === 0 ? "font-bold text-red" : "font-semibold text-ink"}>
                          {i.available}
                        </TD>
                        <TD numeric className="text-ink3">{i.minimumStock}</TD>
                        <TD className="text-ink2">{i.unit.toLowerCase()}</TD>
                        <TD truncate className="text-[11px] text-ink3">{i.location}</TD>
                        <TD><StatusBadge map={STOCK_STATUS} value={i.stockStatus} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line lg:hidden">
                {rows.map((i) => (
                  <li key={i.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-ink">{i.itemCode}</span>
                      <StatusBadge map={STOCK_STATUS} value={i.stockStatus} className="ml-auto shrink-0" />
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-ink">{i.name}</div>
                    <div className="mt-1 text-[11.5px] text-ink2">
                      Available <strong className="text-ink">{i.available}</strong> {i.unit.toLowerCase()}
                      {" · "}On Hand {i.onHand}{" · "}Reserved {i.reserved}
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-ink3">{i.location}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
    </PageContainer>
  );
}
