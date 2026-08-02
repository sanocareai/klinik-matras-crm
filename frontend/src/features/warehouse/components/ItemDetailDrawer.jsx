import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Pencil, Loader2, History } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  STOCK_STATUS_REAL, CATEGORY_REAL, SERVICE_LINE_REAL, MOVEMENT_LABEL_REAL,
  UNIT_LABEL, formatQty, deriveStockStatusReal,
} from "../inventoryReal.js";

// Detail item — data NYATA. Riwayat pergerakan diambil dari ledger
// (GET /inventory/movements?materialId=), sumber kebenaran yang SAMA dengan
// saldo di header. Tidak ada angka di drawer ini yang disimpan terpisah.
//
// ⚠️ Bagian yang SENGAJA TIDAK ADA (lihat FIELDS_NOT_IN_BACKEND di
// inventoryReal.js): Location Stock per rak/bin, Batch/Lot, Reserved,
// barcode, dimensi. Belum ada kolomnya sama sekali — menampilkan section
// kosong yang tidak pernah bisa diisi siapa pun lebih menyesatkan daripada
// tidak menampilkannya (pelajaran yang sama dengan checklist POD di Delivery).
const waktu = (s) => new Date(s).toLocaleString("id-ID", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function Baris({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-[11.5px] text-ink3">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] font-medium text-ink">{children}</dd>
    </div>
  );
}

export default function ItemDetailDrawer({ item, onClose, onEdit, onChanged }) {
  const [movements, setMovements] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const materialId = item?.materialId || item?.id;

  useEffect(() => {
    if (!materialId) return;
    setLoading(true);
    setError("");
    api.getStockMovements({ materialId, limit: 50 })
      .then(setMovements)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [materialId]);

  if (!item) return null;

  const status = deriveStockStatusReal(item);
  // Supplier BUKAN atribut material — ia tercatat per penerimaan di ledger.
  // Yang bisa dikatakan jujur: supplier pada penerimaan TERAKHIR.
  const supplierTerakhir = movements?.find((m) => m.type === "RECEIPT" && m.supplier)?.supplier;

  async function toggleAktif() {
    setBusy(true);
    setError("");
    try {
      await api.updateMaterial(materialId, { active: !item.active });
      onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!item} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail item inventory"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{item.code}</Dialog.Title>
            <StatusBadge map={STOCK_STATUS_REAL} value={status} />
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ink">{item.name}</p>

            <div className="mt-3 rounded-btn border border-border p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink3">Available Stock</div>
              <div className="mt-0.5 text-[24px] font-extrabold leading-none tabular-nums text-ink">
                {formatQty(item.balance, item.unit)}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink3">
                Dihitung dari penjumlahan seluruh baris ledger, bukan angka tersimpan.
                Belum ada sistem reservasi stok — jadi saldo ini sekaligus
                <em> on hand</em> dan <em>available</em>.
              </p>
            </div>

            <dl className="mt-3 divide-y divide-line">
              <Baris label="Category">
                {item.category
                  ? `${CATEGORY_REAL[item.category]?.label} · ${CATEGORY_REAL[item.category]?.labelId}`
                  : <span className="text-ink3">Tanpa kategori</span>}
              </Baris>
              <Baris label="Service Line">
                {item.serviceLine ? SERVICE_LINE_REAL[item.serviceLine]?.labelId : <span className="text-ink3">Lintas lini</span>}
              </Baris>
              <Baris label="Unit of Measure">{UNIT_LABEL[item.unit] || item.unit}</Baris>
              <Baris label="Minimum Stock / Reorder Point">
                {item.reorderPoint != null
                  ? formatQty(item.reorderPoint, item.unit)
                  : <span className="text-ink3">Alert dimatikan</span>}
              </Baris>
              <Baris label="Reorder Quantity">
                {item.reorderQty != null ? formatQty(item.reorderQty, item.unit) : <span className="text-ink3">—</span>}
              </Baris>
              <Baris label="Supplier terakhir">
                {supplierTerakhir || <span className="text-ink3">Belum ada penerimaan</span>}
              </Baris>
              <Baris label="Status item">{item.active ? "Aktif" : "Nonaktif"}</Baris>
            </dl>

            <div className="mt-4 border-t border-line pt-3">
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                <History size={12} aria-hidden /> Movement History
              </h4>

              {loading && (
                <p className="flex items-center gap-1.5 py-3 text-[12px] text-ink3">
                  <Loader2 size={12} className="animate-spin" /> Memuat riwayat…
                </p>
              )}

              {!loading && movements?.length === 0 && (
                <p className="py-3 text-[12px] text-ink3">
                  Belum ada pergerakan stok untuk item ini.
                </p>
              )}

              {!loading && movements?.length > 0 && (
                <ul className="divide-y divide-line">
                  {movements.map((m) => (
                    <li key={m.id} className="flex items-start gap-2 py-2">
                      <StatusBadge map={MOVEMENT_LABEL_REAL} value={m.type} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-ink3">{waktu(m.createdAt)}</p>
                        {(m.reason || m.note) && (
                          <p className="truncate text-[11.5px] text-ink2">{m.reason || m.note}</p>
                        )}
                        {m.unit?.unitCode && <p className="text-[11px] text-ink3">Unit {m.unit.unitCode}</p>}
                        {m.createdBy?.name && <p className="text-[10.5px] text-ink3">oleh {m.createdBy.name}</p>}
                      </div>
                      <span className={`shrink-0 text-[12.5px] font-bold tabular-nums ${Number(m.qty) < 0 ? "text-red" : "text-green"}`}>
                        {Number(m.qty) > 0 ? "+" : ""}{Number(m.qty)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-4 border-t border-line pt-3 text-[10.5px] leading-relaxed text-ink3">
              Lokasi rak/bin, batch &amp; lot, tanggal kedaluwarsa, dan stok
              ter-reserve belum tersedia — kolomnya belum ada di database.
              Menyusul bersama Stock Transfer &amp; Material Issue.
            </p>
          </div>

          <div className="shrink-0 border-t border-line p-3">
            {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => onEdit(item)}>
                <Pencil size={14} /> Edit Item
              </Button>
              <Button variant="ghost" size="sm" onClick={toggleAktif} disabled={busy}>
                {busy && <Loader2 size={14} className="animate-spin" />}
                {item.active ? "Nonaktifkan" : "Aktifkan"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
