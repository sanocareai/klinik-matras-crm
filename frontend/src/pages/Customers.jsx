import React, { useEffect, useState, useMemo } from "react";
import { Plus, Download } from "lucide-react";
import { api } from "../api.js";
import CustomerDrawer from "../components/CustomerDrawer.jsx";
import Pagination from "../components/Pagination.jsx";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import CustomerFilters from "@/features/customers/components/CustomerFilters.jsx";
import CustomersTable from "@/features/customers/components/CustomersTable.jsx";
import CustomerCardList from "@/features/customers/components/CustomerCardList.jsx";
import NewCustomerModal from "@/features/customers/components/NewCustomerModal.jsx";
import {
  formatRupiah, STAGE_LABELS, SOURCE_LABELS, HEALTH_LABELS,
  isVIP, daysSinceLastChat, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
} from "../utils/format.js";
// Lazy — xlsx + file-saver di balik exportToExcel() cukup besar (~285KB),
// dynamic import() di titik pakai (bukan static import di atas) supaya
// hanya diunduh saat tombol Export BENAR-BENAR diklik, bukan ikut terbawa
// tiap kali halaman ini dibuka.

// Pelanggan "Korporat" = berdasarkan field customerType (bukan tag)
const isKorporat = (c) => c.customerType === "CORPORATE";

// Wave 5B: halaman ini sekarang ORKESTRATOR — seluruh presentasi pindah ke
// features/customers/components/*. Semua state & logika filter/sort tetap DI
// SINI (komponen anak controlled), jadi tidak ada sumber kebenaran kedua.
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

  const salesUsers = useMemo(() => users.filter((u) => u.role === "SALES"), [users]);

  const counts = useMemo(() => ({
    all:      customers.length,
    endUser:  customers.filter((c) => !isKorporat(c)).length,
    korporat: customers.filter(isKorporat).length,
  }), [customers]);

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

  function resetAllFilters() {
    setSearch(""); setFilterStage(""); setFilterSource("");
    setFilterSales(""); setFilterCity(""); setQuickChip(""); setPage(1);
  }

  const hasFilters = search || filterStage || filterSource || filterSales || filterCity || quickChip;

  // Setiap perubahan filter WAJIB reset ke halaman 1 — kalau tidak, user bisa
  // terjebak di halaman 5 padahal hasil filter cuma 1 halaman (tampak kosong).
  const withReset = (setter) => (v) => { setter(v); setPage(1); };

  const emptyMessage = hasFilters || typeTab !== "all"
    ? "Tidak ada pelanggan yang cocok dengan filter."
    : "Belum ada pelanggan.";

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

  async function handleExport() {
    const { exportToExcel } = await import("../utils/export.js");
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
      // HEALTH_LABELS diimpor dari utils/format.js — sebelumnya didefinisikan
      // ulang secara lokal di fungsi ini, salinan yang bisa drift.
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

  return (
    <PageContainer>
      <PageHeader
        title="Pelanggan"
        subtitle={loading ? "Memuat data pelanggan…" : `${filtered.length} dari ${customers.length} pelanggan`}
        actions={
          <>
            <Button variant="ghost" onClick={handleExport} disabled={loading}>
              <Download size={15} /> Export Excel
            </Button>
            <Button onClick={() => setShowModal(true)}>
              <Plus size={16} /> Pelanggan Baru
            </Button>
          </>
        }
      />

      <PageBody>
        <CustomerFilters
          typeTab={typeTab} onTypeTab={withReset(setTypeTab)} counts={counts}
          quickChip={quickChip} onQuickChip={withReset(setQuickChip)}
          search={search} onSearch={withReset(setSearch)}
          filterStage={filterStage} onFilterStage={withReset(setFilterStage)}
          filterSource={filterSource} onFilterSource={withReset(setFilterSource)}
          filterCity={filterCity} onFilterCity={withReset(setFilterCity)}
          filterSales={filterSales} onFilterSales={withReset(setFilterSales)}
          cities={cities} salesUsers={salesUsers}
          hasFilters={hasFilters} onReset={resetAllFilters}
        />

        {/* Desktop tabel (hidden md:block) & mobile kartu (md:hidden) — aturan
            breakpoint ada DI komponen masing-masing, bukan di index.css. */}
        <CustomersTable
          rows={paginated} loading={loading} emptyMessage={emptyMessage}
          sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
          onOpen={setDrawerCustomerId}
        />
        <CustomerCardList
          rows={paginated} loading={loading} emptyMessage={emptyMessage}
          onOpen={setDrawerCustomerId}
        />

        {!loading && filtered.length > 0 && (
          <Pagination
            page={page} pageSize={pageSize} total={filtered.length}
            onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }}
          />
        )}
      </PageBody>

      {drawerCustomerId && (
        <CustomerDrawer customerId={drawerCustomerId}
          onClose={() => setDrawerCustomerId(null)} onUpdated={handleDrawerUpdated} />
      )}

      <NewCustomerModal
        open={showModal}
        onOpenChange={setShowModal}
        form={newForm}
        onForm={setNewForm}
        onSubmit={handleCreate}
        submitting={creating}
        error={createError}
      />
    </PageContainer>
  );
}
