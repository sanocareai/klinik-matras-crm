import React, { useEffect, useState } from "react";
import { Link2, Plus, Copy, Check, Trash2, ToggleLeft, ToggleRight, ExternalLink } from "lucide-react";
import { api } from "../api.js";

const KATEGORI_OPTIONS = [
  { value: "META_ADS",        label: "Iklan Meta (Instagram/Facebook)" },
  { value: "GOOGLE_ADS",      label: "Google Ads" },
  { value: "WEBSITE_ORGANIC", label: "Website Organik" },
  { value: "OTHER",           label: "Lainnya" },
];

const KATEGORI_LABEL = {
  META_ADS:        "Iklan Meta",
  GOOGLE_ADS:      "Google Ads",
  WEBSITE_ORGANIC: "Website Organik",
  OTHER:           "Lainnya",
};

const KATEGORI_COLOR = {
  META_ADS:        { bg: "#dbeafe", color: "#1e40af" },
  GOOGLE_ADS:      { bg: "#fef9c3", color: "#854d0e" },
  WEBSITE_ORGANIC: { bg: "#dcfce7", color: "#166534" },
  OTHER:           { bg: "#f3f4f6", color: "#374151" },
};

const PESAN_DEFAULT = "Halo Sano, saya mau konsultasi";

function getTrackingUrl(slug) {
  return `${window.location.origin}/r/${slug}`;
}

export default function TrackingLinks() {
  const [links, setLinks]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [copiedId, setCopiedId]     = useState(null);
  const [form, setForm]             = useState({
    name: "", category: "META_ADS", prefilledMessage: PESAN_DEFAULT, targetPhone: "",
  });
  const [saving, setSaving]         = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const data = await api.getTrackingLinks();
      setLinks(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) return alert("Nama link wajib diisi");
    setSaving(true);
    try {
      const created = await api.createTrackingLink({
        name:             form.name.trim(),
        category:         form.category,
        prefilledMessage: form.prefilledMessage.trim() || PESAN_DEFAULT,
        targetPhone:      form.targetPhone.trim() || null,
      });
      setLinks((prev) => [{ ...created }, ...prev]);
      setNewLinkUrl(getTrackingUrl(created.slug));
      setForm({ name: "", category: "META_ADS", prefilledMessage: PESAN_DEFAULT, targetPhone: "" });
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  }

  async function handleToggleActive(link) {
    try {
      const updated = await api.updateTrackingLink(link.id, { active: !link.active });
      setLinks((prev) => prev.map((l) => l.id === link.id ? { ...l, ...updated } : l));
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(link) {
    if (!confirm(`Hapus link "${link.name}"? Semua data klik juga akan dihapus.`)) return;
    try {
      await api.deleteTrackingLink(link.id);
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
    } catch (err) { alert(err.message); }
  }

  function handleCopy(slug, id) {
    navigator.clipboard.writeText(getTrackingUrl(slug)).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Link Pelacakan</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Buat link khusus per channel iklan untuk melacak sumber lead secara otomatis
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowForm((v) => !v); setNewLinkUrl(null); }}>
          <Plus size={14} /> {showForm ? "Tutup Form" : "Buat Link Baru"}
        </button>
      </div>

      {/* Form buat link baru */}
      {showForm && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h4 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700 }}>Link Baru</h4>
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Nama Link *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Contoh: Google Ads - Kampanye Juni"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Kategori *</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {KATEGORI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Pesan Pre-filled (teks di WA saat link dibuka)</label>
              <input
                value={form.prefilledMessage}
                onChange={(e) => setForm({ ...form, prefilledMessage: e.target.value })}
                placeholder={PESAN_DEFAULT}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Nomor WA Tujuan (opsional — kosongkan untuk pakai nomor default)</label>
              <input
                value={form.targetPhone}
                onChange={(e) => setForm({ ...form, targetPhone: e.target.value })}
                placeholder="628xxx (tanpa tanda +)"
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Batal</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Membuat..." : "Buat Link"}
              </button>
            </div>
          </form>

          {/* URL hasil setelah dibuat */}
          {newLinkUrl && (
            <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--color-success-bg, #dcfce7)",
              border: "1px solid #86efac", borderRadius: 8 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#166534" }}>
                ✅ Link berhasil dibuat! Salin dan pasang di iklan:
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={{ flex: 1, fontSize: 13, background: "white", padding: "6px 10px",
                  borderRadius: 6, border: "1px solid #86efac", wordBreak: "break-all" }}>
                  {newLinkUrl}
                </code>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => { navigator.clipboard.writeText(newLinkUrl); }}>
                  <Copy size={13} /> Salin
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabel link */}
      {loading ? (
        <p className="empty">Memuat...</p>
      ) : links.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <Link2 size={48} style={{ opacity: 0.2, marginBottom: 12 }} />
          <p style={{ margin: 0 }}>Belum ada link pelacakan. Klik "+ Buat Link Baru" untuk mulai.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-subtle, #f9fafb)" }}>
                {["Nama", "Kategori", "Klik", "Jadi Lead", "Conv Rate", "Link", "Aktif", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12,
                    fontWeight: 600, color: "var(--text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {links.map((link) => {
                const color = KATEGORI_COLOR[link.category] || KATEGORI_COLOR.OTHER;
                return (
                  <tr key={link.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{link.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        /r/{link.slug}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ ...color, fontSize: 11, fontWeight: 600,
                        padding: "2px 8px", borderRadius: 99 }}>
                        {KATEGORI_LABEL[link.category] || link.category}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 700 }}>
                      {link.totalClicks ?? 0}
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--color-success, #16a34a)" }}>
                      {link.totalConverted ?? 0}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontWeight: 600 }}>{link.convRate ?? 0}%</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button
                          onClick={() => handleCopy(link.slug, link.id)}
                          className="btn-icon"
                          title="Salin URL"
                          style={{ color: copiedId === link.id ? "var(--color-success, #16a34a)" : undefined }}
                        >
                          {copiedId === link.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <a href={getTrackingUrl(link.slug)} target="_blank" rel="noreferrer"
                          className="btn-icon" title="Buka link">
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <button
                        onClick={() => handleToggleActive(link)}
                        className="btn-icon"
                        title={link.active ? "Nonaktifkan" : "Aktifkan"}
                        style={{ color: link.active ? "var(--color-primary)" : "var(--text-muted)" }}
                      >
                        {link.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <button onClick={() => handleDelete(link)} className="btn-icon"
                        style={{ color: "var(--color-danger)" }} title="Hapus">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
