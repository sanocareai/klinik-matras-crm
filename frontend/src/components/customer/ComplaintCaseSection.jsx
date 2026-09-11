import React, { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Plus, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import ComplaintCaseDrawer from "@/features/complaints/ComplaintCaseDrawer.jsx";
import { CATEGORY_LABEL, SEVERITY_LABEL, STATUS_LABEL, STATUS_TONE } from "@/features/complaints/complaintLabels.js";
import { Badge } from "@/components/ui/badge.jsx";
import { formatTanggal } from "@/utils/formatDate.js";

const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL);
const SEVERITY_OPTIONS = Object.keys(SEVERITY_LABEL);

// Complaint / After-Sales Case (D-116, 11 September 2026) — SATU sumber
// kebenaran BARU untuk komplain, TERPISAH dari badge "Ada Komplain"/tombol
// "+ Ajukan Revisi/Komplain" di atas (jalur lama, KHUSUS order DELIVERED,
// TIDAK disentuh sama sekali). Bedanya: kasus di sini bisa dibuka KAPAN PUN,
// termasuk saat order masih diproduksi — begitu dibuka, sistem otomatis
// menyinkronkan Order.hasComplaint juga (jadi badge lama tetap menyala),
// dan merutekan ke Delivery/Produksi/Warehouse/QC lewat status kasus.
export default function ComplaintCaseSection({ orderId }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openCaseId, setOpenCaseId] = useState(null);

  const [category, setCategory] = useState("KUALITAS_PRODUK");
  const [severity, setSeverity] = useState("SEDANG");
  const [description, setDescription] = useState("");

  const load = useCallback(() => {
    if (!orderId) return;
    setLoading(true);
    api.getComplaintCases({ orderId }).then((d) => setCases(d.cases || [])).catch(() => {}).finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  async function buatKasus() {
    if (!description.trim()) { setError("Keluhan customer wajib diisi"); return; }
    setBusy(true); setError("");
    try {
      await api.createComplaintCase({ orderId, category, severity, description: description.trim() });
      setShowForm(false); setDescription(""); setCategory("KUALITAS_PRODUK"); setSeverity("SEDANG");
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <AlertTriangle size={13} color="var(--text-secondary)" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Kasus Komplain (Lintas Divisi)</span>
        <button
          type="button" onClick={() => setShowForm((v) => !v)}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
        >
          <Plus size={12} /> Buka Kasus
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: 8, padding: 8, borderRadius: 6, background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              style={{ flex: 1, fontSize: 11.5, padding: "5px 6px", borderRadius: 6, border: "1px solid var(--border)" }}>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}
              style={{ width: 110, fontSize: 11.5, padding: "5px 6px", borderRadius: 6, border: "1px solid var(--border)" }}>
              {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </div>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder="Keluhan customer secara rinci…"
            style={{ width: "100%", fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", marginBottom: 6, resize: "vertical" }}
          />
          {error && <p style={{ margin: "0 0 6px", fontSize: 11.5, color: "var(--red)" }}>{error}</p>}
          <button type="button" onClick={buatKasus} disabled={busy} className="btn btn-primary btn-sm"
            style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Buat Kasus
          </button>
        </div>
      )}

      {loading && <p style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Memuat…</p>}
      {!loading && cases.length === 0 && !showForm && (
        <p style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Belum ada kasus komplain untuk order ini.</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {cases.map((c) => (
          <button
            key={c.id} type="button" onClick={() => setOpenCaseId(c.id)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-primary)", cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-primary)" }}>{c.caseNumber}</span>
            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{CATEGORY_LABEL[c.category]}</span>
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-secondary)" }}>{formatTanggal(c.createdAt)}</span>
            <Badge variant={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status] || c.status}</Badge>
          </button>
        ))}
      </div>

      <ComplaintCaseDrawer
        open={!!openCaseId} caseId={openCaseId}
        onClose={() => setOpenCaseId(null)}
        onChanged={load}
      />
    </div>
  );
}
