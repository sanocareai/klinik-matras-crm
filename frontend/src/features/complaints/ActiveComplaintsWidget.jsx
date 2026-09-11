import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE } from "./complaintLabels.js";

// Widget "Kasus Komplain Aktif" — dipasang di dashboard tiap divisi (D-116,
// 11 September 2026, permintaan owner: "komplain itu prioritas, muncul di
// dashboard, notifikasi dan lainnya"). SATU komponen dipakai lintas
// Sales/Delivery/Produksi/Warehouse, filter `currentOwner` menyaring supaya
// tiap dashboard cuma menonjolkan kasus yang REALEVAN untuk divisi itu —
// data dari endpoint yang SAMA (GET /api/complaints) dipakai halaman
// /komplain, bukan sumber kedua.
//
// JUJUR soal kosong (prinsip UX Sano) — kalau tidak ada kasus aktif untuk
// filter ini, widget TIDAK render apa-apa (bukan kotak kosong "0 kasus"
// yang cuma menghabiskan ruang dashboard tanpa nilai).
export default function ActiveComplaintsWidget({ currentOwner, title = "Kasus Komplain Aktif", className = "" }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let batal = false;
    api.getComplaintCases(currentOwner ? { currentOwner } : {})
      .then((d) => {
        if (batal) return;
        const aktif = (d.cases || []).filter((c) => c.status !== "SELESAI" && c.status !== "DIBATALKAN");
        setCases(aktif);
      })
      .catch(() => { if (!batal) setCases([]); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [currentOwner]);

  if (loading || cases.length === 0) return null;

  return (
    <div className={`rounded-2xl bg-redbg p-4 shadow-card ${className}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <AlertTriangle size={15} className="shrink-0 text-red" />
        <p className="text-[13px] font-bold text-red">{title} ({cases.length})</p>
        <button
          type="button" onClick={() => navigate("/komplain")}
          className="ml-auto shrink-0 text-[11.5px] font-semibold text-red hover:underline"
        >
          Lihat semua
        </button>
      </div>
      <div className="space-y-1.5">
        {cases.slice(0, 4).map((c) => (
          <button
            key={c.id} type="button" onClick={() => navigate("/komplain")}
            className="flex w-full items-center gap-2 rounded-btn bg-surface px-2.5 py-1.5 text-left hover:bg-hovertint"
          >
            <span className="shrink-0 font-mono text-[10.5px] font-bold text-ink">{c.caseNumber}</span>
            <span className="truncate text-[11.5px] text-ink2">{c.order?.customer?.name || "—"} · {CATEGORY_LABEL[c.category] || c.category}</span>
            <Badge variant={STATUS_TONE[c.status]} className="ml-auto shrink-0">{STATUS_LABEL[c.status] || c.status}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
