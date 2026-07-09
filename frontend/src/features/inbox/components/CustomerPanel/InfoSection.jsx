import React, { useState } from "react";
import { api } from "../../../../api.js";
import { KOTA_LIST } from "../../../../utils/format.js";

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

// Sumber lead, Kondisi Kasur, Tipe Customer, Kota — semua inline edit lewat
// endpoint existing (PATCH /customers/:id, sama seperti CustomerPanel lama).
export default function InfoSection({ customer, onUpdate }) {
  const [leadSourceDraft, setLeadSourceDraft] = useState(customer.leadSource || "OTHER");
  const [savingHealth, setSavingHealth] = useState(false);
  const [savingType, setSavingType]     = useState(false);
  const [feedback, setFeedback]         = useState(null);

  function showFeedback(type, message) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  }

  async function handleSaveLeadSource() {
    try {
      const updated = await api.updateCustomer(customer.id, { leadSource: leadSourceDraft });
      onUpdate((c) => ({ ...c, ...updated }));
      showFeedback("success", "Sumber lead tersimpan");
    } catch (err) {
      showFeedback("error", err.message);
    }
  }

  async function toggleHealthStatus(value) {
    const newVal = customer.healthStatus === value ? null : value;
    setSavingHealth(true);
    try {
      const updated = await api.updateCustomer(customer.id, { healthStatus: newVal });
      onUpdate((c) => ({ ...c, healthStatus: updated.healthStatus }));
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setSavingHealth(false);
    }
  }

  async function toggleCustomerType(value) {
    if (customer.customerType === value) return;
    setSavingType(true);
    try {
      const updated = await api.updateCustomer(customer.id, { customerType: value });
      onUpdate((c) => ({ ...c, customerType: updated.customerType }));
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setSavingType(false);
    }
  }

  async function saveCity(city) {
    try {
      const updated = await api.updateCustomer(customer.id, { city: city || null });
      onUpdate((c) => ({ ...c, ...updated }));
      showFeedback("success", "Kota tersimpan");
    } catch (err) {
      showFeedback("error", err.message);
    }
  }

  return (
    <>
      {feedback && (
        <div className={`inline-feedback inline-feedback-${feedback.type}`} style={{ margin: "0 0 8px" }}>
          {feedback.message}
        </div>
      )}

      {/* Sumber Lead */}
      <div className="panel-section">
        <span className="panel-section-label">Sumber Lead</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {customer.leadSource && (
            <span style={{ ...(LEAD_SOURCE_COLORS[customer.leadSource] || LEAD_SOURCE_COLORS.OTHER), fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
              {LEAD_SOURCE_LABELS[customer.leadSource] || customer.leadSource}
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: customer.leadSourceConfirmed ? "#dcfce7" : "#f3f4f6", color: customer.leadSourceConfirmed ? "#166534" : "#6b7280" }}>
            {customer.leadSourceConfirmed ? "Dikonfirmasi" : "Otomatis"}
          </span>
        </div>
        {customer.leadSourceDetail && (
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-muted)" }}>{customer.leadSourceDetail}</p>
        )}
        <div className="inline-field">
          <select value={leadSourceDraft} onChange={(e) => setLeadSourceDraft(e.target.value)} style={{ flex: 1 }}>
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

      {/* Kondisi Kasur */}
      <div className="panel-section">
        <span className="panel-section-label">Kondisi Kasur</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { value: "SAKIT", label: "Sakit", activeColor: "#fee2e2", activeText: "#991b1b" },
            { value: "TIDAK_SAKIT", label: "Tidak Sakit", activeColor: "#dcfce7", activeText: "#166534" },
          ].map(({ value, label, activeColor, activeText }) => {
            const active = customer.healthStatus === value;
            return (
              <button key={value} disabled={savingHealth} onClick={() => toggleHealthStatus(value)}
                style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99, border: `1.5px solid ${active ? activeText : "var(--border)"}`, background: active ? activeColor : "transparent", color: active ? activeText : "var(--text-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
                {label}
              </button>
            );
          })}
          {customer.healthStatus && (
            <button disabled={savingHealth} onClick={() => toggleHealthStatus(customer.healthStatus)}
              style={{ fontSize: 11, padding: "4px 8px", borderRadius: 99, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>
              Reset
            </button>
          )}
        </div>
        {!customer.healthStatus && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>Belum ditanyakan ke customer</p>}
      </div>

      {/* Tipe Customer */}
      <div className="panel-section">
        <span className="panel-section-label">Tipe Customer</span>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { value: "END_USER", label: "End User" },
            { value: "CORPORATE", label: "Corporate" },
          ].map(({ value, label }) => {
            const active = (customer.customerType || "END_USER") === value;
            return (
              <button key={value} disabled={savingType} onClick={() => toggleCustomerType(value)}
                style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99, border: `1.5px solid ${active ? "var(--color-primary)" : "var(--border)"}`, background: active ? "#dbeafe" : "transparent", color: active ? "#1e40af" : "var(--text-secondary)", cursor: active ? "default" : "pointer", transition: "all 0.15s" }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Kota */}
      <div className="panel-section">
        <span className="panel-section-label">Kota</span>
        <div className="inline-field">
          <select value={customer.city || ""} onChange={(e) => saveCity(e.target.value)} style={{ flex: 1, fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)" }}>
            <option value="">— Pilih Kota —</option>
            {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}
