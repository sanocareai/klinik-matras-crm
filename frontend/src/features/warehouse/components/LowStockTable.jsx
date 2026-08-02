import React from "react";
import { PackageCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui/table.jsx";
import { Button } from "@/components/ui/button.jsx";

// C. Low Stock Alert — item yang available-nya sudah menyentuh/di bawah
// minimum stock. Empty state-nya SENGAJA berbunyi positif ("semua di atas
// minimum"), bukan "tidak ada data": daftar kosong di sini adalah KABAR BAIK,
// bukan kegagalan memuat.
export default function LowStockTable({ items, onCreateReplenishment }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="Tidak ada low stock item"
        description="Semua item berada di atas minimum stock level."
      />
    );
  }

  return (
    <>
      <TableWrap className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH>Item Code</TH><TH>Item Name</TH><TH>Category</TH>
              <TH numeric>Available</TH><TH numeric>Minimum</TH><TH numeric>Shortage</TH>
              <TH>Supplier</TH><TH>Action</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((i) => (
              <TR key={i.id}>
                <TD className="font-semibold text-ink">{i.itemCode}</TD>
                <TD truncate>{i.name}</TD>
                <TD className="text-ink2">{i.category.replace("_", " ")}</TD>
                <TD numeric className={i.available === 0 ? "font-bold text-red" : "text-ink"}>
                  {i.available} {i.unit.toLowerCase()}
                </TD>
                <TD numeric className="text-ink2">{i.minimumStock}</TD>
                <TD numeric className="font-bold text-orange">{i.shortage}</TD>
                <TD truncate className="text-ink2">{i.supplier || "—"}</TD>
                <TD>
                  <Button variant="ghost" size="sm" onClick={() => onCreateReplenishment?.(i)}>
                    Replenish
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-line md:hidden">
        {items.map((i) => (
          <li key={i.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold text-ink">{i.itemCode}</span>
              <span className="ml-auto shrink-0 text-[11px] font-bold text-orange">
                kurang {i.shortage} {i.unit.toLowerCase()}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[13px] text-ink">{i.name}</div>
            <div className="mt-0.5 text-[11px] text-ink2">
              Available {i.available} · Minimum {i.minimumStock} · {i.supplier || "tanpa supplier"}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
