import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "../../../../api.js";
import ProfileSection from "./ProfileSection.jsx";
import PipelineSection from "./PipelineSection.jsx";
import InfoSection from "./InfoSection.jsx";
import OrdersSection from "./OrdersSection.jsx";
import MediaGallery from "./MediaGallery.jsx";
import NotesSection from "./NotesSection.jsx";
import GroupPanel from "./GroupPanel.jsx";
import NextBestActionCard from "./NextBestActionCard.jsx";
import AssignmentSection from "./AssignmentSection.jsx";
import { CustomerPanelSkeleton } from "../Skeletons.jsx";

// Panel kanan Inbox (Fase E). type=GROUP → GroupPanel (tanpa pipeline/order/
// dll), INDIVIDUAL → profil customer lengkap. Collapsible via onClose (state
// & persist localStorage dikelola di Inbox.jsx, lihat komentar di sana) —
// backdrop di bawah ini muncul (lewat CSS) di layar <1024px sebagai drawer.
export default function CustomerPanel({ conversation, onClose }) {
  const customerId = conversation?.customer?.id;
  const [customer, setCustomer]   = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (conversation?.type === "GROUP") { setCustomer(null); setLoadError(null); return; }
    if (!customerId) { setCustomer(null); setLoadError(null); return; }
    setLoadError(null);
    setCustomer(null);
    api.getCustomer(customerId)
      .then(setCustomer)
      .catch((err) => setLoadError(err.message || "Gagal memuat data pelanggan"));
  }, [customerId, conversation?.type]);

  if (conversation?.type === "GROUP") {
    return (
      <>
        <div className="customer-panel-backdrop" onClick={onClose} />
        <GroupPanel conversation={conversation} />
      </>
    );
  }

  if (!customerId) {
    return (
      <div className="customer-panel customer-panel-empty" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p className="text-muted" style={{ fontSize: 13 }}>Pilih percakapan</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="customer-panel" style={{ padding: 20, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 12 }}>{loadError}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => { setLoadError(null); setCustomer(null); }}>Coba Lagi</button>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="customer-panel">
        <CustomerPanelSkeleton />
      </div>
    );
  }

  return (
    <>
      <div className="customer-panel-backdrop" onClick={onClose} />
      <div className="customer-panel">
        <ProfileSection customer={customer} conversation={conversation} onUpdate={setCustomer} />

        <div style={{ padding: "0 16px 12px" }}>
          <Link to="/customers" className="panel-fullprofile-link">
            <ExternalLink size={12} /> Lihat Profil Lengkap
          </Link>
        </div>

        <div className="panel-body">
          {/* Wave 6 (redesign Inbox) — siapa pegang chat vs siapa pemilik
              lead, dua konsep yang sering tertukar (CLAUDE.md §20). Paling
              atas, sebelum Next Best Action, karena ini identitas dasar
              ("siapa yang bertanggung jawab"), bukan rekomendasi. */}
          <AssignmentSection conversation={conversation} customer={customer} />

          {/* Wave 2 (redesign Inbox) — Next Best Action, di atas Pipeline
              supaya jadi hal PERTAMA yang dilihat sales saat buka panel:
              "apa yang harus saya lakukan sekarang untuk pelanggan ini",
              sebelum detail lain. Render null diam-diam kalau tidak
              relevan/gagal — lihat komentar di NextBestActionCard.jsx. */}
          <div className="panel-section">
            <NextBestActionCard customerId={customer.id} />
          </div>

          <PipelineSection customer={customer} onUpdate={setCustomer} />
          <InfoSection customer={customer} onUpdate={setCustomer} />
          <OrdersSection customer={customer} onUpdate={setCustomer} />

          <hr className="divider" />

          <div className="panel-section">
            <span className="panel-section-label">Media</span>
            <MediaGallery conversationId={conversation?.id} />
          </div>

          <hr className="divider" />

          <NotesSection customer={customer} onUpdate={setCustomer} />
        </div>
      </div>
    </>
  );
}
