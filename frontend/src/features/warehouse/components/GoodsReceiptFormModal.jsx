import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { RECEIPT_SOURCE_REAL } from "../inventoryReal.js";
import { teksJumlah } from "@/features/finance/purchaseOrderLogic.js";

// Buat Penerimaan Barang baru — status awal selalu DRAFT (POST /inventory/goods-receipts).
//
// Dua jalur:
//   • DARI PO (Purchase Order bahan baku yang sudah disetujui Finance): supplier, referensi, dan baris item terisi dari PO — Gudang tidak
//     mengetik ulang. Gudang tetap mencatat surat jalan, jumlah datang, baik, dan ditolak di tahapan penerimaan seperti biasa. Jumlah
//     dijadwalkan per baris tidak boleh melebihi sisa PO. Harga PO tidak ditampilkan di sini.
//   • TANPA PO (jalur lama, untuk kiriman yang memang tidak punya PO): isian bebas seperti sebelumnya, ditandai jelas sebagai "Tanpa PO".
const BARIS_KOSONG = { materialId: "", orderedQty: "" };
const MODE = { PO: "po", MANUAL: "manual" };

export default function GoodsReceiptFormModal({ open, onClose, onCreated }) {
  const [mode, setMode] = useState(MODE.PO);
  const [pos, setPos] = useState(null); // null = memuat
  const [poId, setPoId] = useState("");
  const [pilihan, setPilihan] = useState({}); // purchaseOrderLineId -> { dipilih, qty }
  const [materials, setMaterials] = useState([]);
  const [sourceType, setSourceType] = useState("SUPPLIER_DELIVERY");
  const [sourceReference, setSourceReference] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ ...BARIS_KOSONG }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(MODE.PO); setPoId(""); setPilihan({}); setPos(null);
    setSourceType("SUPPLIER_DELIVERY"); setSourceReference(""); setSupplier("");
    setExpectedDate(""); setNotes(""); setLines([{ ...BARIS_KOSONG }]); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
    api.getGudangPurchaseOrders()
      .then((r) => { setPos(r.purchaseOrders || []); if ((r.purchaseOrders || []).length === 0) setMode(MODE.MANUAL); })
      .catch(() => { setPos([]); setMode(MODE.MANUAL); });
  }, [open]);

  const po = useMemo(() => (pos || []).find((p) => p.id === poId) || null, [pos, poId]);

  function pilihPO(id) {
    setPoId(id);
    const p = (pos || []).find((x) => x.id === id);
    const awal = {};
    for (const l of p?.lines || []) awal[l.id] = { dipilih: l.progres.belumDatang > 0, qty: String(l.progres.belumDatang) };
    setPilihan(awal);
    setExpectedDate(p?.expectedDate ? String(p.expectedDate).slice(0, 10) : "");
  }
  const setPil = (id, patch) => setPilihan((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  function setLine(i, patch) { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  const tambahBaris = () => setLines((ls) => [...ls, { ...BARIS_KOSONG }]);
  const hapusBaris = (i) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // Galat isian jalur PO: jumlah dijadwalkan harus > 0 dan tidak melebihi sisa PO.
  const galatPO = useMemo(() => {
    if (!po) return "Pilih Purchase Order";
    const dipilih = po.lines.filter((l) => pilihan[l.id]?.dipilih);
    if (dipilih.length === 0) return "Pilih minimal satu item";
    for (const l of dipilih) {
      const q = Number(pilihan[l.id].qty);
      if (!(q > 0)) return `${l.kode}: jumlah dijadwalkan harus lebih dari 0`;
      if (q > l.progres.belumDatang + 1e-9) return `${l.kode}: melebihi yang belum datang (${teksJumlah(l.progres.belumDatang)} ${l.satuan})`;
    }
    return null;
  }, [po, pilihan]);

  async function simpan(e) {
    e.preventDefault();
    setErr("");
    let body;
    if (mode === MODE.PO) {
      if (galatPO) { setErr(galatPO); return; }
      body = {
        purchaseOrderId: po.id, expectedDate: expectedDate || undefined, notes: notes || undefined,
        lines: po.lines.filter((l) => pilihan[l.id]?.dipilih).map((l) => ({ purchaseOrderLineId: l.id, orderedQty: Number(pilihan[l.id].qty) })),
      };
    } else {
      const valid = lines.filter((l) => l.materialId);
      if (valid.length === 0) { setErr("Minimal satu item wajib dipilih"); return; }
      body = {
        sourceType, sourceReference: sourceReference || undefined, supplier: supplier || undefined,
        expectedDate: expectedDate || undefined, notes: notes || undefined,
        lines: valid.map((l) => ({ materialId: l.materialId, orderedQty: l.orderedQty || undefined })),
      };
    }
    setBusy(true);
    try {
      await api.createGoodsReceipt(body);
      onCreated();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  const kolom = "w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent";
  const adaPO = (pos || []).length > 0;

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Penerimaan Baru" className="w-[600px]">
      <form onSubmit={simpan} className="space-y-3">
        <div role="radiogroup" aria-label="Sumber penerimaan" className="flex flex-wrap gap-1.5">
          <button type="button" role="radio" aria-checked={mode === MODE.PO} disabled={!adaPO} onClick={() => setMode(MODE.PO)}
            className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold ${mode === MODE.PO ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint"} disabled:opacity-40`}>
            Dari Purchase Order
          </button>
          <button type="button" role="radio" aria-checked={mode === MODE.MANUAL} onClick={() => setMode(MODE.MANUAL)}
            className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold ${mode === MODE.MANUAL ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint"}`}>
            Tanpa PO
          </button>
        </div>

        {mode === MODE.PO ? (
          <>
            {pos === null ? (
              <p className="flex items-center gap-1.5 text-[12.5px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat Purchase Order…</p>
            ) : (
              <div>
                <label htmlFor="gr-po" className="mb-1 block text-[11.5px] font-semibold text-ink2">Purchase Order *</label>
                <select id="gr-po" value={poId} onChange={(e) => pilihPO(e.target.value)} className={kolom}>
                  <option value="">— pilih PO yang disetujui —</option>
                  {pos.map((p) => <option key={p.id} value={p.id}>{p.poNumber} — {p.supplier.name}{p.status === "DITERIMA_SEBAGIAN" ? " (diterima sebagian)" : ""}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-ink3">Hanya PO yang sudah disetujui Finance dan belum selesai diterima.</p>
              </div>
            )}

            {po && (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-btn bg-inset px-3 py-2 text-[12px]">
                  <div><dt className="text-ink3">Supplier</dt><dd className="ml-0 font-medium text-ink">{po.supplier.name}</dd></div>
                  <div><dt className="text-ink3">Referensi</dt><dd className="ml-0 font-medium text-ink">{po.poNumber}</dd></div>
                </dl>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Item yang dijadwalkan datang *</label>
                  <div className="space-y-2">
                    {po.lines.map((l) => {
                      const p = pilihan[l.id] || { dipilih: false, qty: "" };
                      const penuh = l.progres.belumDatang <= 0;
                      return (
                        <div key={l.id} className="rounded-btn border border-border p-2.5" data-testid="baris-po-gudang">
                          <label className="flex items-start gap-2 text-[12.5px]">
                            <input type="checkbox" checked={!!p.dipilih && !penuh} disabled={penuh} onChange={(e) => setPil(l.id, { dipilih: e.target.checked })} className="mt-0.5" />
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold text-ink">{l.kode}</span> <span className="text-ink2">{l.nama}</span>
                              <span className="mt-0.5 block text-[11.5px] text-ink3">
                                Dipesan {teksJumlah(l.dipesan)} {l.satuan} · masuk stok {teksJumlah(l.progres.masukStok)} · <strong className="text-ink2">belum datang {teksJumlah(l.progres.belumDatang)}</strong>{penuh ? " — sudah terpenuhi" : ""}
                              </span>
                            </span>
                          </label>
                          {p.dipilih && !penuh && (
                            <div className="mt-2 flex items-center gap-2 pl-6">
                              <label htmlFor={`gr-qty-${l.id}`} className="text-[11.5px] text-ink2">Jumlah dijadwalkan</label>
                              <input
                                id={`gr-qty-${l.id}`} type="number" step="any" min="0" value={p.qty} onChange={(e) => setPil(l.id, { qty: e.target.value })}
                                className="w-28 rounded-btn border border-border bg-surface px-2 py-1 text-right text-[12px] tabular-nums text-ink outline-none focus:border-accent"
                              />
                              <span className="text-[11.5px] text-ink3">{l.satuan}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="rounded-btn bg-orangebg px-3 py-2 text-[12px] text-orange" data-testid="peringatan-tanpa-po">
              Penerimaan ini <strong>tanpa PO</strong>: tidak ada pencocokan jumlah dan harga terhadap pesanan. Gunakan hanya untuk kiriman yang memang tidak punya PO.
            </p>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <div>
                <label htmlFor="gr-source" className="mb-1 block text-[11.5px] font-semibold text-ink2">Jenis sumber *</label>
                <select id="gr-source" value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={kolom}>
                  {Object.entries(RECEIPT_SOURCE_REAL).map(([k, s]) => <option key={k} value={k}>{s.labelId || s.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="gr-ref" className="mb-1 block text-[11.5px] font-semibold text-ink2">Referensi</label>
                <input id="gr-ref" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="No. PO lama / referensi internal" className={`${kolom} placeholder:text-ink3`} />
              </div>
            </div>
            <div>
              <label htmlFor="gr-supplier" className="mb-1 block text-[11.5px] font-semibold text-ink2">Supplier / Pengirim</label>
              <input id="gr-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nama supplier atau pengirim" className={`${kolom} placeholder:text-ink3`} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11.5px] font-semibold text-ink2">Baris item *</label>
                <button type="button" onClick={tambahBaris} className="flex items-center gap-1 text-[11.5px] font-semibold text-accent"><Plus size={12} /> Tambah baris</button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select aria-label={`Item baris ${i + 1}`} value={l.materialId} onChange={(e) => setLine(i, { materialId: e.target.value })} className="min-w-0 flex-1 rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent">
                      <option value="">Pilih item…</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                    </select>
                    <input
                      aria-label={`Jumlah baris ${i + 1}`} type="number" step="any" min="0" value={l.orderedQty} onChange={(e) => setLine(i, { orderedQty: e.target.value })} placeholder="Jumlah"
                      className="w-20 shrink-0 rounded-btn border border-border bg-surface px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                    <button type="button" onClick={() => hapusBaris(i)} disabled={lines.length === 1} className="shrink-0 rounded-btn p-1.5 text-ink3 hover:bg-redbg hover:text-red disabled:opacity-30" aria-label="Hapus baris"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              {materials.length === 0 && <p className="mt-1.5 text-[10.5px] text-ink3">Belum ada item aktif di katalog — tambahkan lewat Stock &amp; Material dulu.</p>}
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div>
            <label htmlFor="gr-date" className="mb-1 block text-[11.5px] font-semibold text-ink2">Perkiraan tiba</label>
            <input id="gr-date" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={kolom} />
          </div>
          <div>
            <label htmlFor="gr-notes" className="mb-1 block text-[11.5px] font-semibold text-ink2">Catatan</label>
            <input id="gr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={kolom} />
          </div>
        </div>

        {err && <p role="alert" data-testid="galat-penerimaan" className="text-[12px] text-red">{err}</p>}
        {mode === MODE.PO && po && galatPO && !err && <p className="text-[12px] text-orange">{galatPO}</p>}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy || (mode === MODE.PO && !!galatPO)}>
            {busy && <Loader2 size={14} className="animate-spin" />} Buat Draf Penerimaan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
