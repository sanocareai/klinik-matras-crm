import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, ClipboardList, Trash2, Pencil, Ban, CheckCircle2, ListChecks, FileText, Download, Eye } from "lucide-react";
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
import JejakBiayaPO from "@/features/finance/JejakBiayaPO.jsx";
import TerminFaktur from "@/features/finance/TerminFaktur.jsx";
import { adalahAdminKeuangan } from "@/features/finance/matriksAksi.js";
import { TERMIN_AWAL, galatTermin, teksTermin } from "@/features/finance/terminLogic.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi, Pilihan, InputUang, tanggalPendek,
} from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import PanelKedatangan, { LegendaProgres } from "@/features/kedatangan/PanelKedatangan.jsx";
import { MODE_PENDAMPING_OPSI, adaPendamping, teksPratinjauPendamping } from "@/features/kedatangan/kedatanganLogic.js";
import {
  STATUS_PO, TAB_PO, LABEL_STATUS_PENERIMAAN, baris0, teksJumlah, subtotal, totalIsian, galatBaris, galatFormulir,
  formDariPO, bodyDariForm, ringkasProgres, nilaiBelumDiterima, aksiPO, kalimatEvent,
  SATUAN_OPSI, JENIS_SKU_OPSI, PESAN_NON_STOK, labelSatuan, labelJenisSku, materialBaru0, galatMaterialBaru, bodyMaterialBaru, teksSetara, infoKonversi, daftarBarangBaru,
  FAKTUR_TERBUKA, LABEL_STATUS_FAKTUR, formFakturAwal, formFakturDariEvaluasi, galatFaktur, subtotalFaktur, totalFaktur, petunjukBaris, bodyFaktur, statusFaktur,
} from "@/features/finance/purchaseOrderLogic.js";

// PURCHASE ORDER BAHAN BAKU — Fase 1 integrasi Finance → Gudang.
// PO adalah dokumen KOMITMEN: menyimpan, menyetujui, merevisi, atau membatalkan PO TIDAK mengubah stok dan TIDAK membuat jurnal.
// Stok masuk dan jurnal persediaan baru lahir saat Gudang menekan Simpan ke Stok (putaway) dari Penerimaan Barang yang dibuat dari PO ini.
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
  const [sp] = useSearchParams();
  useEffect(() => { const id = sp.get("buka"); if (id) setDetailId(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan dalam (dari panel lain) cukup dibaca sekali

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
        PO hanya <strong>rencana dan komitmen</strong>: menyimpan atau menyetujui PO <strong>tidak mengubah stok dan tidak membuat jurnal</strong>. Setelah disetujui, PO ini muncul di Gudang sebagai <strong>Barang Akan Datang</strong>. Finance atau Gudang mencatat
        kedatangan lewat <strong>Catat Barang Tiba</strong> (tiap pengiriman = satu penerimaan sendiri), lalu Gudang memeriksa baik/ditolak dan menekan <strong>Simpan ke Stok</strong>. Hanya langkah terakhir itu yang menambah stok dan persediaan.
        Penerimaan tanpa PO tetap bisa dibuat Gudang, tetapi ditandai <strong>Tanpa PO</strong> dan tidak ada pencocokan jumlah maupun harga.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka label="PO Berjalan" value={String(ringkas.berjalan)} sub="disetujui dan belum selesai diterima" />
        <KartuAngka label="Nilai Belum Masuk Stok" value={formatUang(ringkas.nilaiMenunggu)} sub="dipesan dikurangi masuk stok, × harga PO" />
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
                <THead><TR><TH sticky width={140}>No. PO</TH><TH>Supplier</TH><TH width={96}>Tanggal</TH><TH width={96}>Estimasi</TH><TH width={230}>Masuk stok</TH><TH numeric width={120}>Nilai PO</TH><TH width={132}>Status</TH></TR></THead>
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
                      { label: "Masuk stok", value: pr.teks },
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
function penggunaAdminKeuangan() {
  try { return adalahAdminKeuangan(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; }
}

// Pencarian material yang ADA: kode, nama, atau kategori. Daftar tampil inline (bukan popover) supaya tidak terpotong area gulir modal.
function PemilihMaterial({ materials, value, nomor, namaCadangan, onPilih }) {
  const [q, setQ] = useState("");
  const terpilih = materials.find((m) => m.id === value);
  const hasil = useMemo(() => {
    const t = q.trim().toLowerCase();
    const cocok = t ? materials.filter((m) => `${m.code} ${m.name} ${m.itemGroup || ""}`.toLowerCase().includes(t)) : materials;
    return cocok.slice(0, 8);
  }, [materials, q]);
  if (value) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface px-3 py-2" data-testid="material-terpilih">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{terpilih ? `${terpilih.code} — ${terpilih.name}` : (namaCadangan || "Item")}</div>
          {terpilih && <div className="text-[11.5px] text-ink3">Satuan stok {labelSatuan(terpilih.unit)}{terpilih.kind ? ` · ${labelJenisSku(terpilih.kind)}` : ""}</div>}
        </div>
        <button type="button" onClick={() => onPilih("")} className="shrink-0 text-[12px] font-semibold text-accent max-sm:min-h-11 max-sm:px-2">Ganti</button>
      </div>
    );
  }
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari material (kode, nama, atau kategori)…" aria-label={`Cari material baris ${nomor}`} />
      <ul role="listbox" aria-label={`Hasil pencarian material baris ${nomor}`} className="mt-1 max-h-44 list-none divide-y divide-line overflow-y-auto rounded-lg border border-line p-0">
        {hasil.length === 0 && <li className="px-3 py-2 text-[12px] text-ink3">Tidak ada material yang cocok. Bila barangnya memang belum ada, buat barang baru.</li>}
        {hasil.map((m) => (
          <li key={m.id}>
            <button type="button" role="option" aria-selected="false" onClick={() => onPilih(m.id)} className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-hovertint max-sm:min-h-11">
              <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">{m.code}</span>
              <span className="min-w-0 flex-1 truncate text-ink2">{m.name}</span>
              <span className="shrink-0 text-[11px] text-ink3">{labelSatuan(m.unit)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Modal "Buat Barang Baru". Tidak menulis apa pun: hanya mengumpulkan data + memeriksa duplikat. SKU baru lahir saat draf PO disimpan (satu transaksi dengan PO-nya).
function ModalBarangBaru({ awal, supplierId, supplierNama, onClose, onSimpan, onPakaiMaterial }) {
  const [m, setM] = useState(() => ({ ...materialBaru0(), ...(awal || {}) }));
  const [periksa, setPeriksa] = useState(null); // { pasti, mirip }
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const set = (k, v) => { setM((s) => ({ ...s, [k]: v })); setPeriksa(null); };
  const beli = m.satuanBeli || m.satuanStok;
  const beda = !!m.satuanStok && beli !== m.satuanStok;
  const galatIsi = galatMaterialBaru(m);
  const perluKonfirmasi = !!periksa && periksa.pasti.length === 0 && periksa.mirip.length > 0;
  const alasanKurang = perluKonfirmasi && (!m.konfirmasiMirip || String(m.alasanMirip || "").trim().length < 5);

  async function periksaDanPakai() {
    setGalat("");
    if (periksa && periksa.pasti.length === 0 && (periksa.mirip.length === 0 || (m.konfirmasiMirip && !alasanKurang))) return onSimpan(m);
    setSibuk(true);
    try {
      const r = await api.cekDuplikatSku({ supplierId, materialBaru: bodyMaterialBaru({ ...m, konfirmasiMirip: false }) });
      setPeriksa({ pasti: r.pasti || [], mirip: r.mirip || [] });
      if ((r.pasti || []).length === 0 && (r.mirip || []).length === 0) onSimpan(m);
    } catch (e) { setGalat(e.message || "Gagal memeriksa duplikat"); } finally { setSibuk(false); }
  }

  const label = periksa?.pasti.length ? "Barang sudah ada" : perluKonfirmasi ? "Lanjutkan sebagai barang baru" : "Periksa & pakai di PO";
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Buat Barang Baru"
      description={`Barang ini baru dibuat saat PO disimpan${supplierNama ? ` (supplier ${supplierNama})` : ""}. Belum ada stok, jurnal, atau utang yang tercatat.`}
      className="w-[640px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || (galatIsi && m.nama)) && <p role="alert" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatIsi}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <TombolAksi disabled={!!galatIsi || sibuk || !!periksa?.pasti.length || alasanKurang} onClick={periksaDanPakai}>{sibuk ? "Memeriksa…" : label}</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3" data-testid="modal-barang-baru">
        <Field label="Nama barang" required><Input value={m.nama} onChange={(e) => set("nama", e.target.value)} placeholder="mis. Lem Semprot 500 ml" maxLength={200} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kategori" required hint="mis. Perekat, Busa, Kain, APD."><Input value={m.kategori} onChange={(e) => set("kategori", e.target.value)} maxLength={80} /></Field>
          <Field label="Jenis" required>
            <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Jenis barang">
              {JENIS_SKU_OPSI.map((j) => (
                <button
                  key={j.key} type="button" role="radio" aria-checked={m.jenis === j.key} onClick={() => set("jenis", j.key)}
                  className={cn("rounded-lg border px-3 py-2 text-left max-sm:min-h-11", m.jenis === j.key ? "border-accent bg-hovertint" : "border-line")}
                >
                  <span className="block text-[12.5px] font-semibold text-ink">{j.label}</span>
                  <span className="block text-[11px] leading-snug text-ink3">{j.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        </div>
        <p className="rounded-lg bg-surface px-3 py-2 text-[11.5px] leading-snug text-ink2">{PESAN_NON_STOK}</p>
        <Field label="Spesifikasi singkat"><Input value={m.spesifikasi} onChange={(e) => set("spesifikasi", e.target.value)} placeholder="mis. kaleng aerosol 500 ml" maxLength={500} /></Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Satuan pembelian" hint="Satuan yang tertulis di PO dan faktur supplier.">
            <Pilihan value={beli} onChange={(v) => set("satuanBeli", v)} aria-label="Satuan pembelian">
              <option value="">— pilih —</option>
              {SATUAN_OPSI.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Pilihan>
          </Field>
          <Field label="Satuan stok" required hint="Satuan di Gudang. Setelah ada pergerakan stok, satuan ini terkunci.">
            <Pilihan value={m.satuanStok} onChange={(v) => set("satuanStok", v)} aria-label="Satuan stok">
              <option value="">— pilih —</option>
              {SATUAN_OPSI.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Pilihan>
          </Field>
        </div>
        {beda && (
          <Field label={`Faktor konversi: 1 ${labelSatuan(beli)} = … ${labelSatuan(m.satuanStok)}`} required hint="Maksimal 4 angka di belakang koma. Contoh: 1 box berisi 12 kaleng → isi 12.">
            <input
              type="number" inputMode="decimal" min="0" step="any" value={m.faktorKonversi} aria-label="Faktor konversi"
              onChange={(e) => set("faktorKonversi", e.target.value)}
              className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11"
            />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nama barang versi supplier"><Input value={m.namaSupplier} onChange={(e) => set("namaSupplier", e.target.value)} maxLength={200} /></Field>
          <Field label="Kode barang supplier"><Input value={m.kodeSupplier} onChange={(e) => set("kodeSupplier", e.target.value)} maxLength={100} /></Field>
          <Field label="MOQ (opsional)" hint="Jumlah pesan minimum dalam satuan pembelian."><Input type="number" inputMode="decimal" min="0" value={m.moq} onChange={(e) => set("moq", e.target.value)} /></Field>
          <Field label="Estimasi waktu kirim (hari, opsional)"><Input type="number" inputMode="numeric" min="0" max="365" value={m.estimasiKirimHari} onChange={(e) => set("estimasiKirimHari", e.target.value)} /></Field>
          <Field label="Lokasi penyimpanan (opsional)"><Input value={m.lokasi} onChange={(e) => set("lokasi", e.target.value)} placeholder="mis. Rak B2" maxLength={200} /></Field>
          <Field label="Catatan"><Input value={m.catatan} onChange={(e) => set("catatan", e.target.value)} maxLength={500} /></Field>
        </div>

        {periksa?.pasti.length > 0 && (
          <div role="alert" data-testid="duplikat-pasti" className="rounded-lg bg-redbg px-3 py-2.5 text-[12.5px] text-red">
            <p className="font-semibold">Barang ini sudah ada di master material — jangan buat SKU baru.</p>
            <ul className="mt-1.5 list-none space-y-1 p-0">
              {periksa.pasti.map((c) => (
                <li key={c.materialId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{c.kode}</span><span className="min-w-0 flex-1">{c.nama} · {labelSatuan(c.satuan)} <span className="opacity-80">({c.alasan})</span></span>
                  <button type="button" onClick={() => onPakaiMaterial(c.materialId)} className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-[12px] font-semibold text-accent max-sm:min-h-11">Pakai material ini</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {perluKonfirmasi && (
          <div role="alert" data-testid="duplikat-mirip" className="rounded-lg bg-orangebg px-3 py-2.5 text-[12.5px] text-orange">
            <p className="font-semibold">Ada barang yang mirip. Periksa dulu agar tidak terjadi SKU ganda.</p>
            <ul className="mt-1.5 list-none space-y-1 p-0">
              {periksa.mirip.map((c) => (
                <li key={c.materialId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{c.kode}</span><span className="min-w-0 flex-1">{c.nama} · {labelSatuan(c.satuan)} <span className="opacity-80">({c.alasan})</span></span>
                  <button type="button" onClick={() => onPakaiMaterial(c.materialId)} className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-[12px] font-semibold text-accent max-sm:min-h-11">Pakai material ini</button>
                </li>
              ))}
            </ul>
            <label className="mt-2 flex items-start gap-2 text-ink">
              <input type="checkbox" checked={!!m.konfirmasiMirip} onChange={(e) => setM((s) => ({ ...s, konfirmasiMirip: e.target.checked }))} className="mt-0.5" />
              <span>Saya sudah memeriksa — ini memang barang yang berbeda.</span>
            </label>
            {m.konfirmasiMirip && <div className="mt-1.5"><Input value={m.alasanMirip} onChange={(e) => setM((s) => ({ ...s, alasanMirip: e.target.value }))} placeholder="Alasan (wajib, min. 5 huruf), mis. beda ketebalan" aria-label="Alasan melanjutkan barang mirip" maxLength={300} /></div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ModalPO({ kunci, po, onClose, onSaved }) {
  const mengubah = !!po;
  const bolehBuatSku = useMemo(penggunaAdminKeuangan, []);
  const [f, setF] = useState(() => (po ? formDariPO(po) : { supplierId: "", orderDate: hariIniISO(), expectedDate: "", notes: "", lines: [baris0()] }));
  const [termin, setTermin] = useState(TERMIN_AWAL);
  const [suppliers, setSuppliers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [galat, setGalat] = useState("");
  const [barangBaru, setBarangBaru] = useState(null); // { baris, awal? } — modal Buat Barang Baru untuk baris ke-n
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setBaris = (i, patch) => setF((s) => ({ ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  useEffect(() => {
    api.getFinanceSuppliers().then((r) => setSuppliers((r.suppliers || []).filter((s) => s.active !== false))).catch(() => {});
    api.getMaterials({ active: "true" }).then((m) => setMaterials(Array.isArray(m) ? m : [])).catch(() => {});
  }, []);

  const bahan = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const unitMap = useMemo(() => new Map(materials.map((m) => [m.id, m.unit])), [materials]);
  const galatForm = galatFormulir(f, unitMap) || galatTermin(termin);
  const total = totalIsian(f.lines);
  const namaSupplier = suppliers.find((s) => s.id === f.supplierId)?.name || po?.supplier?.name || "";
  const jumlahBaru = daftarBarangBaru(f.lines).length;

  async function simpan() {
    setGalat("");
    try {
      const body = bodyDariForm({ ...f, termin });
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
          {jumlahBaru > 0 && <p data-testid="info-barang-baru" className="text-[12px] text-ink2">{jumlahBaru} barang baru akan dibuat di master material saat draf ini disimpan.</p>}
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
          <div className="sm:col-span-2"><TerminFaktur mode="po" supplierId={f.supplierId} tanggalFaktur={f.orderDate} value={termin} onChange={setTermin} /></div>
          <Field label="Tanggal PO" required><Input type="date" value={f.orderDate} onChange={(e) => set("orderDate", e.target.value)} /></Field>
          <Field label="Estimasi kedatangan" hint="Boleh dikosongkan."><Input type="date" min={f.orderDate} value={f.expectedDate} onChange={(e) => set("expectedDate", e.target.value)} /></Field>
          <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="mis. kirim ke Gudang Utama sebelum Jumat" /></Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ink2">Item bahan baku</span>
            <button type="button" onClick={() => set("lines", [...f.lines, baris0()])} className="flex items-center gap-1 text-[12px] font-semibold text-accent max-sm:min-h-11"><Plus size={12} /> Tambah baris</button>
          </div>
          <div className="space-y-2">
            {f.lines.map((l, i) => {
              const m = bahan.get(l.materialId);
              const unitStok = l.materialBaru ? l.materialBaru.satuanStok : m?.unit ?? null;
              const g = (l.materialId || l.materialBaru || l.qty || l.unitPrice) ? galatBaris(l, unitStok) : null;
              const setara = teksSetara(l, unitStok);
              const kv = infoKonversi(l, unitStok);
              const satuanBeli = l.materialBaru ? (l.materialBaru.satuanBeli || l.materialBaru.satuanStok) : (l.satuanBeli || unitStok);
              return (
                <div key={i} className="rounded-lg border border-line p-2.5" data-testid="baris-po">
                  {l.materialBaru ? (
                    <div className="min-w-0 rounded-lg bg-surface px-3 py-2" data-testid="barang-baru">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <Badge variant="accent">Barang baru — akan dibuat saat PO disimpan</Badge>
                        <div className="flex items-center gap-3">
                          <button type="button" onClick={() => setBarangBaru({ baris: i, awal: l.materialBaru })} className="shrink-0 text-[12px] font-semibold text-accent max-sm:min-h-11">Ubah</button>
                          <button type="button" onClick={() => setBaris(i, { materialBaru: null })} className="shrink-0 text-[12px] font-semibold text-ink2 max-sm:min-h-11">Pakai material yang ada</button>
                        </div>
                      </div>
                      <div className="mt-1.5 break-words text-[13px] font-semibold text-ink">{l.materialBaru.nama}</div>
                      <div className="text-[11.5px] text-ink3">{labelJenisSku(l.materialBaru.jenis)} · satuan stok {labelSatuan(l.materialBaru.satuanStok)}{l.materialBaru.kodeSupplier ? ` · kode supplier ${l.materialBaru.kodeSupplier}` : ""}</div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <PemilihMaterial
                        materials={materials} value={l.materialId} nomor={i + 1} namaCadangan={po?.lines?.find((x) => x.materialId === l.materialId)?.nama}
                        onPilih={(id) => setBaris(i, { materialId: id, satuanBeli: "", faktorKonversi: "" })}
                      />
                      {!l.materialId && (bolehBuatSku ? (
                        <button type="button" onClick={() => setBarangBaru({ baris: i, awal: null })} className="flex items-center gap-1 text-[12px] font-semibold text-accent max-sm:min-h-11" data-testid="tombol-barang-baru"><Plus size={12} /> Buat Barang Baru</button>
                      ) : (
                        <p className="text-[11.5px] text-ink3" data-testid="petunjuk-barang-baru">Barangnya belum ada di master material? Minta Admin Finance membuat barang baru dari PO.</p>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[110px_minmax(0,1fr)_140px] sm:items-start">
                    <Field label={`Jumlah${satuanBeli ? ` (${labelSatuan(satuanBeli)})` : ""}`}>
                      <input
                        type="number" inputMode="decimal" min="0" step="any" value={l.qty} aria-label={`Jumlah baris ${i + 1}`}
                        onChange={(e) => setBaris(i, { qty: e.target.value })}
                        className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11"
                      />
                    </Field>
                    {!l.materialBaru && m ? (
                      <Field label="Satuan pembelian">
                        <div className="flex items-center gap-2">
                          <Pilihan value={l.satuanBeli || m.unit} onChange={(v) => setBaris(i, v === m.unit ? { satuanBeli: "", faktorKonversi: "" } : { satuanBeli: v })} aria-label={`Satuan pembelian baris ${i + 1}`}>
                            {SATUAN_OPSI.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                          </Pilihan>
                          {kv && (
                            <input
                              type="number" inputMode="decimal" min="0" step="any" value={l.faktorKonversi || ""} aria-label={`Faktor konversi baris ${i + 1}`} placeholder={`isi ${labelSatuan(m.unit)}`}
                              onChange={(e) => setBaris(i, { faktorKonversi: e.target.value })}
                              className="h-9 w-24 shrink-0 rounded-lg bg-surface px-2 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11"
                            />
                          )}
                        </div>
                      </Field>
                    ) : <div className="hidden sm:block" />}
                    <Field label={`Harga per ${satuanBeli ? labelSatuan(satuanBeli) : "satuan"} (Rp)`}>
                      <InputUang value={l.unitPrice} onChange={(v) => setBaris(i, { unitPrice: v })} aria-label={`Harga satuan baris ${i + 1}`} />
                    </Field>
                  </div>
                  {!kv && (
                    <details className="mt-2 rounded-lg bg-inset px-2.5 py-2" open={adaPendamping(l.pendamping)} data-testid="pendamping-po">
                      <summary className="cursor-pointer text-[12px] font-semibold text-ink2 max-sm:min-h-11">Jumlah fisik pendamping (opsional)</summary>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <Field label="Satuan pendamping" hint="mis. LEMBAR, KALENG">
                          <Input value={l.pendamping?.satuan ?? ""} onChange={(e) => setBaris(i, { pendamping: { ...l.pendamping, satuan: e.target.value } })} aria-label={`Satuan pendamping baris ${i + 1}`} />
                        </Field>
                        <Field label="Mode">
                          <Pilihan value={l.pendamping?.mode ?? ""} onChange={(v) => setBaris(i, { pendamping: { ...l.pendamping, mode: v } })} aria-label={`Mode pendamping baris ${i + 1}`}>
                            <option value="">— pilih mode —</option>
                            {MODE_PENDAMPING_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </Pilihan>
                        </Field>
                        {l.pendamping?.mode === "TETAP" && (
                          <Field label={`Rasio (1 ${satuanBeli ? labelSatuan(satuanBeli) : "satuan"} = …)`}>
                            <input type="number" inputMode="decimal" min="0" step="any" value={l.pendamping.rasio ?? ""} aria-label={`Rasio pendamping baris ${i + 1}`} onChange={(e) => setBaris(i, { pendamping: { ...l.pendamping, rasio: e.target.value } })}
                              className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                          </Field>
                        )}
                        {l.pendamping?.mode === "AKTUAL" && (
                          <Field label="Perkiraan jumlah (opsional)">
                            <input type="number" inputMode="decimal" min="0" step="any" value={l.pendamping.estimasi ?? ""} aria-label={`Perkiraan pendamping baris ${i + 1}`} onChange={(e) => setBaris(i, { pendamping: { ...l.pendamping, estimasi: e.target.value } })}
                              className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                          </Field>
                        )}
                      </div>
                      {l.pendamping?.mode && <p className="mt-1.5 text-[11.5px] text-ink3">{MODE_PENDAMPING_OPSI.find((o) => o.key === l.pendamping.mode)?.hint} Hanya informasi kontrol — tidak memengaruhi stok, nilai persediaan, atau jurnal.</p>}
                      {teksPratinjauPendamping(l.pendamping, l.qty, satuanBeli ? labelSatuan(satuanBeli) : "") && <p data-testid="pratinjau-pendamping" className="mt-1 text-[12px] font-medium text-accent">Tampil di PO: {teksPratinjauPendamping(l.pendamping, l.qty, satuanBeli ? labelSatuan(satuanBeli) : "")}</p>}
                    </details>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-[12px] text-ink2">Subtotal <strong className="tabular-nums text-ink">{formatUang(subtotal(l))}</strong></span>
                    {setara && <span data-testid="setara" className="text-[12px] font-medium text-accent">{setara}</span>}
                    {g && (l.materialId || l.materialBaru) && <span className="min-w-0 basis-full truncate text-[11.5px] text-orange sm:basis-auto">{g}</span>}
                    <button
                      type="button" onClick={() => set("lines", f.lines.length > 1 ? f.lines.filter((_, idx) => idx !== i) : f.lines)} disabled={f.lines.length === 1}
                      aria-label={`Hapus baris ${i + 1}`} className="ml-auto shrink-0 rounded-lg p-2 text-ink3 hover:bg-redbg hover:text-red disabled:opacity-30"
                    ><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          {materials.length === 0 && <p className="mt-1.5 text-[11.5px] text-ink3">Belum ada item aktif di katalog — {bolehBuatSku ? "gunakan “Buat Barang Baru” pada baris di atas." : "minta Admin Finance membuat barang baru, atau tambahkan lewat Stock & Material di Gudang."}</p>}
        </div>
      </div>
      {barangBaru && (
        <ModalBarangBaru
          awal={barangBaru.awal} supplierId={f.supplierId} supplierNama={namaSupplier}
          onClose={() => setBarangBaru(null)}
          onSimpan={(mb) => { setBaris(barangBaru.baris, { materialId: "", materialBaru: mb, satuanBeli: "", faktorKonversi: "" }); setBarangBaru(null); }}
          onPakaiMaterial={(id) => { setBaris(barangBaru.baris, { materialId: id, materialBaru: null, satuanBeli: "", faktorKonversi: "" }); setBarangBaru(null); }}
        />
      )}
    </Modal>
  );
}

// ── Detail PO ────────────────────────────────────────────────────────────
function ModalDetailPO({ id, onClose, onChanged, onUbah }) {
  const [po, setPo] = useState(null);
  const [galat, setGalat] = useState("");
  const [dialog, setDialog] = useState(null); // "batal" | "revisi"
  const [faktur, setFaktur] = useState(null); // { editBillId? } — formulir faktur
  const [setujuiFaktur, setSetujuiFaktur] = useState(null); // evaluasi faktur yang butuh catatan tinjauan harga
  const [tolakFaktur, setTolakFaktur] = useState(null);
  const [segar, setSegar] = useState(0);

  const muat = useCallback(async () => {
    try { setPo(await api.getPurchaseOrder(id)); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat PO"); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);
  const segarkan = useCallback(async () => { await muat(); await onChanged(); setSegar((n) => n + 1); }, [muat, onChanged]);

  async function jalankan(fn) {
    setGalat("");
    try { const baru = await fn(); setPo(baru); setDialog(null); await onChanged(); } catch (e) { setGalat(e.message || "Aksi gagal"); }
  }

  const aksi = po ? aksiPO(po) : null;

  // Pratinjau (tab baru) dan unduh PDF — murni baca; pola sama dengan Invoice Sales.
  const [sibukPdf, setSibukPdf] = useState(null);
  async function bukaPdf(unduh) {
    setSibukPdf(unduh ? "unduh" : "lihat"); setGalat("");
    try {
      const { blob, namaFile } = await api.getPurchaseOrderPdf(id);
      const url = URL.createObjectURL(blob);
      if (unduh) { const a = document.createElement("a"); a.href = url; a.download = namaFile; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
      else { window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    } catch (e) { setGalat(e.message || "Gagal membuat PDF"); } finally { setSibukPdf(null); }
  }
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
                <Button variant="neutral" onClick={() => bukaPdf(false)} disabled={!!sibukPdf} data-testid="po-pdf-lihat" className="max-sm:min-h-11 max-sm:px-4"><Eye size={14} /> {sibukPdf === "lihat" ? "Membuat…" : "Pratinjau PDF"}</Button>
                <Button variant="neutral" onClick={() => bukaPdf(true)} disabled={!!sibukPdf} data-testid="po-pdf-unduh" className="max-sm:min-h-11 max-sm:px-4"><Download size={14} /> {sibukPdf === "unduh" ? "Membuat…" : "Unduh PDF"}</Button>
                {["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"].includes(po.status) && <Button variant="neutral" onClick={() => setFaktur({})} className="max-sm:min-h-11 max-sm:px-4"><FileText size={14} /> Catat faktur</Button>}
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
        {!po ? <p className="py-6 text-[13px] text-ink3">Memuat…</p> : (
          <IsiDetail
            po={po} segar={segar}
            onUbahFaktur={(billId) => setFaktur({ editBillId: billId })}
            onSetujuiFaktur={setSetujuiFaktur}
            onTolakFaktur={setTolakFaktur}
            onGalat={setGalat}
            onSegarkan={segarkan}
          />
        )}
      </Modal>
      {faktur && po && (
        <ModalFaktur
          key={faktur.editBillId || "baru"} po={po} editBillId={faktur.editBillId} onClose={() => setFaktur(null)}
          onSaved={async () => { setFaktur(null); await segarkan(); }}
        />
      )}
      {setujuiFaktur && (
        <ModalSetujuiFaktur ev={setujuiFaktur} onClose={() => setSetujuiFaktur(null)} onSetujui={async (catatan) => { await api.approveFinanceBill(setujuiFaktur.billId, { catatanTinjauanHarga: catatan }); setSetujuiFaktur(null); await segarkan(); }} />
      )}
      {tolakFaktur && (
        <ModalAlasan
          judul={`Tolak faktur ${tolakFaktur.supplierRef || tolakFaktur.billNumber}`}
          deskripsi="Faktur yang ditolak tidak mengklaim barang apa pun. Catat faktur baru bila perlu."
          label="Alasan penolakan" tombol="Tolak Faktur" galat={galat}
          onClose={() => setTolakFaktur(null)}
          onSubmit={async (alasan) => { try { await api.rejectFinanceBill(tolakFaktur.billId, alasan); setTolakFaktur(null); await segarkan(); } catch (e) { setGalat(e.message || "Gagal menolak faktur"); } }}
        />
      )}
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

function IsiDetail({ po, segar, onUbahFaktur, onSetujuiFaktur, onTolakFaktur, onGalat, onSegarkan }) {
  const barisLaku = po.status !== "DRAFT";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeStatus status={po.status} />
        <span className="text-[12px] text-ink2">Dibuat oleh {po.createdBy?.name || "—"}{po.approvedBy ? ` · disetujui ${po.approvedBy.name} (${tglJam(po.approvedAt)})` : ""}</span>
      </div>
      {po.notes && <p className="text-[12.5px] text-ink2">{po.notes}</p>}
      <p className="m-0 text-[12.5px] text-ink2" data-testid="termin-po">Termin pembayaran: <strong className="text-ink">{po.termin ? teksTermin({ label: po.termin.label, sumber: po.termin.sumber }) : "belum ditetapkan"}</strong>{po.termin?.alasan ? ` — diganti: ${po.termin.alasan}` : ""}</p>
      {po.status === "DIBATALKAN" && <p className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">Dibatalkan {tglJam(po.cancelledAt)} — {po.cancelReason}</p>}

      <section>
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Item &amp; progres penerimaan</h4>
        <TableWrap className="hidden md:block">
          <Table>
            <THead><TR><TH>Item</TH><TH numeric>Dipesan</TH><TH numeric title="Dipesan dikurangi datang aktif (datang dikurangi yang ditolak)">Belum datang</TH><TH numeric title="Baik yang sudah disimpan ke stok">Masuk stok</TH><TH numeric title="Dipesan dikurangi masuk stok">Belum masuk stok</TH><TH numeric>Sudah ditagih</TH><TH numeric>Harga satuan</TH><TH numeric>Nilai PO</TH></TR></THead>
            <TBody>
              {po.lines.map((l) => (
                <TR key={l.id}>
                  <TD><div className="font-medium text-ink">{l.kode}</div><div className="text-[11.5px] text-ink2">{l.nama}</div>{l.konversi && <div data-testid="konversi-detail" className="text-[11.5px] text-accent">1 {labelSatuan(l.konversi.satuanBeli)} = {teksJumlah(l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)} · setara {teksJumlah(l.dipesan * l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)}</div>}</TD>
                  <TD numeric>{teksJumlah(l.dipesan)} {l.satuan}</TD>
                  <TD numeric className={l.progres.belumDatang > 0 && barisLaku ? "font-semibold text-ink" : ""}>{teksJumlah(l.progres.belumDatang)}</TD>
                  <TD numeric>{teksJumlah(l.progres.masukStok)}</TD>
                  <TD numeric className={l.progres.belumMasukStok > 0 && barisLaku ? "font-semibold text-ink" : ""}>{teksJumlah(l.progres.belumMasukStok)}</TD>
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
              {l.konversi && <div className="text-[11.5px] text-accent">1 {labelSatuan(l.konversi.satuanBeli)} = {teksJumlah(l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)} · setara {teksJumlah(l.dipesan * l.konversi.faktor)} {labelSatuan(l.konversi.satuanStok)}</div>}
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                <div><dt className="text-ink3">Dipesan</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.dipesan)} {l.satuan}</dd></div>
                <div><dt className="text-ink3">Belum datang</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.progres.belumDatang)}</dd></div>
                <div><dt className="text-ink3">Masuk stok</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.progres.masukStok)}</dd></div>
                <div><dt className="text-ink3">Belum masuk stok</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.progres.belumMasukStok)}</dd></div>
                <div><dt className="text-ink3">Sudah ditagih</dt><dd className="ml-0 tabular-nums">{teksJumlah(l.ditagih)}</dd></div>
                <div><dt className="text-ink3">Harga satuan</dt><dd className="ml-0 tabular-nums">{formatUang(l.hargaSatuan)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap justify-end gap-x-6 gap-y-1 text-[12.5px] text-ink2">
          <span>Nilai PO <strong className="tabular-nums text-ink">{formatUang(po.totalDipesan)}</strong></span>
          <span>Nilai masuk stok <strong className="tabular-nums text-ink">{formatUang(po.totalDiterima)}</strong></span>
          <span>Nilai sudah ditagih <strong className="tabular-nums text-ink">{formatUang(po.totalDitagih)}</strong></span>
        </div>
        {po.progresDefinisi && <div className="mt-2"><LegendaProgres definisi={po.progresDefinisi} /></div>}
        <p className="mt-1 text-[11.5px] text-ink3">“Sudah ditagih” dihitung dari penerimaan yang tagihan supplier-nya sudah disetujui. Tagihan menempel ke satu penerimaan, bukan ke baris.</p>
      </section>

      {po.kedatangan && po.status !== "DRAFT" && (
        <section data-testid="seksi-kedatangan">
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Kedatangan barang</h4>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {po.kedatangan.bendera.map((b) => <Badge key={b.kode} variant={b.kode === "TERLAMBAT" || b.kode === "DIBATALKAN" ? "red" : b.kode === "SELESAI" ? "green" : "accent"}>{b.label}</Badge>)}
            <span className="text-[12px] text-ink2" data-testid="status-termin-po">{po.kedatangan.terminStatus === "MENUNGGU_TANGGAL_PENERIMAAN" ? "Termin: menunggu tanggal penerimaan (termin berjalan dari tanggal barang tiba, bukan dari tanggal PO)" : "Termin berjalan per penerimaan dari tanggal barang tiba"}</span>
          </div>
          <PanelKedatangan
            po={po.kedatangan} workspace="FINANCE" bolehTulis={po.status !== "DIBATALKAN"} onChanged={onSegarkan}
            ekstraPenerimaan={(r) => {
              const lama = (po.penerimaan || []).find((x) => x.id === r.id);
              return (
                <p className="m-0 mt-1.5 text-[12px] text-ink2" data-testid="tagihan-penerimaan">
                  {!lama || lama.finSupplierBills.length === 0 ? "Belum ada tagihan" : lama.finSupplierBills.map((t) => `${t.billNumber} (${t.status === "DISETUJUI" ? "disetujui" : String(t.status).toLowerCase().replace(/_/g, " ")})`).join(", ")}
                </p>
              );
            }}
          />
        </section>
      )}
      <section hidden={!!po.kedatangan && po.status !== "DRAFT"}>
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

      <section data-testid="seksi-faktur">
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Faktur supplier atas PO ini</h4>
        {(po.faktur || []).length === 0 ? (
          <p className="text-[12.5px] text-ink3">{["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"].includes(po.status) ? "Belum ada faktur. Klik “Catat faktur” setelah faktur supplier diterima." : "Faktur bisa dicatat setelah PO disetujui."}</p>
        ) : (
          <div className="space-y-2">
            {po.faktur.map((fk) => (
              <KartuFaktur key={fk.id} fk={fk} segar={segar} onUbah={onUbahFaktur} onSetujui={onSetujuiFaktur} onTolak={onTolakFaktur} onGalat={onGalat} onSegarkan={onSegarkan} />
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[11.5px] text-ink3">Faktur dan pembayarannya tidak menambah stok. Jumlah yang menagih lebih dari barang baik yang belum ditagih akan <strong>tertahan</strong>; beda harga wajib tinjauan Finance (tanpa toleransi otomatis).</p>
      </section>

      {po.status !== "DRAFT" && (po.penerimaan || []).length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Jejak Biaya Bahan</h4>
          <JejakBiayaPO poId={po.id} segar={segar} />
        </section>
      )}

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

// Satu faktur: status pencocokan + tabel per baris (dipesan, diterima baik, sudah ditagih, diajukan, harga PO, harga faktur, selisih).
function KartuFaktur({ fk, segar, onUbah, onSetujui, onTolak, onGalat, onSegarkan }) {
  const [ev, setEv] = useState(null);
  const [galat, setGalat] = useState("");
  const [buka, setBuka] = useState(FAKTUR_TERBUKA.includes(fk.status));
  useEffect(() => {
    let batal = false;
    api.getFakturPurchaseOrder(fk.id).then((d) => { if (!batal) setEv(d); }).catch((e) => { if (!batal) setGalat(e.message); });
    return () => { batal = true; };
  }, [fk.id, fk.status, segar]);
  const st = statusFaktur(ev);
  const terbuka = FAKTUR_TERBUKA.includes(fk.status);

  async function setujui() {
    setGalat(""); onGalat("");
    if (ev?.perluTinjauanHarga) { onSetujui(ev); return; }
    try { await api.approveFinanceBill(fk.id, {}); await onSegarkan(); } catch (e) { setGalat(e.message); }
  }

  return (
    <div className="rounded-lg border border-line p-3 text-[12.5px]" data-testid="kartu-faktur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-ink">{fk.supplierRef || fk.billNumber}</span>
        <span className="text-ink3">{fk.billNumber}</span>
        <Badge variant={st.variant}>{st.label}</Badge>
        <span className="ml-auto tabular-nums text-ink">{formatUang(fk.amount)}</span>
        <button type="button" className="text-[12px] font-semibold text-accent" onClick={() => setBuka((v) => !v)}>{buka ? "Sembunyikan" : "Pencocokan"}</button>
      </div>
      {ev?.tertahan && (
        <ul className="mt-2 list-none space-y-1 p-0" data-testid="alasan-tertahan">
          {ev.alasanTertahan.map((a, i) => <li key={i} className="rounded-lg bg-redbg px-3 py-1.5 text-[12px] text-red">{a}</li>)}
        </ul>
      )}
      {buka && ev && (
        <>
          <TableWrap className="mt-2 hidden md:block">
            <Table>
              <THead><TR><TH>Item</TH><TH numeric>Dipesan</TH><TH numeric>Diterima baik</TH><TH numeric>Sudah ditagih</TH><TH numeric>Diajukan di faktur ini</TH><TH numeric>Harga PO</TH><TH numeric>Harga faktur</TH><TH numeric>Selisih</TH></TR></THead>
              <TBody>
                {ev.barisFaktur.map((b) => (
                  <TR key={b.id}>
                    <TD><div className="font-medium text-ink">{b.kode}</div></TD>
                    <TD numeric>{teksJumlah(b.dipesan)} {b.satuan}</TD>
                    <TD numeric>{teksJumlah(b.diterimaBaik)}</TD>
                    <TD numeric>{teksJumlah(b.sudahDitagih)}</TD>
                    <TD numeric className={b.melebihi ? "font-semibold text-red" : "font-semibold text-ink"}>{teksJumlah(b.diajukanIni)}</TD>
                    <TD numeric><Uang value={b.hargaPO} /></TD>
                    <TD numeric><Uang value={b.hargaFaktur} /></TD>
                    <TD numeric className={b.selisihHarga !== 0 ? "font-semibold text-orange" : ""}>{b.selisihHarga === 0 ? "—" : <><Uang value={b.selisihHarga} /> / sat · <Uang value={b.selisihNilai} /></>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <ul className="mt-2 list-none space-y-2 p-0 md:hidden">
            {ev.barisFaktur.map((b) => (
              <li key={b.id} className="rounded-lg border border-line p-2.5">
                <div className="font-medium text-ink">{b.kode}</div>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div><dt className="text-ink3">Dipesan</dt><dd className="ml-0 tabular-nums">{teksJumlah(b.dipesan)} {b.satuan}</dd></div>
                  <div><dt className="text-ink3">Diterima baik</dt><dd className="ml-0 tabular-nums">{teksJumlah(b.diterimaBaik)}</dd></div>
                  <div><dt className="text-ink3">Sudah ditagih</dt><dd className="ml-0 tabular-nums">{teksJumlah(b.sudahDitagih)}</dd></div>
                  <div><dt className="text-ink3">Diajukan di faktur ini</dt><dd className={cn("ml-0 tabular-nums", b.melebihi && "font-semibold text-red")}>{teksJumlah(b.diajukanIni)}</dd></div>
                  <div><dt className="text-ink3">Harga PO</dt><dd className="ml-0 tabular-nums">{formatUang(b.hargaPO)}</dd></div>
                  <div><dt className="text-ink3">Harga faktur</dt><dd className="ml-0 tabular-nums">{formatUang(b.hargaFaktur)}</dd></div>
                  <div className="col-span-2"><dt className="text-ink3">Selisih</dt><dd className={cn("ml-0 tabular-nums", b.selisihHarga !== 0 && "font-semibold text-orange")}>{b.selisihHarga === 0 ? "—" : `${formatUang(b.selisihHarga)} per satuan · ${formatUang(b.selisihNilai)}`}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          {ev.perluTinjauanHarga && terbuka && <p className="mt-2 rounded-lg bg-orangebg px-3 py-1.5 text-[12px] text-orange" data-testid="perlu-tinjauan">Harga faktur berbeda dari harga PO (selisih {formatUang(ev.selisihHargaTotal)}). Wajib ditinjau Finance saat menyetujui; selisihnya masuk Selisih Harga Pembelian.</p>}
          {ev.catatanTinjauan && <p className="mt-2 text-[12px] text-ink2">Catatan tinjauan: {ev.catatanTinjauan}</p>}
          {ev.alokasi?.length > 0 && <p className="mt-1 text-[11.5px] text-ink3">Menagih penerimaan: {[...new Set(ev.alokasi.map((a) => a.receiptNumber))].join(", ")}</p>}
          {ev.termBasis === "TANGGAL_TIBA" && (
            <div className="mt-2" data-testid="jadwal-jatuh-tempo-faktur">
              <h5 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Jadwal jatuh tempo per penerimaan</h5>
              {(ev.jadwalJatuhTempo || []).length === 0 ? <p className="m-0 text-[12px] text-ink2">Menunggu tanggal penerimaan — jatuh tempo dihitung dari tanggal barang tiba yang dicatat pada penerimaan.</p> : (
                <ul className="m-0 list-none space-y-1 p-0">
                  {ev.jadwalJatuhTempo.map((j) => (
                    <li key={j.penerimaanId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-inset px-2.5 py-1.5 text-[12px]" data-testid="jadwal-item">
                      <span className="font-mono font-semibold text-ink">{j.nomorPenerimaan}</span>
                      <span className="text-ink2">tiba {j.tanggalTiba ? tgl(j.tanggalTiba) : "—"}</span>
                      <span className="text-ink">{j.jatuhTempo ? `jatuh tempo ${tgl(j.jatuhTempo)}` : j.statusLabel}</span>
                      <span className="ml-auto tabular-nums text-ink2">{formatUang(j.nilai)} · dibayar {formatUang(j.dibayar)} · sisa {formatUang(j.sisa)}</span>
                      <Badge variant={j.status === "LUNAS" ? "green" : j.terlambat ? "red" : "neutral"}>{j.terlambat ? "Terlambat" : j.statusLabel}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11.5px] text-ink3">Total jadwal sama dengan nilai faktur — utang tetap satu per faktur; pembayaran menutup jadwal yang paling awal jatuh tempo lebih dulu.</p>
            </div>
          )}
        </>
      )}
      {galat && <p role="alert" className="mt-2 rounded-lg bg-redbg px-3 py-1.5 text-[12px] text-red">{galat}</p>}
      {terbuka && (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="neutral" onClick={() => onTolak({ ...fk, billId: fk.id })}>Tolak</Button>
          <Button size="sm" variant="neutral" onClick={() => onUbah(fk.id)}><Pencil size={13} /> Ubah</Button>
          <TombolAksi size="sm" disabled={!ev || ev.tertahan} title={ev?.tertahan ? "Faktur tertahan — lihat alasan di atas" : undefined} onClick={setujui}>Setujui</TombolAksi>
        </div>
      )}
    </div>
  );
}

// Formulir faktur atas PO: per baris jumlah & harga faktur, dengan petunjuk dini (akan tertahan / beda harga). Server tetap memutuskan.
function ModalFaktur({ po, editBillId, onClose, onSaved }) {
  const mengubah = !!editBillId;
  const [kunci] = useState(idKunci);
  const [termin, setTermin] = useState(TERMIN_AWAL);
  const [p, setP] = useState(null);
  const [f, setF] = useState(null);
  const [galat, setGalat] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setBaris = (i, patch) => setF((s) => ({ ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const pandangan = await api.getPenagihanPurchaseOrder(po.id);
        const ev = mengubah ? await api.getFakturPurchaseOrder(editBillId) : null;
        if (batal) return;
        setP(pandangan);
        setF(mengubah ? { ...formFakturDariEvaluasi({ ...ev, billDate: ev.billDate }, pandangan), billDate: ev.billDate ? String(ev.billDate).slice(0, 10) : hariIniISO() } : formFakturAwal(pandangan, hariIniISO()));
      } catch (e) { if (!batal) setGalat(e.message || "Gagal memuat data penagihan"); }
    })();
    return () => { batal = true; };
  }, [po.id, editBillId, mengubah]);

  const galatForm = f ? (galatFaktur(f, { edit: mengubah }) || galatTermin(termin, { perluTanggal: false })) : "Memuat…";
  const total = f ? totalFaktur(f.lines) : 0;
  const barisPO = new Map((p?.barisPO || []).map((b) => [b.purchaseOrderLineId, b]));

  async function simpan() {
    setGalat("");
    try {
      const body = bodyFaktur({ ...f, termin }, { edit: mengubah });
      if (mengubah) await api.updateFakturPurchaseOrder(editBillId, body); else await api.createFakturPurchaseOrder(po.id, body, `fak-${kunci}`);
      await onSaved();
    } catch (e) { setGalat(e.message || "Gagal menyimpan faktur"); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={mengubah ? "Ubah Faktur atas PO" : `Catat Faktur atas ${po.poNumber}`}
      description="Faktur dicocokkan per baris dengan PO. Disimpan sebagai Menunggu Persetujuan. Faktur dan pembayarannya tidak menambah stok."
      className="w-[860px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || (galatForm && f && f.supplierRef)) && <p role="alert" data-testid="galat-faktur" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatForm}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink2">Total faktur <strong className="tabular-nums text-ink">{formatUang(total)}</strong></span>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
              <TombolAksi disabled={!!galatForm} onClick={simpan}>{mengubah ? "Simpan Perubahan" : "Simpan Faktur"}</TombolAksi>
            </div>
          </div>
        </div>
      }
    >
      {!f ? <p className="py-6 text-[13px] text-ink3">{galat || "Memuat…"}</p> : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Nomor faktur supplier" required><Input value={f.supplierRef} onChange={(e) => set("supplierRef", e.target.value)} placeholder="mis. 2327/CR/EB/10/2026" aria-label="Nomor faktur supplier" /></Field>
            <Field label="Tanggal faktur" required><Input type="date" value={f.billDate} onChange={(e) => set("billDate", e.target.value)} /></Field>
          </div>
          <TerminFaktur purchaseOrderId={po.id} supplierId={po.supplier?.id} tanggalFaktur={f.billDate} value={termin} onChange={setTermin} />

          {p.penerimaan.length > 0 && (
            <div>
              <span className="mb-1 block text-[12px] font-semibold text-ink2">Penerimaan yang ditagih <span className="font-normal text-ink3">(kosong = semua penerimaan PO yang masih punya barang baik belum ditagih)</span></span>
              <div className="flex flex-wrap gap-2">
                {p.penerimaan.map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px]">
                    <input type="checkbox" checked={f.receiptIds.includes(r.id)} onChange={(e) => set("receiptIds", e.target.checked ? [...f.receiptIds, r.id] : f.receiptIds.filter((x) => x !== r.id))} />
                    <span className="font-mono">{r.receiptNumber}</span><span className="text-ink3">baik {teksJumlah(r.diterimaBaik)} · belum ditagih {teksJumlah(r.tersedia)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {f.lines.map((l, i) => {
              const b = barisPO.get(l.purchaseOrderLineId);
              const petunjuk = petunjukBaris(l, b) || [];
              return (
                <div key={l.purchaseOrderLineId} className="rounded-lg border border-line p-2.5" data-testid="baris-faktur">
                  <label className="flex items-start gap-2 text-[12.5px]">
                    <input type="checkbox" checked={l.pakai} onChange={(e) => setBaris(i, { pakai: e.target.checked, ...(e.target.checked && !l.qty && b.tersedia > 0 && { qty: String(b.tersedia) }) })} className="mt-0.5" aria-label={`Faktur baris ${b.kode}`} />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink">{b.kode}</span> <span className="text-ink2">{b.nama}</span>
                      <span className="mt-0.5 block text-[11.5px] text-ink3">Dipesan {teksJumlah(b.dipesan)} {b.satuan} · diterima baik {teksJumlah(b.diterimaBaik)} · sudah ditagih {teksJumlah(b.sudahDitagih)} · <strong className="text-ink2">tersedia {teksJumlah(b.tersedia)}</strong> · harga PO {formatUang(b.hargaPO)}</span>
                    </span>
                  </label>
                  {l.pakai && (
                    <div className="mt-2 grid grid-cols-1 gap-2 pl-6 sm:grid-cols-[120px_160px_1fr] sm:items-end">
                      <Field label={`Jumlah (${b.satuan})`}>
                        <input type="number" inputMode="decimal" min="0" step="any" value={l.qty} aria-label={`Jumlah faktur ${b.kode}`} onChange={(e) => setBaris(i, { qty: e.target.value })}
                          className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                      </Field>
                      <Field label="Harga faktur (Rp)"><InputUang value={l.unitPrice} onChange={(v) => setBaris(i, { unitPrice: v })} aria-label={`Harga faktur ${b.kode}`} /></Field>
                      <div className="text-[12px] text-ink2">Subtotal <strong className="tabular-nums text-ink">{formatUang(subtotalFaktur(l))}</strong></div>
                    </div>
                  )}
                  {petunjuk.map((x) => <p key={x.jenis} className={cn("mt-1.5 pl-6 text-[11.5px]", x.jenis === "tertahan" ? "text-red" : "text-orange")} data-testid={`petunjuk-${x.jenis}`}>{x.teks}</p>)}
                </div>
              );
            })}
          </div>

          {mengubah && <Field label="Alasan perubahan" required><Input value={f.reason} onChange={(e) => set("reason", e.target.value)} aria-label="Alasan perubahan" /></Field>}
        </div>
      )}
    </Modal>
  );
}

// Persetujuan faktur yang harganya berbeda dari PO: Finance wajib menulis catatan tinjauan (tidak ada toleransi otomatis).
function ModalSetujuiFaktur({ ev, onClose, onSetujui }) {
  const [catatan, setCatatan] = useState("");
  const [galat, setGalat] = useState("");
  const berbeda = ev.barisFaktur.filter((b) => b.selisihHarga !== 0);
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Tinjau selisih harga — ${ev.supplierRef || ev.billNumber}`} className="w-[560px]"
      description="Harga faktur berbeda dari harga PO. Setelah disetujui, selisihnya dijurnal ke Selisih Harga Pembelian (kebijakan yang sudah berlaku); GRNI ditutup sebesar harga PO."
      footer={
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Kembali</Button>
            <TombolAksi disabled={catatan.trim().length < 5} onClick={async () => { try { await onSetujui(catatan.trim()); } catch (e) { setGalat(e.message); } }}>Setujui dengan tinjauan</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-orangebg px-3 py-2 text-[13px] text-orange" data-testid="selisih-total">
          <div>Selisih harga total: <strong className="tabular-nums">{formatUang(Math.abs(ev.selisihHargaTotal))}</strong> {ev.selisihHargaTotal > 0 ? "LEBIH MAHAL dari PO (menjadi beban Selisih Harga Pembelian)" : "LEBIH MURAH dari PO (menjadi keuntungan Selisih Harga Pembelian)"}</div>
          <div className="mt-0.5 text-[12px]">Nilai faktur <span className="tabular-nums">{formatUang(ev.amount)}</span> · nilai menurut harga PO <span className="tabular-nums">{formatUang(ev.amount - ev.selisihHargaTotal)}</span></div>
        </div>
        <ul className="list-none space-y-1 p-0 text-[12.5px]">
          {berbeda.map((b) => (
            <li key={b.id} className="rounded-lg bg-inset px-3 py-1.5 text-ink2" data-testid="selisih-baris">{b.kode}: harga PO {formatUang(b.hargaPO)} → faktur {formatUang(b.hargaFaktur)} × {teksJumlah(b.diajukanIni)} = selisih <strong className="tabular-nums text-ink">{formatUang(b.selisihNilai)}</strong></li>
          ))}
        </ul>
        <Field label="Catatan tinjauan Finance" required hint={`Minimal 5 karakter (${catatan.trim().length}/5). Tersimpan permanen bersama nama peninjau.`}>
          <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. kenaikan harga disetujui Owner" aria-label="Catatan tinjauan" autoFocus />
        </Field>
      </div>
    </Modal>
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
  const valid = q > 0 && q >= baris.progres.masukStok && q !== baris.dipesan && alasan.trim().length >= 3;
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
        <Field label={`Jumlah baru (${baris.satuan})`} hint={`Sudah masuk stok ${teksJumlah(baris.progres.masukStok)}; jumlah baru tidak boleh lebih kecil.`}>
          <Input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Alasan revisi" required><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. supplier hanya sanggup kirim 8" /></Field>
      </div>
    </Modal>
  );
}
