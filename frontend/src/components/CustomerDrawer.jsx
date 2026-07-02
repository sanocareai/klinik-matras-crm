import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import StageSelect from "./customer/StageSelect.jsx";
import OrderSection from "./customer/OrderSection.jsx";
import NotesSection from "./customer/NotesSection.jsx";
import { formatWaktu, formatTanggalWaktu, SOURCE_LABELS, tagClass, KOTA_LIST } from "../utils/format.js";

const TABS = ["Profil", "Order", "Catatan", "Riwayat Chat"];

export default function CustomerDrawer({ customerId, onClose, onUpdated }) {
  const [customer, setCustomer] = useState(null);
  const [tab, setTab] = useState("Profil");
  const [conversations, setConversations] = useState([]);
  const [loadingConvos, setLoadingConvos] = useState(false);

  // form fields untuk Profil
  const [form, setForm] = useState({ name: "", city: "", email: "", tags: "" });
  const [feedback, setFeedback] = useState(null); // { type, message }
  const [savingHealth, setSavingHealth] = useState(false);
  const [savingType, setSavingType]     = useState(false);

  function showFeedback(type, message) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  }

  useEffect(() => {
    if (!customerId) return;
    setTab("Profil");
    api.getCustomer(customerId).then((c) => {
      setCustomer(c);
      setForm({
        name: c.name || "",
        city: c.city || "",
        email: c.email || "",
        tags: (c.tags || []).join(", "),
      });
    });
  }, [customerId]);

  // Muat riwayat chat hanya saat tab Riwayat Chat pertama kali dibuka
  useEffect(() => {
    if (tab === "Riwayat Chat" && customer && conversations.length === 0 && !loadingConvos) {
      setLoadingConvos(true);
      api.getCustomerConversations(customer.id)
        .then(setConversations)
        .finally(() => setLoadingConvos(false));
    }
  }, [tab, customer]);

  function handleCustomerUpdate(updated) {
    setCustomer(updated);
    if (onUpdated) onUpdated(updated);
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const updated = await api.updateCustomer(customer.id, {
        name: form.name || null,
        city: form.city || null,
        email: form.email || null,
        tags,
      });
      setCustomer((c) => ({ ...c, ...updated }));
      if (onUpdated) onUpdated({ ...customer, ...updated });

      // Tampilkan feedback berdasarkan status sync WA
      if (updated.whatsappSyncStatus === "success") {
        showFeedback("success", "Nama tersimpan & tersinkron ke WhatsApp ✓");
      } else if (updated.whatsappSyncStatus === "failed") {
        showFeedback("warning", "Nama tersimpan di CRM, tapi gagal sync ke WhatsApp (coba lagi nanti)");
      } else {
        showFeedback("success", "Perubahan tersimpan");
      }
    } catch (err) {
      showFeedback("error", err.message);
    }
  }

  async function handleStageChange(pipelineStage) {
    const updated = await api.updateCustomer(customer.id, { pipelineStage });
    setCustomer((c) => ({ ...c, ...updated }));
    if (onUpdated) onUpdated({ ...customer, ...updated });
  }

  async function toggleHealthStatus(value) {
    const newVal = customer.healthStatus === value ? null : value;
    setSavingHealth(true);
    try {
      const updated = await api.updateCustomer(customer.id, { healthStatus: newVal });
      setCustomer((c) => ({ ...c, healthStatus: updated.healthStatus }));
      if (onUpdated) onUpdated({ ...customer, healthStatus: updated.healthStatus });
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
      setCustomer((c) => ({ ...c, customerType: updated.customerType }));
      if (onUpdated) onUpdated({ ...customer, customerType: updated.customerType });
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setSavingType(false);
    }
  }

  if (!customer) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-header">
            <p className="text-muted">Memuat...</p>
            <button className="drawer-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
      </div>
    );
  }

  const displayName = customer.name || customer.phone || customer.instagramHandle || "Pelanggan";

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <Avatar name={displayName} size="md" />
          <div className="drawer-header-info">
            <h2 className="drawer-title">{displayName}</h2>
            <p className="drawer-sub">{customer.phone || customer.instagramHandle}</p>
          </div>
          <button className="drawer-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="drawer-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={`drawer-tab${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="drawer-body">

          {/* ── TAB PROFIL ── */}
          {tab === "Profil" && (
            <form onSubmit={handleSaveProfile}>
              {feedback && (
                <div className={`inline-feedback inline-feedback-${feedback.type}`} style={{ marginBottom: 12 }}>
                  {feedback.message}
                </div>
              )}
              <p className="drawer-section-title">Informasi Pelanggan</p>

              <div className="drawer-field">
                <label>Nama</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nama pelanggan"
                />
              </div>

              <div className="drawer-field">
                <label>Kota</label>
                <select
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                >
                  <option value="">— Pilih Kota —</option>
                  {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>

              <div className="drawer-field">
                <label>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="email@contoh.com"
                />
              </div>

              <div className="drawer-field">
                <label>Tags (pisahkan dengan koma)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="premium, repeat-order, Korporat"
                />
              </div>

              <div className="drawer-field">
                <label>Tahap Pipeline</label>
                <StageSelect value={customer.pipelineStage} onChange={handleStageChange} />
              </div>

              <div className="drawer-field">
                <label>Sumber Lead</label>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  {SOURCE_LABELS[customer.leadSource] || customer.leadSource || "—"}
                </div>
              </div>

              <div className="drawer-field">
                <label>Kondisi Kasur</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { value: "SAKIT",       label: "Sakit",       activeColor: "#fee2e2", activeText: "#991b1b" },
                    { value: "TIDAK_SAKIT", label: "Tidak Sakit", activeColor: "#dcfce7", activeText: "#166534" },
                  ].map(({ value, label, activeColor, activeText }) => {
                    const active = customer.healthStatus === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={savingHealth}
                        onClick={() => toggleHealthStatus(value)}
                        style={{
                          fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                          border: `1.5px solid ${active ? activeText : "var(--border)"}`,
                          background: active ? activeColor : "transparent",
                          color: active ? activeText : "var(--text-secondary)",
                          cursor: "pointer", transition: "all 0.15s",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {customer.healthStatus && (
                    <button
                      type="button"
                      disabled={savingHealth}
                      onClick={() => toggleHealthStatus(customer.healthStatus)}
                      style={{
                        fontSize: 11, padding: "4px 8px", borderRadius: 99,
                        border: "1px solid var(--border)", background: "transparent",
                        color: "var(--text-muted)", cursor: "pointer",
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="drawer-field">
                <label>Tipe Customer</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {[
                    { value: "END_USER",   label: "End User" },
                    { value: "CORPORATE",  label: "Corporate" },
                  ].map(({ value, label }) => {
                    const active = (customer.customerType || "END_USER") === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={savingType}
                        onClick={() => toggleCustomerType(value)}
                        style={{
                          fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                          border: `1.5px solid ${active ? "var(--primary)" : "var(--border)"}`,
                          background: active ? "#dbeafe" : "transparent",
                          color: active ? "#1e40af" : "var(--text-secondary)",
                          cursor: active ? "default" : "pointer", transition: "all 0.15s",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="drawer-field">
                <label>Sales Person yang menangani</label>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  {customer.assignedSales?.name || "—"}
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                Simpan Perubahan
              </button>

              {/* Riwayat Keluhan dari semua order */}
              <div style={{ marginTop: 24 }}>
                <p className="drawer-section-title" style={{ marginBottom: 8 }}>Riwayat Keluhan</p>
                {(!customer.allKeluhan || customer.allKeluhan.length === 0) ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Belum ada riwayat keluhan.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {customer.allKeluhan.map((item, idx) => (
                      <div key={idx} style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px" }}>
                        <div style={{ fontSize: 13, color: "#92400e" }}>{item.keluhan}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                          {formatTanggalWaktu(item.tanggal)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </form>
          )}

          {/* ── TAB ORDER ── */}
          {tab === "Order" && (
            <>
              <p className="drawer-section-title">Order</p>
              <OrderSection customer={customer} onUpdate={handleCustomerUpdate} />
            </>
          )}

          {/* ── TAB CATATAN ── */}
          {tab === "Catatan" && (
            <>
              <p className="drawer-section-title">Catatan</p>
              <NotesSection customer={customer} onUpdate={handleCustomerUpdate} />
            </>
          )}

          {/* ── TAB RIWAYAT CHAT ── */}
          {tab === "Riwayat Chat" && (
            <>
              <p className="drawer-section-title">Riwayat Percakapan</p>
              {loadingConvos && <p className="text-muted">Memuat...</p>}
              {!loadingConvos && conversations.length === 0 && (
                <p className="text-small">Belum ada riwayat percakapan.</p>
              )}
              {conversations.map((conv) => (
                <div key={conv.id} className="convo-block">
                  <div className="convo-block-header">
                    <span className={`channel-badge ${conv.channel.toLowerCase()}`}>
                      {conv.channel === "WHATSAPP" ? "WhatsApp" : "Instagram"}
                    </span>
                    <span>{formatTanggalWaktu(conv.lastMessageAt)}</span>
                    <span className={`badge ${conv.status === "OPEN" ? "badge-open" : conv.status === "PENDING" ? "badge-pending" : "badge-resolved"}`}>
                      {conv.status}
                    </span>
                  </div>
                  <div className="convo-msgs">
                    {conv.messages.slice(-8).map((m) => (
                      <div key={m.id} className={`convo-msg ${m.direction === "OUTBOUND" ? "out" : "in"}`}>
                        {m.content}
                        <div className="convo-msg-time">{formatWaktu(m.createdAt)}</div>
                      </div>
                    ))}
                    {conv.messages.length === 0 && (
                      <p className="text-small">Belum ada pesan.</p>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
