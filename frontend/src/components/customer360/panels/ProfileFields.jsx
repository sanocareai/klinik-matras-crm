import React, { useState, useEffect } from "react";
import { api } from "../../../api.js";
import StageSelect from "../../customer/StageSelect.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { SOURCE_LABELS, KOTA_LIST, formatTanggalWaktu } from "../../../utils/format.js";

// Sumber lead yang BOLEH dipilih manual — versi enum saat ini saja (bukan
// enum lama "ADS"/"WEBSITE" di SOURCE_LABELS, yang cuma dipertahankan
// supaya data historis tetap tampil benar, bukan untuk dipilih ulang).
const LEAD_SOURCE_OPTIONS = [
  "META_ADS", "GOOGLE_ADS", "WEBSITE_ORGANIC", "INSTAGRAM",
  "WHATSAPP_DIRECT", "REFERRAL", "OTHER",
];

// Panel edit profil — memegang LOGIKA edit profil (pakai api.updateCustomer +
// StageSelect yang sudah ada). Bukan dipindah ke orchestrator. onUpdated dipanggil
// setelah perubahan supaya data 360 di-refetch.
export default function ProfileFields({ customer, onUpdated }) {
  const [form, setForm] = useState({ name: "", phone: "", city: "", email: "", tags: "" });
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [salesUsers, setSalesUsers] = useState([]);

  useEffect(() => {
    setForm({ name: customer.name || "", phone: customer.phone || "", city: customer.city || "", email: customer.email || "", tags: (customer.tags || []).join(", ") });
  }, [customer.id]);

  // Daftar sales utk pemilih "Sales Person" — role SALES lewat kolom lama
  // ATAU peran tambahan SALES (D-010, mis. admin/leader yang kadang turun
  // tangan jualan sendiri, lihat Pengguna & Peran).
  useEffect(() => {
    api.getUsers().then((list) => setSalesUsers((list || []).filter((u) =>
      (Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role]).includes("SALES")
    ))).catch(() => {});
  }, []);

  function flash(type, message) { setFeedback({ type, message }); setTimeout(() => setFeedback(null), 4000); }

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const updated = await api.updateCustomer(customer.id, { name: form.name || null, phone: form.phone || null, city: form.city || null, email: form.email || null, tags });
      flash(updated.whatsappSyncStatus === "failed" ? "warning" : "success",
        updated.whatsappSyncStatus === "failed" ? "Tersimpan di CRM, gagal sync ke WhatsApp" : "Perubahan tersimpan");
      onUpdated?.(updated);
    } catch (err) { flash("error", err.message); } finally { setSaving(false); }
  }

  // BUG YANG DIPERBAIKI: onUpdated dulu dipanggil TANPA argumen — pemanggil
  // di Customers.jsx (handleDrawerUpdated) mengharapkan objek customer yang
  // sudah diperbarui untuk menambal baris tabel Pelanggan (`updated.id`),
  // jadi tabel tetap menampilkan data lama (stage/kesehatan/tipe pelanggan)
  // sampai halaman di-refresh manual. Sekarang hasil api.updateCustomer
  // (row Customer yang sudah ter-update) diteruskan ke onUpdated.
  async function patch(data) {
    setBusy(true);
    try {
      const updated = await api.updateCustomer(customer.id, data);
      onUpdated?.(updated);
    }
    catch (err) { flash("error", err.message); }
    finally { setBusy(false); }
  }

  const fbClass = feedback?.type === "success" ? "bg-greenbg text-green"
    : feedback?.type === "warning" ? "bg-orangebg text-orange" : "bg-redbg text-red";
  const health = customer.healthStatus;
  const ctype = customer.customerType || "END_USER";
  const selectCls = "h-9 w-full rounded-lg bg-surface px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/30";

  return (
    <form onSubmit={saveProfile} className="flex flex-col gap-3">
      {feedback && <div className={`rounded-lg px-3 py-2 text-[12px] ${fbClass}`}>{feedback.message}</div>}

      <Field label="Nama"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nama pelanggan" /></Field>
      {/* BUG YANG DIPERBAIKI: nomor WA dulu cuma ditampilkan di header
          drawer (read-only) — tidak ada jalur sama sekali untuk mengoreksi
          typo, padahal nomor salah berarti customer jadi TIDAK BISA
          dihubungi lagi lewat CRM. Backend (PATCH /customers/:id) sudah
          lama mendukung ini, cuma tidak pernah diekspos di form. */}
      <Field label="No. WhatsApp"><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="62812xxxxxxxx" /></Field>
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
              className={`rounded-full  px-3 py-1 text-[12px] font-semibold transition-colors ${
                health === v
                  ? (v === "SAKIT" ? "border-red bg-redbg text-red" : "border-green bg-greenbg text-green")
                  : "text-ink2 hover:bg-hovertint"}`}>{l}</button>
          ))}
        </div>
      </Field>

      <Field label="Tipe Customer">
        <div className="flex gap-1.5">
          {[["END_USER", "End User"], ["CORPORATE", "Corporate"]].map(([v, l]) => (
            <button key={v} type="button" disabled={busy} onClick={() => ctype !== v && patch({ customerType: v })}
              className={`rounded-full  px-3 py-1 text-[12px] font-semibold transition-colors ${
                ctype === v ? "bg-accentbg text-accent" : "text-ink2 hover:bg-hovertint"}`}>{l}</button>
          ))}
        </div>
      </Field>

      {/* BUG YANG DIPERBAIKI: Sumber Lead & Sales Person dulu cuma teks
          read-only di sini, padahal backend (PATCH /customers/:id) sudah
          lama mendukung mengubah keduanya — sales sering salah pilih sumber
          lead atau customer perlu dipindah ke sales lain, dan sebelumnya
          harus lewat halaman lain (atau tidak bisa sama sekali) untuk
          mengoreksinya. */}
      <Field label="Sumber Lead">
        <select
          value={customer.leadSource || ""} disabled={busy}
          onChange={(e) => e.target.value && patch({ leadSource: e.target.value })}
          className={selectCls}
        >
          {!LEAD_SOURCE_OPTIONS.includes(customer.leadSource) && (
            <option value={customer.leadSource || ""}>{SOURCE_LABELS[customer.leadSource] || customer.leadSource || "— Belum diisi —"}</option>
          )}
          {LEAD_SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
        </select>
        {customer.leadSourceConfirmed === false && (
          <p className="mt-1 text-[11px] text-orange">Belum dikonfirmasi — masih dugaan otomatis sistem.</p>
        )}
      </Field>
      <Field label="Sales Person">
        <select
          value={customer.assignedSalesId || ""} disabled={busy}
          onChange={(e) => patch({ assignedSalesId: e.target.value || null })}
          className={selectCls}
        >
          <option value="">— Belum ditugaskan —</option>
          {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>

      <Button type="submit" disabled={saving} className="w-full justify-center">{saving ? "Menyimpan..." : "Simpan Perubahan"}</Button>

      {/* Riwayat Keluhan (konteks kesehatan) */}
      <div className="mt-1">
        <div className="mb-1.5 text-[12px] font-semibold text-ink">Riwayat Keluhan</div>
        {(!customer.allKeluhan || customer.allKeluhan.length === 0) ? (
          <p className="text-[12px] text-ink3">Belum ada riwayat keluhan.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {customer.allKeluhan.map((it, i) => (
              <div key={i} className="rounded-lg bg-orangebg px-3 py-2">
                <div className="text-[12px] text-ink">{it.keluhan}</div>
                <div className="mt-0.5 text-[10.5px] text-ink3">{formatTanggalWaktu(it.tanggal)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
