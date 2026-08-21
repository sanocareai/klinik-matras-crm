import React, { useEffect, useState } from "react";
import {
  UserPlus, Trash2, Key, Shield, ShieldCheck, Lock, X, Eye, EyeOff,
  MessageSquare, Users, FileText, Check, UserX, UserCheck, MoreVertical,
} from "lucide-react";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import { formatTanggalWaktu } from "../utils/format.js";
import { isAdminUser } from "@/lib/roles.js";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu.jsx";
import { PageContainer } from "@/components/ui/page.jsx";

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
// Sejak redesain 22 Agustus 2026 nilai ini cuma dipakai sebagai warna titik
// RoleChip + ikon stat strip (bukan lagi latar blok penuh) — lihat RoleChip
// di bawah. Warna sengaja tetap saturasi solid (bukan pastel): dipakai
// sebagai aksen KECIL (dot 6px, ikon 16px), bukan area luas, jadi butuh
// kontras lebih di kedua tema.
const ROLE_COLORS = {
  ADMIN:             { color: "#7c3aed" },
  SALES:             { color: "#2563eb" },
  PRODUCTION_LEAD:   { color: "#b45309" },
  PRODUCTION_WORKER: { color: "#b45309" },
  QC_LEAD:           { color: "#be185d" },
  WAREHOUSE:         { color: "#b45309" },
  DISPATCHER:        { color: "#059669" },
  DRIVER:            { color: "#059669" },
  FINANCE:           { color: "#7c3aed" },
};
const ALL_ROLES = Object.keys(ROLE_LABELS);

// Redesain 22 Agustus 2026 — versi lama tiap chip punya BLOK warna pastel
// penuh sendiri (7 warna berbeda sekaligus untuk user multi-peran seperti
// Natasha terlihat seperti "permen rainbow", ramai tanpa menambah info).
// Sekarang satu gaya chip netral (bg-inset/text-ink2, konsisten di kedua
// tema) + titik kecil warna peran — warna tetap membantu bedakan sekilas,
// tapi tidak lagi mendominasi baris saat satu user punya banyak peran.
function RoleChip({ role }) {
  const { color } = ROLE_COLORS[role] || { color: "var(--text-secondary)" };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-inset px-2.5 py-1 text-[11px] font-semibold text-ink2">
      <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: color }} />
      {ROLE_LABELS[role] || role}
    </span>
  );
}

// Menu aksi per baris (Ubah Peran/Reset PW/Nonaktifkan/Hapus) — dipakai
// SAMA oleh tabel desktop & kartu mobile (sebelumnya 2 baris tombol
// terpisah yang gampang saling menyimpang). Mengganti 3-4 tombol berjejer
// (kadang ikon polos tanpa label, kadang teks — tidak konsisten) dengan
// SATU kebab, pola yang sama dengan menu profil di sidebar (Layout.jsx).
function UserRowActions({ u, isMe, onEditRole, onResetPw, onToggleActive, onDelete }) {
  const nonaktif = u.active === false;
  return (
    <Menu
      trigger={
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
          title="Aksi pengguna"
          aria-label={`Aksi untuk ${u.name}`}
        >
          <MoreVertical size={16} />
        </button>
      }
    >
      {!isMe && <MenuItem icon={Shield} onSelect={onEditRole}>Ubah Peran</MenuItem>}
      <MenuItem icon={Key} onSelect={onResetPw}>Reset Password</MenuItem>
      {!isMe && (
        <MenuItem icon={nonaktif ? UserCheck : UserX} onSelect={onToggleActive}>
          {nonaktif ? "Aktifkan Kembali" : "Nonaktifkan"}
        </MenuItem>
      )}
      {!isMe && (
        <>
          <MenuSeparator />
          <MenuItem icon={Trash2} destructive onSelect={onDelete}>Hapus Pengguna</MenuItem>
        </>
      )}
    </Menu>
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
      // includeInactive: true — halaman ini satu-satunya tempat admin perlu
      // lihat & bisa mengaktifkan-kembali akun nonaktif (mis. sales resign).
      // Semua picker assign/transfer lain SENGAJA tidak kirim ini, jadi
      // otomatis cuma dapat akun aktif tanpa perlu diubah satu-satu.
      const data = await api.getUsers({ includeInactive: true });
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

  // Nonaktifkan/aktifkan — alternatif yang AMAN dari hapus permanen untuk
  // akun yang resign: tidak bisa login lagi & hilang dari picker assign/
  // Laporan (lihat catatan backend routes/users.js), tapi customer/
  // percakapan yang sudah tertaut ke dia TIDAK dilepas otomatis — cuma
  // diberi peringatan di sini supaya admin sadar perlu di-assign ulang.
  async function handleToggleActive(u) {
    const menonaktifkan = u.active !== false;
    if (menonaktifkan) {
      const n = u._count?.assignedCustomers || 0;
      const pesan = n > 0
        ? `Nonaktifkan "${u.name}"? Dia tidak akan bisa login lagi.\n\n⚠️ Masih ada ${n} pelanggan yang ditugaskan ke dia — data itu TIDAK dilepas otomatis, cuma tidak akan muncul lagi di pilihan assign baru. Anda perlu assign ulang pelanggan itu ke sales aktif secara manual lewat drawer Pelanggan.`
        : `Nonaktifkan "${u.name}"? Dia tidak akan bisa login lagi.`;
      if (!confirm(pesan)) return;
    }
    try {
      const updated = await api.updateUser(u.id, { active: !menonaktifkan });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...updated } : x)));
      showFeedback("success", menonaktifkan
        ? `"${u.name}" dinonaktifkan.`
        : `"${u.name}" diaktifkan kembali.`);
    } catch (err) {
      showFeedback("error", err.message);
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

  // BUG (fix, 22 Agustus 2026): halaman ini SATU-SATUNYA yang tidak pernah
  // dibungkus PageContainer (komponen ui/page.jsx yang KOMENTARNYA SENDIRI
  // menyebut "Pengguna" sebagai salah satu halaman yang harusnya dibetulkan
  // olehnya) — root-nya <div> polos di dalam .app-content/.page-body yang
  // sama-sama padding:0, jadi seluruh isi (judul, stat card, tabel) mentok
  // ke tepi sidebar/browser tanpa jarak sama sekali.
  return (
    <PageContainer>
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

      {/* Stats — redesain 22 Agustus 2026: versi lama 9 blok pastel PENUH
          berjejer terasa seperti papan reklame warna-warni. Sekarang kartu
          netral (bg-surface/border, konsisten di kedua tema) + lencana ikon
          kecil berwarna per peran — warnanya tetap membantu, tapi cuma di
          ikon, bukan seluruh kartu, jadi baris statistik tidak bersaing
          dengan tabel di bawahnya untuk perhatian. */}
      <div className="user-stats" style={{ marginBottom: 24, display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 }}>
        {roleStats.map(({ role, label, count }) => {
          const { color } = ROLE_COLORS[role] || { color: "var(--text-secondary)" };
          return (
            <div
              key={role}
              className="border-border bg-surface"
              style={{
                flex: "0 0 auto", padding: "11px 16px", borderRadius: 12, border: "1px solid",
                display: "flex", alignItems: "center", gap: 11, whiteSpace: "nowrap",
              }}
            >
              <span style={{
                width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                background: color + "1a", color,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <ShieldCheck size={16} />
              </span>
              <div>
                <p className="text-ink" style={{ margin: 0, fontWeight: 800, fontSize: 18, lineHeight: 1.15 }}>{count}</p>
                <p className="text-ink3" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>{label}</p>
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
                <th style={{ textAlign: "center" }}>Pelanggan</th>
                <th style={{ textAlign: "center" }}>Percakapan</th>
                <th style={{ textAlign: "center" }}>Catatan</th>
                <th style={{ textAlign: "center" }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === currentUser?.id;
                const nonaktif = u.active === false;
                return (
                  <tr key={u.id} style={nonaktif ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar name={u.name || u.email} src={u.avatarUrl} size="sm" />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {u.name}
                            {isMe && <span style={{ marginLeft: 6, fontSize: 10, background: "var(--accent-bg)", color: "var(--accent)", fontWeight: 700, padding: "1px 6px", borderRadius: 8 }}>Anda</span>}
                            {nonaktif && <span style={{ marginLeft: 6, fontSize: 10, background: "var(--bg-inset)", color: "var(--text-muted)", fontWeight: 700, padding: "1px 6px", borderRadius: 8 }}>Nonaktif</span>}
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
                        <span className={u._count?.assignedCustomers ? "text-ink" : "text-ink3"} style={{ fontWeight: 700 }}>
                          {u._count?.assignedCustomers || 0}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                        <MessageSquare size={13} color="var(--text-muted)" />
                        <span className={u._count?.assignedConversations ? "text-ink" : "text-ink3"} style={{ fontWeight: 700 }}>
                          {u._count?.assignedConversations || 0}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                        <FileText size={13} color="var(--text-muted)" />
                        <span className={u._count?.notes ? "text-ink" : "text-ink3"} style={{ fontWeight: 700 }}>
                          {u._count?.notes || 0}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <UserRowActions
                        u={u} isMe={isMe}
                        onEditRole={() => { setShowRoleEdit(u); setRoleEditError(""); }}
                        onResetPw={() => { setShowReset(u); setResetPw(""); setShowResetPw(false); }}
                        onToggleActive={() => handleToggleActive(u)}
                        onDelete={() => setShowDelete(u)}
                      />
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
            const nonaktif = u.active === false;
            return (
              <div key={u.id} className="user-card" style={nonaktif ? { opacity: 0.55 } : undefined}>
                <div className="user-card-header">
                  <Avatar name={u.name || u.email} src={u.avatarUrl} size="sm" />
                  <div className="user-card-info">
                    <div className="user-card-name">
                      {u.name}
                      {isMe && <span className="user-card-you">Anda</span>}
                      {nonaktif && <span style={{ marginLeft: 6, fontSize: 10, background: "var(--bg-inset)", color: "var(--text-muted)", fontWeight: 700, padding: "1px 6px", borderRadius: 8 }}>Nonaktif</span>}
                    </div>
                    <div className="user-card-email">{u.email}</div>
                  </div>
                  {/* Kebab di header kartu — pola sama dengan tabel desktop
                      (UserRowActions), bukan lagi baris tombol terpisah di
                      bawah supaya cuma ada SATU implementasi aksi. */}
                  <UserRowActions
                    u={u} isMe={isMe}
                    onEditRole={() => { setShowRoleEdit(u); setRoleEditError(""); }}
                    onResetPw={() => { setShowReset(u); setResetPw(""); setShowResetPw(false); }}
                    onToggleActive={() => handleToggleActive(u)}
                    onDelete={() => setShowDelete(u)}
                  />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0" }}>
                  {effectiveRoles(u).map((role) => <RoleChip key={role} role={role} />)}
                </div>
                <div className="user-card-stats">
                  <span><Users size={12} /> {u._count?.assignedCustomers || 0} pelanggan</span>
                  <span><MessageSquare size={12} /> {u._count?.assignedConversations || 0} percakapan</span>
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
                        borderRadius: 8, border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                        background: checked ? "var(--accent-bg)" : "var(--bg-surface)", cursor: busy ? "wait" : "pointer",
                        textAlign: "left", opacity: busy ? 0.6 : 1,
                      }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                        background: checked ? "var(--accent)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {checked && <Check size={13} color="#fff" />}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>{ROLE_LABELS[role]}</span>
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
              <div style={{ padding: "12px 16px", background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: 8, fontSize: 13, color: "var(--red)" }}>
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
    </PageContainer>
  );
}
