import React from "react";
import { Inbox, ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui/table.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { RECEIPT_STATUS_REAL, ISSUE_STATUS_REAL, ISSUE_PRIORITY_REAL, MOVEMENT_LABEL_REAL } from "../inventoryReal.js";

const tanggal = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
const waktu = (s) => new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// D. Incoming Goods — goods receipt yang dijadwalkan masuk (data NYATA,
// lihat WarehouseDashboard.jsx).
export function IncomingGoodsTable({ rows }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Belum ada penerimaan barang"
        description="Kiriman supplier atau penerimaan barang baru akan tampil di sini."
      />
    );
  }
  return (
    <TableWrap>
      <Table>
        <THead>
          <TR>
            <TH>No. Receipt</TH><TH>Referensi</TH><TH>Supplier</TH>
            <TH>Perkiraan Tiba</TH><TH numeric>Item</TH><TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="font-semibold text-ink">{r.id}</TD>
              <TD className="text-ink2">{r.reference || "—"}</TD>
              <TD truncate>{r.supplier || "—"}</TD>
              <TD className="whitespace-nowrap text-ink2">{r.expectedDate ? tanggal(r.expectedDate) : "—"}</TD>
              <TD numeric>{r.itemCount}</TD>
              <TD><StatusBadge map={RECEIPT_STATUS_REAL} value={r.status} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

// E. Material Request Queue — permintaan dari Production (data NYATA).
export function MaterialRequestTable({ rows }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Belum ada permintaan material"
        description="Permintaan material dari Produksi yang menunggu tindak lanjut akan tampil di sini."
      />
    );
  }
  return (
    <TableWrap>
      <Table>
        <THead>
          <TR>
            <TH>No. Issue</TH><TH>Departemen</TH><TH>Diminta Oleh</TH>
            <TH numeric>Item</TH><TH>Dibutuhkan</TH><TH>Prioritas</TH><TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="font-semibold text-ink">{r.id}</TD>
              <TD truncate className="text-ink2">{r.department || "—"}</TD>
              <TD className="text-ink2">{r.requestedBy}</TD>
              <TD numeric>{r.totalItems}</TD>
              <TD className="whitespace-nowrap text-ink2">{r.requiredDate ? tanggal(r.requiredDate) : "—"}</TD>
              <TD><StatusBadge map={ISSUE_PRIORITY_REAL} value={r.priority} /></TD>
              <TD><StatusBadge map={ISSUE_STATUS_REAL} value={r.status} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

// F. Recent Stock Movement (data NYATA).
export function RecentMovementList({ rows }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Belum ada pergerakan stok"
        description="Penerimaan, pengeluaran, dan penyesuaian stok terbaru akan tampil di sini."
      />
    );
  }
  return (
    <ul className="divide-y divide-line">
      {rows.map((m) => (
        <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
          <StatusBadge map={MOVEMENT_LABEL_REAL} value={m.type} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-ink">{m.itemName}</p>
            <p className="text-[11px] text-ink3">{m.reference} · {m.user} · {waktu(m.at)}</p>
          </div>
          <span className={`shrink-0 text-[12.5px] font-bold tabular-nums ${m.qty < 0 ? "text-red" : "text-green"}`}>
            {m.qty > 0 ? "+" : ""}{m.qty} {m.unit.toLowerCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}

// G. Inventory Issues — ringkasan masalah yang perlu ditindak.
export function InventoryIssuesGrid({ rows }) {
  const TONE = {
    red:    "border-red bg-redbg text-red",
    orange: "border-orange bg-orangebg text-orange",
    accent: "border-accent bg-accentbg text-accent",
  };
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
      {rows.map((r) => (
        <div
          key={r.id}
          className={`rounded-btn border-l-[3px] px-3 py-2.5 ${r.count === 0 ? "border-line bg-inset text-ink3" : TONE[r.severity]}`}
        >
          <div className="text-[20px] font-extrabold leading-none tabular-nums">{r.count}</div>
          <div className="mt-1 text-[11.5px] font-semibold">{r.label}</div>
          <div className="text-[10.5px] opacity-80">{r.labelId}</div>
        </div>
      ))}
    </div>
  );
}
