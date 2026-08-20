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

// Fix dark mode (20 Agt 2026): warna pastel LAMA ({bg:"#dbeafe",
// color:"#1e40af"}, dst) HARDCODE terang — bg pastel-nya tidak ikut gelap
// sama sekali di dark mode, jadi badge ini selalu tampil sebagai kotak
// terang mencolok di atas panel gelap (bagian dari keluhan "labelnya
// putih"). Sekarang SATU warna jenuh per sumber dipakai untuk bg (alpha
// tipis, otomatis membaur dengan permukaan apa pun di baliknya — terang
// ATAU gelap) sekaligus teks (solid, cukup kontras di dua-duanya karena
// lightness-nya di tengah, bukan pastel/gelap ekstrem).
const LEAD_SOURCE_HEX = {
  META_ADS:        "#2563eb",
  GOOGLE_ADS:      "#b45309",
  WEBSITE_ORGANIC: "#16a34a",
  INSTAGRAM:       "#db2777",
  WHATSAPP_DIRECT: "#059669",
  REFERRAL:        "#7c3aed",
  OTHER:           "#6b7280",
};
function pillTone(hex) {
  return { background: `${hex}26`, color: hex };
}

// Sumber lead, Kondisi Pelanggan, Tipe Customer, Kota — semua inline edit lewat
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
            <span style={{ ...pillTone(LEAD_SOURCE_HEX[customer.leadSource] || LEAD_SOURCE_HEX.OTHER), fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
              {LEAD_SOURCE_LABELS[customer.leadSource] || customer.leadSource}
            </span>
          )}
          <span
            className={customer.leadSourceConfirmed ? undefined : "bg-inset text-ink3"}
            style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
              ...(customer.leadSourceConfirmed ? pillTone("#16a34a") : {}),
            }}
          >
            {customer.leadSourceConfirmed ? "Dikonfirmasi" : "Otomatis"}
          </span>
        </div>
        {customer.leadSourceDetail && (
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-muted)" }}>{customer.leadSourceDetail}</p>
        )}
        <div className="inline-field">
          <select
            value={leadSourceDraft} onChange={(e) => setLeadSourceDraft(e.target.value)}
            className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[13px] text-ink"
          >
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

      {/* Kondisi Pelanggan (nama field DB tetap healthStatus, cuma label UI) */}
      <div className="panel-section">
        <span className="panel-section-label">Kondisi Pelanggan</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { value: "SAKIT", label: "Sakit", hex: "#dc2626" },
            { value: "TIDAK_SAKIT", label: "Tidak Sakit", hex: "#16a34a" },
          ].map(({ value, label, hex }) => {
            const active = customer.healthStatus === value;
            return (
              <button key={value} disabled={savingHealth} onClick={() => toggleHealthStatus(value)}
                className={active ? undefined : "text-ink2"}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                  border: `1.5px solid ${active ? hex : "var(--border)"}`,
                  ...(active ? pillTone(hex) : { background: "transparent" }),
                }}>
                {label}
              </button>
            );
          })}
          {customer.healthStatus && (
            <button disabled={savingHealth} onClick={() => toggleHealthStatus(customer.healthStatus)}
              className="text-ink3"
              style={{ fontSize: 11, padding: "4px 8px", borderRadius: 99, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>
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
            const hex = "#2563eb";
            return (
              <button key={value} disabled={savingType} onClick={() => toggleCustomerType(value)}
                className={active ? undefined : "text-ink2"}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                  cursor: active ? "default" : "pointer", transition: "all 0.15s",
                  border: `1.5px solid ${active ? hex : "var(--border)"}`,
                  ...(active ? pillTone(hex) : { background: "transparent" }),
                }}>
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
          <select
            value={customer.city || ""} onChange={(e) => saveCity(e.target.value)}
            className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[13px] text-ink"
          >
            <option value="">— Pilih Kota —</option>
            {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}
