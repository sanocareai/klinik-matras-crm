import React from "react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { LEAD_SOURCES, KOTA_LIST } from "@/utils/format.js";

const SELECT_CLS =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 " +
  "outline-none transition-colors focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-600/40";

// Form tambah pelanggan baru. Wave 5B: dipindah dari overlay buatan sendiri
// (.modal-overlay/.modal-box) ke primitive ui/modal.jsx (Radix Dialog) —
// dapat fokus-trap, tutup pakai Esc, dan atribut aria secara otomatis, yang
// versi lama tidak punya.
export default function NewCustomerModal({
  open, onOpenChange, form, onForm, onSubmit, submitting, error,
}) {
  const set = (k) => (e) => onForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Tambah Pelanggan Baru"
      description="Wajib isi minimal nomor WhatsApp atau username Instagram."
    >
      {/* Form membungkus body + footer supaya Enter tetap men-submit —
          footer Modal ada di dalam children, bukan prop `footer`, karena
          tombol submit harus berada DI DALAM <form>. */}
      <form onSubmit={onSubmit}>
        <div className="flex flex-col gap-3">
          <Field label="Tipe Pelanggan">
            <select className={SELECT_CLS} value={form.customerType} onChange={set("customerType")}>
              <option value="END_USER">End User (B2C)</option>
              <option value="CORPORATE">Korporat (B2B)</option>
            </select>
          </Field>

          <Field label="Nama">
            <Input placeholder="Nama pelanggan / perusahaan" value={form.name} onChange={set("name")} />
          </Field>

          <Field label="Nomor WhatsApp">
            <Input placeholder="628xxxx" value={form.phone} onChange={set("phone")} inputMode="numeric" />
          </Field>

          <Field label="Username Instagram">
            <Input placeholder="tanpa @" value={form.instagramHandle} onChange={set("instagramHandle")} />
          </Field>

          <Field label="Email">
            <Input type="email" placeholder="email@perusahaan.com" value={form.email || ""} onChange={set("email")} />
          </Field>

          <Field label="Kota">
            <select className={SELECT_CLS} value={form.city} onChange={set("city")}>
              <option value="">— Pilih Kota —</option>
              {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>

          <Field label="Sumber Lead">
            <select className={SELECT_CLS} value={form.leadSource} onChange={set("leadSource")}>
              {LEAD_SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>

          {error && <p className="text-[13px] text-chart-rose">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Menyimpan…" : "Tambah Pelanggan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
