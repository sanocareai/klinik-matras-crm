import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { blankRow, isBlankRow, totalsOf, validateMaterialRows, withTrailingBlank } from "@/features/production/materialRows.js";

// Daftar baris bahan dengan pola "+ Tambah baris" (sama dengan PO Finance): pilih bahan, jumlah + satuan, keterangan relevan (stok tersedia/sisa diserahkan). Satu baris kosong otomatis
// tersedia setelah baris terakhir terisi; baris kosong tidak dikirim. Komponen ini hanya mengelola isian — penyimpanan (revisi, idempotensi, konflik) oleh pemanggil.
//   options: [{ id, label, unit, hint? }]  ·  hintOf(row): teks/JSX kecil di bawah baris (mis. "Cukup", "Kurang 2")  ·  errors: { [rowKey]: pesan }
const field = "block w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-[14px] text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

export default function MaterialRowsEditor({ rows, onChange, options, hintOf = null, errors = {}, disabled = false, emptyOptionsText = null, addLabel = "Tambah baris", testid = "material-rows", pickLabel = "Pilih bahan…", qtyLabel = "Jumlah" }) {
  const byId = new Map((options || []).map((o) => [o.id, o]));
  const update = (key, patch) => onChange(withTrailingBlank(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))));
  const remove = (key) => onChange(withTrailingBlank(rows.filter((r) => r.key !== key)));
  const usedElsewhere = (row) => new Set(rows.filter((r) => r.key !== row.key && r.materialId).map((r) => r.materialId));
  const totals = totalsOf(rows, (id) => byId.get(id)?.unit);

  if (!(options || []).length && emptyOptionsText) return <p data-testid={`${testid}-empty`} className="rounded-btn bg-orangebg px-3 py-3 text-[13px] text-orange">{emptyOptionsText}</p>;
  return (
    <div className="space-y-2" data-testid={testid}>
      <ul className="m-0 list-none space-y-2 p-0">
        {rows.map((r, i) => {
          const o = byId.get(r.materialId);
          const taken = usedElsewhere(r);
          const err = errors[r.key];
          return (
            <li key={r.key} data-testid="material-row" data-blank={isBlankRow(r) ? "true" : undefined} className={`rounded-btn border p-2 ${err ? "border-red" : "border-line"}`}>
              <div className="flex items-start gap-2">
                <span aria-hidden className="mt-2.5 w-5 shrink-0 text-center text-[12px] font-semibold text-ink3">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <select aria-label={`Bahan baris ${i + 1}`} data-testid="material-row-select" disabled={disabled} className={field} value={r.materialId} onChange={(e) => update(r.key, { materialId: e.target.value })}>
                    <option value="">{pickLabel}</option>
                    {(options || []).map((m) => <option key={m.id} value={m.id} disabled={taken.has(m.id)}>{m.label}{taken.has(m.id) ? " — sudah dipilih" : ""}</option>)}
                    {r.materialId && !o && <option value={r.materialId}>(bahan tidak ada di daftar)</option>}
                  </select>
                  {o?.hint && <p className="m-0 text-[12px] text-ink3">{o.hint}</p>}
                  {hintOf && r.materialId ? <div className="text-[12px]">{hintOf(r, o)}</div> : null}
                </div>
                <div className="flex shrink-0 items-start gap-1.5">
                  <div className="w-24">
                    <input aria-label={`${qtyLabel} baris ${i + 1}`} data-testid="material-row-qty" inputMode="decimal" placeholder="0" disabled={disabled} className={`${field} text-right`} value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
                    {o?.unit && <p className="m-0 mt-0.5 text-right text-[11.5px] text-ink3">{String(o.unit).toLowerCase()}</p>}
                  </div>
                  <button type="button" aria-label={`Hapus baris ${i + 1}`} data-testid="material-row-remove" disabled={disabled || (rows.length === 1 && isBlankRow(r))} onClick={() => remove(r.key)}
                    className="flex h-10 w-10 items-center justify-center rounded-btn text-red disabled:opacity-30"><Trash2 size={16} aria-hidden /></button>
                </div>
              </div>
              {err && <p role="alert" data-testid="material-row-error" className="m-0 mt-1.5 pl-7 text-[12px] font-semibold text-red">{err}</p>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" data-testid="material-row-add" disabled={disabled} onClick={() => onChange([...rows.filter((r) => !isBlankRow(r)), blankRow()])}
          className="flex min-h-[44px] items-center gap-1 text-[13px] font-semibold text-accent disabled:opacity-50"><Plus size={14} aria-hidden /> {addLabel}</button>
        <span data-testid="material-rows-total" className="text-[12px] text-ink3">
          {totals.count === 0 ? "Belum ada bahan terisi" : `${totals.count} bahan · ${totals.byUnit.map((t) => `${t.qty}${t.unit ? ` ${String(t.unit).toLowerCase()}` : ""}`).join(" + ")}`}
        </span>
      </div>
    </div>
  );
}

export { validateMaterialRows };
