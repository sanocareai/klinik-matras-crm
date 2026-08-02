import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, ArrowRight, XCircle, Truck, PackageCheck } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  TRANSFER_STATUS_REAL, TRANSFER_TYPE_REAL, TRANSFER_FORWARD_FLOW, UNIT_LABEL,
} from "../inventoryReal.js";

// Detail Stock Transfer — Confirm Dispatch lalu Confirm Receipt. Dua-duanya
// menulis baris ledger nyata (lihat catatan panjang di schema.prisma &
// routes/stockTransfer.js). Qty Received bisa dioverride per baris sebelum
// Confirm Receipt — itulah `difference` yang ditampilkan setelah selesai.
const waktu = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export default function StockTransferDetailDrawer({ transferId, onClose, onChanged }) {
  const [transfer, setTransfer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiveQty, setReceiveQty] = useState({});
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = () => {
    if (!transferId) return;
    setLoading(true);
    setError("");
    api.getStockTransfer(transferId)
      .then((d) => {
        setTransfer(d);
        setReceiveQty(Object.fromEntries(d.lines.map((l) => [l.id, l.qtySent])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [transferId]);

  if (!transferId) return null;

  const status = transfer?.status;
  const selesai = status === "COMPLETED" || status === "CANCELLED";
  const currentIdx = TRANSFER_FORWARD_FLOW.indexOf(status);
  const nextStatus = TRANSFER_FORWARD_FLOW[currentIdx + 1];
  const bisaDibatalkan = !selesai && status !== "IN_TRANSIT";

  async function majukan() {
    setBusy(true);
    setError("");
    try {
      await api.updateStockTransfer(transferId, { status: nextStatus });
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function dispatch() {
    setBusy(true);
    setError("");
    try {
      await api.dispatchStockTransfer(transferId);
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function receive() {
    setBusy(true);
    setError("");
    try {
      await api.receiveStockTransfer(transferId, {
        lines: transfer.lines.map((l) => ({ lineId: l.id, qtyReceived: receiveQty[l.id] })),
      });
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function batalkan() {
    if (!cancelReason.trim()) { setError("Alasan pembatalan wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      await api.cancelStockTransfer(transferId, cancelReason);
      load();
      onChanged();
      setCancelling(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!transferId} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail Stock Transfer"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[560px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{transfer?.transferNumber || "…"}</Dialog.Title>
            {status && <StatusBadge map={TRANSFER_STATUS_REAL} value={status} />}
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading && (
              <p className="flex items-center gap-1.5 py-6 text-[12.5px] text-ink3">
                <Loader2 size={14} className="animate-spin" /> Memuat…
              </p>
            )}

            {transfer && (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  <div><dt className="text-ink3">Transfer Type</dt><dd className="font-medium text-ink">{TRANSFER_TYPE_REAL[transfer.transferType]?.label}</dd></div>
                  <div><dt className="text-ink3">Requested By</dt><dd className="font-medium text-ink">{transfer.requestedBy?.name || "—"}</dd></div>
                  <div><dt className="text-ink3">Source</dt><dd className="font-medium text-ink">{transfer.sourceLocation.code}</dd></div>
                  <div><dt className="text-ink3">Destination</dt><dd className="font-medium text-ink">{transfer.destinationLocation.code}</dd></div>
                  <div><dt className="text-ink3">Dispatched</dt><dd className="font-medium text-ink">{transfer.dispatchedAt ? waktu(transfer.dispatchedAt) : "—"}</dd></div>
                  <div><dt className="text-ink3">Received</dt><dd className="font-medium text-ink">{transfer.receivedAt ? waktu(transfer.receivedAt) : "—"}</dd></div>
                </dl>
                {transfer.notes && <p className="mt-2 text-[11.5px] text-ink2">{transfer.notes}</p>}

                <div className="mt-4 border-t border-line pt-3">
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Item Lines</h4>
                  <div className="space-y-2.5">
                    {transfer.lines.map((line) => {
                      const diff = line.qtyReceived != null ? line.qtySent - line.qtyReceived : null;
                      return (
                        <div key={line.id} className="rounded-btn border border-border p-2.5">
                          <div className="flex items-center justify-between">
                            <p className="text-[12.5px] font-semibold text-ink">{line.material.code}</p>
                            <p className="text-[11px] text-ink3">Sent {line.qtySent} {UNIT_LABEL[line.material.unit]}</p>
                          </div>
                          <p className="text-[11px] text-ink2">{line.material.name}</p>

                          {status === "IN_TRANSIT" ? (
                            <div className="mt-2">
                              <label className="mb-0.5 block text-[10px] text-ink3">Qty Received</label>
                              <input
                                type="number" step="any" min="0" value={receiveQty[line.id] ?? ""}
                                onChange={(e) => setReceiveQty((q) => ({ ...q, [line.id]: e.target.value }))}
                                className="w-full max-w-[140px] rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
                              />
                            </div>
                          ) : line.qtyReceived != null ? (
                            <p className="mt-1.5 text-[11px] text-ink3">
                              Received {line.qtyReceived} {UNIT_LABEL[line.material.unit]}
                              {diff !== 0 && (
                                <span className={diff > 0 ? "ml-1 font-semibold text-red" : "ml-1 font-semibold text-orange"}>
                                  ({diff > 0 ? `selisih -${diff}` : `selisih +${-diff}`})
                                </span>
                              )}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {transfer && !selesai && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              {cancelling ? (
                <div className="space-y-2">
                  <textarea
                    value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Alasan pembatalan…" rows={2}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setCancelling(false)}>Batal</Button>
                    <Button variant="destructive" size="sm" onClick={batalkan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Cancel Transfer
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {bisaDibatalkan && (
                    <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
                      <XCircle size={14} /> Cancel
                    </Button>
                  )}
                  {status === "PICKED" ? (
                    <Button size="sm" className="ml-auto" onClick={dispatch} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />} Confirm Dispatch
                    </Button>
                  ) : status === "IN_TRANSIT" ? (
                    <Button size="sm" className="ml-auto" onClick={receive} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />} Confirm Receipt
                    </Button>
                  ) : nextStatus && nextStatus !== "IN_TRANSIT" ? (
                    <Button size="sm" className="ml-auto" onClick={majukan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                      Advance to {TRANSFER_STATUS_REAL[nextStatus]?.label}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
