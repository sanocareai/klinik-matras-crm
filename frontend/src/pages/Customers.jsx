import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Download, Contact } from "lucide-react";
import { api } from "../api.js";
import CustomerDrawer from "../components/CustomerDrawer.jsx";
import Pagination from "../components/Pagination.jsx";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import CustomerFilters from "@/features/customers/components/CustomerFilters.jsx";
import CustomersTable from "@/features/customers/components/CustomersTable.jsx";
import CustomerCardList from "@/features/customers/components/CustomerCardList.jsx";
import NewCustomerModal from "@/features/customers/components/NewCustomerModal.jsx";
import BulkActionBar from "@/features/customers/components/BulkActionBar.jsx";
import {
  formatRupiah, STAGE_LABELS, SOURCE_LABELS, HEALTH_COMPLAINT_LABELS,
  ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
} from "../utils/format.js";

// Revisi 27 Jul 2026: halaman ini dulu fetch SELURUH 1.320+ pelanggan (dengan
// relasi order lengkap) sekali di awal, lalu filter/sort/paginasi semuanya di
// browser. Sekarang search/filter/sort/pagination dikirim ke server lewat
// query param (?page=...) — lihat komentar panjang di backend/src/routes/
// customers.js GET / soal kenapa (dan soal 2 caller lama — Pengaturan export
// & mobile PelangganScreen — yang SENGAJA masih dibiarkan pakai jalur lama
// tanpa ?page=).
const DEBOUNCE_MS = 350;

function mapTypeTab(typeTab) {
  if (typeTab === "end-user") return "END_USER";
  if (typeTab === "korporat") return "CORPORATE";
  return undefined;
}

export default function Customers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ all: 0, endUser: 0, korporat: 0 });
  const [users, setUsers] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [typeTab, setTypeTab] = useState("all"); // "all" | "end-user" | "korporat"
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage]   = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterSales, setFilterSales]   = useState("");
  const [filterCity, setFilterCity]     = useState("");
  // "" = semua, "false" = belum dikonfirmasi sales, "true" = sudah. Dipakai
  // widget "Konfirmasi Sumber" di Laporan (deep-link ?confirmed=false).
  const [filterConfirmed, setFilterConfirmed] = useState("");
  // Periode pendaftaran pelanggan — hanya terisi saat masuk dari
  // Laporan > Traffic, supaya jumlah di daftar cocok dengan angka yang
  // barusan diklik di laporan.
  const [filterPeriode, setFilterPeriode] = useState({ from: "", to: "" });
  const [quickChip, setQuickChip]   = useState("");
  const [sortKey, setSortKey]   = useState("updatedAt");
  const [sortDir, setSortDir]   = useState("desc");
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [selected, setSelected] = useState(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);
  // true = "pilih SEMUA yang cocok filter aktif" (lintas halaman, lihat
  // BulkActionBar), bukan cuma baris yang tercentang di `selected`
  // (baris-baris itu cuma representasi visual halaman ini saat mode ini aktif).
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  const [drawerCustomerId, setDrawerCustomerId] = useState(null);

  // Deep-link `?id=` (NotificationDrawer/Notifications — tipe CUSTOMER, lihat
  // features/notifications/notificationTypes.js). CustomerDrawer fetch datanya
  // SENDIRI dari customerId, jadi tidak perlu menunggu daftar pelanggan halaman
  // ini selesai dimuat seperti Orders — buka langsung begitu param ada.
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    setDrawerCustomerId(id);
    setSearchParams((prev) => { prev.delete("id"); return prev; }, { replace: true });
  }, [searchParams, setSearchParams]);

  // Deep-link `?source=` (Laporan > Traffic — klik nama sumber untuk lihat
  // daftar kontaknya) dan `?confirmed=false` (widget "Konfirmasi Sumber" —
  // WHATSAPP_DIRECT yang belum pernah dikoreksi manual sales).
  useEffect(() => {
    const source = searchParams.get("source");
    const confirmed = searchParams.get("confirmed");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!source && confirmed === null && !from) return;
    if (source) setFilterSource(source);
    if (confirmed !== null) setFilterConfirmed(confirmed);
    if (from && to) setFilterPeriode({ from, to });
    setSearchParams((prev) => {
      prev.delete("source"); prev.delete("confirmed"); prev.delete("from"); prev.delete("to");
      return prev;
    }, { replace: true });
  }, [searchParams, setSearchParams]);
  const [showModal, setShowModal]   = useState(false);
  // city DIHAPUS dari form ini (29 Agustus 2026) — lihat catatan di
  // NewCustomerModal.jsx. filterCity di bawah (dropdown "Semua Kota") TIDAK
  // disentuh, itu fitur berbeda (filter tabel Pelanggan, bukan intake).
  const [newForm, setNewForm]       = useState({ name: "", phone: "", instagramHandle: "", leadSource: "OTHER", customerType: "END_USER" });
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState("");

  // Search sekarang memicu request jaringan (bukan filter lokal gratis
  // seperti sebelumnya) — debounce supaya tidak fetch tiap ketikan.
  const debounceRef = useRef(null);
  function handleSearchChange(v) {
    setSearchInput(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(v.trim());
      setPage(1);
    }, DEBOUNCE_MS);
  }
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Sales list & daftar kota — sekali muat, tidak terikat filter/halaman aktif.
  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {});
    api.getCustomerCities().then(setCities).catch(() => {});
  }, []);

  // Kriteria filter AKTIF, terpisah dari page/sort — persis bentuk yang
  // diterima buildCustomerWhere() di backend (routes/customers.js), dipakai
  // juga oleh bulk-reassign supaya "pilih semua yang cocok filter ini"
  // benar-benar filter yang SAMA dengan yang sedang dilihat user.
  const activeFilters = useMemo(() => ({
    search: search || undefined,
    stage: filterStage || undefined,
    source: filterSource || undefined,
    sales: filterSales || undefined,
    city: filterCity || undefined,
    customerType: mapTypeTab(typeTab),
    quickChip: quickChip || undefined,
    confirmed: filterConfirmed || undefined,
    from: filterPeriode.from || undefined,
    to: filterPeriode.to || undefined,
  }), [search, filterStage, filterSource, filterSales, filterCity, typeTab, quickChip, filterConfirmed, filterPeriode]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.getCustomers({
        page, limit: pageSize,
        ...activeFilters,
        sortKey, sortDir,
      });
      setItems(res.items);
      setTotal(res.total);
      setCounts(res.counts);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeFilters, sortKey, sortDir]);

  useEffect(() => { load(); }, [load]);

  // Seleksi baris tidak relevan lintas halaman/filter — kosongkan begitu
  // salah satu berubah supaya tidak ada checkbox "hantu" yang menunjuk
  // pelanggan yang sudah tidak terlihat di halaman ini. selectAllMatching
  // ikut direset karena "semua yang cocok filter LAMA" tidak lagi berarti
  // apa-apa begitu filternya berubah.
  useEffect(() => { setSelected(new Set()); setSelectAllMatching(false); }, [page, activeFilters]);

  // role SALES lewat kolom lama ATAU peran tambahan SALES (D-010, mis.
  // admin/leader yang kadang turun tangan jualan sendiri).
  const salesUsers = useMemo(() => users.filter((u) =>
    (Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role]).includes("SALES")
  ), [users]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  function resetAllFilters() {
    setSearchInput(""); setSearch("");
    setFilterStage(""); setFilterSource("");
    setFilterSales(""); setFilterCity(""); setQuickChip("");
    setFilterConfirmed("");
    setFilterPeriode({ from: "", to: "" });
    setPage(1);
  }

  // Setiap perubahan filter WAJIB reset ke halaman 1 — kalau tidak, user bisa
  // terjebak di halaman 5 padahal hasil filter cuma 1 halaman (tampak kosong).
  const withReset = (setter) => (v) => { setter(v); setPage(1); };

  const hasFilters = search || filterStage || filterSource || filterSales || filterCity || quickChip || filterConfirmed || filterPeriode.from;
  const emptyMessage = hasFilters || typeTab !== "all"
    ? "Tidak ada pelanggan yang cocok dengan filter."
    : "Belum ada pelanggan.";

  function handleDrawerUpdated(updated) {
    setItems((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      await api.createCustomer(newForm);
      setShowModal(false);
      setNewForm({ name: "", phone: "", instagramHandle: "", leadSource: "OTHER", customerType: "END_USER" });
      load(); // refetch — supaya total/urutan/halaman tetap benar dari server
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // Export sekarang TIDAK bisa lagi memetakan `filtered` di browser (cuma
  // halaman aktif yang dimuat). Panggil endpoint yang sama TANPA `page` —
  // otomatis balik ke jalur lama (array polos, SEMUA baris cocok filter,
  // tidak dipotong halaman) sambil tetap kirim filter yang sedang aktif.
  async function handleExport() {
    const { exportToExcel } = await import("../utils/export.js");
    try {
      const rows = await api.getCustomers({
        search: search || undefined,
        stage: filterStage || undefined,
        source: filterSource || undefined,
        sales: filterSales || undefined,
        city: filterCity || undefined,
        customerType: mapTypeTab(typeTab),
        quickChip: quickChip || undefined,
        confirmed: filterConfirmed || undefined,
        from: filterPeriode.from || undefined,
        to: filterPeriode.to || undefined,
      });
      const data = rows.map((c) => ({
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
        // Dibaca dari Order.healthStatus (pernahSakit), BUKAN Customer.healthStatus
        // lama — lihat catatan di routes/customers.js.
        "Status Kesehatan": c.pernahSakit ? "Sakit" : "Tidak/Belum Diisi",
        "Kategori Keluhan": (c.complaintCategory || []).map((k) => HEALTH_COMPLAINT_LABELS[k] || k).join(", "),
        Tags: c.tags?.join(", ") || "",
        "Tipe Pelanggan": c.customerType === "CORPORATE" ? "Korporat" : "End User",
        Kota: c.city || "",
        "Sumber Lead": SOURCE_LABELS[c.leadSource] || c.leadSource || "",
        "Detail Iklan": c.leadSourceDetail || "",
        "Jumlah Order": c.orderCount || 0,
        "Total Nilai Order": formatRupiah(c.orderValue || 0),
        "Pernah Komplain": c.pernahKomplain ? "Ya" : "Tidak",
        "Sales Person": c.assignedSales?.name || "",
      }));
      exportToExcel(data, `pelanggan-${typeTab}-${new Date().toISOString().slice(0, 10)}`);
    } catch (err) {
      alert("Gagal export: " + err.message);
    }
  }

  // Unduh .vcf untuk diimpor ke buku alamat HP — SATU ARAH & MANUAL, bukan
  // sinkron otomatis ke WhatsApp. Lihat catatan panjang di
  // backend/src/services/vcard.js soal kenapa itu tidak mungkin lewat WAHA.
  const [exportingVCard, setExportingVCard] = useState(false);
  async function handleExportVCard() {
    setExportingVCard(true);
    try {
      // Filter yang SEDANG AKTIF di layar — "ekspor kontak ini" berarti
      // persis yang sedang dilihat, sama seperti Export Excel.
      const { blob, namaFile } = await api.exportCustomersVCard(activeFilters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = namaFile;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    } finally {
      setExportingVCard(false);
    }
  }

  // Bulk assign sales — DUA jalur:
  // - selectAllMatching: SEMUA pelanggan yang cocok filter aktif (lintas
  //   halaman, bisa ratusan) → 1 request ke POST /customers/bulk-reassign
  //   (updateMany di DB langsung, lihat catatan di routes/customers.js).
  // - selected biasa: cuma baris yang tercentang di halaman ini (wajar
  //   puluhan) → loop api.updateCustomer per id seperti sebelumnya.
  async function handleBulkAssign(salesId) {
    setBulkAssigning(true);
    try {
      if (selectAllMatching) {
        const { count } = await api.bulkReassignCustomers(activeFilters, salesId);
        setSelected(new Set());
        setSelectAllMatching(false);
        await load();
        alert(`${count} pelanggan berhasil dipindahkan.`);
        return;
      }
      const results = await Promise.allSettled(
        [...selected].map((id) => api.updateCustomer(id, { assignedSalesId: salesId }))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      setSelected(new Set());
      await load();
      if (failed > 0) alert(`${failed} pelanggan gagal di-assign, sisanya berhasil.`);
    } catch (err) {
      alert("Gagal memindahkan pelanggan: " + err.message);
    } finally {
      setBulkAssigning(false);
    }
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((c) => c.id))));
  }
  function toggleSelectOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Pelanggan"
        subtitle={loading ? "Memuat data pelanggan…" : `${total.toLocaleString("id-ID")} pelanggan`}
        actions={
          <>
            <Button variant="ghost" onClick={handleExport} disabled={loading}>
              <Download size={15} /> Export Excel
            </Button>
            {/* .vcf untuk diimpor ke buku alamat HP — supaya nama di CRM
                ikut muncul di WhatsApp sales. Satu arah & manual, lihat
                tooltip. */}
            <Button
              variant="ghost"
              onClick={handleExportVCard}
              disabled={loading || exportingVCard}
              title="Unduh kontak lalu impor ke buku alamat HP — TIDAK otomatis sinkron, harus diimpor ulang kalau ada nama baru"
            >
              <Contact size={15} /> {exportingVCard ? "Membuat..." : "Kontak (.vcf)"}
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
          search={searchInput} onSearch={handleSearchChange}
          filterStage={filterStage} onFilterStage={withReset(setFilterStage)}
          filterSource={filterSource} onFilterSource={withReset(setFilterSource)}
          filterCity={filterCity} onFilterCity={withReset(setFilterCity)}
          filterSales={filterSales} onFilterSales={withReset(setFilterSales)}
          cities={cities} salesUsers={salesUsers}
          hasFilters={hasFilters} onReset={resetAllFilters}
        />

        {/* Penanda periode aktif — filter tanggal datang dari deep-link
            Laporan dan TIDAK punya kontrolnya sendiri di halaman ini, jadi
            tanpa penanda ini daftar terlihat "kurang" tanpa sebab yang
            jelas. Bisa dilepas satu klik. */}
        {filterPeriode.from && (
          <div className="mb-3 flex items-center gap-2 rounded-btn bg-inset px-3 py-2 text-[12.5px]">
            <span className="text-ink2">
              Menampilkan pelanggan yang masuk <strong className="text-ink">{filterPeriode.from}</strong> s/d{" "}
              <strong className="text-ink">{filterPeriode.to}</strong> (dari Laporan)
            </span>
            <button
              onClick={() => { setFilterPeriode({ from: "", to: "" }); setPage(1); }}
              className="ml-auto shrink-0 font-semibold text-accent hover:underline"
            >
              Tampilkan semua periode
            </button>
          </div>
        )}

        {selected.size > 0 && (
          <BulkActionBar
            count={selectAllMatching ? total : selected.size}
            selectAllMatching={selectAllMatching}
            // Tawaran "pilih semua yang cocok filter" cuma masuk akal kalau
            // seluruh baris DI HALAMAN INI sudah tercentang (kalau baru
            // sebagian, "pilih semua" belum tentu maksud user) DAN memang
            // ada lebih banyak di halaman lain.
            canSelectAllMatching={!selectAllMatching && selected.size === items.length && total > items.length}
            totalMatching={total}
            salesUsers={salesUsers}
            busy={bulkAssigning}
            onAssign={handleBulkAssign}
            onSelectAllMatching={() => setSelectAllMatching(true)}
            onClear={() => { setSelected(new Set()); setSelectAllMatching(false); }}
          />
        )}

        {loadError && (
          <p className="rounded-lg bg-red/10 px-3 py-2 text-[13px] text-red">
            Gagal memuat data pelanggan: {loadError}
          </p>
        )}

        {/* Desktop tabel (hidden md:block) & mobile kartu (md:hidden) — aturan
            breakpoint ada DI komponen masing-masing, bukan di index.css. */}
        <CustomersTable
          rows={items} loading={loading} emptyMessage={emptyMessage}
          sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
          onOpen={setDrawerCustomerId}
          selected={selected} onToggleSelect={toggleSelectOne}
          allSelected={items.length > 0 && selected.size === items.length}
          onToggleSelectAll={toggleSelectAll}
        />
        <CustomerCardList
          rows={items} loading={loading} emptyMessage={emptyMessage}
          onOpen={setDrawerCustomerId}
        />

        {!loading && total > 0 && (
          <Pagination
            page={page} pageSize={pageSize} total={total}
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
