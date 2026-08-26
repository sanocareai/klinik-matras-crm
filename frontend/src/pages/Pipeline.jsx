import React, { useEffect, useState, useRef, useMemo } from "react";
import { Download, RefreshCw, Search, X, AlertTriangle, LayoutGrid, List } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import {
  formatRupiah, formatRupiahShort, STAGE_LABELS, PIPELINE_STAGES,
  stageVariant, ORDER_STATUS_LABELS, orderStatusVariant,
} from "../utils/format.js";
import { useCountUp } from "../hooks/useCountUp.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableEmptyRow } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import KanbanCard, { STAGE_DOT, isStale } from "@/features/pipeline/components/KanbanCard.jsx";
import { rolesOf } from "@/lib/roles.js";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "../lib/dateRange.js";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";
// Lazy — lihat catatan yang sama di Customers.jsx: exportToExcel() (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.

// Konsolidasi 24 Agustus 2026 (restrukturisasi pipeline 7→4): daftar stage
// SEBELUMNYA hardcode lokal di sini (duplikat dari format.js) — sekarang
// diambil dari PIPELINE_STAGES supaya cuma ada SATU sumber kebenaran.
const STAGES = PIPELINE_STAGES.map((p) => p.value);

// Kartu yang dirender per kolom sebelum tombol "Muat lebih banyak".
//
// ⚠️ INI BUKAN SEKADAR SOAL RAPI — ini bug nyata yang diperbaiki. Kolom "New"
// di produksi berisi 1.158 pelanggan; merender semuanya membuat halaman
// panjangnya puluhan ribu piksel, jadi mencari satu customer berarti scroll
// sangat panjang dan kembali ke atas juga scroll panjang. Ditambah 1.158 node
// DOM + drag handler per kartu bikin halaman berat.
const BATCH = 20;

// Total nilai per kolom, dengan count-up saat berubah. Dipisah jadi komponen
// sendiri karena useCountUp adalah hook — tidak boleh dipanggil di dalam
// loop .map() di komponen induk. Count-up ini yang membuat "dampak uang"
// dari memindahkan deal terlihat (sano-animation-guidelines.md §3.6).
function ColumnTotal({ value }) {
  const animated = useCountUp(value);
  return (
    <span className="text-[13px] font-bold tabular-nums text-ink">
      {formatRupiah(Math.round(animated))}
    </span>
  );
}

// Mode "Tabel" (26 Agustus 2026, permintaan owner) — flatten SEMUA stage jadi
// satu daftar yang bisa di-sort & dibandingkan lintas kolom (Kanban memisah
// per kolom, jadi tidak bisa langsung urutkan "siapa yang paling lama mandek
// di SELURUH pipeline" atau "deal terbesar di stage apa pun"). Filter
// pencarian/sales/mandek yang sama dari toolbar di atas tetap berlaku (rows
// sudah difilter sebelum sampai ke sini — lihat `semuaBaris` di Pipeline()).
// TABLE_BATCH lebih besar dari BATCH Kanban (20) — baris tabel jauh lebih
// ringan per-item (tanpa drag handler, tanpa animasi masuk) daripada
// KanbanCard, tapi TETAP dibatasi: kolom "New" pernah berisi 1.158
// pelanggan sendirian (lihat catatan BATCH di atas), dan merender semua
// baris itu sekaligus dalam SATU <table> akan reproduksi persis bug lama
// (DOM berat, halaman lag) yang batching Kanban sudah perbaiki.
const TABLE_BATCH = 100;

function PipelineTableView({ rows, sortKey, sortDir, onSort, onOpenRow, onMoveToStage, adaFilter }) {
  const [limit, setLimit] = useState(TABLE_BATCH);
  // Reset paging setiap kali hasil filter/sort berubah — tanpa ini, ganti
  // filter ke hasil yang lebih kecil bisa meninggalkan `limit` dari sesi
  // sebelumnya yang sudah tidak relevan (bukan bug besar, tapi state basi).
  useEffect(() => { setLimit(TABLE_BATCH); }, [rows]);

  const tampil = rows.slice(0, limit);
  const sisa = rows.length - tampil.length;

  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH sortable sortDir={sortKey === "name" ? sortDir : null} onSort={() => onSort("name")}>Pelanggan</TH>
              <TH sortable sortDir={sortKey === "stage" ? sortDir : null} onSort={() => onSort("stage")}>Stage</TH>
              <TH sortable sortDir={sortKey === "city" ? sortDir : null} onSort={() => onSort("city")}>Kota</TH>
              <TH>Sales</TH>
              <TH>Status Order</TH>
              <TH numeric sortable sortDir={sortKey === "daysSince" ? sortDir : null} onSort={() => onSort("daysSince")}>
                Hari di Stage
              </TH>
              <TH numeric sortable sortDir={sortKey === "totalValue" ? sortDir : null} onSort={() => onSort("totalValue")}>
                Total Nilai
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 && (
              <TableEmptyRow colSpan={7}>
                {adaFilter ? "Tidak ada yang cocok dengan filter" : "Belum ada pelanggan di pipeline"}
              </TableEmptyRow>
            )}
            {tampil.map((r) => {
              const stale = isStale(r, r.stage);
              return (
                <TR key={r.id} clickable onClick={() => onOpenRow(r)}>
                  <TD>
                    <p className="font-semibold text-ink">{r.name || "—"}</p>
                    {r.phone && <p className="text-[11px] text-ink3">{r.phone}</p>}
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <select
                      value={r.stage}
                      onChange={(e) => onMoveToStage(r, e.target.value)}
                      className="rounded-chip border-none bg-transparent p-0 text-[11px] font-medium uppercase tracking-[0.05em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      {PIPELINE_STAGES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <Badge variant={stageVariant(r.stage)} className="mt-1 block w-fit">
                      {STAGE_LABELS[r.stage] || r.stage}
                    </Badge>
                  </TD>
                  <TD>{r.city || "—"}</TD>
                  <TD>{r.assignedSales?.name || "—"}</TD>
                  <TD>
                    {r.latestOrderStatus
                      ? <Badge variant={orderStatusVariant(r.latestOrderStatus)}>{ORDER_STATUS_LABELS[r.latestOrderStatus] || r.latestOrderStatus}</Badge>
                      : "—"}
                  </TD>
                  <TD numeric>
                    <span className={stale ? "font-semibold text-orange" : undefined}>{r.daysSince ?? 0}</span>
                    {stale && <AlertTriangle size={11} className="ml-1 inline text-orange" />}
                  </TD>
                  <TD numeric>{formatRupiah(r.totalValue || 0)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableWrap>
      {sisa > 0 && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + TABLE_BATCH * 2)}
          className="mt-3 w-full rounded-xl bg-surface px-3 py-2.5 text-center text-[12.5px] font-semibold text-accent transition-colors hover:bg-accentbg"
        >
          Muat {Math.min(sisa, TABLE_BATCH * 2)} lagi · sisa {sisa.toLocaleString("id-ID")}
        </button>
      )}
    </>
  );
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [board, setBoard]     = useState({});
  const [users, setUsers]     = useState([]);
  const [filterSales, setFilterSales] = useState("");
  const [cari, setCari]       = useState("");
  const [hanyaMandek, setHanyaMandek] = useState(false);
  const [loading, setLoading] = useState(true);
  const [moveMenu, setMoveMenu] = useState(null); // ID card yang menu-nya terbuka
  // Filter tanggal pelanggan MASUK (Customer.createdAt) — default "Hari ini",
  // sama seperti Dashboard. "Semua" (all_time) dipakai kalau ingin lihat
  // seluruh papan tanpa batas tanggal, karena kebanyakan deal di pipeline
  // dibuat di hari-hari sebelumnya, bukan hari ini.
  const [range, setRange] = useState(() => makeRange("today"));
  // Berapa kartu yang sudah "dibuka" per kolom (paging lokal, bukan request
  // baru — board sudah ada seluruhnya di memori).
  const [limitKolom, setLimitKolom] = useState({});
  const dragState = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  // ID card yang SEDANG digeser — hanya untuk visual "lift" (state `dragging`
  // di KanbanCard). Sengaja state terpisah dari dragState (yang tetap ref
  // supaya tidak memicu re-render tiap dragover).
  const [draggingId, setDraggingId] = useState(null);
  // Tampilan alternatif "Tabel" (26 Agustus 2026, permintaan owner) — Kanban
  // bagus untuk drag antar stage, tapi payah untuk MEMBANDINGKAN banyak
  // pelanggan sekaligus (nilai/hari-di-stage/kota) karena mereka terpisah per
  // kolom. Tabel flatten SEMUA stage jadi satu daftar yang bisa di-sort,
  // filter yang sama (pencarian/sales/mandek) tetap berlaku di kedua mode.
  const [viewMode, setViewMode] = useState("papan"); // "papan" | "tabel"
  const [sortKey, setSortKey] = useState("updatedAt");
  const [sortDir, setSortDir] = useState("desc");

  async function loadBoard() {
    setLoading(true);
    try {
      const [b, u] = await Promise.all([
        api.getPipelineBoard(toApiParams(range)),
        api.getUsers(),
      ]);
      setBoard(b);
      setUsers(u);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBoard(); }, [range]);

  // Filter di-memo per board/filter supaya tidak dihitung ulang tiap render
  // (8 kolom × ribuan kartu × beberapa kali per interaksi drag = terasa).
  const kolom = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const out = {};
    for (const stage of STAGES) {
      let cards = board[stage] || [];
      if (filterSales) cards = cards.filter((c) => c.assignedSalesId === filterSales);
      if (q) {
        cards = cards.filter((c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.phone || "").includes(q) ||
          (c.city || "").toLowerCase().includes(q)
        );
      }
      if (hanyaMandek) cards = cards.filter((c) => isStale(c, stage));
      out[stage] = cards;
    }
    return out;
  }, [board, filterSales, cari, hanyaMandek]);

  const getCards = (stage) => kolom[stage] || [];
  const stageTotal = (stage) => getCards(stage).reduce((s, c) => s + (c.totalValue || 0), 0);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  }

  // Flatten semua stage (yang SUDAH difilter lewat `kolom`) jadi satu daftar
  // untuk mode Tabel — inilah yang tidak bisa dilihat di Kanban: bandingkan
  // nilai/hari-di-stage/kota LINTAS stage sekaligus, bukan per kolom terpisah.
  const semuaBaris = useMemo(() => {
    const rows = [];
    for (const stage of STAGES) {
      for (const card of getCards(stage)) rows.push({ ...card, stage });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case "name":       return dir * (a.name || a.phone || "").localeCompare(b.name || b.phone || "");
        case "stage":      return dir * (STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
        case "totalValue": return dir * ((a.totalValue || 0) - (b.totalValue || 0));
        case "daysSince":  return dir * ((a.daysSince || 0) - (b.daysSince || 0));
        case "city":       return dir * (a.city || "").localeCompare(b.city || "");
        default:           return dir * (new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));
      }
    });
    return rows;
  }, [kolom, sortKey, sortDir]);

  // Buka chat customer. Kartu Kanban sebelumnya TIDAK bisa diklik sama sekali —
  // sales harus pindah ke Inbox lalu mencari nama customer manual. conversationId
  // sekarang dikirim backend (routes/pipeline.js); kalau customer belum pernah
  // chat, jatuh ke halaman Pelanggan supaya klik tidak "mati" tanpa penjelasan.
  function bukaChat(card) {
    if (card.conversationId) navigate(`/inbox?conv=${card.conversationId}`);
    else navigate(`/customers?id=${card.id}`);
  }

  const totalTampil = STAGES.reduce((n, s) => n + getCards(s).length, 0);
  const adaFilter = !!(cari.trim() || filterSales || hanyaMandek);

  // Pindah card ke stage baru — dipakai oleh drag-and-drop maupun tombol mobile.
  // Optimistic update, rollback lewat loadBoard() kalau API gagal.
  async function moveCardToStage(card, fromStage, toStage) {
    if (fromStage === toStage) return;
    setBoard((prev) => {
      const next = { ...prev };
      next[fromStage] = (prev[fromStage] || []).filter((c) => c.id !== card.id);
      next[toStage]   = [{ ...card }, ...(prev[toStage] || [])];
      return next;
    });
    try {
      // Ini juga yang mencatat baris pipeline_transitions di backend (satu
      // transaksi) dan memicu webhook lead.won kalau toStage = TRANSACTION —
      // lihat routes/customers.js PATCH /:id.
      await api.updateCustomer(card.id, { pipelineStage: toStage });
    } catch (err) {
      alert("Gagal memindah pelanggan: " + err.message);
      loadBoard();
    }
  }

  // Drag & drop handlers (desktop) — HTML5 native, logika TIDAK diubah di
  // Wave 5A, hanya ditambah set/clear draggingId untuk efek visual.
  function onDragStart(e, card, fromStage) {
    dragState.current = { card, fromStage };
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(card.id);
  }

  // Selalu jalan di akhir drag, termasuk kalau dilepas di luar kolom / ditekan
  // Esc — jadi ini titik pembersihan yang bisa diandalkan untuk state visual.
  function onDragEnd() {
    setDraggingId(null);
    setDragOver(null);
  }

  function onDragOver(e, stage) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(stage);
  }

  async function onDrop(e, toStage) {
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    if (!dragState.current) return;
    const { card, fromStage } = dragState.current;
    dragState.current = null;
    await moveCardToStage(card, fromStage, toStage);
  }

  async function handleExport() {
    const { exportToExcel } = await import("../utils/export.js");
    const rows = [];
    STAGES.forEach((stage) => {
      getCards(stage).forEach((c) => {
        rows.push({
          Nama: c.name || c.phone || "",
          Telepon: c.phone || "",
          Stage: STAGE_LABELS[stage] || stage,
          "Total Nilai Order": formatRupiah(c.totalValue || 0),
          "Hari di Stage": c.daysSince || 0,
          Mandek: isStale(c, stage) ? "Ya" : "",
          "Sales Person": c.assignedSales?.name || "",
        });
      });
    });
    exportToExcel(rows, "pipeline-" + new Date().toISOString().slice(0, 10));
  }

  const totalMandek = STAGES.reduce(
    (n, s) => n + getCards(s).filter((c) => isStale(c, s)).length, 0
  );

  return (
    <PageContainer>
      <PageHeader
        title="Pipeline"
        subtitle={
          totalMandek > 0
            ? `${totalMandek} deal mandek ${"≥"}14 hari — perlu ditindak`
            : "Geser kartu antar stage untuk memperbarui status"
        }
        actions={
          <>
            {/* Toggle Papan/Tabel (26 Agustus 2026, permintaan owner) — Kanban
                bagus untuk drag antar stage, Tabel bagus untuk membandingkan
                banyak pelanggan sekaligus (sort by nilai/hari-di-stage/kota). */}
            <div className="flex items-center gap-0.5 rounded-lg bg-inset p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("papan")}
                aria-label="Tampilan Papan"
                aria-pressed={viewMode === "papan"}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors",
                  viewMode === "papan" ? "bg-surface text-ink shadow-card" : "text-ink3 hover:text-ink2"
                )}
              >
                <LayoutGrid size={13} /> Papan
              </button>
              <button
                type="button"
                onClick={() => setViewMode("tabel")}
                aria-label="Tampilan Tabel"
                aria-pressed={viewMode === "tabel"}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors",
                  viewMode === "tabel" ? "bg-surface text-ink shadow-card" : "text-ink3 hover:text-ink2"
                )}
              >
                <List size={13} /> Tabel
              </button>
            </div>
            <DateRangePicker value={range} onChange={setRange} />
            {/* Pencarian di dalam board — tanpa ini satu-satunya cara menemukan
                customer di kolom berisi ribuan kartu adalah scroll manual. */}
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                type="search"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari nama, nomor, kota…"
                aria-label="Cari pelanggan di pipeline"
                className="h-8 w-48 rounded-lg bg-surface pl-8 pr-7 text-[13px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              {cari && (
                <button
                  type="button" onClick={() => setCari("")} aria-label="Hapus pencarian"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink3 hover:text-ink"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {/* min-w eksplisit — appearance:none (tokens.css) membuang jaminan
                browser melebarkan <select> mengikuti opsi TERPANJANG (nama
                sales terpanjang), bukan cuma yang sedang terpilih. Bug sama
                yang sudah diperbaiki di Orders.jsx/CustomerFilters.jsx. */}
            <select
              className="h-8 min-w-[164px] rounded-lg bg-surface px-2 text-[13px] text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              value={filterSales}
              onChange={(e) => setFilterSales(e.target.value)}
              aria-label="Filter sales person"
            >
              <option value="">Semua Sales</option>
              {users.filter((u) => rolesOf(u).some((r) => r === "SALES" || r === "ADMIN")).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <Button
              variant={hanyaMandek ? "primary" : "ghost"} size="sm"
              onClick={() => setHanyaMandek((v) => !v)}
              title="Tampilkan hanya deal yang tidak disentuh ≥14 hari"
            >
              <AlertTriangle size={14} /> Mandek
            </Button>
            <Button variant="ghost" size="sm" onClick={loadBoard} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExport}>
              <Download size={14} /> Export
            </Button>
          </>
        }
      />

      <PageBody>
       <PageErrorBoundary label="Pipeline">
        {loading ? (
          <div className="flex gap-3 overflow-hidden">
            {STAGES.slice(0, 5).map((s) => (
              <div key={s} className="flex w-64 shrink-0 flex-col gap-2 rounded-2xl bg-inset/80 p-2.5">
                <Skeleton className="h-5 w-24" />
                {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            ))}
          </div>
        ) : (
          <>
            {adaFilter && (
              <p className="mb-3 text-xs text-ink3">
                {totalTampil.toLocaleString("id-ID")} pelanggan cocok dengan filter
                {cari.trim() && <> · pencarian “<strong className="text-ink2">{cari.trim()}</strong>”</>}
                {hanyaMandek && <> · hanya mandek ≥14 hari</>}
                {" · "}
                <button type="button" onClick={() => { setCari(""); setFilterSales(""); setHanyaMandek(false); }}
                  className="font-semibold text-accent hover:underline">
                  Reset filter
                </button>
              </p>
            )}

            {viewMode === "tabel" ? (
              <PipelineTableView
                rows={semuaBaris}
                sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                onOpenRow={bukaChat}
                onMoveToStage={(card, toStage) => moveCardToStage(card, card.stage, toStage)}
                adaFilter={adaFilter}
              />
            ) : (
            /* LAYOUT DIPERBAIKI: dulu `lg:grid-cols-5` dengan 8 stage — 3 kolom
                terakhir (Completed/Paid/Already Reviewed) TERLIPAT ke BARIS
                KEDUA grid, dan karena kolom "New" berisi 1.158 kartu, baris
                kedua itu terdorong ribuan piksel ke bawah sehingga terlihat
                seperti "stage berhasil hilang". Sekarang satu baris flex dengan
                scroll HORIZONTAL — semua stage selalu terjangkau, dan tiap
                kolom punya scroll VERTIKAL sendiri (max-h) supaya panjang satu
                kolom tidak lagi menentukan panjang halaman. */
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
              {STAGES.map((stage) => {
                const cards = getCards(stage);
                const limit = limitKolom[stage] || BATCH;
                const tampil = cards.slice(0, limit);
                const sisa = cards.length - tampil.length;
                const mandek = cards.filter((c) => isStale(c, stage)).length;
                return (
                  <div
                    key={stage}
                    onDragOver={(e) => onDragOver(e, stage)}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => onDrop(e, stage)}
                    className={cn(
                      "flex w-[264px] shrink-0 flex-col rounded-2xl p-2.5 transition-colors duration-150",
                      dragOver === stage ? "bg-accentbg/70" : "border-transparent bg-inset/80"
                    )}
                  >
                    <div className="flex items-center gap-2 px-0.5">
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STAGE_DOT[stage] || "bg-ink3")} />
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink2">
                        {STAGE_LABELS[stage] || stage}
                      </span>
                      <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink2">
                        {cards.length.toLocaleString("id-ID")}
                      </span>
                    </div>
                    <div className="mb-2 mt-1 flex items-baseline justify-between gap-2 px-0.5">
                      <ColumnTotal value={stageTotal(stage)} />
                      {mandek > 0 && (
                        <span className="shrink-0 text-[10px] font-semibold text-orange" title={`${mandek} deal tidak disentuh ≥14 hari`}>
                          {mandek} mandek
                        </span>
                      )}
                    </div>

                    {/* Scroll vertikal PER KOLOM — inti perbaikan "long scroll". */}
                    <div className="flex max-h-[calc(100vh-310px)] min-h-24 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                      {tampil.map((card) => (
                        <KanbanCard
                          key={card.id}
                          card={card}
                          stage={stage}
                          stages={STAGES}
                          dragging={draggingId === card.id}
                          menuOpen={moveMenu === card.id}
                          onDragStart={(e) => onDragStart(e, card, stage)}
                          onDragEnd={onDragEnd}
                          onToggleMenu={() => setMoveMenu(moveMenu === card.id ? null : card.id)}
                          onMoveToStage={(s) => { setMoveMenu(null); moveCardToStage(card, stage, s); }}
                          onOpenChat={() => bukaChat(card)}
                        />
                      ))}

                      {sisa > 0 && (
                        <button
                          type="button"
                          onClick={() => setLimitKolom((p) => ({ ...p, [stage]: limit + BATCH * 2 }))}
                          className="rounded-xl bg-surface px-2 py-2 text-[11px] font-semibold text-accent transition-colors hover:bg-accentbg"
                        >
                          Muat {Math.min(sisa, BATCH * 2)} lagi · sisa {sisa.toLocaleString("id-ID")}
                        </button>
                      )}

                      {cards.length === 0 && (
                        <div className="flex min-h-16 items-center justify-center rounded-xl border-dashed border-line px-2 py-3 text-center text-[11px] text-ink3">
                          {adaFilter ? "Tidak ada yang cocok" : "Kosong"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </>
        )}
       </PageErrorBoundary>
      </PageBody>
    </PageContainer>
  );
}
