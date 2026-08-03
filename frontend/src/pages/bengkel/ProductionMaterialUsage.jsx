import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { formatTanggalJam } from "@/utils/formatDate.js";

// Bahan Produksi — Production Tahap 5. DATA NYATA, lintas order.
//
// Sumbernya stock_movements yang SAMA dengan yang dicatat dari kartu
// "Bahan Digunakan" di halaman Detail Unit — bukan agregasi/tabel
// tersendiri, jadi angkanya tidak mungkin drift dari ledger sebenarnya.
//
// TIDAK ADA alur approval/dokumen (beda dari MaterialIssue di sisi Gudang)
// — gudang & bengkel satu ruangan yang sama, jadi cukup catat langsung.
export default function ProductionMaterialUsage() {
  const navigate = useNavigate();
  const [cari, setCari] = useState("");
  const [materials, setMaterials] = useState([]);
  const [fMaterial, setFMaterial] = useState("");
  const [movements, setMovements] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getMaterials({ active: true }).then(setMaterials).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getMaterialUsage({ q: cari.trim() || undefined, materialId: fMaterial || undefined })
      .then((d) => setMovements(d.movements))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cari, fMaterial]);

  useEffect(() => {
    const t = setTimeout(load, cari ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, cari]);

  const kosong = !loading && movements && movements.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Bahan Produksi"
        subtitle="Seluruh pemakaian bahan baku per unit, lintas order."
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />

      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Cari kode unit, no. order, atau nama pelanggan…" aria-label="Cari"
            className="h-9 min-w-[240px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          <select
            value={fMaterial} onChange={(e) => setFMaterial(e.target.value)} aria-label="Filter bahan"
            className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            <option value="">Semua bahan</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={Boxes}
              title="Belum ada pemakaian bahan"
              description="Catat pemakaian bahan dari halaman Detail Unit (Work Order) — akan muncul di sini otomatis."
            />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Tanggal</TH><TH>Unit</TH><TH>Order</TH><TH>Pelanggan</TH>
                    <TH>Bahan</TH><TH>Jenis</TH><TH>Jumlah</TH><TH>Dicatat Oleh</TH>
                  </TR>
                </THead>
                <TBody>
                  {loading && <TableSkeletonRows rows={8} cols={8} />}
                  {!loading && movements?.map((m) => (
                    <TR key={m.id} clickable onClick={() => navigate(`/bengkel/units/${m.unit.id}`)}>
                      <TD className="text-ink2">{formatTanggalJam(m.createdAt)}</TD>
                      <TD className="font-semibold text-ink">{m.unit?.unitCode || "—"}</TD>
                      <TD className="text-ink2">{m.unit?.order?.orderNumber || "—"}</TD>
                      <TD truncate>{m.unit?.order?.customer?.name || "—"}</TD>
                      <TD truncate className="text-ink2">{m.material.name}</TD>
                      <TD>
                        <Badge variant={m.type === "ISSUE" ? "accent" : "orange"}>
                          {m.type === "ISSUE" ? "Pemakaian" : "Koreksi"}
                        </Badge>
                      </TD>
                      <TD className="text-ink2">
                        {m.type === "ISSUE" ? "" : "-"}{Math.abs(Number(m.qty))} {m.material.unit}
                      </TD>
                      <TD className="text-ink2">{m.createdBy?.name || "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </PageBody>
    </PageContainer>
  );
}
