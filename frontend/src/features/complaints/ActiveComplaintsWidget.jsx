import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
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
//
// `ringkas` (OPSIONAL, default false — dashboard divisi lain tidak berubah): tampilan ringkas Dashboard Sales CRM —
// satu baris berisi jumlah kasus + tombol "Lihat kasus"; rincian (nomor kasus, pelanggan, kategori, status) tetap
// ada dan dibuka lewat "Rincian". Sumber data, filter, dan hak akses sama persis (GET /api/complaints).
export default function ActiveComplaintsWidget({ currentOwner, title = "Kasus Komplain Aktif", className = "", ringkas = false }) {
  const [cases, setCases] = useState([]);
  const [rinci, setRinci] = useState(false);
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

  const daftar = (
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
  );

  if (ringkas) {
    return (
      <div className={`crm-komplain ${className}`} data-testid="komplain-ringkas">
        <div className="crm-komplain-baris">
          <span className="crm-komplain-ikon" aria-hidden="true"><AlertTriangle size={22} strokeWidth={2.4} /></span>
          <div className="crm-komplain-teks">
            <p className="crm-komplain-judul">{cases.length} komplain perlu ditindaklanjuti</p>
            <p className="crm-komplain-sub">{title}</p>
          </div>
          <button type="button" className="crm-komplain-rinci" aria-expanded={rinci} onClick={() => setRinci((v) => !v)}>
            Rincian <ChevronDown size={14} className={rinci ? "crm-putar" : undefined} />
          </button>
          <button type="button" className="crm-komplain-aksi" onClick={() => navigate("/komplain")}>
            Lihat kasus <ChevronRight size={15} />
          </button>
        </div>
        {rinci && <div className="crm-komplain-daftar">{daftar}</div>}
      </div>
    );
  }

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
      {daftar}
    </div>
  );
}
