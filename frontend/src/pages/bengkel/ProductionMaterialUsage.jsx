import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, RefreshCw } from "lucide-react";
import { unitDetailPath } from "@/lib/legacyProductionRoutes.js";
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
    api.getMaterials({ active: true, untuk: "produksi" }).then(setMaterials).catch(() => {});
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
    <PageContainer fluid className="prod-halaman">
      <PageHeader
        title="Bahan Produksi"
        subtitle="Seluruh pemakaian bahan baku per unit, lintas order."
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />

      <PageBody className="prod-stack">
        <div className="prod-toolbar prod-cari-baris">
          <input
            type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Cari kode unit, no. order, atau nama pelanggan…" aria-label="Cari"
            className="prod-cari"
          />
          <select
            value={fMaterial} onChange={(e) => setFMaterial(e.target.value)} aria-label="Filter bahan"
            className="prod-pilih"
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
                    <TR key={m.id} clickable onClick={() => navigate(unitDetailPath(m.unit.id))}>
                      <TD className="min-w-[110px] text-ink2">{formatTanggalJam(m.createdAt)}</TD>
                      <TD className="whitespace-nowrap font-semibold text-ink">{m.unit?.unitCode || "—"}</TD>
                      <TD className="break-words text-ink2">{m.unit?.order?.orderNumber || "—"}</TD>
                      <TD className="min-w-[180px] break-words">{m.unit?.order?.customer?.name || "—"}</TD>
                      <TD className="min-w-[160px] break-words text-ink2">{m.material.name}</TD>
                      <TD>
                        <Badge variant={m.type === "ISSUE" ? "accent" : m.type === "WASTE" ? "red" : "orange"}>
                          {m.type === "ISSUE" ? "Pemakaian" : m.type === "WASTE" ? "Terbuang" : "Koreksi"}
                        </Badge>
                        {m.type === "WASTE" && m.reason && (
                          <div className="mt-0.5 truncate text-[10.5px] text-ink3">{m.reason}</div>
                        )}
                      </TD>
                      <TD className="text-ink2">
                        {m.type === "RETURN" ? "-" : ""}{Math.abs(Number(m.qty))} {m.material.unit}
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
