import React, { useState, useEffect } from "react";
import { api } from "../../../api.js";
import StageSelect from "../../customer/StageSelect.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { SOURCE_LABELS, KOTA_LIST, formatTanggalWaktu } from "../../../utils/format.js";

// Panel edit profil — memegang LOGIKA edit profil (pakai api.updateCustomer +
// StageSelect yang sudah ada). Bukan dipindah ke orchestrator. onUpdated dipanggil
// setelah perubahan supaya data 360 di-refetch.
export default function ProfileFields({ customer, onUpdated }) {
  const [form, setForm] = useState({ name: "", city: "", email: "", tags: "" });
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ name: customer.name || "", city: customer.city || "", email: customer.email || "", tags: (customer.tags || []).join(", ") });
  }, [customer.id]);

  function flash(type, message) { setFeedback({ type, message }); setTimeout(() => setFeedback(null), 4000); }

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const updated = await api.updateCustomer(customer.id, { name: form.name || null, city: form.city || null, email: form.email || null, tags });
      flash(updated.whatsappSyncStatus === "failed" ? "warning" : "success",
        updated.whatsappSyncStatus === "failed" ? "Tersimpan di CRM, gagal sync ke WhatsApp" : "Perubahan tersimpan");
      onUpdated?.();
    } catch (err) { flash("error", err.message); } finally { setSaving(false); }
  }

  async function patch(data) {
    setBusy(true);
    try { await api.updateCustomer(customer.id, data); onUpdated?.(); }
    catch (err) { flash("error", err.message); }
    finally { setBusy(false); }
  }

  const fbClass = feedback?.type === "success" ? "bg-chart-green-soft text-chart-green"
    : feedback?.type === "warning" ? "bg-chart-orange-soft text-chart-orange" : "bg-chart-rose-soft text-chart-rose";
  const health = customer.healthStatus;
  const ctype = customer.customerType || "END_USER";
  const selectCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-600/30";

  return (
    <form onSubmit={saveProfile} className="flex flex-col gap-3">
      {feedback && <div className={`rounded-lg px-3 py-2 text-[12px] ${fbClass}`}>{feedback.message}</div>}

      <Field label="Nama"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nama pelanggan" /></Field>
      <Field label="Kota">
        <select value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className={selectCls}>
          <option value="">— Pilih Kota —</option>
          {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>
      <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@contoh.com" /></Field>
      <Field label="Tags (pisahkan koma)"><Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="premium, repeat-order" /></Field>

      <Field label="Tahap Pipeline"><StageSelect value={customer.pipelineStage} onChange={(s) => patch({ pipelineStage: s })} /></Field>

      <Field label="Kondisi Pelanggan">
        <div className="flex flex-wrap gap-1.5">
          {[["SAKIT", "Sakit"], ["TIDAK_SAKIT", "Tidak Sakit"]].map(([v, l]) => (
            <button key={v} type="button" disabled={busy} onClick={() => patch({ healthStatus: health === v ? null : v })}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                health === v
                  ? (v === "SAKIT" ? "border-chart-rose bg-chart-rose-soft text-chart-rose" : "border-chart-green bg-chart-green-soft text-chart-green")
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
      </Field>

      <Field label="Tipe Customer">
        <div className="flex gap-1.5">
          {[["END_USER", "End User"], ["CORPORATE", "Corporate"]].map(([v, l]) => (
            <button key={v} type="button" disabled={busy} onClick={() => ctype !== v && patch({ customerType: v })}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                ctype === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
      </Field>

      <Field label="Sumber Lead"><div className="text-[13px] text-slate-500">{SOURCE_LABELS[customer.leadSource] || customer.leadSource || "—"}</div></Field>
      <Field label="Sales Person"><div className="text-[13px] text-slate-500">{customer.assignedSales?.name || "—"}</div></Field>

      <Button type="submit" disabled={saving} className="w-full justify-center">{saving ? "Menyimpan..." : "Simpan Perubahan"}</Button>

      {/* Riwayat Keluhan (konteks kesehatan) */}
      <div className="mt-1">
        <div className="mb-1.5 text-[12px] font-semibold text-slate-700">Riwayat Keluhan</div>
        {(!customer.allKeluhan || customer.allKeluhan.length === 0) ? (
          <p className="text-[12px] text-slate-400">Belum ada riwayat keluhan.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {customer.allKeluhan.map((it, i) => (
              <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[12px] text-amber-800">{it.keluhan}</div>
                <div className="mt-0.5 text-[10.5px] text-slate-400">{formatTanggalWaktu(it.tanggal)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
