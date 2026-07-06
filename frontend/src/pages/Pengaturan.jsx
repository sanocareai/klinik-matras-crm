import React, { useEffect, useState } from "react";
import {
  Building2, Lock, Wifi, Download, Save, Eye, EyeOff, CheckCircle, XCircle,
  MessageSquare, Plus, Pencil, Trash2, X, Copy, TrendingUp,
} from "lucide-react";
import { api } from "../api.js";
import { exportToExcel } from "../utils/export.js";
import { formatRupiah, STAGE_LABELS, SOURCE_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "../utils/format.js";

const NAV_ITEMS = [
  { key: "profil",        label: "Profil Perusahaan", icon: Building2 },
  { key: "whatsapp",     label: "Status WhatsApp",    icon: Wifi },
  { key: "template",     label: "Template Pesan",     icon: MessageSquare },
  { key: "target-sales", label: "Target Sales",       icon: TrendingUp },
  { key: "keamanan",     label: "Keamanan Akun",      icon: Lock },
  { key: "data",         label: "Data & Backup",      icon: Download },
];

const KATEGORI_LABELS = {
  pembukaan: "Pembukaan",
  follow_up: "Follow Up",
  penawaran: "Offers/Negosiasi",
  konfirmasi: "Konfirmasi",
  penutupan: "Penutupan",
  lainnya: "Lainnya",
};

const KATEGORI_COLORS = {
  pembukaan: { bg: "#dbeafe", color: "#1e40af" },
  follow_up: { bg: "#ede9fe", color: "#5b21b6" },
  : { bg: "#dcfce7", color: "#166534" },
  konfirmasi: { bg: "#fef9c3", color: "#854d0e" },
  penutupan: { bg: "#fee2e2", color: "#991b1b" },
  lainnya:   { bg: "#f3f4f6", color: "#374151" },
};

const EMPTY_TPL_FORM = { nama: "", kategori: "pembukaan", isi: "" };

function TemplateSection() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_TPL_FORM);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    api.getTemplates()
      .then(setTemplates)
      .catch(() => setMsg({ type: "error", text: "Gagal memuat template" }))
      .finally(() => setLoading(false));
  }, []);

  function showMsg(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_TPL_FORM);
    setShowForm(true);
  }

  function openEdit(tpl) {
    setEditId(tpl.id);
    setForm({ nama: tpl.nama, kategori: tpl.kategori, isi: tpl.isi });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_TPL_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editId) {
        const updated = await api.updateTemplate(editId, form);
        setTemplates((prev) => prev.map((t) => (t.id === editId ? updated : t)));
        showMsg("success", "Template berhasil diperbarui");
      } else {
        const created = await api.createTemplate(form);
        setTemplates((prev) => [...prev, created]);
        showMsg("success", "Template berhasil ditambahkan");
      }
      cancelForm();
    } catch (err) {
      showMsg("error", err.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Hapus template ini?")) return;
    try {
      await api.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      showMsg("success", "Template dihapus");
    } catch (err) {
      showMsg("error", err.message);
    }
  }

  function handleCopy(tpl) {
    navigator.clipboard.writeText(tpl.isi).then(() => {
      setCopied(tpl.id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const grouped = Object.keys(KATEGORI_LABELS).reduce((acc, k) => {
    acc[k] = templates.filter((t) => t.kategori === k);
    return acc;
  }, {});

  return (
    <div className="settings-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Template Pesan</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Template siap pakai untuk mempercepat balasan di Inbox. Gunakan <code>{"{nama_customer}"}</code> untuk nama otomatis.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd} style={{ gap: 5, display: "flex", alignItems: "center" }}>
          <Plus size={14} /> Tambah Template
        </button>
      </div>

      {msg && (
        <div className={`inline-feedback inline-feedback-${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      {/* Form tambah/edit */}
      {showForm && (
        <div style={{ marginBottom: 24, padding: 16, background: "var(--bg-secondary)", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              {editId ? "Edit Template" : "Template Baru"}
            </h3>
            <button onClick={cancelForm} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Nama Template *</label>
                <input
                  value={form.nama}
                  onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
                  placeholder="Contoh: Salam Pembuka"
                  required
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Kategori</label>
                <select value={form.kategori} onChange={(e) => setForm((f) => ({ ...f, kategori: e.target.value }))}>
                  {Object.entries(KATEGORI_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Isi Pesan *</label>
              <textarea
                value={form.isi}
                onChange={(e) => setForm((f) => ({ ...f, isi: e.target.value }))}
                placeholder={"Halo kak {nama_customer}, terima kasih sudah menghubungi Klinik Matras..."}
                rows={4}
                required
                style={{ resize: "vertical" }}
              />
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                Gunakan <code>{"{nama_customer}"}</code> — akan diganti otomatis dengan nama customer saat dipakai di Inbox.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm">
                <Save size={13} /> {editId ? "Simpan Perubahan" : "Buat Template"}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={cancelForm}>
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Daftar template per kategori */}
      {loading ? (
        <p className="text-muted">Memuat...</p>
      ) : templates.length === 0 ? (
        <p className="text-muted" style={{ textAlign: "center", padding: "40px 0" }}>
          Belum ada template. Klik "+ Tambah Template" untuk mulai.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {Object.entries(KATEGORI_LABELS).map(([key, label]) => {
            const items = grouped[key] || [];
            if (items.length === 0) return null;
            const colors = KATEGORI_COLORS[key];
            return (
              <div key={key}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: colors.bg, color: colors.color }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{items.length} template</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map((tpl) => (
                    <div
                      key={tpl.id}
                      style={{ padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-primary)", display: "flex", gap: 12, alignItems: "flex-start" }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 13 }}>{tpl.nama}</p>
                        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {tpl.isi}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          title="Salin isi template"
                          onClick={() => handleCopy(tpl)}
                          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", cursor: "pointer", color: copied === tpl.id ? "#166534" : "var(--text-muted)" }}
                        >
                          {copied === tpl.id ? <CheckCircle size={13} /> : <Copy size={13} />}
                        </button>
                        <button
                          title="Edit"
                          onClick={() => openEdit(tpl)}
                          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", cursor: "pointer", color: "var(--text-muted)" }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          title="Hapus"
                          onClick={() => handleDelete(tpl.id)}
                          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #fee2e2", background: "#fff5f5", cursor: "pointer", color: "#991b1b" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const BULAN_LABELS = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function SalesTargetSection() {
  const nowDate = new Date();
  const [year, setYear]   = useState(nowDate.getFullYear());
  const [month, setMonth] = useState(nowDate.getMonth() + 1);
  const [rows, setRows]   = useState([]); // [{ userId, name, targetValue }]
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg] = useState(null);

  function showMsg(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function load() {
    setLoading(true);
    try {
      const data = await api.getSalesTargets({ year, month });
      setRows(data.map((r) => ({ userId: r.userId, name: r.name, targetValue: r.targetValue || 0 })));
    } catch (err) {
      showMsg("error", "Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [year, month]);

  async function handleSaveAll() {
    setSaving(true);
    try {
      await Promise.all(rows.map((r) =>
        api.updateSalesTarget({ userId: r.userId, year, month, targetValue: r.targetValue })
      ));
      showMsg("success", "Semua target berhasil disimpan");
    } catch (err) {
      showMsg("error", err.message);
    } finally {
      setSaving(false);
    }
  }

  const years = [nowDate.getFullYear() - 1, nowDate.getFullYear(), nowDate.getFullYear() + 1];

  return (
    <div className="settings-card">
      <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Target Sales Bulanan</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Set target nilai order (Rupiah) per Sales Person per bulan. Digunakan untuk progress bar di Dashboard.
      </p>

      {msg && (
        <div className={`inline-feedback inline-feedback-${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      {/* Pilih bulan & tahun */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Bulan</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ minWidth: 140 }}>
            {BULAN_LABELS.slice(1).map((label, i) => (
              <option key={i + 1} value={i + 1}>{label}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Tahun</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ minWidth: 100 }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">Belum ada Sales Person terdaftar.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            {rows.map((row, idx) => (
              <div key={row.userId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card-bg)" }}>
                <span style={{ fontWeight: 600, minWidth: 120, fontSize: 14 }}>{row.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Rp</span>
                  <input
                    type="number"
                    min="0"
                    step="1000000"
                    value={row.targetValue}
                    onChange={(e) => setRows((prev) => prev.map((r, i) => i === idx ? { ...r, targetValue: Number(e.target.value) } : r))}
                    style={{ flex: 1, maxWidth: 200, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}
                  />
                  {row.targetValue > 0 && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      = {formatRupiah(row.targetValue)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={handleSaveAll} disabled={saving}>
            <Save size={14} /> {saving ? "Menyimpan..." : "Simpan Semua Target"}
          </button>
        </>
      )}
    </div>
  );
}

export default function Pengaturan({ user }) {
  const [section, setSection] = useState("profil");

  // Settings
  const [settings, setSettings]   = useState(null);
  const [form, setForm]           = useState({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg]       = useState(null);

  // WhatsApp status
  const [waStatus, setWaStatus]     = useState(null);
  const [waLoading, setWaLoading]   = useState(false);

  // Password change
  const [pwForm, setPwForm]       = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwMsg, setPwMsg]         = useState(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [showPw, setShowPw]       = useState({ current: false, new: false, confirm: false });

  // Export data
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setForm(s);
    }).catch(() => {});
  }, []);

  function showMsg(setter, type, text) {
    setter({ type, text });
    setTimeout(() => setter(null), 4000);
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const updated = await api.updateSettings(form);
      setSettings(updated);
      showMsg(setSettingsMsg, "success", "Pengaturan berhasil disimpan.");
    } catch (err) {
      showMsg(setSettingsMsg, "error", err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function checkWaStatus() {
    setWaLoading(true);
    try {
      const status = await api.getWhatsappStatus();
      setWaStatus(status);
    } catch (err) {
      setWaStatus({ status: "error", error: err.message });
    } finally {
      setWaLoading(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwMsg({ type: "error", text: "Password baru dan konfirmasi tidak cocok." });
      return;
    }
    if (pwForm.newPassword.length < 6) {
      setPwMsg({ type: "error", text: "Password baru minimal 6 karakter." });
      return;
    }
    setPwLoading(true);
    try {
      await api.changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showMsg(setPwMsg, "success", "Password berhasil diubah.");
    } catch (err) {
      showMsg(setPwMsg, "error", err.message);
    } finally {
      setPwLoading(false);
    }
  }

  async function handleExportCustomers() {
    const HEALTH_LABELS = { SAKIT: "Sakit", TIDAK_SAKIT: "Tidak Sakit" };
    setExporting(true);
    try {
      const customers = await api.getCustomers();
      exportToExcel(
        customers.map((c) => ({
          "Tipe Pelanggan":   c.customerType === "CORPORATE" ? "Korporat" : "End User",
          Nama:               c.name || "",
          Telepon:            c.phone || "",
          Instagram:          c.instagramHandle ? "@" + c.instagramHandle : "",
          Email:              c.email || "",
          Kota:               c.city || "",
          "Status Kasur":     HEALTH_LABELS[c.healthStatus] || "Belum Diisi",
          Tags:               (c.tags || []).join(", "),
          Pipeline:                STAGE_LABELS[c.pipelineStage] || c.pipelineStage || "",
          "Status Order Terbaru":  ORDER_STATUS_LABELS[c.latestOrderStatus] || (c.latestOrderStatus ? c.latestOrderStatus : "Belum Ada Order"),
          "ID Order":              c.latestOrderNumber || "",
          "Status Pembayaran":     PAYMENT_STATUS_LABELS[c.latestPaymentStatus] || "",
          "Sumber Lead":           SOURCE_LABELS[c.leadSource] || c.leadSource || "",
          "Jumlah Order":          c.orderCount || 0,
          "Total Nilai Order":     formatRupiah(c.orderValue || 0),
          "Sales Person":          c.assignedSales?.name || "",
        })),
        `export-pelanggan-${new Date().toISOString().slice(0, 10)}`
      );
    } catch (err) {
      alert("Gagal export: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  if (user?.role !== "ADMIN") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 12 }}>
        <Lock size={40} color="var(--text-muted)" />
        <h2 style={{ margin: 0, color: "var(--text-muted)" }}>Akses Terbatas</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Hanya admin yang bisa mengakses halaman Pengaturan.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Pengaturan</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>Konfigurasi sistem CRM Klinik Matras</p>
        </div>
      </div>

      <div className="settings-layout">
        {/* Sidebar */}
        <nav className="settings-sidebar">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <button key={key} className={`settings-nav-item ${section === key ? "active" : ""}`}
              onClick={() => setSection(key)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>

        {/* Main */}
        <div className="settings-main">

          {/* ── PROFIL PERUSAHAAN ── */}
          {section === "profil" && (
            <div className="settings-card">
              <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Profil Perusahaan</h2>
              {settingsMsg && (
                <div className={`inline-feedback inline-feedback-${settingsMsg.type}`} style={{ marginBottom: 16 }}>
                  {settingsMsg.text}
                </div>
              )}
              <form onSubmit={handleSaveSettings}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {[
                    { key: "companyName",    label: "Nama Perusahaan",  placeholder: "Klinik Matras" },
                    { key: "companyTagline", label: "Tagline",          placeholder: "Spesialis Kasur Berkualitas" },
                    { key: "companyEmail",   label: "Email Perusahaan", placeholder: "info@klinikmatras.com", type: "email" },
                    { key: "companyPhone",   label: "Nomor Telepon",    placeholder: "628xxxx" },
                    { key: "companyAddress", label: "Alamat",           placeholder: "Jl. Contoh No. 1", full: true },
                    { key: "companyCity",    label: "Kota",             placeholder: "Bandung" },
                  ].map(({ key, label, placeholder, type, full }) => (
                    <div key={key} className="form-group" style={full ? { gridColumn: "1 / -1" } : {}}>
                      <label className="form-label">{label}</label>
                      <input type={type || "text"} value={form[key] || ""} placeholder={placeholder}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                    </div>
                  ))}
                </div>

                <hr style={{ margin: "20px 0", borderColor: "var(--border)" }} />
                <h3 style={{ fontSize: 15, fontWeight: 700, marginTop: 0 }}>Target & Mata Uang</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">Target Penjualan Bulanan (Rp)</label>
                    <input type="number" value={form.targetBulanan || ""} placeholder="500000000"
                      onChange={(e) => setForm((f) => ({ ...f, targetBulanan: Number(e.target.value) }))} />
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      Saat ini: {formatRupiah(form.targetBulanan || 0)}
                    </p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Timezone</label>
                    <select value={form.timezone || "Asia/Jakarta"} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
                      <option value="Asia/Jakarta">WIB — Asia/Jakarta</option>
                      <option value="Asia/Makassar">WITA — Asia/Makassar</option>
                      <option value="Asia/Jayapura">WIT — Asia/Jayapura</option>
                    </select>
                  </div>
                </div>

                <hr style={{ margin: "20px 0", borderColor: "var(--border)" }} />
                <h3 style={{ fontSize: 15, fontWeight: 700, marginTop: 0 }}>Koneksi WAHA</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">WAHA Base URL</label>
                    <input type="text" value={form.wahaBaseUrl || ""} placeholder="http://localhost:3000"
                      onChange={(e) => setForm((f) => ({ ...f, wahaBaseUrl: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">WAHA Session Name</label>
                    <input type="text" value={form.wahaSession || ""} placeholder="default"
                      onChange={(e) => setForm((f) => ({ ...f, wahaSession: e.target.value }))} />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }} disabled={savingSettings}>
                  <Save size={15} /> {savingSettings ? "Menyimpan..." : "Simpan Pengaturan"}
                </button>
              </form>
            </div>
          )}

          {/* ── STATUS WHATSAPP ── */}
          {section === "whatsapp" && (
            <div className="settings-card">
              <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Status Koneksi WhatsApp</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
                Status real-time koneksi WAHA self-hosted ke nomor WhatsApp klinik.
              </p>
              <button className="btn btn-primary" onClick={checkWaStatus} disabled={waLoading} style={{ marginBottom: 20 }}>
                <Wifi size={15} /> {waLoading ? "Mengecek..." : "Cek Status Sekarang"}
              </button>

              {waStatus && (
                <div className={`wa-status ${waStatus.status === "WORKING" ? "connected" : "disconnected"}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {waStatus.status === "WORKING"
                      ? <CheckCircle size={20} color="#166534" />
                      : <XCircle size={20} color="#991b1b" />}
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>
                        {waStatus.status === "WORKING" ? "Terhubung" : "Tidak Terhubung"}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.8 }}>
                        Status WAHA: <strong>{waStatus.status || "Unknown"}</strong>
                      </p>
                    </div>
                  </div>
                  {waStatus.error && (
                    <p style={{ margin: "12px 0 0", fontSize: 12, opacity: 0.85 }}>
                      Error: {waStatus.error}
                    </p>
                  )}
                </div>
              )}

              <div style={{ marginTop: 24, padding: 16, background: "var(--bg-secondary)", borderRadius: 10 }}>
                <h3 style={{ marginTop: 0, fontSize: 14, fontWeight: 700 }}>Cara menghubungkan ulang</h3>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: "var(--text-muted)" }}>
                  <li>Buka WAHA dashboard di browser (URL dari pengaturan profil)</li>
                  <li>Pilih session &ldquo;default&rdquo; (atau nama yang dikonfigurasi)</li>
                  <li>Klik &ldquo;Start&rdquo; → scan QR code dengan WhatsApp di HP</li>
                  <li>Tunggu status berubah menjadi &ldquo;WORKING&rdquo;</li>
                  <li>Klik tombol di atas untuk verifikasi status</li>
                </ol>
              </div>
            </div>
          )}

          {/* ── TEMPLATE PESAN ── */}
          {section === "template" && <TemplateSection />}

          {/* ── TARGET SALES ── */}
          {section === "target-sales" && <SalesTargetSection />}

          {/* ── KEAMANAN ── */}
          {section === "keamanan" && (
            <div className="settings-card">
              <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Keamanan Akun</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
                Ubah password login Anda. Gunakan kombinasi huruf, angka, dan simbol.
              </p>
              {pwMsg && (
                <div className={`inline-feedback inline-feedback-${pwMsg.type}`} style={{ marginBottom: 16 }}>
                  {pwMsg.text}
                </div>
              )}
              <form onSubmit={handleChangePassword} style={{ maxWidth: 400 }}>
                {[
                  { key: "currentPassword", label: "Password Saat Ini",  show: "current" },
                  { key: "newPassword",     label: "Password Baru",       show: "new" },
                  { key: "confirmPassword", label: "Konfirmasi Password Baru", show: "confirm" },
                ].map(({ key, label, show }) => (
                  <div key={key} className="form-group">
                    <label className="form-label">{label}</label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showPw[show] ? "text" : "password"}
                        value={pwForm[key]}
                        onChange={(e) => setPwForm((f) => ({ ...f, [key]: e.target.value }))}
                        placeholder="••••••••"
                        style={{ paddingRight: 40 }}
                      />
                      <button type="button" onClick={() => setShowPw((s) => ({ ...s, [show]: !s[show] }))}
                        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                        {showPw[show] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                ))}
                <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }} disabled={pwLoading}>
                  <Lock size={15} /> {pwLoading ? "Menyimpan..." : "Ubah Password"}
                </button>
              </form>
            </div>
          )}

          {/* ── DATA & BACKUP ── */}
          {section === "data" && (
            <div className="settings-card">
              <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Data & Backup</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>
                Export data CRM ke format Excel untuk backup atau analisis eksternal.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700 }}>Data Pelanggan</p>
                    <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-muted)" }}>Semua data pelanggan beserta info kontak, pipeline, dan nilai order</p>
                  </div>
                  <button className="btn btn-ghost" onClick={handleExportCustomers} disabled={exporting}>
                    <Download size={14} /> {exporting ? "Mengunduh..." : "Export Excel"}
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700 }}>FAQ & Knowledge Base</p>
                    <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-muted)" }}>Daftar pertanyaan & jawaban yang tersimpan di Knowledge Base AI</p>
                  </div>
                  <button className="btn btn-ghost" onClick={async () => {
                    try {
                      const faq = await api.getFaq();
                      exportToExcel(faq.map((q) => ({ Pertanyaan: q.question, Jawaban: q.answer })), "faq-knowledge-base");
                    } catch (e) { alert("Gagal export FAQ: " + e.message); }
                  }}>
                    <Download size={14} /> Export Excel
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 24, padding: 16, background: "#fef3c7", borderRadius: 10, border: "1px solid #fde68a" }}>
                <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                  Catatan: Data percakapan dan pesan tidak dapat diexport secara massal karena volume yang besar. Gunakan Prisma Studio untuk akses database langsung jika diperlukan.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
