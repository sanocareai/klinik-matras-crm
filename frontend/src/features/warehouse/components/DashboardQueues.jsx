import React from "react";
import { Inbox, ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui/table.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { RECEIPT_STATUS, ISSUE_STATUS, PRIORITY, MOVEMENT_TYPE } from "../data/warehouseMock.js";

const tanggal = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
const waktu = (s) => new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// D. Incoming Goods — goods receipt yang dijadwalkan masuk.
export function IncomingGoodsTable({ rows }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Belum ada Goods Receipt"
        description="Supplier delivery atau penerimaan barang baru akan tampil di sini."
      />
    );
  }
  return (
    <TableWrap>
      <Table>
        <THead>
          <TR>
            <TH>Receipt ID</TH><TH>Reference</TH><TH>Supplier</TH>
            <TH>Expected</TH><TH numeric>Items</TH><TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="font-semibold text-ink">{r.id}</TD>
              <TD className="text-ink2">{r.reference}</TD>
              <TD truncate>{r.supplier}</TD>
              <TD className="whitespace-nowrap text-ink2">{tanggal(r.expectedDate)}</TD>
              <TD numeric>{r.itemCount}</TD>
              <TD><StatusBadge map={RECEIPT_STATUS} value={r.status} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

// E. Material Request Queue — permintaan dari Production.
export function MaterialRequestTable({ rows }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Belum ada Material Request"
        description="Permintaan material dari Production akan tampil di sini."
      />
    );
  }
  return (
    <TableWrap>
      <Table>
        <THead>
          <TR>
            <TH>Request ID</TH><TH>Work Order</TH><TH>Line</TH><TH>Requested By</TH>
            <TH numeric>Items</TH><TH>Required</TH><TH>Priority</TH><TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="font-semibold text-ink">{r.id}</TD>
              <TD className="text-ink2">{r.workOrder}</TD>
              <TD truncate>{r.line}</TD>
              <TD className="text-ink2">{r.requestedBy}</TD>
              <TD numeric>{r.totalItems}</TD>
              <TD className="whitespace-nowrap text-ink2">{tanggal(r.requiredDate)}</TD>
              <TD><StatusBadge map={PRIORITY} value={r.priority} /></TD>
              <TD><StatusBadge map={ISSUE_STATUS} value={r.status} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

// F. Recent Stock Movement.
export function RecentMovementList({ rows }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((m) => (
        <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
          <StatusBadge map={MOVEMENT_TYPE} value={m.type} className="shrink-0" />
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
