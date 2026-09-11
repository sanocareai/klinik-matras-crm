import React, { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "./complaintLabels.js";

const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL);
const SEVERITY_OPTIONS = Object.keys(SEVERITY_LABEL);

// Form inline "Buka Kasus Komplain" — SATU sumber kebenaran (D-116, 12
// September 2026, laporan owner: "untuk input komplain belum ada, harus
// buka chat > klik order nya > isi komplain" — sebelum ini form yang
// SAMA PERSIS ditulis ulang di ComplaintCaseSection.jsx dan hanya di
// SANA, tidak ada di tempat lain yang menampilkan order). Dipakai dari
// DUA tempat sekarang: ComplaintCaseSection.jsx (Customer Profile) DAN
// RiwayatRevisiKendala.jsx (Orders/ArmadaOrders/ProductionOrders/
// B2BOrders/OrderEditDrawer/JobDetailDrawer — SEMUA lewat satu komponen
// bersama itu) — supaya field & validasi TIDAK bisa diam-diam beda antara
// keduanya, kelas bug yang sama seperti D-109/D-111.
export default function NewComplaintCaseForm({ orderId, unitId, onCreated, onCancel }) {
  const [category, setCategory] = useState("KUALITAS_PRODUK");
  const [severity, setSeverity] = useState("SEDANG");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!description.trim()) { setError("Keluhan customer wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      const kase = await api.createComplaintCase({ orderId, unitId, category, severity, description: description.trim() });
      onCreated?.(kase);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-btn border border-border bg-inset/40 p-2.5">
      <div className="mb-1.5 flex gap-1.5">
        <select
          value={category} onChange={(e) => setCategory(e.target.value)}
          className="min-w-0 flex-1 rounded-btn border border-border bg-surface px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent"
        >
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <select
          value={severity} onChange={(e) => setSeverity(e.target.value)}
          className="w-28 shrink-0 rounded-btn border border-border bg-surface px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent"
        >
          {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
        </select>
      </div>
      <textarea
        value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
        placeholder="Keluhan customer secara rinci…"
        className="mb-1.5 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
      />
      {error && <p className="mb-1.5 text-[11px] text-red">{error}</p>}
      <div className="flex gap-1.5">
        <button
          type="button" onClick={submit} disabled={busy}
          className="flex items-center gap-1 rounded-btn bg-accent px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Buat Kasus
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-btn px-2.5 py-1.5 text-[11.5px] font-semibold text-ink3 hover:bg-hovertint">
            Batal
          </button>
        )}
      </div>
    </div>
  );
}
