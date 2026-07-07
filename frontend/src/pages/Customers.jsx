import React, { useEffect, useState, useMemo } from "react";
import { Search, Plus, X, Download, ArrowUp, ArrowDown, Users, Building2, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import CustomerDrawer from "../components/CustomerDrawer.jsx";
import Pagination from "../components/Pagination.jsx";
import {
  formatRupiah, formatPhoneDisplay, STAGE_LABELS, SOURCE_LABELS, LEAD_SOURCES,
  PIPELINE_STAGES, tagClass, isVIP, daysSinceLastChat, KOTA_LIST,
  ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
} from "../utils/format.js";
import { exportToExcel } from "../utils/export.js";

// Pelanggan "Korporat" = berdasarkan field customerType (bukan tag)
const isKorporat = (c) => c.customerType === "CORPORATE";

const ORDER_STATUS_STYLE = {
  PENDING:    { background: "#fef3c7", color: "#92400e" },
  PICKUP:     { background: "#dbeafe", color: "#1e40af" },
  PROCESSING: { background: "#ede9fe", color: "#5b21b6" },
  READY:      { background: "#ccfbf1", color: "#065f46" },
  DELIVERED:  { background: "#dcfce7", color: "#166534" },
  CANCELLED:  { background: "#fee2e2", color: "#991b1b" },
};

export default function Customers() {
  const [customers, setCustomers]   = useState([]);
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);

  // Customer type tab
  const [typeTab, setTypeTab]       = useState("all"); // "all" | "end-user" | "korporat"

  // Filters
  const [search, setSearch]         = useState("");
  const [filterStage, setFilterStage]   = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterSales, setFilterSales]   = useState("");
  const [filterCity, setFilterCity]     = useState("");
  const [quickChip, setQuickChip]   = useState("");

  // Sort
  const [sortKey, setSortKey]   = useState("updatedAt");
  const [sortDir, setSortDir]   = useState("desc");

  // Pagination
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Drawer + modal
  const [drawerCustomerId, setDrawerCustomerId] = useState(null);
  const [showModal, setShowModal]   = useState(false);
  const [newForm, setNewForm]       = useState({ name: "", phone: "", instagramHandle: "", city: "", leadSource: "OTHER", customerType: "END_USER" });
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    Promise.all([api.getCustomers(), api.getUsers()]).then(([c, u]) => {
      setCustomers(c);
      setUsers(u);
      setLoading(false);
    });
  }, []);

  // Unique cities for dropdown
  const cities = useMemo(() => {
    const s = new Set(customers.map((c) => c.city).filter(Boolean));
    return [...s].sort();
  }, [customers]);

  // Count per tab
  const countAll      = customers.length;
  const countEndUser  = customers.filter((c) => !isKorporat(c)).length;
  const countKorporat = customers.filter(isKorporat).length;

  const filtered = useMemo(() => {
    let list = customers.filter((c) => {
      // Customer type tab
      if (typeTab === "end-user"  && isKorporat(c)) return false;
      if (typeTab === "korporat"  && !isKorporat(c)) return false;

      const q = search.toLowerCase();
      const matchSearch = !q ||
        c.name?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.instagramHandle?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q);
      const matchStage  = !filterStage  || c.pipelineStage === filterStage;
      const matchSource = !filterSource || c.leadSource    === filterSource;
      const matchSales  = !filterSales  || c.assignedSalesId === filterSales;
      const matchCity   = !filterCity   || c.city === filterCity;

      let matchChip = true;
      if (quickChip === "vip")      matchChip = isVIP(c);
      if (quickChip === "no-order") matchChip = (c.orderCount || 0) === 0;
      if (quickChip === "inactive") matchChip = daysSinceLastChat(c.lastMessageAt) > 30;

      return matchSearch && matchStage && matchSource && matchSales && matchCity && matchChip;
    });

    list = [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string") av = av?.toLowerCase() || "";
      if (typeof bv === "string") bv = bv?.toLowerCase() || "";
      av = av ?? ""; bv = bv ?? "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [customers, typeTab, search, filterStage, filterSource, filterSales, filterCity, quickChip, sortKey, sortDir]);

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  }

  function resetAllFilters() {
    setSearch(""); setFilterStage(""); setFilterSource("");
    setFilterSales(""); setFilterCity(""); setQuickChip(""); setPage(1);
  }

  const hasFilters = search || filterStage || filterSource || filterSales || filterCity || quickChip;

  function handleDrawerUpdated(updated) {
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      const c = await api.createCustomer(newForm);
      setCustomers((prev) => [{ ...c, orderCount: 0, orderValue: 0 }, ...prev]);
      setShowModal(false);
      setNewForm({ name: "", phone: "", instagramHandle: "", city: "", leadSource: "OTHER", customerType: "END_USER" });
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleExport() {
    const HEALTH_LABELS = { SAKIT: "Sakit", TIDAK_SAKIT: "Tidak Sakit" };
    const data = filtered.map((c) => ({
      /* Urutan kolom cocok dengan urutan tabel di halaman */
      "Nama Pelanggan": c.name || c.phone || c.instagramHandle || "",
      "ID Order": c.latestOrderNumber || "",
      "No HP": c.phone || "",
      Instagram: c.instagramHandle ? "@" + c.instagramHandle : "",
      Email: c.email || "",
      Pipeline: STAGE_LABELS[c.pipelineStage] || c.pipelineStage || "",
      "Status Order": ORDER_STATUS_LABELS[c.latestOrderStatus] || (c.latestOrderStatus ? c.latestOrderStatus : "Belum Ada Order"),
      "Status Pembayaran": PAYMENT_STATUS_LABELS[c.latestPaymentStatus] || "",
      "Keluhan Terbaru": c.latestKeluhan || "",
      "Merk Kasur": c.latestMerkKasur || "",
      "Ukuran Kasur": c.latestUkuranKasur || "",
      "Berat Badan (kg)": c.latestBeratBadan || "",
      Layanan: c.latestLayanan || "",
      "Status Kesehatan": HEALTH_LABELS[c.healthStatus] || "Belum Diisi",
      Tags: c.tags?.join(", ") || "",
      "Tipe Pelanggan": c.customerType === "CORPORATE" ? "Korporat" : "End User",
      Kota: c.city || "",
      "Sumber Lead": SOURCE_LABELS[c.leadSource] || c.leadSource || "",
      "Jumlah Order": c.orderCount || 0,
      "Total Nilai Order": formatRupiah(c.orderValue || 0),
      "Pernah Komplain": c.pernahKomplain ? "Ya" : "Tidak",
      "Sales Person": c.assignedSales?.name || "",
    }));
    exportToExcel(data, `pelanggan-${typeTab}-${new Date().toISOString().slice(0, 10)}`);
  }

  if (loading) return <div className="page-loading">Memuat data pelanggan...</div>;

  return (
    <div className="customers-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Pelanggan</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            {filtered.length} dari {customers.length} pelanggan
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={handleExport}>
            <Download size={15} /> Export Excel
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Pelanggan Baru
          </button>
        </div>
      </div>

      {/* Customer Type Tabs */}
      <div className="customer-type-tabs">
        <button className={`customer-type-tab ${typeTab === "all" ? "active" : ""}`}
          onClick={() => { setTypeTab("all"); setPage(1); }}>
          <Users size={15} /> Semua
          <span className="tab-count">{countAll}</span>
        </button>
        <button className={`customer-type-tab ${typeTab === "end-user" ? "active" : ""}`}
          onClick={() => { setTypeTab("end-user"); setPage(1); }}>
          <Users size={15} /> End User
          <span className="tab-count">{countEndUser}</span>
        </button>
        <button className={`customer-type-tab ${typeTab === "korporat" ? "active" : ""}`}
          onClick={() => { setTypeTab("korporat"); setPage(1); }}>
          <Building2 size={15} /> Korporat
          <span className="tab-count">{countKorporat}</span>
        </button>
      </div>

      {/* Quick chips */}
      <div className="quick-chips">
        <button className={`quick-chip chip-vip ${quickChip === "vip" ? "active" : ""}`}
          onClick={() => { setQuickChip(quickChip === "vip" ? "" : "vip"); setPage(1); }}>
          VIP (≥ Rp5jt)
        </button>
        <button className={`quick-chip chip-noorder ${quickChip === "no-order" ? "active" : ""}`}
          onClick={() => { setQuickChip(quickChip === "no-order" ? "" : "no-order"); setPage(1); }}>
          Belum Order
        </button>
        <button className={`quick-chip chip-inactive ${quickChip === "inactive" ? "active" : ""}`}
          onClick={() => { setQuickChip(quickChip === "inactive" ? "" : "inactive"); setPage(1); }}>
          Tidak Aktif (&gt;30 hari)
        </button>
      </div>

      {/* Toolbar */}
      <div className="customers-toolbar">
        <div className="search-input-wrap">
          <Search size={15} className="search-icon" />
          <input className="search-input" placeholder="Cari nama, nomor, email, atau Instagram..."
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>

        <div className="filter-group">
          <select className="filter-select" value={filterStage} onChange={(e) => { setFilterStage(e.target.value); setPage(1); }}>
            <option value="">Semua Stage</option>
            {PIPELINE_STAGES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          <select className="filter-select" value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}>
            <option value="">Semua Sumber</option>
            {LEAD_SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          <select className="filter-select" value={filterCity} onChange={(e) => { setFilterCity(e.target.value); setPage(1); }}>
            <option value="">Semua Kota</option>
            {cities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>

          <select className="filter-select" value={filterSales} onChange={(e) => { setFilterSales(e.target.value); setPage(1); }}>
            <option value="">Semua Sales Person</option>
            {users.filter((u) => u.role === "SALES").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>

          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={resetAllFilters}>
              <X size={14} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="customer-table">
          <thead>
            <tr>
              {/* Urutan wajib: Nama → ID Order → No HP → Pipeline → Status Order → Keluhan → Sakit/Tidak Sakit → Tags */}
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("name")}>
                Nama Pelanggan <SortIcon col="name" />
              </th>
              <th>ID Order</th>
              <th>No HP</th>
              <th>Pipeline</th>
              <th>Status Order</th>
              <th>Keluhan</th>
              <th>Sakit/Tidak Sakit</th>
              <th>Tags</th>
              {/* Kolom tambahan */}
              <th>Tipe</th>
              <th>Kota</th>
              <th>Order</th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("orderValue")}>
                Nilai Order <SortIcon col="orderValue" />
              </th>
              <th>Sales Person</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((c) => {
              const displayName = c.name || c.phone || c.instagramHandle || "—";
              const korporat = isKorporat(c);
              return (
                <tr key={c.id} onClick={() => setDrawerCustomerId(c.id)} style={{ cursor: "pointer" }}>
                  {/* 1. Nama Pelanggan */}
                  <td>
                    <div className="cell-name-wrap">
                      <Avatar name={displayName} src={c.profilePictureUrl} size="sm" />
                      <div>
                        <div className="cell-name" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {displayName}
                          {c.pernahKomplain && (
                            <AlertTriangle size={12} color="#dc2626" title="Pernah komplain" />
                          )}
                        </div>
                        {isVIP(c) && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "#ede9fe", padding: "1px 6px", borderRadius: 10 }}>VIP</span>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* 2. ID Order */}
                  <td style={{ fontSize: 13 }}>
                    {c.latestOrderNumber || <span className="muted">—</span>}
                  </td>
                  {/* 3. No HP */}
                  <td>
                    {c.phone && <div style={{ fontSize: 13 }}>{c.phone}</div>}
                    {c.instagramHandle && <div className="cell-sub">@{c.instagramHandle}</div>}
                    {!c.phone && !c.instagramHandle && <span className="muted">—</span>}
                  </td>
                  {/* 4. Pipeline */}
                  <td>
                    <span className={`stage-badge stage-${c.pipelineStage?.toLowerCase()}`}>
                      {STAGE_LABELS[c.pipelineStage] || c.pipelineStage}
                    </span>
                  </td>
                  {/* 5. Status Order */}
                  <td>
                    {c.latestOrderStatus ? (
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6, ...ORDER_STATUS_STYLE[c.latestOrderStatus] }}>
                        {ORDER_STATUS_LABELS[c.latestOrderStatus] || c.latestOrderStatus}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {/* 6. Keluhan */}
                  <td style={{ fontSize: 13, maxWidth: 180 }}>
                    {c.latestKeluhan ? (
                      <span title={c.latestKeluhan} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
                        {c.latestKeluhan}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {/* 7. Sakit/Tidak Sakit */}
                  <td>
                    {c.healthStatus === "SAKIT" && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "#fee2e2", color: "#991b1b" }}>Sakit</span>
                    )}
                    {c.healthStatus === "TIDAK_SAKIT" && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "#dcfce7", color: "#166534" }}>Tidak Sakit</span>
                    )}
                    {!c.healthStatus && <span className="muted">—</span>}
                  </td>
                  {/* 8. Tags */}
                  <td>
                    {c.tags?.length > 0
                      ? c.tags.slice(0, 3).map((t) => (
                          <span key={t} className={`tag-chip ${tagClass(t)}`}>{t}</span>
                        ))
                      : <span className="muted">—</span>
                    }
                    {c.tags?.length > 3 && <span className="muted" style={{ fontSize: 11 }}> +{c.tags.length - 3}</span>}
                  </td>
                  {/* 9+ Kolom tambahan */}
                  <td>
                    <span style={{
                      fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                      background: korporat ? "#ede9fe" : "#f0fdf4",
                      color: korporat ? "#5b21b6" : "#166534",
                    }}>
                      {korporat ? "Korporat" : "End User"}
                    </span>
                  </td>
                  <td>{c.city || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: "center" }}>{c.orderCount}</td>
                  <td>{formatRupiah(c.orderValue)}</td>
                  <td>{c.assignedSales?.name || <span className="muted">—</span>}</td>
                  <td onClick={(e) => { e.stopPropagation(); setDrawerCustomerId(c.id); }}>
                    <button className="btn btn-ghost btn-sm">Lihat</button>
                  </td>
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={14} style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                  {hasFilters || typeTab !== "all"
                    ? "Tidak ada pelanggan yang cocok dengan filter."
                    : "Belum ada pelanggan."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Card list — tampil hanya di mobile via CSS (.customer-card-list { display: none } di desktop) */}
      <div className="customer-card-list">
        {paginated.length === 0 ? (
          <p style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)" }}>
            {hasFilters || typeTab !== "all" ? "Tidak ada pelanggan yang cocok." : "Belum ada pelanggan."}
          </p>
        ) : paginated.map((c) => {
          const displayName = c.name || formatPhoneDisplay(c.phone) || c.instagramHandle || "?";
          return (
            <div key={c.id} className="customer-card-item" onClick={() => setDrawerCustomerId(c.id)}>
              <div className="customer-card-header">
                <Avatar name={displayName} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="customer-card-name">{displayName}</div>
                  <div className="customer-card-sub">
                    {formatPhoneDisplay(c.phone) || (c.instagramHandle ? "@" + c.instagramHandle : "—")}
                  </div>
                </div>
                <span className={`stage-badge stage-${(c.pipelineStage || "lead").toLowerCase()}`}>
                  {STAGE_LABELS[c.pipelineStage] || c.pipelineStage || "—"}
                </span>
              </div>
              <div className="customer-card-body">
                <span>{c.city || "Kota belum diisi"}</span>
                <span>{c.orderCount || 0} order · {formatRupiah(c.orderValue || 0)}</span>
              </div>
              {c.tags?.length > 0 && (
                <div className="customer-card-tags">
                  {c.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className={`tag-chip ${tagClass(tag)}`}>{tag}</span>
                  ))}
                  {c.tags.length > 3 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>+{c.tags.length - 3}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Pagination page={page} pageSize={pageSize} total={filtered.length}
        onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />

      {drawerCustomerId && (
        <CustomerDrawer customerId={drawerCustomerId}
          onClose={() => setDrawerCustomerId(null)} onUpdated={handleDrawerUpdated} />
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tambah Pelanggan Baru</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tipe Pelanggan</label>
                  <select value={newForm.customerType} onChange={(e) => setNewForm((f) => ({ ...f, customerType: e.target.value }))}>
                    <option value="END_USER">End User (B2C)</option>
                    <option value="CORPORATE">Korporat (B2B)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Nama</label>
                  <input type="text" placeholder="Nama pelanggan / perusahaan" value={newForm.name}
                    onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nomor WhatsApp</label>
                  <input type="text" placeholder="628xxxx" value={newForm.phone}
                    onChange={(e) => setNewForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Username Instagram</label>
                  <input type="text" placeholder="tanpa @" value={newForm.instagramHandle}
                    onChange={(e) => setNewForm((f) => ({ ...f, instagramHandle: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" placeholder="email@perusahaan.com" value={newForm.email || ""}
                    onChange={(e) => setNewForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Kota</label>
                  <select value={newForm.city} onChange={(e) => setNewForm((f) => ({ ...f, city: e.target.value }))}>
                    <option value="">— Pilih Kota —</option>
                    {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Sumber Lead</label>
                  <select value={newForm.leadSource} onChange={(e) => setNewForm((f) => ({ ...f, leadSource: e.target.value }))}>
                    {LEAD_SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                {createError && <p style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 8px" }}>{createError}</p>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? "Menyimpan..." : "Tambah Pelanggan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
