import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import StageSelect from "./customer/StageSelect.jsx";
import OrderSection from "./customer/OrderSection.jsx";
import NotesSection from "./customer/NotesSection.jsx";
import { formatWaktu, formatTanggalWaktu, SOURCE_LABELS, tagClass } from "../utils/format.js";

const TABS = ["Profil", "Order", "Catatan", "Riwayat Chat"];

export default function CustomerDrawer({ customerId, onClose, onUpdated }) {
  const [customer, setCustomer] = useState(null);
  const [tab, setTab] = useState("Profil");
  const [conversations, setConversations] = useState([]);
  const [loadingConvos, setLoadingConvos] = useState(false);

  // form fields untuk Profil
  const [form, setForm] = useState({ name: "", city: "", email: "", tags: "" });
  const [feedback, setFeedback] = useState(null); // { type, message }

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
                <input
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="Kota"
                />
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
                <label>Sales yang menangani</label>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  {customer.assignedSales?.name || "—"}
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                Simpan Perubahan
              </button>
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
