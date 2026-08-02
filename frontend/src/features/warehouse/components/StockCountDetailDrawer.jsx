import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, PlayCircle, Send, RotateCcw, CheckCircle2, XCircle, EyeOff } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { COUNT_STATUS_REAL, COUNT_TYPE_REAL, COUNT_METHOD_REAL, UNIT_LABEL } from "../inventoryReal.js";

// Detail Stock Count — Start Count (snapshot systemQty) → isi countedQty
// per baris (blind: systemQty disembunyikan) → Submit Count → review
// selisih + alasan → Complete Count (menulis ADJUSTMENT per baris
// berselisih). Lihat catatan panjang di schema.prisma & routes/stockCount.js.
const waktu = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export default function StockCountDetailDrawer({ countId, onClose, onChanged }) {
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lineEdits, setLineEdits] = useState({});
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = () => {
    if (!countId) return;
    setLoading(true);
    setError("");
    api.getStockCount(countId)
      .then((d) => { setCount(d); setLineEdits({}); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [countId]);

  if (!countId) return null;

  const status = count?.status;
  const selesai = status === "COMPLETED" || status === "CANCELLED";
  const bisaDibatalkan = !selesai;
  const sembunyikanSystemQty = count?.blindCount && status === "IN_PROGRESS";

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
      await Promise.all(Object.entries(lineEdits).map(([lineId, patch]) =>
        api.updateStockCountLine(countId, lineId, patch)
      ));
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function jalankan(aksi, apiFn) {
    setBusy(true);
    setError("");
    try {
      // Complete Count WAJIB baca reason terbaru — flush dulu edit baris
      // yang belum disimpan (mis. reason yang baru diketik) sebelum
      // backend memvalidasi/menulis ledger dari data tersimpan.
      if (aksi === "complete" && Object.keys(lineEdits).length > 0) {
        await Promise.all(Object.entries(lineEdits).map(([lineId, patch]) =>
          api.updateStockCountLine(countId, lineId, patch)
        ));
      }
      await apiFn(countId);
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
      await api.cancelStockCount(countId, cancelReason);
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
    <Dialog.Root open={!!countId} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail Stock Count"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[560px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{count?.countNumber || "…"}</Dialog.Title>
            {status && <StatusBadge map={COUNT_STATUS_REAL} value={status} />}
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

            {count && (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  <div><dt className="text-ink3">Count Type</dt><dd className="font-medium text-ink">{COUNT_TYPE_REAL[count.countType]?.label}</dd></div>
                  <div><dt className="text-ink3">Count Method</dt><dd className="font-medium text-ink">{COUNT_METHOD_REAL[count.countMethod]?.label}</dd></div>
                  <div><dt className="text-ink3">Scheduled Date</dt><dd className="font-medium text-ink">{count.scheduledDate ? waktu(count.scheduledDate) : "—"}</dd></div>
                  <div><dt className="text-ink3">Assigned To</dt><dd className="font-medium text-ink">{count.assignedTo?.name || "—"}</dd></div>
                  <div><dt className="text-ink3">Reviewed By</dt><dd className="font-medium text-ink">{count.reviewedBy?.name || "—"}</dd></div>
                </dl>
                {sembunyikanSystemQty && (
                  <p className="mt-2 flex items-center gap-1.5 rounded-btn bg-accentbg px-2.5 py-1.5 text-[11px] text-accent">
                    <EyeOff size={12} /> Blind count aktif — system quantity disembunyikan sampai submit.
                  </p>
                )}
                {count.notes && <p className="mt-2 text-[11.5px] text-ink2">{count.notes}</p>}

                <div className="mt-4 border-t border-line pt-3">
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Item Lines</h4>
                  <div className="space-y-2.5">
                    {count.lines.map((line) => {
                      const diff = line.systemQty != null && line.countedQty != null ? line.countedQty - line.systemQty : null;
                      const berselisih = diff !== null && diff !== 0;
                      return (
                        <div key={line.id} className="rounded-btn border border-border p-2.5">
                          <div className="flex items-center justify-between">
                            <p className="text-[12.5px] font-semibold text-ink">{line.material.code}</p>
                            {!sembunyikanSystemQty && line.systemQty != null && (
                              <p className="text-[11px] text-ink3">System {line.systemQty} {UNIT_LABEL[line.material.unit]}</p>
                            )}
                          </div>
                          <p className="text-[11px] text-ink2">{line.material.name}</p>

                          {status === "IN_PROGRESS" ? (
                            <div className="mt-2">
                              <label className="mb-0.5 block text-[10px] text-ink3">Counted Quantity</label>
                              <input
                                type="number" step="any" min="0" value={nilai(line, "countedQty")}
                                onChange={(e) => edit(line.id, "countedQty", e.target.value)}
                                className="w-full max-w-[140px] rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
                              />
                            </div>
                          ) : status === "WAITING_REVIEW" ? (
                            <>
                              <p className="mt-1.5 text-[11px] text-ink2">
                                Counted <strong>{line.countedQty}</strong> {UNIT_LABEL[line.material.unit]}
                                {berselisih && (
                                  <span className={diff > 0 ? "ml-1 font-bold text-green" : "ml-1 font-bold text-red"}>
                                    ({diff > 0 ? `+${diff}` : diff})
                                  </span>
                                )}
                              </p>
                              {berselisih && (
                                <div className="mt-1.5">
                                  <label className="mb-0.5 block text-[10px] text-ink3">Reason for Difference *</label>
                                  <input
                                    type="text" value={nilai(line, "reason")}
                                    onChange={(e) => edit(line.id, "reason", e.target.value)}
                                    placeholder="mis. salah catat lokasi, rusak belum dilaporkan"
                                    className="w-full rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                                  />
                                </div>
                              )}
                            </>
                          ) : selesai ? (
                            <p className="mt-1.5 text-[11px] text-ink3">
                              System {line.systemQty ?? "—"} · Counted {line.countedQty ?? "—"}
                              {berselisih && ` · ${line.reason || "—"}`}
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[11px] text-ink3">Diisi setelah Start Count.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {(status === "IN_PROGRESS" || status === "WAITING_REVIEW") && Object.keys(lineEdits).length > 0 && (
                    <Button variant="secondary" size="sm" className="mt-2" onClick={simpanBaris} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : null} Simpan Perubahan Baris
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          {count && !selesai && (
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
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Cancel Count
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
                  {status === "SCHEDULED" && (
                    <Button size="sm" className="ml-auto" onClick={() => jalankan("start", api.startStockCount)} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Start Count
                    </Button>
                  )}
                  {status === "IN_PROGRESS" && (
                    <Button size="sm" className="ml-auto" onClick={() => jalankan("submit", api.submitStockCount)} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit Count
                    </Button>
                  )}
                  {status === "WAITING_REVIEW" && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => jalankan("recount", api.recountStockCount)} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Recount
                      </Button>
                      <Button size="sm" className="ml-auto" onClick={() => jalankan("complete", api.completeStockCount)} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Complete Count
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
