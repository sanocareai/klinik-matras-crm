import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import StageSelect from "./customer/StageSelect.jsx";
import OrderSection from "./customer/OrderSection.jsx";
import NotesSection from "./customer/NotesSection.jsx";
import { formatPhoneDisplay } from "../utils/format.js";

export default function CustomerPanel({ customerId }) {
  const [customer, setCustomer] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [feedback, setFeedback] = useState(null);

  function showFeedback(type, message) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  }

  useEffect(() => {
    if (!customerId) { setCustomer(null); return; }
    api.getCustomer(customerId).then((c) => {
      setCustomer(c);
      setNameDraft(c.name || "");
      setCityDraft(c.city || "");
    });
  }, [customerId]);

  async function updateStage(pipelineStage) {
    const updated = await api.updateCustomer(customerId, { pipelineStage });
    setCustomer((c) => ({ ...c, ...updated }));
  }

  async function saveName() {
    if (!nameDraft.trim()) return;
    try {
      const updated = await api.updateCustomer(customerId, { name: nameDraft.trim() });
      setCustomer((c) => ({ ...c, ...updated }));
      if (updated.whatsappSyncStatus === "success") {
        showFeedback("success", "Nama tersimpan & tersinkron ke WhatsApp");
      } else if (updated.whatsappSyncStatus === "failed") {
        showFeedback("warning", "Nama tersimpan, gagal sync ke WhatsApp");
      } else {
        showFeedback("success", "Nama tersimpan");
      }
    } catch (err) {
      showFeedback("error", err.message);
    }
  }

  async function saveCity() {
    try {
      const updated = await api.updateCustomer(customerId, { city: cityDraft });
      setCustomer((c) => ({ ...c, ...updated }));
      showFeedback("success", "Kota tersimpan");
    } catch (err) {
      showFeedback("error", err.message);
    }
  }

  if (!customerId) {
    return (
      <div className="customer-panel customer-panel-empty" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p className="text-muted" style={{ fontSize: 13 }}>Pilih percakapan</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="customer-panel" style={{ padding: 20 }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 10, marginBottom: 12 }} />
        <div className="skeleton skeleton-text" style={{ width: "80%" }} />
        <div className="skeleton skeleton-text" style={{ width: "60%" }} />
      </div>
    );
  }

  const displayName = customer.name || customer.phone || customer.instagramHandle || "Pelanggan";
  const phoneFormatted = formatPhoneDisplay(customer.phone || "");

  return (
    <div className="customer-panel">
      {/* Header */}
      <div className="panel-header">
        <Avatar name={displayName} size="md" />
        <div className="panel-header-info">
          <p className="panel-name">{displayName}</p>
          <p className="panel-contact" title={customer.phone}>{phoneFormatted || customer.instagramHandle}</p>
        </div>
      </div>

      {/* Lihat Profil Lengkap */}
      <div style={{ padding: "0 16px 12px" }}>
        <Link
          to="/customers"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "var(--color-primary)", fontWeight: 600 }}
        >
          <ExternalLink size={12} />
          Lihat Profil Lengkap
        </Link>
      </div>

      {/* Body */}
      <div className="panel-body">
        {feedback && (
          <div className={`inline-feedback inline-feedback-${feedback.type}`} style={{ margin: "0 0 8px" }}>
            {feedback.message}
          </div>
        )}

        {/* Nama Kontak */}
        <div className="panel-section">
          <span className="panel-section-label">Nama Kontak</span>
          <div className="inline-field">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              placeholder="Nama pelanggan..."
            />
            <button className="btn btn-secondary btn-sm" onClick={saveName}>Simpan</button>
          </div>
          {customer.phone && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
              {phoneFormatted}
            </p>
          )}
        </div>

        {/* Pipeline stage */}
        <div className="panel-section">
          <span className="panel-section-label">Tahap Pipeline</span>
          <StageSelect value={customer.pipelineStage} onChange={updateStage} />
        </div>

        {/* Kota */}
        <div className="panel-section">
          <span className="panel-section-label">Kota</span>
          <div className="inline-field">
            <input
              value={cityDraft}
              onChange={(e) => setCityDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveCity()}
              placeholder="Kota pelanggan"
            />
            <button className="btn btn-secondary btn-sm" onClick={saveCity}>Simpan</button>
          </div>
        </div>

        {/* Orders */}
        <div className="panel-section">
          <span className="panel-section-label">Order</span>
          <OrderSection customer={customer} onUpdate={setCustomer} />
        </div>

        <hr className="divider" />

        {/* Notes */}
        <div className="panel-section">
          <span className="panel-section-label">Catatan</span>
          <NotesSection customer={customer} onUpdate={setCustomer} />
        </div>
      </div>
    </div>
  );
}
