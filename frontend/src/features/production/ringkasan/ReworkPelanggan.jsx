import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/features/complaints/complaintLabels.js";
import { IkDokumen } from "@/components/produksiIcons.jsx";

// "Rework pelanggan" di Ringkasan Produksi — sumber & filter SAMA dengan ActiveComplaintsWidget (GET /complaints?currentOwner=PRODUCTION, status aktif).
// Tidak ada kasus aktif = tidak render apa-apa (jujur, bukan kotak "0 kasus").
export default function ReworkPelanggan() {
  const [kasus, setKasus] = useState([]);
  useEffect(() => {
    let batal = false;
    api.getComplaintCases({ currentOwner: "PRODUCTION" })
      .then((d) => { if (!batal) setKasus((d.cases || []).filter((c) => c.status !== "SELESAI" && c.status !== "DIBATALKAN")); })
      .catch(() => { if (!batal) setKasus([]); });
    return () => { batal = true; };
  }, []);
  if (!kasus.length) return null;
  return (
    <div className="prod-rework" data-testid="rework-pelanggan">
      <div className="prod-rework-kepala"><h3>Rework pelanggan</h3><span className="prod-hitung">{kasus.length}</span><Link to="/komplain" className="prod-rework-semua">Lihat semua</Link></div>
      <ul>
        {kasus.slice(0, 4).map((c) => (
          <li key={c.id}>
            <Link to="/komplain" className="prod-rework-baris">
              <IkDokumen size={20} />
              <span className="prod-rework-nama">{CATEGORY_LABEL[c.category] || c.category}<small>{c.order?.customer?.name || "—"}</small></span>
              <span className="prod-rework-no">{c.caseNumber}</span>
              <span className="prod-rework-status">{STATUS_LABEL[c.status] || c.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
