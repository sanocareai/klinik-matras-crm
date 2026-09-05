import React, { useState } from "react";
import { api } from "../../../../api.js";

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

// Sumber lead, Tipe Customer — inline edit lewat endpoint existing
// (PATCH /customers/:id, sama seperti CustomerPanel lama).
//
// Kota DIHAPUS dari sini (29 Agustus 2026, permintaan owner) — Customer.city
// dianggap redundan dgn Order.deliveryCity (kota pengiriman per order, D-027)
// dan panel ini yang dicabut duluan. TIDAK menyentuh Customer.city di tempat
// lain (tabel/filter Pelanggan, Pipeline, widget Distribusi Kota di Laporan,
// Customer360) — SENGAJA scope sempit sesuai keputusan owner, field-field
// itu tetap baca/tulis Customer.city seperti biasa. Kolom di database juga
// TIDAK dihapus, cuma tidak lagi bisa diedit lewat panel ini.
//
// "Kondisi Pelanggan" (Customer.healthStatus/complaintCategory) DIHAPUS
// dari sini juga (4 Sep 2026, permintaan owner) — REDUNDAN dgn healthStatus
// per-ORDER yang sudah ada di form input order (Order.healthStatus,
// OrderSection.jsx), dan dua sumber yang bisa berbeda nilai justru
// membingungkan ("customer ini sakit atau tidak?" — jawabannya beda-beda
// tergantung dilihat dari mana). Order.healthStatus sekarang SATU-SATUNYA
// sumber kebenaran; filter "Sakit" di tabel Pelanggan (Customers.jsx)
// dibaca dari situ (lihat buildCustomerWhere() di routes/customers.js).
// Kolom Customer.healthStatus/complaintCategory di database TIDAK dihapus
// (masih ada endpoint PATCH /customers/:id yang menerimanya), cuma tidak
// ada lagi UI mana pun yang menulisnya — akan makin basi seiring waktu,
// itu memang yang diinginkan.
export default function InfoSection({ customer, onUpdate }) {
  const [leadSourceDraft, setLeadSourceDraft] = useState(customer.leadSource || "OTHER");
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
    </>
  );
}
