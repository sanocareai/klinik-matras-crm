import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import StageSelect from "./customer/StageSelect.jsx";
import OrderSection from "./customer/OrderSection.jsx";
import NotesSection from "./customer/NotesSection.jsx";
import { formatPhoneDisplay } from "../utils/format.js";

const LEAD_SOURCE_LABELS = {
  META_ADS:        "Iklan Meta",
  GOOGLE_ADS:      "Google Ads",
  WEBSITE_ORGANIC: "Website Organik",
  INSTAGRAM:       "Instagram",
  WHATSAPP_DIRECT: "WA Langsung",
  REFERRAL:        "Referral",
  OTHER:           "Lainnya",
  ADS:             "Iklan (lama)",
  WEBSITE:         "Website (lama)",
};

const LEAD_SOURCE_COLORS = {
  META_ADS:        { bg: "#dbeafe", color: "#1e40af" },
  GOOGLE_ADS:      { bg: "#fef9c3", color: "#854d0e" },
  WEBSITE_ORGANIC: { bg: "#dcfce7", color: "#166534" },
  INSTAGRAM:       { bg: "#fce7f3", color: "#9d174d" },
  WHATSAPP_DIRECT: { bg: "#d1fae5", color: "#065f46" },
  REFERRAL:        { bg: "#ede9fe", color: "#5b21b6" },
  OTHER:           { bg: "#f3f4f6", color: "#374151" },
};

export default function CustomerPanel({ customerId }) {
  const [customer, setCustomer] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [leadSourceDraft, setLeadSourceDraft] = useState("OTHER");
  const [feedback, setFeedback] = useState(null);

  function showFeedback(type, message) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  }

  useEffect(() => {
    if (!customerId) { setCustomer(null); setLoadError(null); return; }
    console.log("[CustomerPanel] fetch customerId:", customerId);
    setLoadError(null);
    setCustomer(null);
    api.getCustomer(customerId)
      .then((c) => {
        console.log("[CustomerPanel] data diterima:", c?.id, c?.name);
        setCustomer(c);
        setNameDraft(c.name || "");
        setPhoneDraft(c.phone || "");
        setCityDraft(c.city || "");
        setLeadSourceDraft(c.leadSource || "OTHER");
      })
      .catch((err) => {
        console.error("[CustomerPanel] gagal fetch:", err);
        setLoadError(err.message || "Gagal memuat data pelanggan");
      });
  }, [customerId]);

  async function updateStage(pipelineStage) {
    const updated = await api.updateCustomer(customerId, { pipelineStage });
    setCustomer((c) => ({ ...c, ...updated }));
  }

  async function saveField(field, value, label) {
    try {
      const updated = await api.updateCustomer(customerId, { [field]: value || null });
      setCustomer((c) => ({ ...c, ...updated }));
      showFeedback("success", `${label} tersimpan`);
    } catch (err) {
      showFeedback("error", err.message);
    }
  }

  async function handleSaveLeadSource() {
    try {
      const updated = await api.updateCustomer(customerId, { leadSource: leadSourceDraft });
      setCustomer((c) => ({ ...c, ...updated }));
      showFeedback("success", "Sumber lead tersimpan");
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

  if (loadError) {
    return (
      <div className="customer-panel" style={{ padding: 20, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 12 }}>
          {loadError}
        </p>
        <button className="btn btn-ghost btn-sm"
          onClick={() => { setLoadError(null); setCustomer(null); }}>
          Coba Lagi
        </button>
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

  const displayName = customer.name || (customer.phone ? formatPhoneDisplay(customer.phone) : null) || customer.instagramHandle || "Pelanggan";

  return (
    <div className="customer-panel">
      {/* Header */}
      <div className="panel-header">
        <Avatar name={displayName} size="md" />
        <div className="panel-header-info">
          <p className="panel-name">{displayName}</p>
          <p className="panel-contact">{formatPhoneDisplay(customer.phone) || customer.instagramHandle}</p>
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
              onKeyDown={(e) => e.key === "Enter" && saveField("name", nameDraft, "Nama")}
              placeholder="Nama pelanggan..."
            />
            <button className="btn btn-secondary btn-sm" onClick={() => saveField("name", nameDraft, "Nama")}>Simpan</button>
          </div>
        </div>

        {/* Nomor WhatsApp */}
        <div className="panel-section">
          <span className="panel-section-label">Nomor WhatsApp</span>
          <div className="inline-field">
            <input
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveField("phone", phoneDraft, "Nomor")}
              placeholder="628xxx (format internasional)"
            />
            <button className="btn btn-secondary btn-sm" onClick={() => saveField("phone", phoneDraft, "Nomor")}>Simpan</button>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
            Format: 628xxx (tanpa +, tanpa 0 di depan)
          </p>
        </div>

        {/* Pipeline stage */}
        <div className="panel-section">
          <span className="panel-section-label">Tahap Pipeline</span>
          <StageSelect value={customer.pipelineStage} onChange={updateStage} />
        </div>

        {/* Sumber Lead */}
        <div className="panel-section">
          <span className="panel-section-label">Sumber Lead</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {customer.leadSource && (
              <span style={{
                ...(LEAD_SOURCE_COLORS[customer.leadSource] || LEAD_SOURCE_COLORS.OTHER),
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
              }}>
                {LEAD_SOURCE_LABELS[customer.leadSource] || customer.leadSource}
              </span>
            )}
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
              background: customer.leadSourceConfirmed ? "#dcfce7" : "#f3f4f6",
              color:      customer.leadSourceConfirmed ? "#166534" : "#6b7280",
            }}>
              {customer.leadSourceConfirmed ? "Dikonfirmasi" : "Otomatis"}
            </span>
          </div>
          {customer.leadSourceDetail && (
            <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-muted)" }}>
              {customer.leadSourceDetail}
            </p>
          )}
          <div className="inline-field">
            <select value={leadSourceDraft} onChange={(e) => setLeadSourceDraft(e.target.value)}
              style={{ flex: 1 }}>
              <option value="META_ADS">Iklan Meta</option>
              <option value="GOOGLE_ADS">Google Ads</option>
              <option value="WEBSITE_ORGANIC">Website Organik</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="WHATSAPP_DIRECT">WA Langsung</option>
              <option value="REFERRAL">Referral</option>
              <option value="OTHER">Lainnya</option>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={handleSaveLeadSource}>Simpan</button>
          </div>
        </div>

        {/* Kota */}
        <div className="panel-section">
          <span className="panel-section-label">Kota</span>
          <div className="inline-field">
            <input
              value={cityDraft}
              onChange={(e) => setCityDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveField("city", cityDraft, "Kota")}
              placeholder="Kota pelanggan"
            />
            <button className="btn btn-secondary btn-sm" onClick={() => saveField("city", cityDraft, "Kota")}>Simpan</button>
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
