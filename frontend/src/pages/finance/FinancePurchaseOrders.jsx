import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, ClipboardList, Trash2, Pencil, Ban, CheckCircle2, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi, Pilihan, InputUang, tanggalPendek,
} from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import {
  STATUS_PO, TAB_PO, LABEL_STATUS_PENERIMAAN, baris0, teksJumlah, subtotal, totalIsian, galatBaris, galatFormulir,
  formDariPO, bodyDariForm, ringkasProgres, nilaiBelumDiterima, aksiPO, kalimatEvent,
} from "@/features/finance/purchaseOrderLogic.js";

// PURCHASE ORDER BAHAN BAKU — Fase 1 integrasi Finance → Gudang.
// PO adalah dokumen KOMITMEN: menyimpan, menyetujui, merevisi, atau membatalkan PO TIDAK mengubah stok dan TIDAK membuat jurnal.
// Stok masuk dan jurnal persediaan baru lahir saat Gudang menempatkan barang (putaway) dari Penerimaan Barang yang dibuat dari PO ini.
// Angka dipesan / diterima baik / ditolak / belum diterima / ditagih dihitung server dari penerimaan Gudang — layar ini hanya menampilkan.

const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tgl = (v) => (v ? tanggalPendek(String(v).slice(0, 10)) : "—");
const tglJam = (iso) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const BadgeStatus = ({ status }) => <Badge variant={STATUS_PO[status]?.variant || "neutral"}>{STATUS_PO[status]?.label || status}</Badge>;
const idKunci = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export default function FinancePurchaseOrders() {
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [form, setForm] = useState(null); // { kunci, po? } — kunci baru tiap dibuka = isian bersih
  const [detailId, setDetailId] = useState(null);

  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try { setData(await api.getPurchaseOrders({ status: tab, q: qTunda.trim() })); }
    catch (e) { if (diam) setPesan(e.message || "Gagal menyegarkan daftar PO"); else setError(e.message || "Gagal memuat Purchase Order"); }
    finally { if (!diam) setLoading(false); }
  }, [tab, qTunda]);
  useEffect(() => { muat({ diam: pernahMuat.current }); pernahMuat.current = true; }, [muat]);

  const daftar = data?.purchaseOrders || [];
  const bukaBaru = () => setForm({ kunci: idKunci(), po: null });

  const ringkas = useMemo(() => {
    const berjalan = daftar.filter((p) => ["DISETUJUI", "DITERIMA_SEBAGIAN"].includes(p.status));
    return {
      berjalan: berjalan.length,
      draf: daftar.filter((p) => p.status === "DRAFT").length,
      nilaiMenunggu: berjalan.reduce((s, p) => s + nilaiBelumDiterima(p), 0),
    };
  }, [daftar]);

  return (
    <HalamanFinance
      title="Purchase Order Bahan Baku"
      subtitle="Rencana pembelian bahan ke supplier, lengkap dengan harga, jumlah, dan progres penerimaan di Gudang."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<Button size="sm" onClick={bukaBaru}><Plus size={14} /> PO Baru</Button>}
    >
      {pesan && (
        <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="text-[13px] text-ink">{pesan}</p><Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
        </CardContent></Card>
      )}

      <Penjelasan>
        PO hanya <strong>rencana dan komitmen</strong>: menyimpan atau menyetujui PO <strong>tidak mengubah stok dan tidak membuat jurnal</strong>. Setelah disetujui, Gudang memilih PO ini
        saat membuat <strong>Penerimaan Baru</strong>, mencatat jumlah datang, baik, dan ditolak, lalu menempatkan barang ke rak. Hanya penempatan itu yang menambah stok dan persediaan.
        Penerimaan tanpa PO tetap bisa dibuat Gudang, tetapi ditandai <strong>Tanpa PO</strong> dan tidak ada pencocokan jumlah maupun harga.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka label="PO Berjalan" value={String(ringkas.berjalan)} sub="disetujui dan belum selesai diterima" />
        <KartuAngka label="Nilai Masih Ditunggu" value={formatUang(ringkas.nilaiMenunggu)} sub="sisa belum diterima × harga PO" />
        <KartuAngka label="Draf Menunggu Persetujuan" value={String(ringkas.draf)} tone={ringkas.draf > 0 ? "orange" : "default"} sub="belum bisa dipilih Gudang" />
      </div>

      <div role="tablist" aria-label="Saring status PO" className="flex flex-wrap gap-2">
        {TAB_PO.map((t) => (
          <Button key={t.key || "semua"} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)}>{t.label}</Button>
        ))}
      </div>
      <FilterBar q={q} onQ={setQ} placeholder="Cari nomor PO atau supplier…" filters={[]} ringkasan={`${daftar.length} PO`} onReset={() => setQ("")} />

      <Card className="overflow-hidden">
        <JudulKartu title="Daftar Purchase Order" description="Klik baris untuk melihat item, progres penerimaan, tagihan, dan riwayat." />
        {daftar.length === 0 ? (
          <CardContent><EmptyState icon={ClipboardList} title="Belum ada Purchase Order" description="Buat PO untuk bahan baku yang akan dibeli dari supplier." action={<Button size="sm" onClick={bukaBaru}>PO Baru</Button>} /></CardContent>
        ) : (
          <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead><TR><TH sticky width={140}>No. PO</TH><TH>Supplier</TH><TH width={96}>Tanggal</TH><TH width={96}>Estimasi</TH><TH width={190}>Diterima baik</TH><TH numeric width={120}>Nilai PO</TH><TH width={132}>Status</TH></TR></THead>
                <TBody>
                  {daftar.map((p) => {
                    const pr = ringkasProgres(p);
                    return (
                      <TR key={p.id} clickable onClick={() => setDetailId(p.id)}>
                        <TD sticky className="font-mono text-[12px]">{p.poNumber}</TD>
                        <TD truncate>{p.supplier.name}</TD>
                        <TD className="whitespace-nowrap text-[12px]">{tgl(p.orderDate)}</TD>
                        <TD className="whitespace-nowrap text-[12px]">{tgl(p.expectedDate)}</TD>
                        <TD><Progres teks={pr.teks} persen={pr.persen} /></TD>
                        <TD numeric><Uang value={p.totalDipesan} /></TD>
                        <TD><BadgeStatus status={p.status} /></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
            <CardList className={CARD_VIEW_CLASS}>
              {daftar.map((p) => {
                const pr = ringkasProgres(p);
                return (
                  <RowCard
                    key={p.id}
                    onClick={() => setDetailId(p.id)}
                    title={p.poNumber}
                    status={<BadgeStatus status={p.status} />}
                    subtitle={p.supplier.name}
                    fields={[
                      { label: "Tanggal", value: tgl(p.orderDate) },
                      { label: "Estimasi", value: tgl(p.expectedDate) },
                      { label: "Nilai PO", value: formatUang(p.totalDipesan) },
                      { label: "Diterima baik", value: pr.teks },
                    ]}
                  />
                );
              })}
            </CardList>
          </>
        )}
      </Card>

      {form && (
        <ModalPO
          key={form.kunci}
          kunci={form.kunci}
          po={form.po}
          onClose={() => setForm(null)}
          onSaved={async (id) => { setForm(null); await muat({ diam: true }); setDetailId(id); }}
        />
      )}
      {detailId && (
        <ModalDetailPO
          key={detailId}
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => muat({ diam: true })}
          onUbah={(po) => { setDetailId(null); setForm({ kunci: idKunci(), po }); }}
        />
      )}
    </HalamanFinance>
  );
}

function Progres({ teks, persen }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] tabular-nums text-ink2">{teks}</div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={persen} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${persen}%` }} />
      </div>
    </div>
  );
}

// ── Formulir PO (baru / ubah draf) ───────────────────────────────────────
function ModalPO({ kunci, po, onClose, onSaved }) {
  const mengubah = !!po;
  const [f, setF] = useState(() => (po ? formDariPO(po) : { supplierId: "", orderDate: hariIniISO(), expectedDate: "", notes: "", lines: [baris0()] }));
  const [suppliers, setSuppliers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [galat, setGalat] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setBaris = (i, patch) => setF((s) => ({ ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  useEffect(() => {
    api.getFinanceSuppliers().then((r) => setSuppliers((r.suppliers || []).filter((s) => s.active !== false))).catch(() => {});
    api.getMaterials({ active: "true" }).then((m) => setMaterials(Array.isArray(m) ? m : [])).catch(() => {});
  }, []);

  const bahan = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const galatForm = galatFormulir(f);
  const total = totalIsian(f.lines);

  async function simpan() {
    setGalat("");
    try {
      const body = bodyDariForm(f);
      const hasil = mengubah ? await api.updatePurchaseOrder(po.id, body) : await api.createPurchaseOrder(body, `po-${kunci}`);
      await onSaved(hasil.id);
    } catch (e) { setGalat(e.message || "Gagal menyimpan PO"); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={mengubah ? `Ubah Draf ${po.poNumber}` : "Purchase Order Baru"}
      description="Disimpan sebagai draf. PO baru bisa dipilih Gudang setelah disetujui. Menyimpan PO tidak mengubah stok dan tidak membuat jurnal."
      className="w-[760px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || (galatForm && f.supplierId)) && <p role="alert" data-testid="galat-po" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatForm}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink2">Total <strong className="tabular-nums text-ink">{formatUang(total)}</strong></span>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
              <TombolAksi disabled={!!galatForm} onClick={simpan}>{mengubah ? "Simpan Perubahan" : "Simpan Draf"}</TombolAksi>
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Supplier" required>
            <Pilihan value={f.supplierId} onChange={(v) => set("supplierId", v)} aria-label="Supplier">
              <option value="">— pilih supplier —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {mengubah && !suppliers.some((s) => s.id === f.supplierId) && <option value={f.supplierId}>{po.supplier.name}</option>}
            </Pilihan>
          </Field>
          <Field label="Tanggal PO" required><Input type="date" value={f.orderDate} onChange={(e) => set("orderDate", e.target.value)} /></Field>
          <Field label="Estimasi kedatangan" hint="Boleh dikosongkan."><Input type="date" min={f.orderDate} value={f.expectedDate} onChange={(e) => set("expectedDate", e.target.value)} /></Field>
          <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="mis. kirim ke Gudang Utama sebelum Jumat" /></Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ink2">Item bahan baku</span>
            <button type="button" onClick={() => set("lines", [...f.lines, baris0()])} className="flex items-center gap-1 text-[12px] font-semibold text-accent"><Plus size={12} /> Tambah baris</button>
          </div>
          <div className="space-y-2">
            {f.lines.map((l, i) => {
              const m = bahan.get(l.materialId);
              const g = (l.materialId || l.qty || l.unitPrice) ? galatBaris(l) : null;
              return (
                <div key={i} className="rounded-lg border border-line p-2.5" data-testid="baris-po">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_96px_132px] sm:items-end">
                    <Field label={`Item ${i + 1}`}>
                      <Pilihan value={l.materialId} onChange={(v) => setBaris(i, { materialId: v })} aria-label={`Item baris ${i + 1}`}>
                        <option value="">— pilih item katalog —</option>
                        {materials.map((mm) => <option key={mm.id} value={mm.id}>{mm.code} — {mm.name}</option>)}
                        {l.materialId && !bahan.has(l.materialId) && <option value={l.materialId}>{po?.lines?.find((x) => x.materialId === l.materialId)?.nama || "Item"}</option>}
                      </Pilihan>
                    </Field>
                    <Field label={`Jumlah${m ? ` (${m.unit})` : ""}`}>
                      <input
                        type="number" inputMode="decimal" min="0" step="any" value={l.qty} aria-label={`Jumlah baris ${i + 1}`}
                        onChange={(e) => setBaris(i, { qty: e.target.value })}
                        className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11"
                      />
                    </Field>
                    <Field label="Harga satuan (Rp)">
                      <InputUang value={l.unitPrice} onChange={(v) => setBaris(i, { unitPrice: v })} aria-label={`Harga satuan baris ${i + 1}`} />
                    </Field>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink2">Subtotal <strong className="tabular-nums text-ink">{formatUang(subtotal(l))}</strong></span>
                    {g && l.materialId && <span className="min-w-0 truncate text-[11.5px] text-orange">{g}</span>}
                    <button
                      type="button" onClick={() => set("lines", f.lines.length > 1 ? f.lines.filter((_, idx) => idx !== i) : f.lines)} disabled={f.lines.length === 1}
                      aria-label={`Hapus baris ${i + 1}`} className="shrink-0 rounded-lg p-2 text-ink3 hover:bg-redbg hover:text-red disabled:opacity-30"
                    ><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          {materials.length === 0 && <p className="mt-1.5 text-[11.5px] text-ink3">Belum ada item aktif di katalog — tambahkan lewat Stock &amp; Material di Gudang dulu.</p>}
        </div>
      </div>
    </Modal>
  );
}

// ── Detail PO ────────────────────────────────────────────────────────────
function ModalDetailPO({ id, onClose, onChanged, onUbah }) {
  const [po, setPo] = useState(null);
  const [galat, setGalat] = useState("");
  const [dialog, setDialog] = useState(null); // "batal" | "revisi"

  const muat = useCallback(async () => {
    try { setPo(await api.getPurchaseOrder(id)); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat PO"); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);

  async function jalankan(fn) {
    setGalat("");
    try { const baru = await fn(); setPo(baru); setDialog(null); await onChanged(); } catch (e) { setGalat(e.message || "Aksi gagal"); }
  }

  const aksi = po ? aksiPO(po) : null;
  return (
    <>
      <Modal
        open onOpenChange={(v) => !v && onClose()}
        title={po ? `${po.poNumber}` : "Memuat PO…"}
        description={po ? `${po.supplier.name} · tanggal ${tgl(po.orderDate)}${po.expectedDate ? ` · estimasi ${tgl(po.expectedDate)}` : ""}` : undefined}
        className="w-[920px]"
        footer={
          po && aksi ? (
            <div className="flex w-full flex-col gap-2">
              {galat && <p role="alert" data-testid="galat-detail-po" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] leading-snug text-red">{galat}</p>}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {aksi.batalkan && <Button variant="neutral" onClick={() => setDialog("batal")} className="max-sm:min-h-11 max-sm:px-4"><Ban size={14} /> Batalkan PO</Button>}
                {aksi.revisi && <Button variant="neutral" onClick={() => setDialog("revisi")} className="max-sm:min-h-11 max-sm:px-4"><ListChecks size={14} /> Revisi jumlah</Button>}
                {aksi.ubah && <Button variant="neutral" onClick={() => onUbah(po)} className="max-sm:min-h-11 max-sm:px-4"><Pencil size={14} /> Ubah draf</Button>}
                {aksi.setujui && (
                  <TombolAksi confirmText={`Setujui ${po.poNumber} senilai ${formatUang(po.totalDipesan)}? Setelah disetujui, Gudang bisa membuat Penerimaan dari PO ini dan harga tidak bisa diubah lagi.`} onClick={() => jalankan(() => api.approvePurchaseOrder(po.id))}>
                    <CheckCircle2 size={14} /> Setujui
                  </TombolAksi>
                )}
              </div>
            </div>
          ) : galat ? <p role="alert" className="text-[12.5px] text-red">{galat}</p> : null
        }
      >
        {!po ? <p className="py-6 text-[13px] text-ink3">Memuat…</p> : <IsiDetail po={po} />}
      </Modal>
      {dialog === "batal" && po && (
        <ModalAlasan
          judul={`Batalkan ${po.poNumber}`}
          deskripsi="PO yang dibatalkan tidak bisa dibuatkan Penerimaan lagi. Tidak ada stok atau jurnal yang berubah."
          label="Alasan pembatalan" tombol="Batalkan PO" galat={galat}
          onClose={() => setDialog(null)}
          onSubmit={(alasan) => jalankan(() => api.cancelPurchaseOrder(po.id, alasan))}
        />
      )}
      {dialog === "revisi" && po && (
        <ModalRevisi po={po} galat={galat} onClose={() => setDialog(null)} onSubmit={(d) => jalankan(() => api.revisiJumlahPurchaseOrder(po.id, d))} />
      )}
    </>
  );
}

function IsiDetail({ po }) {
  const barisLaku = po.status !== "DRAFT";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeStatus status={po.status} />
        <span className="text-[12px] text-ink2">Dibuat oleh {po.createdBy?.name || "—"}{po.approvedBy ? ` · disetujui ${po.approvedBy.name} (${tglJam(po.approvedAt)})` : ""}</span>
      </div>
      {po.notes && <p className="text-[12.5px] text-ink2">{po.notes}</p>}
      {po.status === "DIBATALKAN" && <p className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">Dibatalkan {tglJam(po.cancelledAt)} — {po.cancelReason}</p>}

      <section>
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Item &amp; progres penerimaan</h4>
        <TableWrap className="hidden md:block">
          <Table>
            <THead><TR><TH>Item</TH><TH numeric>Dipesan</TH><TH numeric>Diterima baik</TH><TH numeric>Ditolak</TH><TH numeric>Belum diterima</TH><TH numeric>Sudah ditagih</TH><TH numeric>Harga satuan</TH><TH numeric>Nilai PO</TH></TR></THead>
            <TBody>
              {po.lines.map((l) => (
                <TR key={l.id}>
                  <TD><div className="font-medium text-ink">{l.kode}</div><div className="text-[11.5px] text-ink2">{l.nama}</div></TD>
                  <TD numeric>{teksJumlah(l.dipesan)} {l.satuan}</TD>
                  <TD numeric>{teksJumlah(l.diterimaBaik)}</TD>
                  <TD numeric>{teksJumlah(l.ditolak)}</TD>
                  <TD numeric className={l.belumDiterima > 0 && barisLaku ? "font-semibold text-ink" : ""}>{teksJumlah(l.belumDiterima)}</TD>
                  <TD numeric>{teksJumlah(l.ditagih)}</TD>
                  <TD numeric><Uang value={l.hargaSatuan} /></TD>
                  <TD numeric><Uang value={l.nilaiDipesan} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
        <ul className="list-none space-y-2 p-0 md:hidden">
          {po.lines.map((l) => (
            <li key={l.id} className="rounded-lg border border-line p-2.5 text-[12.5px]">
              <div className="font-medium text-ink">{l.kode} — {l.nama}</div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                <div><dt className="text-ink3">Dipesan</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.dipesan)} {l.satuan}</dd></div>
                <div><dt className="text-ink3">Diterima baik</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.diterimaBaik)}</dd></div>
                <div><dt className="text-ink3">Ditolak</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.ditolak)}</dd></div>
                <div><dt className="text-ink3">Belum diterima</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.belumDiterima)}</dd></div>
                <div><dt className="text-ink3">Sudah ditagih</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.ditagih)}</dd></div>
                <div><dt className="text-ink3">Harga satuan</dt><dd className="ml-0 tabular-nums">{formatUang(l.hargaSatuan)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap justify-end gap-x-6 gap-y-1 text-[12.5px] text-ink2">
          <span>Nilai PO <strong className="tabular-nums text-ink">{formatUang(po.totalDipesan)}</strong></span>
          <span>Nilai diterima baik <strong className="tabular-nums text-ink">{formatUang(po.totalDiterima)}</strong></span>
          <span>Nilai sudah ditagih <strong className="tabular-nums text-ink">{formatUang(po.totalDitagih)}</strong></span>
        </div>
        <p className="mt-1 text-[11.5px] text-ink3">“Sudah ditagih” dihitung dari penerimaan yang tagihan supplier-nya sudah disetujui. Tagihan menempel ke satu penerimaan, bukan ke baris.</p>
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Penerimaan Gudang dari PO ini</h4>
        {(po.penerimaan || []).length === 0 ? (
          <p className="text-[12.5px] text-ink3">{po.status === "DRAFT" ? "Draf belum bisa diterima Gudang." : "Belum ada penerimaan. Gudang memilih PO ini saat membuat Penerimaan Baru."}</p>
        ) : (
          <ul className="list-none space-y-1.5 p-0">
            {po.penerimaan.map((r) => (
              <li key={r.id} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold text-ink">{r.receiptNumber}</span>
                  <Badge variant={r.status === "COMPLETED" ? "green" : r.status === "REJECTED" ? "red" : "accent"}>{LABEL_STATUS_PENERIMAAN[r.status] || r.status}</Badge>
                  {r.deliveryNote && <span className="text-ink2">Surat jalan {r.deliveryNote}</span>}
                  <span className="ml-auto text-ink2">{r.finSupplierBills.length === 0 ? "Belum ada tagihan" : r.finSupplierBills.map((t) => `${t.billNumber} (${t.status === "DISETUJUI" ? "disetujui" : t.status.toLowerCase().replace(/_/g, " ")})`).join(", ")}</span>
                </div>
                <div className="mt-1 text-ink2">
                  {r.lines.map((x) => {
                    const l = po.lines.find((b) => b.id === x.purchaseOrderLineId);
                    return `${l?.kode ?? "—"}: datang ${teksJumlah(x.receivedQty)} · baik ${teksJumlah(x.acceptedQty)} · ditolak ${teksJumlah(x.rejectedQty)}`;
                  }).join("  |  ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Riwayat</h4>
        <ol className="list-none space-y-1 p-0">
          {(po.riwayat || []).map((e) => (
            <li key={e.id} className="text-[12.5px] text-ink2"><span className="tabular-nums text-ink3">{tglJam(e.createdAt)}</span> · <span className="text-ink">{e.actor?.name || "Sistem"}</span> · {kalimatEvent(e)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ModalAlasan({ judul, deskripsi, label, tombol, galat, onClose, onSubmit }) {
  const [alasan, setAlasan] = useState("");
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={judul} description={deskripsi} className="w-[480px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Kembali</Button>
            <TombolAksi disabled={alasan.trim().length < 3} onClick={() => onSubmit(alasan.trim())}>{tombol}</TombolAksi>
          </div>
        </div>
      }
    >
      <Field label={label} required><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function ModalRevisi({ po, galat, onClose, onSubmit }) {
  const [lineId, setLineId] = useState(po.lines[0].id);
  const baris = po.lines.find((l) => l.id === lineId);
  const [qty, setQty] = useState(String(baris.dipesan));
  const [alasan, setAlasan] = useState("");
  const q = Number(qty);
  const valid = q > 0 && q >= baris.diterimaBaik && q !== baris.dipesan && alasan.trim().length >= 3;
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Revisi jumlah ${po.poNumber}`} className="w-[520px]"
      description="Cara resmi menangani selisih: menaikkan jumlah bila supplier mengirim lebih, atau menurunkannya bila sisanya tidak akan dikirim. Harga satuan tidak berubah. Tidak mengubah stok atau jurnal."
      footer={
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Kembali</Button>
            <TombolAksi disabled={!valid} onClick={() => onSubmit({ lineId, qty: q, reason: alasan.trim() })}>Simpan Revisi</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Item">
          <Pilihan value={lineId} onChange={(v) => { setLineId(v); setQty(String(po.lines.find((l) => l.id === v).dipesan)); }} aria-label="Item yang direvisi">
            {po.lines.map((l) => <option key={l.id} value={l.id}>{l.kode} — dipesan {teksJumlah(l.dipesan)} {l.satuan}</option>)}
          </Pilihan>
        </Field>
        <Field label={`Jumlah baru (${baris.satuan})`} hint={`Sudah diterima baik ${teksJumlah(baris.diterimaBaik)}; jumlah baru tidak boleh lebih kecil.`}>
          <Input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Alasan revisi" required><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. supplier hanya sanggup kirim 8" /></Field>
      </div>
    </Modal>
  );
}
