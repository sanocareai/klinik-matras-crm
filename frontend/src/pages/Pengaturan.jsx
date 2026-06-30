import React, { useEffect, useState } from "react";
import {
  Building2, Lock, Wifi, WifiOff, Download, Save, Eye, EyeOff, CheckCircle, XCircle,
} from "lucide-react";
import { api } from "../api.js";
import { exportToExcel } from "../utils/export.js";
import { formatRupiah } from "../utils/format.js";

const NAV_ITEMS = [
  { key: "profil",    label: "Profil Perusahaan", icon: Building2 },
  { key: "whatsapp", label: "Status WhatsApp",    icon: Wifi },
  { key: "keamanan", label: "Keamanan Akun",      icon: Lock },
  { key: "data",     label: "Data & Backup",      icon: Download },
];

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
    setExporting(true);
    try {
      const customers = await api.getCustomers();
      exportToExcel(
        customers.map((c) => ({
          Nama: c.name || "",
          Telepon: c.phone || "",
          Instagram: c.instagramHandle ? "@" + c.instagramHandle : "",
          Email: c.email || "",
          Kota: c.city || "",
          Tags: (c.tags || []).join(", "),
          Pipeline: c.pipelineStage || "",
          "Sumber Lead": c.leadSource || "",
          "Jumlah Order": c.orderCount || 0,
          "Nilai Order": c.orderValue || 0,
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
