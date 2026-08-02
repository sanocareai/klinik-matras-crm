import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, ArrowRight, XCircle, PackageCheck, Save } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  RECEIPT_STATUS_REAL, RECEIPT_SOURCE_REAL, RECEIPT_FORWARD_FLOW, UNIT_LABEL,
} from "../inventoryReal.js";

// Detail Goods Receipt — mengedit hasil kedatangan & inspeksi per baris,
// lalu menjalankan transisi status. COMPLETED hanya bisa dicapai lewat
// tombol "Confirm Putaway" (POST /:id/putaway) — itu SATU-SATUNYA titik
// yang menulis baris stock_movements RECEIPT nyata, lihat catatan panjang
// di schema.prisma & routes/goodsReceipt.js.
const waktu = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export default function GoodsReceiptDetailDrawer({ receiptId, onClose, onChanged }) {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lineEdits, setLineEdits] = useState({});
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = () => {
    if (!receiptId) return;
    setLoading(true);
    setError("");
    api.getGoodsReceipt(receiptId)
      .then((r) => { setReceipt(r); setLineEdits({}); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [receiptId]);

  if (!receiptId) return null;

  const status = receipt?.status;
  const selesai = status === "COMPLETED" || status === "REJECTED";
  const currentIdx = RECEIPT_FORWARD_FLOW.indexOf(status);
  const nextStatus = RECEIPT_FORWARD_FLOW[currentIdx + 1];
  // Field kedatangan/inspeksi bisa diisi mulai ARRIVED, supaya data bisa
  // disiapkan sebelum status benar-benar dimajukan ke INSPECTION.
  const bisaIsiKedatangan = !selesai && currentIdx >= RECEIPT_FORWARD_FLOW.indexOf("ARRIVED");

  function edit(lineId, field, value) {
    setLineEdits((e) => ({ ...e, [lineId]: { ...e[lineId], [field]: value } }));
  }
  function nilai(line, field) {
    const e = lineEdits[line.id];
    if (e && field in e) return e[field];
    return line[field] ?? "";
  }

  async function simpanBaris() {
    setBusy(true);
    setError("");
    try {
      const ids = Object.keys(lineEdits);
      await Promise.all(ids.map((lineId) => {
        const patch = lineEdits[lineId];
        const body = {};
        for (const k of ["receivedQty", "acceptedQty", "rejectedQty", "condition"]) {
          if (k in patch) body[k] = patch[k];
        }
        return api.updateGoodsReceiptLine(receiptId, lineId, body);
      }));
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function majukan() {
    setBusy(true);
    setError("");
    try {
      await api.updateGoodsReceipt(receiptId, { status: nextStatus });
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function putaway() {
    setBusy(true);
    setError("");
    try {
      await api.putawayGoodsReceipt(receiptId);
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function tolak() {
    if (!rejectReason.trim()) { setError("Alasan penolakan wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      await api.rejectGoodsReceipt(receiptId, rejectReason);
      load();
      onChanged();
      setRejecting(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!receiptId} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail Goods Receipt"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[560px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{receipt?.receiptNumber || "…"}</Dialog.Title>
            {status && <StatusBadge map={RECEIPT_STATUS_REAL} value={status} />}
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

            {receipt && (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  <div><dt className="text-ink3">Source Type</dt><dd className="font-medium text-ink">{RECEIPT_SOURCE_REAL[receipt.sourceType]?.label}</dd></div>
                  <div><dt className="text-ink3">Reference</dt><dd className="font-medium text-ink">{receipt.sourceReference || "—"}</dd></div>
                  <div><dt className="text-ink3">Supplier / Sender</dt><dd className="font-medium text-ink">{receipt.supplier || "—"}</dd></div>
                  <div><dt className="text-ink3">Expected Date</dt><dd className="font-medium text-ink">{receipt.expectedDate ? waktu(receipt.expectedDate) : "—"}</dd></div>
                  <div><dt className="text-ink3">Received Date</dt><dd className="font-medium text-ink">{receipt.receivedDate ? waktu(receipt.receivedDate) : "—"}</dd></div>
                  <div><dt className="text-ink3">Dibuat oleh</dt><dd className="font-medium text-ink">{receipt.createdBy?.name || "—"}</dd></div>
                </dl>
                {receipt.notes && <p className="mt-2 text-[11.5px] text-ink2">{receipt.notes}</p>}

                <div className="mt-4 border-t border-line pt-3">
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Item Lines</h4>
                  <div className="space-y-2.5">
                    {receipt.lines.map((line) => (
                      <div key={line.id} className="rounded-btn border border-border p-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[12.5px] font-semibold text-ink">{line.material.code}</p>
                          <p className="text-[11px] text-ink3">Ordered {line.orderedQty ?? "—"} {UNIT_LABEL[line.material.unit]}</p>
                        </div>
                        <p className="text-[11px] text-ink2">{line.material.name}</p>

                        {bisaIsiKedatangan ? (
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <div>
                              <label className="mb-0.5 block text-[10px] text-ink3">Received</label>
                              <input
                                type="number" step="any" min="0" value={nilai(line, "receivedQty")}
                                onChange={(e) => edit(line.id, "receivedQty", e.target.value)}
                                className="w-full rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] text-ink3">Accepted</label>
                              <input
                                type="number" step="any" min="0" value={nilai(line, "acceptedQty")}
                                onChange={(e) => edit(line.id, "acceptedQty", e.target.value)}
                                className="w-full rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] text-ink3">Rejected</label>
                              <input
                                type="number" step="any" min="0" value={nilai(line, "rejectedQty")}
                                onChange={(e) => edit(line.id, "rejectedQty", e.target.value)}
                                className="w-full rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
                              />
                            </div>
                            <div className="col-span-3">
                              <label className="mb-0.5 block text-[10px] text-ink3">Condition</label>
                              <input
                                type="text" value={nilai(line, "condition")}
                                onChange={(e) => edit(line.id, "condition", e.target.value)}
                                placeholder="mis. baik, sesuai spesifikasi"
                                className="w-full rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                              />
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-ink3">
                            {selesai
                              ? `Received ${line.receivedQty ?? "—"} · Accepted ${line.acceptedQty ?? "—"} · Rejected ${line.rejectedQty ?? "—"}`
                              : "Isi setelah barang tiba (status Arrived)."}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {bisaIsiKedatangan && Object.keys(lineEdits).length > 0 && (
                    <Button variant="secondary" size="sm" className="mt-2" onClick={simpanBaris} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan Perubahan Baris
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          {receipt && !selesai && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              {rejecting ? (
                <div className="space-y-2">
                  <textarea
                    value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Alasan penolakan…" rows={2}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>Batal</Button>
                    <Button variant="destructive" size="sm" onClick={tolak} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Tolak Receipt
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}>
                    <XCircle size={14} /> Reject
                  </Button>
                  {status === "READY_FOR_PUTAWAY" ? (
                    <Button size="sm" className="ml-auto" onClick={putaway} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />} Confirm Putaway
                    </Button>
                  ) : nextStatus && nextStatus !== "COMPLETED" ? (
                    <Button size="sm" className="ml-auto" onClick={majukan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                      Advance to {RECEIPT_STATUS_REAL[nextStatus]?.label}
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
