import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows, TableEmptyRow,
} from "@/components/ui/table.jsx";
import {
  formatRupiah, STAGE_LABELS, ORDER_STATUS_LABELS, HEALTH_LABELS, SOURCE_LABELS,
  stageVariant, orderStatusVariant, healthVariant, tagClass, isVIP,
} from "@/utils/format.js";

// Urutan kolom WAJIB dipertahankan (CLAUDE.md Gelombang 5 poin 1 & 3):
// Nama → ID Order → No HP → Pipeline → Status Order → Keluhan → Kesehatan → Tags
// lalu kolom tambahan. Urutan ini juga harus cocok dengan export Excel.
// "Sumber" ditambah 14 Agt 2026 SETELAH prefix wajib itu (di antara kolom
// tambahan yang boleh berubah) — supaya begitu tabel difilter Sumber Lead =
// Meta Ads, iklan/kreatif SPESIFIK-nya langsung kelihatan per baris, tanpa
// buka profil satu-satu.
// +1 kolom checkbox seleksi massal (Wave 5B lanjutan — bulk assign sales).
const COL_COUNT = 16;

export default function CustomersTable({
  rows, loading, emptyMessage, sortKey, sortDir, onSort, onOpen,
  selected, onToggleSelect, allSelected, onToggleSelectAll,
}) {
  const navigate = useNavigate();
  const dirFor = (key) => (sortKey === key ? sortDir : null);

  // BUG YANG DIPERBAIKI: klik baris SEBELUMNYA selalu buka drawer profil —
  // untuk sampai ke chat customer, sales harus buka drawer dulu lalu cari
  // tombol "Lanjutkan WhatsApp" yang kecil di dalamnya (susah dijangkau di
  // HP/tablet). Sekarang klik baris LANGSUNG ke chat (deep-link
  // /inbox?conv=) kalau customer sudah pernah chat — itu aksi yang jauh
  // lebih sering dibutuhkan sales daripada buka profil. Profil TETAP bisa
  // diakses lewat tombol "Lihat" eksplisit di kolom Aksi (tidak dihapus).
  function handleRowClick(c) {
    if (c.conversationId) navigate(`/inbox?conv=${c.conversationId}`);
    else onOpen(c.id);
  }

  return (
    // "dh-table" (D-098) — TableWrap default (`rounded-2xl bg-surface`)
    // TIDAK cocok pola seleksi kaca otomatis ([class*="rounded-card"]/.card),
    // sama akar masalahnya dengan ArmadaOrders.jsx "Semua Order" (D-078) —
    // baca komentar lengkap di sana / delivery-dark.css §2. Kelas ini yang
    // menyamakannya, no-op di luar .glass-division (di luar pilot /customers).
    <TableWrap className="hidden md:block dh-table">
      <Table>
        <THead>
          <TR>
            <TH className="w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label="Pilih semua pelanggan di halaman ini"
              />
            </TH>
            <TH sortable sortDir={dirFor("name")} onSort={() => onSort("name")}>Nama Pelanggan</TH>
            <TH>ID Order</TH>
            <TH>No HP</TH>
            <TH>Pipeline</TH>
            <TH>Status Order</TH>
            <TH>Keluhan</TH>
            <TH>Kesehatan</TH>
            <TH>Tags</TH>
            <TH>Tipe</TH>
            <TH sortable sortDir={dirFor("city")} onSort={() => onSort("city")}>Kota</TH>
            <TH numeric sortable sortDir={dirFor("orderCount")} onSort={() => onSort("orderCount")}>Order</TH>
            <TH numeric sortable sortDir={dirFor("orderValue")} onSort={() => onSort("orderValue")}>Nilai Order</TH>
            <TH sortable sortDir={dirFor("assignedSales")} onSort={() => onSort("assignedSales")}>Sales Person</TH>
            <TH sortable sortDir={dirFor("leadSource")} onSort={() => onSort("leadSource")}>Sumber</TH>
            <TH>Aksi</TH>
          </TR>
        </THead>
        <TBody>
          {loading && <TableSkeletonRows rows={8} cols={COL_COUNT} />}

          {!loading && rows.map((c) => {
            const displayName = c.name || c.phone || c.instagramHandle || "—";
            const korporat = c.customerType === "CORPORATE";
            return (
              <TR key={c.id} clickable onClick={() => handleRowClick(c)}>
                <TD onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected?.has(c.id) || false}
                    onChange={() => onToggleSelect(c.id)}
                    aria-label={`Pilih ${displayName}`}
                  />
                </TD>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={displayName} src={c.profilePictureUrl} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="truncate font-semibold text-ink">{displayName}</span>
                        {c.pernahKomplain && (
                          <AlertTriangle size={12} className="shrink-0 text-red" title="Pernah komplain" />
                        )}
                      </div>
                      {isVIP(c) && <Badge variant="violet" className="mt-0.5">VIP</Badge>}
                    </div>
                  </div>
                </TD>

                <TD>{c.latestOrderNumber || <span className="text-ink3">—</span>}</TD>

                <TD>
                  {c.phone && <div className="tabular-nums">{c.phone}</div>}
                  {c.instagramHandle && <div className="text-[11px] text-ink3">@{c.instagramHandle}</div>}
                  {!c.phone && !c.instagramHandle && <span className="text-ink3">—</span>}
                </TD>

                {/* Semua warna status lewat helper variant di utils/format.js —
                    BUKAN hardcode inline seperti sebelumnya. Itu sumber drift
                    yang dicatat CLAUDE.md §8 (label "Penawaran" nyangkut). */}
                <TD>
                  <Badge variant={stageVariant(c.pipelineStage)}>
                    {STAGE_LABELS[c.pipelineStage] || c.pipelineStage}
                  </Badge>
                </TD>

                <TD>
                  {c.latestOrderStatus ? (
                    <Badge variant={orderStatusVariant(c.latestOrderStatus)}>
                      {ORDER_STATUS_LABELS[c.latestOrderStatus] || c.latestOrderStatus}
                    </Badge>
                  ) : <span className="text-ink3">—</span>}
                </TD>

                <TD className="max-w-44">
                  {c.latestKeluhan ? (
                    <span className="block truncate" title={c.latestKeluhan}>{c.latestKeluhan}</span>
                  ) : <span className="text-ink3">—</span>}
                </TD>

                <TD>
                  {c.healthStatus
                    ? <Badge variant={healthVariant(c.healthStatus)}>{HEALTH_LABELS[c.healthStatus]}</Badge>
                    : <span className="text-ink3">—</span>}
                </TD>

                <TD>
                  {c.tags?.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <span key={t} className={`tag-chip ${tagClass(t)}`}>{t}</span>
                      ))}
                      {c.tags.length > 3 && (
                        <span className="text-[11px] text-ink3">+{c.tags.length - 3}</span>
                      )}
                    </span>
                  ) : <span className="text-ink3">—</span>}
                </TD>

                <TD>
                  <Badge variant={korporat ? "violet" : "success"}>
                    {korporat ? "Korporat" : "End User"}
                  </Badge>
                </TD>

                <TD>{c.city || <span className="text-ink3">—</span>}</TD>
                <TD numeric>{c.orderCount || 0}</TD>
                <TD numeric className="font-semibold text-ink">{formatRupiah(c.orderValue)}</TD>
                {/* BUG YANG DIPERBAIKI: nama sales sebelumnya text-ink3 (opacity
                    40%, dipakai untuk placeholder/data kosong) — ini DATA
                    SUNGGUHAN, bukan kosong, jadi kontrasnya dinaikkan supaya
                    kebaca jelas, bukan pudar seperti tanda "—". */}
                <TD className={c.assignedSales ? "font-medium text-ink2" : undefined}>
                  {c.assignedSales?.name || <span className="text-ink3">—</span>}
                </TD>

                {/* leadSourceDetail = iklan/kreatif SPESIFIK ("Meta CTWA -
                    facebook - fb.me/77pJdJNsy"), bukan cuma platform —
                    ditulis apa adanya, tidak dinormalisasi/ditebak lebih
                    lanjut (prinsip "jujur tidak tahu" yang sama dipakai di
                    seluruh sistem atribusi ini). leadSourceConfirmed=false
                    pada WHATSAPP_DIRECT ditandai "Otomatis" supaya sales
                    tahu ini belum pernah dikonfirmasi manual. */}
                <TD className="max-w-40">
                  <div className="truncate text-[12.5px] text-ink2">
                    {SOURCE_LABELS[c.leadSource] || c.leadSource || "—"}
                  </div>
                  {c.leadSourceDetail && (
                    <div className="truncate text-[11px] text-ink3" title={c.leadSourceDetail}>
                      {c.leadSourceDetail}
                    </div>
                  )}
                  {c.leadSource === "WHATSAPP_DIRECT" && !c.leadSourceConfirmed && (
                    <div className="text-[10.5px] text-ink3">(belum dikonfirmasi)</div>
                  )}
                </TD>

                <TD onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}>
                  <Button variant="ghost" size="sm" title="Lihat profil pelanggan">Profil</Button>
                </TD>
              </TR>
            );
          })}

          {!loading && rows.length === 0 && (
            <TableEmptyRow colSpan={COL_COUNT}>{emptyMessage}</TableEmptyRow>
          )}
        </TBody>
      </Table>
    </TableWrap>
  );
}
