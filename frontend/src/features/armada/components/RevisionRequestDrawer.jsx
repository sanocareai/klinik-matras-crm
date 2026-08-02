import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Search, Loader2, Send } from "lucide-react";
import { api } from "@/api.js";

// Drawer pengajuan Revisi baru — pencarian unit DIBATASI status DELIVERED
// (lihat GET /armada/revisions/units), karena mengajukan revisi atas kasur
// yang belum sampai ke customer tidak masuk akal.
export default function RevisionRequestDrawer({ open, onClose, onCreated }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [unit, setUnit] = useState(null);
  const [trigger, setTrigger] = useState("KENYAMANAN");
  const [complaint, setComplaint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setQ(""); setResults([]); setUnit(null); setTrigger("KENYAMANAN"); setComplaint(""); setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || unit || q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchRevisionUnits(q.trim())
        .then((d) => setResults(d.units))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, unit, open]);

  async function ajukan() {
    if (!unit) { setError("Pilih unit terlebih dahulu"); return; }
    if (!complaint.trim()) { setError("Keluhan/alasan wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      await api.createRevision({ unitId: unit.id, trigger, complaint });
      onCreated();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Ajukan Revisi"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[420px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">Ajukan Revisi</Dialog.Title>
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Unit *</label>
              {unit ? (
                <div className="flex items-center justify-between rounded-btn border border-accent bg-accentbg px-2.5 py-2">
                  <div>
                    <p className="text-[12.5px] font-semibold text-ink">{unit.unitCode}</p>
                    <p className="text-[11px] text-ink2">{unit.order?.customer?.name} · {unit.order?.orderNumber}</p>
                  </div>
                  <button type="button" onClick={() => setUnit(null)} className="text-[11.5px] font-semibold text-accent">Ganti</button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
                    <input
                      type="search" value={q} onChange={(e) => setQ(e.target.value)}
                      placeholder="Cari kode unit, no. order, atau nama pelanggan…"
                      className="w-full rounded-btn border border-border bg-surface py-1.5 pl-8 pr-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                  </div>
                  {searching && <p className="mt-1.5 text-[11px] text-ink3">Mencari…</p>}
                  {!searching && q.trim().length >= 2 && results.length === 0 && (
                    <p className="mt-1.5 text-[11px] text-ink3">Tidak ada unit terkirim yang cocok.</p>
                  )}
                  {results.length > 0 && (
                    <ul className="mt-1.5 max-h-48 divide-y divide-line overflow-y-auto rounded-btn border border-border">
                      {results.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => setUnit(u)}
                            className="w-full px-2.5 py-2 text-left transition-colors hover:bg-hovertint"
                          >
                            <p className="text-[12.5px] font-semibold text-ink">{u.unitCode}</p>
                            <p className="text-[11px] text-ink2">{u.order?.customer?.name} · {u.order?.orderNumber}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Jenis *</label>
              <div className="flex gap-2">
                {[
                  { key: "KENYAMANAN", label: "Trial Kenyamanan" },
                  { key: "GARANSI", label: "Klaim Garansi" },
                ].map((t) => (
                  <button
                    key={t.key} type="button" onClick={() => setTrigger(t.key)}
                    className={`flex-1 rounded-btn border py-1.5 text-[12px] font-semibold transition-colors ${
                      trigger === t.key ? "border-accent bg-accentbg text-accent" : "border-border text-ink2 hover:bg-hovertint"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Keluhan / alasan *</label>
              <textarea
                value={complaint} onChange={(e) => setComplaint(e.target.value)}
                placeholder="mis. tekstur kasur terasa terlalu keras di area pinggul"
                rows={4}
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-line p-3">
            {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
            <button
              type="button" onClick={ajukan} disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-accent py-2 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Ajukan Revisi
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
