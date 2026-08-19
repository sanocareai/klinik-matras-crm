import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2, Lock, Wifi, Download, Save, Eye, EyeOff, CheckCircle,
  MessageSquare, Plus, Pencil, Trash2, X, Copy, TrendingUp, Palette,
  Bold, Italic, Strikethrough, Camera, Tag,
} from "lucide-react";
import { api } from "../api.js";
import { getSocket } from "../lib/socket.js";
import Avatar from "../components/Avatar.jsx";
// Lazy — lihat catatan yang sama di Customers.jsx: exportToExcel() (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.
import { formatRupiah, STAGE_LABELS, SOURCE_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "../utils/format.js";
import { WA_MARKERS, toggleWaFormat, parseWaFormatting } from "../utils/waFormat.jsx";

// Polling fallback (Fix UX sync-history) kalau socket putus/belum sempat
// connect — 3 detik sesuai spec.
import AppearanceSection from "@/features/settings/AppearanceSection.jsx";
import { isAdminUser } from "@/lib/roles.js";

const SYNC_POLL_INTERVAL_MS = 3000;

const NAV_ITEMS = [
  { key: "profil",        label: "Profil Perusahaan", icon: Building2 },
  { key: "whatsapp",     label: "Status WhatsApp",    icon: Wifi },
  { key: "template",     label: "Template Pesan",     icon: MessageSquare },
  { key: "target-sales", label: "Target Sales",       icon: TrendingUp },
  { key: "promo",        label: "Promo",              icon: Tag },
  { key: "tampilan",     label: "Tampilan",           icon: Palette },
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
  penawaran: { bg: "#dcfce7", color: "#166534" },
  konfirmasi: { bg: "#fef9c3", color: "#854d0e" },
  penutupan: { bg: "#fee2e2", color: "#991b1b" },
  lainnya:   { bg: "#f3f4f6", color: "#374151" },
};

const EMPTY_TPL_FORM = { nama: "", kategori: "pembukaan", isi: "", isShared: false };

function formatSyncDuration(startedAt, finishedAt) {
  const seconds = Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000);
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} mnt ${rest} dtk`;
}

// Revisi 26 Jul 2026: dulu SATU daftar rata untuk semua orang (file JSON
// tanpa kepemilikan). Sekarang dipisah "Template Tim" (isShared, hanya ADMIN
// yang kelola) vs "Template Saya" (pribadi milik user yang login, SALES
// bebas bikin/edit/hapus punya sendiri) — sesuai keputusan 26 Jul 2026:
// "sales punya template masing-masing yang bisa dicustomize". Backend
// (routes/templates.js) yang menegakkan siapa boleh apa lewat `canManage`
// per-item; komponen ini cuma mengikuti flag itu, bukan menghitung ulang.
function TemplateFormatToolbar({ textareaRef, value, onChange }) {
  function apply(marker) {
    const el = textareaRef.current;
    if (!el) return;
    const { nextText, selStart, selEnd } = toggleWaFormat(el, value, marker);
    onChange(nextText);
    setTimeout(() => {
      el.focus();
      el.selectionStart = selStart;
      el.selectionEnd = selEnd;
    }, 0);
  }
  const btnStyle = { padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center" };
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
      <button type="button" title="Tebal (*teks*)" style={btnStyle} onClick={() => apply(WA_MARKERS.bold)}><Bold size={13} /></button>
      <button type="button" title="Miring (_teks_)" style={btnStyle} onClick={() => apply(WA_MARKERS.italic)}><Italic size={13} /></button>
      <button type="button" title="Coret (~teks~)" style={btnStyle} onClick={() => apply(WA_MARKERS.strike)}><Strikethrough size={13} /></button>
    </div>
  );
}

function TemplateSection({ user }) {
  const isAdmin = isAdminUser(user);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_TPL_FORM);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(null);
  const formTextareaRef = useRef(null);

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
    setForm({ nama: tpl.nama, kategori: tpl.kategori, isi: tpl.isi, isShared: tpl.isShared });
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

  // Dua daftar terpisah — bukan "daftar polos dikelompokkan kategori" seperti
  // dulu, karena kepemilikan sekarang bagian penting dari cara membacanya:
  // sales harus langsung lihat mana template MEREKA (bebas ubah) vs Template
  // Tim (cuma bisa pakai). Dalam tiap daftar tetap dikelompokkan kategori.
  const templateTim   = templates.filter((t) => t.isShared);
  const templateSaya  = templates.filter((t) => !t.isShared);

  function renderDaftar(list) {
    const grouped = Object.keys(KATEGORI_LABELS).reduce((acc, k) => {
      acc[k] = list.filter((t) => t.kategori === k);
      return acc;
    }, {});
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
                      <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 13 }}>
                        {tpl.nama}
                        {tpl.isShared && tpl.author == null && (
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>· TIM</span>
                        )}
                      </p>
                      {/* Format WhatsApp langsung dirender di sini juga (bukan
                          teks mentah "*.../*") — supaya preview template SAMA
                          dengan tampilan di TemplatePicker Inbox dan pesan
                          yang benar-benar terkirim. */}
                      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {parseWaFormatting(tpl.isi)}
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
                      {/* Edit/Hapus HANYA kalau backend bilang boleh — server
                          yang menegakkan aturan (template Tim = admin saja,
                          template pribadi = pemiliknya saja), tombol ini
                          cuma mengikuti, tidak menghitung ulang aturannya. */}
                      {tpl.canManage && (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="settings-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 200 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Template Pesan</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Template siap pakai untuk mempercepat balasan di Inbox. Gunakan <code>{"{nama_customer}"}</code> untuk nama otomatis,
            dan tombol <strong>Tebal/Miring/Coret</strong> di bawah — formatnya akan tampil PERSIS begitu di WhatsApp customer.
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
              <TemplateFormatToolbar
                textareaRef={formTextareaRef}
                value={form.isi}
                onChange={(v) => setForm((f) => ({ ...f, isi: v }))}
              />
              <textarea
                ref={formTextareaRef}
                value={form.isi}
                onChange={(e) => setForm((f) => ({ ...f, isi: e.target.value }))}
                placeholder={"Halo kak {nama_customer}, terima kasih sudah menghubungi Klinik Matras..."}
                rows={4}
                required
                style={{ resize: "vertical" }}
              />
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                Gunakan <code>{"{nama_customer}"}</code> — akan diganti otomatis dengan nama customer saat dipakai di Inbox.
                Pilih teks lalu klik tombol format di atas untuk menebalkan/memiringkan/mencoret
                (kotak ketik tetap teks polos dengan simbol WhatsApp — sama seperti WhatsApp asli,
                gayanya baru terlihat saat template dipakai/dikirim).
              </p>
              {form.isi && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--bg-primary)", border: "1px dashed var(--border)", borderRadius: 6 }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>Preview</p>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {parseWaFormatting(form.isi)}
                  </p>
                </div>
              )}
            </div>

            {/* Toggle "jadikan Template Tim" HANYA untuk ADMIN — sales tidak
                bisa mempromosikan template pribadinya sendiri jadi milik
                tim (server juga menolak ini kalau dipaksa lewat API, lihat
                routes/templates.js). */}
            {isAdmin && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!form.isShared}
                  onChange={(e) => setForm((f) => ({ ...f, isShared: e.target.checked }))}
                />
                Jadikan Template Tim (terlihat &amp; bisa dipakai semua sales)
              </label>
            )}

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

      {/* Daftar template — dipisah Tim vs Saya */}
      {loading ? (
        <p className="text-muted">Memuat...</p>
      ) : templates.length === 0 ? (
        <p className="text-muted" style={{ textAlign: "center", padding: "40px 0" }}>
          Belum ada template. Klik "+ Tambah Template" untuk mulai.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Template Tim {templateTim.length > 0 && `(${templateTim.length})`}
            </h3>
            {templateTim.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Belum ada template tim.</p>
            ) : renderDaftar(templateTim)}
          </div>
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Template Saya {templateSaya.length > 0 && `(${templateSaya.length})`}
            </h3>
            {templateSaya.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>
                Belum punya template pribadi. Klik "+ Tambah Template" — hanya Anda yang bisa lihat dan pakai.
              </p>
            ) : renderDaftar(templateSaya)}
          </div>
        </div>
      )}
    </div>
  );
}

// 2 session WAHA aktif (lihat CLAUDE.md §"Multi-session WAHA aktif") — CS-1
// dan CS-2, masing-masing dicek terpisah lewat ?session= (backend tetap
// backward-compatible, default WAHA_SESSION kalau param tidak dikirim).
const WA_SESSIONS = [
  { key: "CS-1", label: "CS-1" },
  { key: "CS-2", label: "CS-2" },
];

function WaSessionCard({ session, label }) {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(false);

  async function checkStatus() {
    setLoading(true);
    try {
      const data = await api.getWhatsappStatus(session);
      setStatus(data);
    } catch (err) {
      setStatus({ status: "ERROR", connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { checkStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connected = status?.connected;

  return (
    <div className="wa-session-card">
      <div className="wa-session-card-head">
        <span className="wa-session-name">{label}</span>
        {status && (
          <span className={`wa-status-dot-wrap ${connected ? "connected" : "disconnected"}`}>
            <span className="wa-status-dot" />
            {connected ? "WORKING" : (status.status || "DOWN")}
          </span>
        )}
      </div>
      {status?.error && (
        <p className="wa-session-error">{status.error}</p>
      )}
      <button className="btn btn-secondary btn-sm" onClick={checkStatus} disabled={loading} style={{ marginTop: 12 }}>
        <Wifi size={13} /> {loading ? "Mengecek..." : "Cek Status"}
      </button>
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

// D-026 (20 Agustus 2026) — kelola katalog kampanye promo (mis. "Merdeka
// dari Sakit Pinggang" diskon hingga 17%). Admin-only (create/edit) — sales
// cuma MEMILIH promo dari dropdown ini saat input order (OrderSection.jsx),
// tidak pernah membuat kampanye baru sendiri.
function PromoSection() {
  const [promos, setPromos] = useState(null);
  const [msg, setMsg] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", discountPercent: "", validFrom: "", validUntil: "" });
  const [saving, setSaving] = useState(false);

  function showMsg(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  function load() {
    api.getPromos().then(setPromos).catch((err) => showMsg("error", err.message));
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      await api.createPromo({
        code: form.code, name: form.name,
        discountPercent: form.discountPercent || undefined,
        validFrom: form.validFrom || undefined,
        validUntil: form.validUntil || undefined,
      });
      setForm({ code: "", name: "", discountPercent: "", validFrom: "", validUntil: "" });
      setShowForm(false);
      showMsg("success", "Promo dibuat");
      load();
    } catch (err) {
      showMsg("error", err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(promo) {
    try {
      await api.updatePromo(promo.id, { active: !promo.active });
      load();
    } catch (err) {
      showMsg("error", err.message);
    }
  }

  return (
    <div className="settings-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Promo</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={14} /> Promo Baru
        </button>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        Kampanye yang bisa dipilih sales saat input order (mis. "Merdeka dari Sakit Pinggang").
        Diskonnya cuma PENANDA untuk laporan — harga akhir tetap diketik manual sales seperti biasa,
        tidak dihitung otomatis dari sini.
      </p>

      {msg && (
        <div className={`inline-feedback inline-feedback-${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} style={{ padding: 14, marginBottom: 16, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-page)" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
              <label className="form-label">Kode</label>
              <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="MERDEKA17" style={{ textTransform: "uppercase" }} />
            </div>
            <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 220 }}>
              <label className="form-label">Nama Kampanye</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Merdeka dari Sakit Pinggang" />
            </div>
            <div className="form-group" style={{ margin: 0, minWidth: 100 }}>
              <label className="form-label">Diskon (%)</label>
              <input type="number" min="0" max="100" value={form.discountPercent}
                onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))} placeholder="17" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Mulai</label>
              <input type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Sampai</label>
              <input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan Promo"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Batal</button>
          </div>
        </form>
      )}

      {promos === null ? (
        <p className="text-muted">Memuat...</p>
      ) : promos.length === 0 ? (
        <p className="text-muted">Belum ada promo dibuat.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {promos.map((p) => (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
              border: "1px solid var(--border)", borderRadius: 8,
              background: "var(--card-bg)", opacity: p.active ? 1 : 0.55,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{p.code}</span>
                  {p.discountPercent != null && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-primary)" }}>{p.discountPercent}%</span>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  {p.orderCount} order · {formatRupiah(p.totalValue)}
                  {(p.validFrom || p.validUntil) && (
                    <> · {p.validFrom ? new Date(p.validFrom).toLocaleDateString("id-ID") : "—"} s/d {p.validUntil ? new Date(p.validUntil).toLocaleDateString("id-ID") : "—"}</>
                  )}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(p)}>
                {p.active ? "Nonaktifkan" : "Aktifkan"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV_KEYS = NAV_ITEMS.map((n) => n.key);

// Section yang boleh diakses SALES (bukan cuma ADMIN). Revisi 26 Jul 2026:
// sebelumnya SELURUH halaman Pengaturan diblokir untuk non-admin di satu
// gerbang paling atas ("Hanya admin yang bisa mengakses halaman
// Pengaturan") — akibatnya "Template Saya" yang justru dirancang supaya
// SETIAP sales bisa bikin template sendiri (lihat routes/templates.js,
// keputusan bisnis yang sama) tidak pernah bisa dibuka sales sama sekali,
// terlepas dari kepemilikan per-template di backend sudah benar. Sekarang
// gerbangnya PER-SECTION: SALES cuma bisa buka "Template Pesan" (untuk
// kelola template pribadinya), section lain (Profil Perusahaan, Status
// WhatsApp, Target Sales, Data & Backup) TETAP admin-only.
//
// "keamanan" DITAMBAHKAN (19 Agustus 2026, bareng fitur ganti foto profil
// web): ini section AKUN PRIBADI (password + foto profil sendiri), sama
// sifatnya dengan "template" — bukan pengaturan perusahaan/tim yang
// seharusnya admin-only. Sebelumnya ikut ke-lock tanpa alasan eksplisit,
// akibatnya SALES tidak bisa ganti password ATAU foto profilnya sendiri
// dari web sama sekali (cuma bisa dari aplikasi mobile).
const SALES_ALLOWED_SECTIONS = ["template", "keamanan"];

export default function Pengaturan({ user, onUserUpdate }) {
  const isAdmin = isAdminUser(user);

  // Deep link ?section=target-sales — dipakai widget Target Sales di
  // Dashboard supaya empty state bisa langsung buka tab yang relevan.
  // SALES: default ke "template" (satu-satunya section yang boleh dia
  // buka), bukan "profil" yang akan langsung kena gerbang akses-terbatas.
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const sectionValid = NAV_KEYS.includes(requestedSection)
    && (isAdmin || SALES_ALLOWED_SECTIONS.includes(requestedSection));
  const initialSection = sectionValid ? requestedSection : (isAdmin ? "profil" : "template");
  const [section, setSection] = useState(initialSection);

  // Sidebar/dropdown SALES cuma menampilkan section yang boleh dia buka —
  // bukan cuma disembunyikan di UI, gerbang di bawah (sebelum render body)
  // tetap menolak kalau section di-set lewat cara lain (mis. URL manual).
  const visibleNavItems = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter((n) => SALES_ALLOWED_SECTIONS.includes(n.key));

  // Settings
  const [settings, setSettings]   = useState(null);
  const [form, setForm]           = useState({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg]       = useState(null);

  // Sinkronisasi riwayat chat — job background (Fix UX timeout), bukan
  // request panjang yang di-await. syncJob = job dari backend penuh:
  // { jobId, status: running|done|failed, progress: {...}, error }.
  const [syncJob, setSyncJob] = useState(null);
  const syncPollRef = useRef(null);

  // Password change
  const [pwForm, setPwForm]       = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwMsg, setPwMsg]         = useState(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [showPw, setShowPw]       = useState({ current: false, new: false, confirm: false });

  // Foto profil — SEBELUMNYA cuma bisa diganti dari aplikasi mobile "Sano
  // Messenger" (ProfileScreen.js). Endpoint backend (POST /users/me/avatar)
  // sudah generik sejak awal, cuma web belum pernah punya UI-nya.
  const avatarInputRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg]             = useState(null);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // supaya pilih file YANG SAMA lagi tetap memicu onChange
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarMsg({ type: "error", text: "File harus berupa gambar" });
      return;
    }
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const updated = await api.uploadAvatar(fd);
      onUserUpdate?.({ avatarUrl: updated.avatarUrl });
      setAvatarMsg({ type: "success", text: "Foto profil berhasil diganti" });
    } catch (err) {
      setAvatarMsg({ type: "error", text: err.message });
    } finally {
      setUploadingAvatar(false);
    }
  }

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

  // Cek job yang mungkin masih berjalan (mis. admin refresh halaman di
  // tengah sync) — dipanggil saat mount, BUKAN cuma setelah klik tombol.
  useEffect(() => {
    api.getSyncHistoryStatus().then((job) => {
      if (job?.status === "running") setSyncJob(job);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket real-time (jalur utama) + polling 3 detik (fallback kalau socket
  // putus/belum connect) — SELALU jalan berdua selama job running, whichever
  // sampai duluan yang menang (keduanya idempotent, sama-sama cuma setState).
  useEffect(() => {
    if (syncJob?.status !== "running") {
      clearInterval(syncPollRef.current);
      return;
    }

    const socket = getSocket();
    function handleProgress(job) { setSyncJob(job); }
    function handleDone(job) { setSyncJob(job); }
    socket.on("sync:progress", handleProgress);
    socket.on("sync:done", handleDone);

    syncPollRef.current = setInterval(() => {
      api.getSyncHistoryStatus().then((job) => {
        if (job?.status) setSyncJob(job);
      }).catch(() => {});
    }, SYNC_POLL_INTERVAL_MS);

    return () => {
      socket.off("sync:progress", handleProgress);
      socket.off("sync:done", handleDone);
      clearInterval(syncPollRef.current);
    };
  }, [syncJob?.status]);

  async function handleSyncHistory() {
    try {
      const result = await api.syncChatHistory();
      setSyncJob({ jobId: result.jobId, status: "running", progress: { totalChats: 0, processedChats: 0, newMessages: 0, failedChats: 0, unsupportedMessages: 0, currentChat: null } });
    } catch (err) {
      // 409 = job lain sudah jalan (mis. admin lain klik duluan) — bukan
      // error sungguhan, cuma "nempel" ke job yang sedang berjalan itu.
      if (err.message === "Sinkronisasi sedang berjalan") {
        api.getSyncHistoryStatus().then((job) => job?.status === "running" && setSyncJob(job)).catch(() => {});
        return;
      }
      setSyncJob({ status: "failed", error: err.message, progress: {} });
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
    const { exportToExcel } = await import("../utils/export.js");
    const HEALTH_LABELS = { SAKIT: "Sakit", TIDAK_SAKIT: "Tidak Sakit" };
    setExporting(true);
    try {
      const customers = await api.getCustomers();
      exportToExcel(
        customers.map((c) => ({
          /* Urutan kolom cocok dengan tabel Pelanggan */
          "Nama Pelanggan":     c.name || c.phone || c.instagramHandle || "",
          "ID Order":           c.latestOrderNumber || "",
          "No HP":              c.phone || "",
          Instagram:            c.instagramHandle ? "@" + c.instagramHandle : "",
          Email:                c.email || "",
          Pipeline:             STAGE_LABELS[c.pipelineStage] || c.pipelineStage || "",
          "Status Order":       ORDER_STATUS_LABELS[c.latestOrderStatus] || (c.latestOrderStatus ? c.latestOrderStatus : "Belum Ada Order"),
          "Status Pembayaran":  PAYMENT_STATUS_LABELS[c.latestPaymentStatus] || "",
          "Keluhan Terbaru":    c.latestKeluhan || "",
          "Merk Kasur":         c.latestMerkKasur || "",
          "Ukuran Kasur":       c.latestUkuranKasur || "",
          "Berat Badan (kg)":   c.latestBeratBadan || "",
          Layanan:              c.latestLayanan || "",
          "Status Kesehatan":   HEALTH_LABELS[c.healthStatus] || "Belum Diisi",
          Tags:                 (c.tags || []).join(", "),
          "Tipe Pelanggan":     c.customerType === "CORPORATE" ? "Korporat" : "End User",
          Kota:                 c.city || "",
          "Sumber Lead":        SOURCE_LABELS[c.leadSource] || c.leadSource || "",
          "Jumlah Order":       c.orderCount || 0,
          "Total Nilai Order":  formatRupiah(c.orderValue || 0),
          "Pernah Komplain":    c.pernahKomplain ? "Ya" : "Tidak",
          "Sales Person":       c.assignedSales?.name || "",
        })),
        `export-pelanggan-${new Date().toISOString().slice(0, 10)}`
      );
    } catch (err) {
      alert("Gagal export: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  // Gerbang PER-SECTION (bukan seluruh halaman lagi) — lihat komentar
  // SALES_ALLOWED_SECTIONS di atas. `section` di sini SUDAH divalidasi lewat
  // `sectionValid` saat inisialisasi awal, tapi dicek ULANG di sini karena
  // `setSection` bisa dipanggil kapan saja lewat klik sidebar/dropdown —
  // keduanya sudah difilter ke `visibleNavItems` untuk SALES, tapi gerbang
  // ini tetap jaring terakhir kalau ada jalan lain mengubah `section`.
  if (!isAdmin && !SALES_ALLOWED_SECTIONS.includes(section)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 12 }}>
        <Lock size={40} color="var(--text-muted)" />
        <h2 style={{ margin: 0, color: "var(--text-muted)" }}>Akses Terbatas</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Hanya admin yang bisa mengakses bagian ini.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            {isAdmin ? "Pengaturan" : "Template Pesan"}
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            {isAdmin ? "Konfigurasi sistem CRM Klinik Matras" : "Kelola template balasan cepat milik Anda sendiri"}
          </p>
        </div>
      </div>

      {/* Dropdown sub-menu — mobile saja (sidebar disembunyikan via CSS di
          breakpoint ini). SALES cuma punya 1 opsi (Template Pesan), jadi
          dropdown-nya tidak perlu ditampilkan sama sekali — dropdown
          1-opsi cuma bingung, bukan navigasi. */}
      {visibleNavItems.length > 1 && (
        <select
          className="settings-mobile-select"
          value={section}
          onChange={(e) => setSection(e.target.value)}
        >
          {visibleNavItems.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      )}

      <div className="settings-layout">
        {/* Sidebar — disembunyikan total untuk SALES (cuma 1 section, sidebar
            navigasi tidak ada gunanya untuk 1 pilihan). */}
        {visibleNavItems.length > 1 && (
        <nav className="settings-sidebar">
          {visibleNavItems.map(({ key, label, icon: Icon }) => (
            <button key={key} className={`settings-nav-item ${section === key ? "active" : ""}`}
              onClick={() => setSection(key)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        )}

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

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                    <Save size={15} /> {savingSettings ? "Menyimpan..." : "Simpan Pengaturan"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── STATUS WHATSAPP ── */}
          {section === "whatsapp" && (
            <div className="settings-card">
              <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Status Koneksi WhatsApp</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
                Status real-time koneksi WAHA self-hosted untuk kedua nomor CS.
              </p>

              <div className="wa-session-grid">
                {WA_SESSIONS.map((s) => (
                  <WaSessionCard key={s.key} session={s.key} label={s.label} />
                ))}
              </div>

              <div style={{ marginTop: 20 }}>
                <button className="btn btn-secondary" onClick={handleSyncHistory} disabled={syncJob?.status === "running"}>
                  <Download size={15} /> {syncJob?.status === "running" ? "Sedang sinkronisasi..." : "Sinkronisasi Riwayat Chat"}
                </button>
              </div>

              {syncJob?.status === "running" && (
                <div style={{ marginTop: 14, maxWidth: 420 }}>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${syncJob.progress.totalChats ? Math.min(100, Math.round((syncJob.progress.processedChats / syncJob.progress.totalChats) * 100)) : 0}%`,
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "6px 0 0" }}>
                    {syncJob.progress.processedChats}/{syncJob.progress.totalChats || "?"} chat diproses
                    {syncJob.progress.currentChat && <> — Memproses {syncJob.progress.currentChat}...</>}
                  </p>
                  <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 0" }}>
                    {syncJob.progress.newMessages} pesan baru ditemukan
                  </p>
                </div>
              )}

              {syncJob?.status === "done" && (
                <div className="inline-feedback inline-feedback-success" style={{ marginTop: 14 }}>
                  <strong>Selesai:</strong> {syncJob.progress.processedChats} chat diproses, {syncJob.progress.newMessages} pesan baru
                  {syncJob.progress.failedChats > 0 && <> · {syncJob.progress.failedChats} chat gagal (lihat log)</>}
                  {syncJob.progress.unsupportedMessages > 0 && <> · {syncJob.progress.unsupportedMessages} pesan tipe tidak dikenal (lihat log)</>}
                  {syncJob.startedAt && syncJob.finishedAt && <> · durasi {formatSyncDuration(syncJob.startedAt, syncJob.finishedAt)}</>}
                </div>
              )}
              {syncJob?.status === "failed" && (
                <div className="inline-feedback inline-feedback-error" style={{ marginTop: 14 }}>
                  Gagal sinkronisasi: {syncJob.error}
                </div>
              )}

              <div style={{ marginTop: 24, padding: 16, background: "var(--bg-secondary)", borderRadius: 10 }}>
                <h3 style={{ marginTop: 0, fontSize: 14, fontWeight: 700 }}>Cara menghubungkan ulang</h3>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: "var(--text-muted)" }}>
                  <li>Buka WAHA dashboard di browser (URL dari pengaturan profil)</li>
                  <li>Pilih session &ldquo;CS-1&rdquo; atau &ldquo;CS-2&rdquo; sesuai nomor yang terputus</li>
                  <li>Klik &ldquo;Start&rdquo; → scan QR code dengan WhatsApp di HP</li>
                  <li>Tunggu status berubah menjadi &ldquo;WORKING&rdquo;</li>
                  <li>Klik &ldquo;Cek Status&rdquo; di card di atas untuk verifikasi</li>
                </ol>
              </div>
            </div>
          )}

          {/* ── TEMPLATE PESAN ── */}
          {section === "tampilan" && <AppearanceSection />}

          {section === "template" && <TemplateSection user={user} />}

          {/* ── TARGET SALES ── */}
          {section === "target-sales" && <SalesTargetSection />}

          {/* ── PROMO (D-026) ── */}
          {section === "promo" && <PromoSection />}

          {/* ── KEAMANAN ── */}
          {section === "keamanan" && (
            <>
              {/* Foto profil — CATATAN 19 Agustus 2026: dulu cuma bisa diganti
                  dari mobile "Sano Messenger". Sekarang jalur yang sama persis
                  (POST /users/me/avatar, crop persegi 256px di server) juga
                  dibuka di sini. */}
              <div className="settings-card" style={{ marginBottom: 16 }}>
                <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Foto Profil</h2>
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
                  Terlihat di sidebar, header, dan mana pun nama Anda muncul di CRM.
                </p>
                {avatarMsg && (
                  <div className={`inline-feedback inline-feedback-${avatarMsg.type}`} style={{ marginBottom: 16 }}>
                    {avatarMsg.text}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    title="Ganti foto profil"
                    style={{ position: "relative", padding: 0, border: "none", background: "none", cursor: uploadingAvatar ? "wait" : "pointer", borderRadius: "9999px" }}
                  >
                    <Avatar name={user?.name} src={user?.avatarUrl} size="xl" />
                    <span
                      style={{
                        position: "absolute", bottom: -2, right: -2, width: 26, height: 26, borderRadius: "9999px",
                        background: "var(--color-primary)", color: "#fff", display: "flex", alignItems: "center",
                        justifyContent: "center", border: "2px solid var(--card-bg)",
                      }}
                    >
                      <Camera size={13} />
                    </span>
                  </button>
                  <div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                    >
                      {uploadingAvatar ? "Mengunggah..." : "Ganti Foto"}
                    </button>
                    <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--text-muted)" }}>
                      JPG/PNG, otomatis dipotong persegi
                    </p>
                  </div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleAvatarChange}
                  />
                </div>
              </div>

              <div className="settings-card">
              <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Ganti Password</h2>
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
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={pwLoading}>
                    <Lock size={15} /> {pwLoading ? "Menyimpan..." : "Ubah Password"}
                  </button>
                </div>
              </form>
              </div>
            </>
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
                      const [{ exportToExcel }, faq] = await Promise.all([import("../utils/export.js"), api.getFaq()]);
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
