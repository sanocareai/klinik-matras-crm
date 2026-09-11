import React, { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { api } from "@/api.js";
import ComplaintCaseDrawer from "@/features/complaints/ComplaintCaseDrawer.jsx";
import NewComplaintCaseForm from "@/features/complaints/NewComplaintCaseForm.jsx";
import { CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE } from "@/features/complaints/complaintLabels.js";
import { Badge } from "@/components/ui/badge.jsx";
import { formatTanggal } from "@/utils/formatDate.js";

// Complaint / After-Sales Case (D-116, 11 September 2026) — SATU sumber
// kebenaran BARU untuk komplain, TERPISAH dari badge "Ada Komplain"/tombol
// "+ Ajukan Revisi/Komplain" di atas (jalur lama, KHUSUS order DELIVERED,
// TIDAK disentuh sama sekali). Bedanya: kasus di sini bisa dibuka KAPAN PUN,
// termasuk saat order masih diproduksi — begitu dibuka, sistem otomatis
// menyinkronkan Order.hasComplaint juga (jadi badge lama tetap menyala),
// dan merutekan ke Delivery/Produksi/Warehouse/QC lewat status kasus.
//
// Form pembuatan DIEKSTRAK ke NewComplaintCaseForm.jsx (12 September 2026,
// laporan owner: "untuk input komplain belum ada, harus buka chat > klik
// order nya > isi komplain") — komponen SAMA sekarang dipakai juga oleh
// RiwayatRevisiKendala.jsx supaya "Buka Kasus" tersedia di SEMUA tempat
// yang menampilkan order (Semua Order Sales/Delivery/Produksi/B2B, Inbox,
// Jadwal & Penugasan), bukan cuma di sini.
export default function ComplaintCaseSection({ orderId }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [openCaseId, setOpenCaseId] = useState(null);

  const load = useCallback(() => {
    if (!orderId) return;
    setLoading(true);
    api.getComplaintCases({ orderId }).then((d) => setCases(d.cases || [])).catch(() => {}).finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

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
        <div style={{ marginBottom: 8 }}>
          <NewComplaintCaseForm
            orderId={orderId}
            onCreated={() => { setShowForm(false); load(); }}
            onCancel={() => setShowForm(false)}
          />
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
