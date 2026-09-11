import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { formatTanggal } from "@/utils/formatDate.js";
import ComplaintCaseDrawer from "@/features/complaints/ComplaintCaseDrawer.jsx";
import {
  CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE, OWNER_LABEL, STATUS_LABEL, STATUS_TONE,
} from "@/features/complaints/complaintLabels.js";

// Papan Kasus Komplain lintas divisi (D-116, 11 September 2026) — SATU
// halaman dipakai Sales/Delivery/Produksi/Warehouse/QC (sidebar masing-
// masing workspace menunjuk ke path YANG SAMA, lihat Layout.jsx), pola
// sama dengan "Semua Order" (ArmadaOrders.jsx/ProductionOrders.jsx) yang
// juga satu sumber data dibaca lintas divisi. Filter status/pemegang kasus
// membantu tiap divisi menyaring kasus yang relevan buat mereka SENDIRI
// tanpa perlu halaman terpisah per divisi (menghindari duplikasi state).
const STATUS_OPTIONS = Object.keys(STATUS_LABEL);
const OWNER_OPTIONS = Object.keys(OWNER_LABEL);

export default function ComplaintCases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getComplaintCases({ status: status || undefined, currentOwner: owner || undefined })
      .then((d) => setCases(d.cases || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, owner]);

  useEffect(() => { load(); }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Kasus Komplain"
        subtitle="Complaint / After-Sales Case lintas divisi — Sales, Delivery, Produksi, Warehouse, QC."
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent">
            <option value="">Semua status</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}
            className="rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent">
            <option value="">Semua pemegang</option>
            {OWNER_OPTIONS.map((o) => <option key={o} value={o}>{OWNER_LABEL[o]}</option>)}
          </select>
        </div>

        {error && <p className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
        {loading && <p className="text-[12.5px] text-ink3">Memuat…</p>}

        {!loading && cases.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title="Belum ada kasus komplain"
            description="Kasus dibuka Sales dari Order Detail (tombol '+ Buka Kasus' di section Kasus Komplain)."
          />
        )}

        {cases.length > 0 && (
          <div className="overflow-x-auto rounded-2xl bg-surface shadow-card dh-table">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink3">
                  <th className="px-3 py-2.5">No. Kasus</th>
                  <th className="px-3 py-2.5">Customer / Order</th>
                  <th className="px-3 py-2.5">Kategori</th>
                  <th className="px-3 py-2.5">Severity</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Pemegang</th>
                  <th className="px-3 py-2.5">Dibuka</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr
                    key={c.id} onClick={() => setOpenId(c.id)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-hovertint"
                  >
                    <td className="px-3 py-2.5 font-semibold text-ink">{c.caseNumber}</td>
                    <td className="px-3 py-2.5 text-ink2">
                      {c.order?.customer?.name} <span className="text-ink3">· {c.order?.orderNumber}</span>
                      {c.unit && <span className="text-ink3"> · {c.unit.unitCode}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-ink2">{CATEGORY_LABEL[c.category] || c.category}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={SEVERITY_TONE[c.severity]}>{SEVERITY_LABEL[c.severity] || c.severity}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status] || c.status}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-ink2">{OWNER_LABEL[c.currentOwner] || c.currentOwner}</td>
                    <td className="px-3 py-2.5 text-ink3">{formatTanggal(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      <ComplaintCaseDrawer open={!!openId} caseId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </PageContainer>
  );
}
