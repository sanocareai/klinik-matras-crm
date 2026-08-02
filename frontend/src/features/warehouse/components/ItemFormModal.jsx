import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import {
  UNIT_LABEL, ALL_UNITS, CATEGORY_REAL, SERVICE_LINE_REAL,
} from "../inventoryReal.js";

// Tambah / ubah item katalog — data NYATA (POST & PATCH /inventory/materials).
//
// ⚠️ `code` dan `unit` TIDAK BISA DIUBAH setelah item dibuat. Itu bukan
// kelalaian UI: backend menolaknya (lihat komentar di routes/inventory.js)
// karena ledger sudah mengacu ke satuan itu — mengganti satuan diam-diam
// membuat riwayat qty tidak bisa dibandingkan. Field-nya dikunci dan
// alasannya ditulis, bukan dihilangkan tanpa penjelasan.
const KOSONG = {
  code: "", name: "", unit: "PCS", category: "", serviceLine: "",
  reorderPoint: "", reorderQty: "",
};

export default function ItemFormModal({ open, item, onClose, onSaved }) {
  const ubah = !!item;
  const [form, setForm] = useState(KOSONG);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr("");
    setForm(item
      ? {
          code: item.code, name: item.name, unit: item.unit,
          category: item.category || "", serviceLine: item.serviceLine || "",
          reorderPoint: item.reorderPoint ?? "", reorderQty: item.reorderQty ?? "",
        }
      : KOSONG);
  }, [open, item]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function simpan(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) { setErr("Kode dan nama wajib diisi"); return; }
    setBusy(true);
    setErr("");
    try {
      if (ubah) {
        // code & unit sengaja TIDAK dikirim — backend menolaknya.
        await api.updateMaterial(item.materialId || item.id, {
          name: form.name,
          category: form.category,          // "" → dikosongkan
          reorderPoint: form.reorderPoint,  // "" → alert dimatikan
          reorderQty: form.reorderQty,
        });
      } else {
        await api.createMaterial({
          code: form.code, name: form.name, unit: form.unit,
          category: form.category || undefined,
          serviceLine: form.serviceLine || undefined,
          reorderPoint: form.reorderPoint || undefined,
          reorderQty: form.reorderQty || undefined,
        });
      }
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title={ubah ? "Ubah Item" : "Tambah Item"}>
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="wh-code" className="mb-1 block text-[11.5px] font-semibold text-ink2">
              Item Code *
            </label>
            <input
              id="wh-code" value={form.code} onChange={set("code")} disabled={ubah}
              placeholder="FOAM-HR-D18-5CM"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent disabled:bg-inset disabled:text-ink3"
            />
            {ubah && <p className="mt-1 text-[10.5px] text-ink3">Kode tidak bisa diubah setelah item dibuat.</p>}
          </div>
          <div>
            <label htmlFor="wh-unit" className="mb-1 block text-[11.5px] font-semibold text-ink2">
              Unit of Measure *
            </label>
            <select
              id="wh-unit" value={form.unit} onChange={set("unit")} disabled={ubah}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent disabled:bg-inset disabled:text-ink3"
            >
              {ALL_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
            {ubah && <p className="mt-1 text-[10.5px] text-ink3">Satuan dikunci — ledger sudah memakainya.</p>}
          </div>
        </div>

        <div>
          <label htmlFor="wh-name" className="mb-1 block text-[11.5px] font-semibold text-ink2">Item Name *</label>
          <input
            id="wh-name" value={form.name} onChange={set("name")}
            placeholder="Busa HR Density 18 — 5cm"
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="wh-cat" className="mb-1 block text-[11.5px] font-semibold text-ink2">Category</label>
            <select
              id="wh-cat" value={form.category} onChange={set("category")}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              <option value="">Tanpa kategori</option>
              {Object.entries(CATEGORY_REAL).map(([k, c]) => (
                <option key={k} value={k}>{c.label} — {c.labelId}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wh-line" className="mb-1 block text-[11.5px] font-semibold text-ink2">Service Line</label>
            <select
              id="wh-line" value={form.serviceLine} onChange={set("serviceLine")} disabled={ubah}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent disabled:bg-inset disabled:text-ink3"
            >
              <option value="">Lintas lini</option>
              {Object.entries(SERVICE_LINE_REAL).map(([k, s]) => <option key={k} value={k}>{s.labelId}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="wh-rop" className="mb-1 block text-[11.5px] font-semibold text-ink2">
              Minimum Stock / Reorder Point
            </label>
            <input
              id="wh-rop" type="number" step="any" min="0" value={form.reorderPoint} onChange={set("reorderPoint")}
              placeholder="kosongkan = alert mati"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="wh-roq" className="mb-1 block text-[11.5px] font-semibold text-ink2">Reorder Quantity</label>
            <input
              id="wh-roq" type="number" step="any" min="0" value={form.reorderQty} onChange={set("reorderQty")}
              placeholder="jumlah restok"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
          </div>
        </div>
        <p className="text-[10.5px] leading-relaxed text-ink3">
          Reorder point kosong berarti alert stok menipis <strong>dimatikan</strong> untuk
          item ini — bukan "restok di angka nol".
        </p>

        {err && <p className="text-[12px] text-red">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} {ubah ? "Simpan Perubahan" : "Tambah Item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
