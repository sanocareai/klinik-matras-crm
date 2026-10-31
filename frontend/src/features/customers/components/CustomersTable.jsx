import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, MessageSquare, Users } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, ColGroup, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import {
  formatRupiah, formatPhoneDisplay, STAGE_LABELS, ORDER_STATUS_LABELS, SOURCE_LABELS,
  stageVariant, orderStatusVariant, healthVariant, tagClass, isVIP,
} from "@/utils/format.js";
import { kolomTampil, LEBAR_KOLOM, lebarMinTabel } from "@/features/customers/columns.js";

// Tampilan awal (Fase 2, 31 Okt 2026): Pelanggan (nama + nomor), Pipeline, Sales, Kota, Order, Nilai Order, lalu Aksi.
// Kolom lain (ID Order, Status Order, Keluhan, Kesehatan, Tags, Tipe, Sumber) dinyalakan lewat menu "Kolom" —
// lihat features/customers/columns.js. Urutan kolom di EKSPOR EXCEL tidak berubah (Customers.jsx handleExport).
//
// Tiga tindakan terpisah per baris:
//   · checkbox        → memilih baris (seleksi massal); tidak membuka apa pun
//   · klik baris      → chat pelanggan (/inbox?conv=) bila sudah pernah chat, selain itu profil — perilaku lama dipertahankan
//   · tombol Profil   → drawer profil; ikon chat → tujuan yang sama dengan klik baris (kini terlihat, bukan tersembunyi)
const LABEL = {
  pelanggan: "Pelanggan", pipeline: "Pipeline", sales: "Sales", kota: "Kota", order: "Order", nilai: "Nilai Order",
  idOrder: "ID Order", statusOrder: "Status Order", keluhan: "Keluhan", kesehatan: "Kesehatan", tags: "Tags", tipe: "Tipe", sumber: "Sumber",
};
const SORT_KEY = { pelanggan: "name", kota: "city", order: "orderCount", nilai: "orderValue", sales: "assignedSales", sumber: "leadSource" };

export default function CustomersTable({
  rows, loading, emptyMessage, sortKey, sortDir, onSort, onOpen,
  selected, onToggleSelect, allSelected, onToggleSelectAll,
  kolomTambahan = [], hasFilters = false, onResetFilters, gagal = false,
}) {
  const navigate = useNavigate();
  const dirFor = (key) => (sortKey === key ? sortDir : null);
  const kolom = kolomTampil(kolomTambahan);
  const jumlahKolom = kolom.length;

  function bukaChat(c) {
    if (c.conversationId) navigate(`/inbox?conv=${c.conversationId}`);
    else onOpen(c.id);
  }

  const kepala = (k) => {
    if (k === "pilih") {
      return (
        <TH key={k} className="crm-pel-th-pilih">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            aria-label="Pilih semua pelanggan di halaman ini"
          />
        </TH>
      );
    }
    if (k === "aksi") return <TH key={k}>Aksi</TH>;
    const sk = SORT_KEY[k];
    return (
      <TH
        key={k}
        numeric={k === "order" || k === "nilai"}
        sortable={!!sk}
        sortDir={sk ? dirFor(sk) : undefined}
        onSort={sk ? () => onSort(sk) : undefined}
      >
        {LABEL[k]}
      </TH>
    );
  };

  const kosong = (v) => v || <span className="text-ink3">—</span>;

  const sel = (c, k, displayName, korporat) => {
    switch (k) {
      case "pilih":
        return (
          <TD key={k} onClick={(e) => e.stopPropagation()} className="crm-pel-td-pilih">
            <input
              type="checkbox"
              checked={selected?.has(c.id) || false}
              onChange={() => onToggleSelect(c.id)}
              aria-label={`Pilih ${displayName}`}
            />
          </TD>
        );
      case "pelanggan": {
        const kontak = formatPhoneDisplay(c.phone) || (c.instagramHandle ? `@${c.instagramHandle}` : "");
        return (
          <TD key={k}>
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={displayName} src={c.profilePictureUrl} size="sm" />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="crm-pel-nama truncate font-semibold text-ink" title={displayName}>{displayName}</span>
                  {isVIP(c) && <Badge variant="violet" className="crm-pel-vip shrink-0">VIP</Badge>}
                  {c.pernahKomplain && (
                    <AlertTriangle size={13} className="shrink-0 text-red" title="Pernah komplain" aria-label="Pernah komplain" />
                  )}
                </div>
                <div className="crm-pel-kontak truncate text-[12px] tabular-nums text-ink3" title={c.phone || undefined}>
                  {kontak || "—"}
                  {c.phone && c.instagramHandle && <span> · @{c.instagramHandle}</span>}
                </div>
              </div>
            </div>
          </TD>
        );
      }
      case "pipeline":
        // Warna status lewat helper variant di utils/format.js — BUKAN hardcode inline (lihat CLAUDE.md §8).
        return (
          <TD key={k}>
            <Badge variant={stageVariant(c.pipelineStage)} className="crm-pel-stage" data-stage={c.pipelineStage}>
              {STAGE_LABELS[c.pipelineStage] || c.pipelineStage}
            </Badge>
          </TD>
        );
      case "sales":
        return (
          <TD key={k}>
            {c.assignedSales?.name ? (
              <span className="flex min-w-0 items-center gap-2" title={c.assignedSales.name}>
                <Avatar name={c.assignedSales.name} src={c.assignedSales.avatarUrl} size="sm" className="h-6 w-6 text-[10px]" />
                <span className="truncate font-medium text-ink2">{c.assignedSales.name}</span>
              </span>
            ) : <span className="text-ink3">—</span>}
          </TD>
        );
      case "kota":
        return <TD key={k} className="truncate" title={c.city || undefined}>{kosong(c.city)}</TD>;
      case "order":
        return <TD key={k} numeric>{c.orderCount || 0}</TD>;
      case "nilai":
        return <TD key={k} numeric className="crm-pel-nilai whitespace-nowrap font-semibold text-ink">{formatRupiah(c.orderValue)}</TD>;
      case "idOrder":
        return <TD key={k} className="truncate">{kosong(c.latestOrderNumber)}</TD>;
      case "statusOrder":
        return (
          <TD key={k}>
            {c.latestOrderStatus ? (
              <Badge variant={orderStatusVariant(c.latestOrderStatus)}>
                {ORDER_STATUS_LABELS[c.latestOrderStatus] || c.latestOrderStatus}
              </Badge>
            ) : <span className="text-ink3">—</span>}
          </TD>
        );
      case "keluhan":
        return (
          <TD key={k}>
            {c.latestKeluhan ? (
              <span className="block truncate" title={c.latestKeluhan}>{c.latestKeluhan}</span>
            ) : <span className="text-ink3">—</span>}
          </TD>
        );
      case "kesehatan":
        // Dibaca dari Order.healthStatus (pernahSakit, dihitung backend dari riwayat order), BUKAN Customer.healthStatus lama.
        return (
          <TD key={k}>
            {c.pernahSakit ? <Badge variant={healthVariant("SAKIT")}>Sakit</Badge> : <span className="text-ink3">—</span>}
          </TD>
        );
      case "tags":
        return (
          <TD key={k}>
            {c.tags?.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1">
                {c.tags.slice(0, 2).map((t) => (
                  <span key={t} className={`tag-chip ${tagClass(t)}`}>{t}</span>
                ))}
                {c.tags.length > 2 && <span className="text-[11px] text-ink3">+{c.tags.length - 2}</span>}
              </span>
            ) : <span className="text-ink3">—</span>}
          </TD>
        );
      case "tipe":
        return (
          <TD key={k}>
            <Badge variant={korporat ? "violet" : "success"}>{korporat ? "Korporat" : "End User"}</Badge>
          </TD>
        );
      case "sumber":
        // leadSourceDetail = iklan/kreatif SPESIFIK, ditulis apa adanya (prinsip "jujur tidak tahu"). WHATSAPP_DIRECT yang
        // belum dikonfirmasi sales ditandai supaya jelas ini atribusi otomatis.
        return (
          <TD key={k}>
            <div className="truncate text-[12.5px] text-ink2">{SOURCE_LABELS[c.leadSource] || c.leadSource || "—"}</div>
            {c.leadSourceDetail && (
              <div className="truncate text-[11px] text-ink3" title={c.leadSourceDetail}>{c.leadSourceDetail}</div>
            )}
            {c.leadSource === "WHATSAPP_DIRECT" && !c.leadSourceConfirmed && (
              <div className="text-[10.5px] text-ink3">(belum dikonfirmasi)</div>
            )}
          </TD>
        );
      case "aksi":
        return (
          <TD key={k} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-end gap-1">
              {c.conversationId && (
                <button
                  type="button"
                  onClick={() => bukaChat(c)}
                  title="Buka chat pelanggan"
                  aria-label={`Buka chat ${displayName}`}
                  className="crm-pel-aksi-chat inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <MessageSquare size={16} />
                </button>
              )}
              <Button variant="ghost" size="sm" className="crm-pel-profil" onClick={() => onOpen(c.id)} title="Lihat profil pelanggan" aria-label={`Profil ${displayName}`}>
                Profil
              </Button>
            </div>
          </TD>
        );
      default:
        return null;
    }
  };

  return (
    // "dh-table" (D-098) — lihat catatan lama: menyamakan pilihan kaca otomatis, no-op di luar .glass-division.
    <TableWrap className="crm-pel-tabel hidden md:block dh-table">
      <Table fixed style={{ minWidth: lebarMinTabel(kolom) }}>
        <ColGroup widths={kolom.map((k) => LEBAR_KOLOM[k] ?? null)} />
        <THead>
          <TR>{kolom.map(kepala)}</TR>
        </THead>
        <TBody>
          {loading && <TableSkeletonRows rows={8} cols={jumlahKolom} />}

          {!loading && rows.map((c) => {
            const displayName = c.name || c.phone || c.instagramHandle || "—";
            const korporat = c.customerType === "CORPORATE";
            const terpilih = selected?.has(c.id) || false;
            return (
              <TR key={c.id} clickable selected={terpilih} onClick={() => bukaChat(c)}>
                {kolom.map((k) => sel(c, k, displayName, korporat))}
              </TR>
            );
          })}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={jumlahKolom}>
                <EmptyState
                  icon={Users}
                  title={gagal ? "Daftar belum dapat ditampilkan" : hasFilters ? "Tidak ada pelanggan yang cocok" : "Belum ada pelanggan"}
                  description={gagal ? "Periksa koneksi, lalu pilih Coba lagi pada pesan di atas." : hasFilters ? emptyMessage : "Pelanggan baru muncul di sini begitu ada chat masuk atau ditambahkan lewat Pelanggan Baru."}
                  action={!gagal && hasFilters && onResetFilters ? (
                    <Button variant="secondary" size="sm" onClick={onResetFilters}>Reset filter</Button>
                  ) : null}
                />
              </td>
            </tr>
          )}
        </TBody>
      </Table>
    </TableWrap>
  );
}
