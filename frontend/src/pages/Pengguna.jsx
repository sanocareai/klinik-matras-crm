import React, { useEffect, useState } from "react";
import {
  UserPlus, Trash2, Key, Shield, ShieldCheck, Lock, X, Eye, EyeOff,
  MessageSquare, Users, FileText, Check,
} from "lucide-react";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import { formatTanggalWaktu } from "../utils/format.js";
import { isAdminUser } from "@/lib/roles.js";

// Label & warna peran — SEMUA 9 peran yang dikenal sistem otorisasi
// (backend/src/constants/permissions.js ROLE_PERMISSIONS), bukan cuma
// ADMIN/SALES/CS lama. "CS" DIHAPUS di sini — bukan pengurangan fitur,
// itu memang bukan peran valid di enum Role Prisma; membuat user dengan
// role itu sebelumnya akan gagal diam-diam di backend.
const ROLE_LABELS = {
  ADMIN: "Admin",
  SALES: "Sales",
  PRODUCTION_LEAD: "Kepala Produksi",
  PRODUCTION_WORKER: "Pekerja Produksi",
  QC_LEAD: "QC Leader",
  WAREHOUSE: "Gudang",
  DISPATCHER: "Dispatcher",
  DRIVER: "Driver",
  FINANCE: "Keuangan",
};
const ROLE_COLORS = {
  ADMIN:             { bg: "#ede9fe", color: "#5b21b6" },
  SALES:             { bg: "#dbeafe", color: "#1e40af" },
  PRODUCTION_LEAD:   { bg: "#fef3c7", color: "#92400e" },
  PRODUCTION_WORKER: { bg: "#fef3c7", color: "#92400e" },
  QC_LEAD:           { bg: "#fce7f3", color: "#9d174d" },
  WAREHOUSE:         { bg: "#fef3c7", color: "#92400e" },
  DISPATCHER:        { bg: "#d1fae5", color: "#065f46" },
  DRIVER:            { bg: "#d1fae5", color: "#065f46" },
  FINANCE:           { bg: "#ede9fe", color: "#5b21b6" },
};
const ALL_ROLES = Object.keys(ROLE_LABELS);

function RoleChip({ role }) {
  const { bg, color } = ROLE_COLORS[role] || { bg: "#f3f4f6", color: "#374151" };
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: bg, color, whiteSpace: "nowrap" }}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

// Peran EFEKTIF seorang user bisa lebih dari satu (D-010, aditif) —
// backend selalu mengembalikan array `roles`, tapi jaga-jaga kalau field
// itu belum terisi (mis. respons lama sebelum reload), fallback ke role
// tunggal supaya UI tidak pernah menampilkan chip kosong.
function effectiveRoles(u) {
  return Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role];
}

export default function Pengguna({ user: currentUser }) {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [feedback, setFeedback]     = useState(null);

  // Modal states
  const [showAdd, setShowAdd]           = useState(false);
  const [showReset, setShowReset]       = useState(null); // user object
  const [showDelete, setShowDelete]     = useState(null); // user object
  const [showRoleEdit, setShowRoleEdit] = useState(null); // user object

  // Add user form
  const [addForm, setAddForm]   = useState({ name: "", email: "", password: "", role: "SALES" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [showAddPw, setShowAddPw] = useState(false);

  // Reset password
  const [resetPw, setResetPw]         = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);

  // Ubah peran — role yang lagi diproses (biar cuma checkbox itu yang
  // kelihatan loading, bukan seluruh modal terkunci).
  const [roleBusy, setRoleBusy] = useState(null);
  const [roleEditError, setRoleEditError] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch (e) {
      showFeedback("error", "Gagal memuat daftar pengguna: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  function showFeedback(type, text) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 5000);
  }

  async function handleAddUser(e) {
    e.preventDefault();
    setAddError("");
    if (!addForm.name || !addForm.email || !addForm.password) {
      setAddError("Nama, email, dan password wajib diisi.");
      return;
    }
    if (addForm.password.length < 6) {
      setAddError("Password minimal 6 karakter.");
      return;
    }
    setAddLoading(true);
    try {
      const created = await api.createUser(addForm);
      setUsers((prev) => [...prev, { ...created, _count: { notes: 0, assignedCustomers: 0, assignedConversations: 0 } }]);
      setShowAdd(false);
      setAddForm({ name: "", email: "", password: "", role: "SALES" });
      showFeedback("success", `Pengguna "${created.name}" berhasil ditambahkan.`);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (!resetPw || resetPw.length < 6) {
      showFeedback("error", "Password baru minimal 6 karakter.");
      return;
    }
    setResetLoading(true);
    try {
      await api.resetUserPassword(showReset.id, resetPw);
      setShowReset(null);
      setResetPw("");
      showFeedback("success", `Password untuk "${showReset.name}" berhasil direset.`);
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setResetLoading(false);
    }
  }

  // Toggle satu peran untuk user yang sedang dibuka di modal "Ubah Peran".
  // Additive (D-010): centang = tambah peran, hapus centang = cabut peran.
  // Tidak boleh mencabut peran TERAKHIR — server juga menolak ini, tapi
  // dicegah di sisi UI dulu supaya jelas kenapa (bukan error server generik).
  async function handleToggleRole(role) {
    const target = showRoleEdit;
    if (!target) return;
    const current = effectiveRoles(target);
    const hasIt = current.includes(role);
    if (hasIt && current.length <= 1) {
      setRoleEditError("User harus punya minimal 1 peran.");
      return;
    }
    setRoleEditError("");
    setRoleBusy(role);
    try {
      const { roles } = hasIt
        ? await api.removeUserRole(target.id, role)
        : await api.addUserRole(target.id, role);
      setUsers((prev) => prev.map((u) => (u.id === target.id ? { ...u, roles } : u)));
      setShowRoleEdit((prev) => (prev ? { ...prev, roles } : prev));
    } catch (err) {
      setRoleEditError(err.message);
    } finally {
      setRoleBusy(null);
    }
  }

  async function handleDeleteUser() {
    try {
      await api.deleteUser(showDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== showDelete.id));
      setShowDelete(null);
      showFeedback("success", `Pengguna "${showDelete.name}" berhasil dihapus.`);
    } catch (err) {
      showFeedback("error", err.message);
      setShowDelete(null);
    }
  }

  if (!isAdminUser(currentUser)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 12 }}>
        <Lock size={40} color="var(--text-muted)" />
        <h2 style={{ margin: 0, color: "var(--text-muted)" }}>Akses Terbatas</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Hanya admin yang bisa mengakses halaman Pengguna & Peran.</p>
      </div>
    );
  }

  const roleStats = ALL_ROLES.map((role) => ({
    role, label: ROLE_LABELS[role], count: users.filter((u) => effectiveRoles(u).includes(role)).length,
  })).filter((s) => s.count > 0);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Pengguna & Peran</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Kelola akun & peran seluruh divisi — {users.length} pengguna terdaftar
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowAdd(true); setAddError(""); }}>
          <UserPlus size={16} /> Tambah Pengguna
        </button>
      </div>

      {feedback && (
        <div className={`inline-feedback inline-feedback-${feedback.type}`} style={{ marginBottom: 16 }}>
          {feedback.text}
        </div>
      )}

      {/* Stats — horizontal-scroll supaya aman di mobile walau peran ada 9 */}
      <div className="user-stats" style={{ marginBottom: 24, display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 }}>
        {roleStats.map(({ role, label, count }) => {
          const { bg, color } = ROLE_COLORS[role] || { bg: "#f3f4f6", color: "#374151" };
          return (
            <div key={role} style={{ flex: "0 0 auto", padding: "14px 20px", background: bg, borderRadius: 10, display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap" }}>
              <ShieldCheck size={22} color={color} />
              <div>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 22, color }}>{count}</p>
                <p style={{ margin: 0, fontSize: 12, color, fontWeight: 600 }}>{label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          Memuat daftar pengguna...
        </div>
      )}

      {/* Table — desktop */}
      {!loading && (
        <div className="settings-card user-table-wrap" style={{ padding: 0, overflow: "hidden" }}>
          <table className="user-table">
            <thead>
              <tr>
                <th>Pengguna</th>
                <th>Peran</th>
                <th>Pelanggan</th>
                <th>Percakapan</th>
                <th>Catatan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === currentUser?.id;
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar name={u.name || u.email} src={u.avatarUrl} size="sm" />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {u.name}
                            {isMe && <span style={{ marginLeft: 6, fontSize: 10, background: "#ede9fe", color: "#5b21b6", fontWeight: 700, padding: "1px 6px", borderRadius: 8 }}>Anda</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 220 }}>
                        {effectiveRoles(u).map((role) => <RoleChip key={role} role={role} />)}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                        <Users size={13} color="var(--text-muted)" />
                        <span style={{ fontWeight: 700 }}>{u._count?.assignedCustomers || 0}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                        <MessageSquare size={13} color="var(--text-muted)" />
                        <span style={{ fontWeight: 700 }}>{u._count?.assignedConversations || 0}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                        <FileText size={13} color="var(--text-muted)" />
                        <span style={{ fontWeight: 700 }}>{u._count?.notes || 0}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {!isMe && (
                          <button className="btn btn-ghost btn-sm" title="Ubah Peran"
                            onClick={() => { setShowRoleEdit(u); setRoleEditError(""); }}>
                            <Shield size={13} /> Peran
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" title="Reset Password"
                          onClick={() => { setShowReset(u); setResetPw(""); setShowResetPw(false); }}>
                          <Key size={13} /> Reset PW
                        </button>
                        {!isMe && (
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--color-danger)" }}
                            title="Hapus Pengguna" onClick={() => setShowDelete(u)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Belum ada pengguna terdaftar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Card list — mobile */}
      {!loading && (
        <div className="user-card-list">
          {users.map((u) => {
            const isMe = u.id === currentUser?.id;
            return (
              <div key={u.id} className="user-card">
                <div className="user-card-header">
                  <Avatar name={u.name || u.email} src={u.avatarUrl} size="sm" />
                  <div className="user-card-info">
                    <div className="user-card-name">
                      {u.name}
                      {isMe && <span className="user-card-you">Anda</span>}
                    </div>
                    <div className="user-card-email">{u.email}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0" }}>
                  {effectiveRoles(u).map((role) => <RoleChip key={role} role={role} />)}
                </div>
                <div className="user-card-stats">
                  <span><Users size={12} /> {u._count?.assignedCustomers || 0} pelanggan</span>
                  <span><MessageSquare size={12} /> {u._count?.assignedConversations || 0} percakapan</span>
                </div>
                <div className="user-card-actions">
                  {!isMe && (
                    <button className="btn btn-ghost btn-sm" onClick={() => { setShowRoleEdit(u); setRoleEditError(""); }}>
                      <Shield size={13} /> Peran
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowReset(u); setResetPw(""); setShowResetPw(false); }}>
                    <Key size={13} /> Reset PW
                  </button>
                  {!isMe && (
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--color-danger)" }}
                      onClick={() => setShowDelete(u)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {users.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px 0" }}>
              Belum ada pengguna terdaftar.
            </p>
          )}
        </div>
      )}

      {/* ── MODAL TAMBAH PENGGUNA ── */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tambah Pengguna Baru</h3>
              <button className="modal-close" onClick={() => setShowAdd(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleAddUser}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nama Lengkap</label>
                  <input type="text" placeholder="Nama pengguna" value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email (untuk login)</label>
                  <input type="email" placeholder="email@klinikmatras.com" value={addForm.email}
                    onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} />
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                    Login selalu pakai email + password ini — termasuk untuk driver, tidak perlu OTP/Google.
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <div style={{ position: "relative" }}>
                    <input type={showAddPw ? "text" : "password"} placeholder="Min. 6 karakter" value={addForm.password}
                      onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} style={{ paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowAddPw((v) => !v)}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                      {showAddPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Peran Awal</label>
                  <select value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}>
                    {ALL_ROLES.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                    Bisa ditambah peran lain lagi nanti lewat tombol "Peran".
                  </p>
                </div>
                {addError && <p style={{ color: "var(--color-danger)", fontSize: 13, margin: "4px 0 0" }}>{addError}</p>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={addLoading}>
                  {addLoading ? "Menyimpan..." : "Tambah Pengguna"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL UBAH PERAN (multi-select aditif, D-010) ── */}
      {showRoleEdit && (
        <div className="modal-overlay" onClick={() => setShowRoleEdit(null)}>
          <div className="modal-box" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Peran {showRoleEdit.name}</h3>
              <button className="modal-close" onClick={() => setShowRoleEdit(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>
                Satu orang bisa punya lebih dari satu peran — centang untuk menambah, hapus centang untuk mencabut.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ALL_ROLES.map((role) => {
                  const checked = effectiveRoles(showRoleEdit).includes(role);
                  const busy = roleBusy === role;
                  return (
                    <button key={role} type="button" disabled={busy}
                      onClick={() => handleToggleRole(role)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                        borderRadius: 8, border: `1px solid ${checked ? "var(--primary)" : "var(--border)"}`,
                        background: checked ? "#eff6ff" : "#fff", cursor: busy ? "wait" : "pointer",
                        textAlign: "left", opacity: busy ? 0.6 : 1,
                      }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${checked ? "var(--primary)" : "var(--border)"}`,
                        background: checked ? "var(--primary)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {checked && <Check size={13} color="#fff" />}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{ROLE_LABELS[role]}</span>
                    </button>
                  );
                })}
              </div>
              {roleEditError && <p style={{ color: "var(--color-danger)", fontSize: 13, margin: "12px 0 0" }}>{roleEditError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowRoleEdit(null)}>Selesai</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL RESET PASSWORD ── */}
      {showReset && (
        <div className="modal-overlay" onClick={() => setShowReset(null)}>
          <div className="modal-box" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Reset Password</h3>
              <button className="modal-close" onClick={() => setShowReset(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <p style={{ margin: "0 0 16px", fontSize: 14 }}>
                  Set password baru untuk <strong>{showReset.name}</strong>.
                </p>
                <div className="form-group">
                  <label className="form-label">Password Baru</label>
                  <div style={{ position: "relative" }}>
                    <input type={showResetPw ? "text" : "password"} placeholder="Min. 6 karakter" value={resetPw}
                      onChange={(e) => setResetPw(e.target.value)} style={{ paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowResetPw((v) => !v)}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                      {showResetPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowReset(null)}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={resetLoading}>
                  <Key size={14} /> {resetLoading ? "Mereset..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL KONFIRMASI HAPUS ── */}
      {showDelete && (
        <div className="modal-overlay" onClick={() => setShowDelete(null)}>
          <div className="modal-box" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: "var(--color-danger)" }}>Hapus Pengguna</h3>
              <button className="modal-close" onClick={() => setShowDelete(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                Apakah Anda yakin ingin menghapus pengguna <strong>{showDelete.name}</strong>?
              </p>
              <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>
                <strong>Perhatian:</strong> Aksi ini tidak dapat dibatalkan. Semua percakapan dan pelanggan yang ditugaskan ke pengguna ini akan dilepas (tidak dihapus).
                Penghapusan akan gagal jika pengguna masih memiliki catatan pelanggan.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowDelete(null)}>Batal</button>
              <button className="btn" style={{ background: "var(--color-danger)", color: "#fff" }} onClick={handleDeleteUser}>
                <Trash2 size={14} /> Ya, Hapus Pengguna
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
