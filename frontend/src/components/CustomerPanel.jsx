import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import StageSelect from "./customer/StageSelect.jsx";
import OrderSection from "./customer/OrderSection.jsx";
import NotesSection from "./customer/NotesSection.jsx";
import { getTagPrefix, setTagPrefix, publicTags, UKURAN_KASUR, MERK_KASUR } from "../utils/format.js";

export default function CustomerPanel({ customerId }) {
  const [customer, setCustomer] = useState(null);
  const [cityDraft, setCityDraft] = useState("");
  const [ukuranDraft, setUkuranDraft] = useState("");
  const [merkDraft, setMerkDraft] = useState("");
  const [feedback, setFeedback] = useState(null);

  function showFeedback(type, message) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  }

  useEffect(() => {
    if (!customerId) { setCustomer(null); return; }
    api.getCustomer(customerId).then((c) => {
      setCustomer(c);
      setCityDraft(c.city || "");
      setUkuranDraft(getTagPrefix(c.tags, "ukuran"));
      setMerkDraft(getTagPrefix(c.tags, "merk"));
    });
  }, [customerId]);

  async function updateStage(pipelineStage) {
    const updated = await api.updateCustomer(customerId, { pipelineStage });
    setCustomer((c) => ({ ...c, ...updated }));
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

  async function saveInfoKasur() {
    try {
      let tags = publicTags(customer.tags);
      tags = setTagPrefix(tags, "ukuran", ukuranDraft);
      tags = setTagPrefix(tags, "merk", merkDraft);
      const updated = await api.updateCustomer(customerId, { tags });
      setCustomer((c) => ({ ...c, ...updated }));
      showFeedback("success", "Info kasur tersimpan");
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

  return (
    <div className="customer-panel">
      {/* Header */}
      <div className="panel-header">
        <Avatar name={displayName} size="md" />
        <div className="panel-header-info">
          <p className="panel-name">{displayName}</p>
          <p className="panel-contact">{customer.phone || customer.instagramHandle}</p>
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
              placeholder="Kota pelanggan"
            />
            <button className="btn btn-secondary btn-sm" onClick={saveCity}>Simpan</button>
          </div>
        </div>

        {/* Info Kasur */}
        <div className="panel-section">
          <span className="panel-section-label">Info Kasur</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <select
              value={ukuranDraft}
              onChange={(e) => setUkuranDraft(e.target.value)}
              style={{ fontSize: 12, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
            >
              <option value="">— Ukuran kasur —</option>
              {UKURAN_KASUR.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <div className="inline-field">
              <select
                value={merkDraft}
                onChange={(e) => setMerkDraft(e.target.value)}
                style={{ flex: 1, fontSize: 12, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
              >
                <option value="">— Merk kasur —</option>
                {MERK_KASUR.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={saveInfoKasur}>Simpan</button>
            </div>
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
