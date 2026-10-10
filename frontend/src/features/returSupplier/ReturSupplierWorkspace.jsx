import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, PackageMinus, RefreshCw, ScrollText, Wallet } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TombolAksi, Pilihan } from "@/features/finance/shared.jsx";
import { UnggahBukti } from "@/features/kedatangan/PanelKedatangan.jsx";
import { cn } from "@/lib/utils.js";
import {
  ALASAN_RETUR, STATUS_RETUR, STATUS_DEBIT_NOTE, TEKS_KEPUTUSAN, jumlahTeks, rupiahTeks, tanggalTeks,
  formReturAwal, bodyRetur, galatRetur, galatKeluar, kalimatDampakDebitNote,
} from "@/features/returSupplier/returLogic.js";

// RETUR SUPPLIER & DEBIT NOTE — satu komponen untuk dua pintu (Gudang tanpa nilai; Finance dengan nilai, debit note, saldo kredit).
// Semua angka/kapasitas/blokir/dampak dari server (pratinjau). Aktor/peran/workspace dari sesi. Tanpa PIN; alasan wajib; Idempotency-Key dibuat per aksi.
const kunciAksi = (p) => `${p}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
const Lencana = ({ peta, kode, className }) => <Badge variant={peta[kode]?.variant || "neutral"} className={className}>{peta[kode]?.label ?? kode}</Badge>;

export default function ReturSupplierWorkspace({ workspace }) {
  const finance = workspace === "FINANCE";
  const A = useMemo(() => (finance
    ? { daftar: api.getReturFinance, detail: api.getReturFinanceDetail, kandidat: api.getKandidatReturFinance, pratinjau: api.pratinjauReturFinance, buat: api.buatReturFinance, batal: api.batalReturFinance, unggah: api.unggahBuktiReturFinance }
    : { daftar: api.getReturGudang, detail: api.getReturGudangDetail, kandidat: api.getKandidatReturGudang, pratinjau: api.pratinjauReturGudang, buat: api.buatReturGudang, batal: api.batalReturGudang, unggah: api.unggahBuktiReturGudang }), [finance]);
  const [tab, setTab] = useState("retur");
  const [daftar, setDaftar] = useState([]);
  const [debitNote, setDebitNote] = useState([]);
  const [kredit, setKredit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState("");
  const [buat, setBuat] = useState(false);
  const [bukaId, setBukaId] = useState(null);
  const [dnId, setDnId] = useState(null);
  const [kreditId, setKreditId] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true); setGalat("");
    try {
      const r = await A.daftar();
      setDaftar(r.retur ?? []);
      if (finance) {
        const [d, k] = await Promise.all([api.getDebitNoteSupplier(), api.getSaldoKreditSupplier()]);
        setDebitNote(d.debitNote ?? []); setKredit(k.kredit ?? []);
      }
    } catch (e) { setGalat(e.message || "Gagal memuat"); } finally { setLoading(false); }
  }, [A, finance]);
  useEffect(() => { muat(); }, [muat]);

  const menunggu = debitNote.filter((d) => d.status === "MENUNGGU").length;
  const totalKredit = kredit.reduce((s, k) => s + k.sisa, 0);
  const TABS = [
    { key: "retur", label: "Retur", Icon: PackageMinus, jml: daftar.length },
    ...(finance ? [{ key: "dn", label: "Debit Note", Icon: ScrollText, jml: menunggu }, { key: "kredit", label: "Saldo Kredit", Icon: Wallet, jml: kredit.length }] : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Retur Supplier"
        subtitle={finance ? "Retur untuk kredit: nilai, Debit Note yang menunggu persetujuan, dan saldo kredit supplier. Faktur yang sudah disetujui tidak diubah." : "Barang bermasalah yang dikembalikan ke supplier untuk kredit: catat kondisi dan konfirmasi barang keluar. Tanpa nilai rupiah."}
        actions={<div className="flex gap-2"><Button variant="ghost" size="sm" onClick={muat} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button><Button size="sm" onClick={() => setBuat(true)} data-testid="buat-retur"><PackageMinus size={14} /> Retur Baru</Button></div>}
      />
      <PageBody>
        <Card className="p-3 text-[12.5px] leading-relaxed text-ink2" data-testid="dua-keputusan">
          <p className="m-0"><strong className="text-ink">Dua keputusan untuk barang bermasalah.</strong></p>
          <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5">
            <li>{TEKS_KEPUTUSAN.pengganti}</li>
            <li>{TEKS_KEPUTUSAN.kredit}</li>
          </ul>
        </Card>
        <div role="tablist" aria-label="Bagian retur supplier" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {TABS.map(({ key, label, Icon, jml }) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`tab-${key}`}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium max-sm:min-h-11", tab === key ? "bg-accentbg text-accent" : "text-ink2 hover:bg-hovertint")}>
              <Icon size={14} aria-hidden /> {label}<span className="rounded-full bg-inset px-1.5 text-[11px] tabular-nums text-ink2">{jml}</span>
            </button>
          ))}
        </div>
        {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}

        {tab === "retur" && (
          daftar.length === 0 && !loading
            ? <Card><EmptyState icon={Inbox} title="Belum ada retur supplier" description="Retur untuk kredit dibuat dari barang yang sudah masuk stok." /></Card>
            : (
              <ul className="list-none space-y-2 p-0" data-testid="daftar-retur">
                {daftar.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setBukaId(r.id)} data-testid="kartu-retur" data-nomor={r.nomor}
                      className="w-full rounded-lg border border-line bg-surface p-3 text-left hover:bg-hovertint max-sm:min-h-11">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-ink">{r.nomor}</span>
                        <Lencana peta={STATUS_RETUR} kode={r.status} />
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-ink2">{r.supplier?.name} · PO {r.po?.poNumber} · {r.alasanLabel}</div>
                      <div className="mt-1 text-[12px] text-ink2">{r.lines.map((l) => `${l.kode} ${jumlahTeks(l.qty)} ${l.satuan}`).join(" · ")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]"><span className="font-medium text-ink" data-testid="tahap-retur">{r.tahap}</span>{r.debitNote && <Lencana peta={STATUS_DEBIT_NOTE} kode={r.debitNote.status} />}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )
        )}
        {tab === "dn" && finance && <DaftarDebitNote data={debitNote} onBuka={setDnId} />}
        {tab === "kredit" && finance && <DaftarKredit data={kredit} total={totalKredit} onPakai={setKreditId} onBatalPakai={muat} />}
      </PageBody>
      {buat && <DialogBuatRetur A={A} finance={finance} workspace={workspace} onClose={() => setBuat(false)} onDone={async (id) => { setBuat(false); await muat(); setBukaId(id); }} />}
      {bukaId && <DetailRetur A={A} finance={finance} workspace={workspace} id={bukaId} onClose={() => setBukaId(null)} onChanged={muat} onBukaDebitNote={(id) => { setBukaId(null); setTab("dn"); setDnId(id); }} />}
      {dnId && <DialogDebitNote id={dnId} onClose={() => setDnId(null)} onChanged={muat} />}
      {kreditId && <DialogPakaiKredit kredit={kredit.find((k) => k.id === kreditId)} onClose={() => setKreditId(null)} onDone={async () => { setKreditId(null); await muat(); }} />}
    </PageContainer>
  );
}

// ── Dialog: Retur Baru ───────────────────────────────────────────────────
function DialogBuatRetur({ A, finance, workspace, onClose, onDone }) {
  const [f, setF] = useState(formReturAwal);
  const [poList, setPoList] = useState([]);
  const [kandidat, setKandidat] = useState([]);
  const [pratinjau, setPratinjau] = useState(null);
  const [galat, setGalat] = useState("");
  const kunci = useRef(kunciAksi("retur"));
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); setPratinjau(null); };

  useEffect(() => {
    const ambil = finance ? api.getPurchaseOrders({ status: "DISETUJUI,DITERIMA_SEBAGIAN,SELESAI" }) : api.getGudangPurchaseOrders({ status: "DISETUJUI,DITERIMA_SEBAGIAN,SELESAI" });
    ambil.then((r) => setPoList((r.purchaseOrders ?? []).filter((p) => p.status !== "DRAFT"))).catch((e) => setGalat(e.message || "Gagal memuat PO"));
  }, [finance]);
  useEffect(() => {
    if (!f.poId) { setKandidat([]); return; }
    A.kandidat(f.poId).then((r) => setKandidat(r.baris ?? [])).catch((e) => setGalat(e.message || "Gagal memuat barang"));
  }, [f.poId, A]);

  const dini = galatRetur(f, kandidat);
  async function lihat() {
    setGalat("");
    try { setPratinjau(await A.pratinjau(bodyRetur(f))); } catch (e) { setGalat(e.message || "Gagal membuat pratinjau"); }
  }
  async function simpan() {
    setGalat("");
    try { const r = await A.buat(bodyRetur(f), kunci.current); await onDone(r.returnId); }
    catch (e) { setGalat(e.message || "Gagal membuat retur"); kunci.current = kunciAksi("retur"); }
  }
  const boleh = !dini && pratinjau?.boleh === true;
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title="Retur Baru — retur untuk kredit" className="w-[820px]"
      description={TEKS_KEPUTUSAN.kredit}
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || dini) && <p role="alert" data-testid="galat-retur" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || dini}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <Button variant="neutral" disabled={!!dini} onClick={lihat} data-testid="pratinjau-retur" className="max-sm:min-h-11">Pratinjau dampak</Button>
            <TombolAksi disabled={!boleh} onClick={simpan} data-testid="simpan-retur">Buat Draf Retur</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="m-0 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2">Ingin minta <strong className="text-ink">pengganti</strong>, bukan kredit? Jangan buat retur: tolak barangnya saat pemeriksaan lalu catat pengiriman pengganti di <strong className="text-ink">Barang Akan Datang</strong>.</p>
        <Field label="PO" required>
          <Pilihan value={f.poId} onChange={(v) => set("poId", v)} aria-label="PO yang diretur">
            <option value="">— pilih PO —</option>
            {poList.map((p) => <option key={p.id} value={p.id}>{p.poNumber} — {p.supplier?.name}</option>)}
          </Pilihan>
        </Field>
        {f.poId && (
          <div className="space-y-2" data-testid="kandidat-retur">
            <div className="text-[12px] font-semibold text-ink2">Barang yang sudah masuk stok</div>
            {kandidat.length === 0 && <p className="text-[12.5px] text-ink3">Belum ada barang baik yang disimpan ke stok dari PO ini.</p>}
            {kandidat.map((k) => (
              <div key={k.goodsReceiptLineId} className="rounded-lg border border-line p-2.5 text-[12.5px]" data-testid="baris-kandidat">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium text-ink">{k.kode} — {k.nama} · {k.nomorPenerimaan}</span>
                  <span className="text-[11.5px] text-ink3">Diterima baik {jumlahTeks(k.diterima)} {k.satuan} · sudah diretur {jumlahTeks(k.diretur)} · <strong className="text-ink2">boleh diretur {jumlahTeks(k.bolehDiretur)}</strong></span>
                </div>
                {k.blokir?.length > 0 && <ul className="m-0 mt-1.5 list-none space-y-1 p-0" data-testid="blokir-retur">{k.blokir.map((b) => <li key={b.kode}><Badge variant="orange">{b.pesan}</Badge></li>)}</ul>}
                {k.bolehDiretur > 0 && (
                  <div className="mt-2 max-w-[220px]">
                    <Field label={`Jumlah diretur (${k.satuan})`}>
                      <input type="number" inputMode="decimal" min="0" step="any" value={f.jumlah[k.goodsReceiptLineId] ?? ""} aria-label={`Jumlah retur ${k.kode} ${k.nomorPenerimaan}`}
                        onChange={(e) => set("jumlah", { ...f.jumlah, [k.goodsReceiptLineId]: e.target.value })}
                        className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                    </Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Alasan retur" required>
            <Pilihan value={f.reasonCode} onChange={(v) => set("reasonCode", v)} aria-label="Alasan retur">
              {ALASAN_RETUR.map((a) => <option key={a.kode} value={a.kode}>{a.label}</option>)}
            </Pilihan>
          </Field>
          <Field label="Penjelasan" required hint="Minimal 5 karakter."><Input value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="mis. busa pecah-pecah saat dibongkar" /></Field>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink2">Foto bukti kondisi barang <span className="text-red">*</span></div>
          <UnggahBukti workspace={workspace} value={f.evidenceUrls} onChange={(v) => set("evidenceUrls", v)} unggah={A.unggah} />
        </div>
        <Field label="Catatan (opsional)"><Input value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
        {pratinjau && (
          <div className="rounded-lg border border-line p-2.5 text-[12.5px]" data-testid="hasil-pratinjau">
            <div className="mb-1 text-[12px] font-semibold text-ink2">Pratinjau server</div>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {pratinjau.baris.map((b) => (
                <li key={b.goodsReceiptLineId}>
                  <span className="font-medium text-ink">{b.kode}</span> {jumlahTeks(b.qty)} {b.satuan} dari {b.nomorPenerimaan}: {b.boleh ? <span className="text-green">boleh</span> : <span className="text-red">tidak boleh</span>}
                  {b.boleh && <span className="text-ink2"> — {b.efek}{finance && b.nilaiPersediaan != null ? ` Nilai persediaan keluar ${rupiahTeks(b.nilaiPersediaan)}.` : ""}</span>}
                  {b.blokir.map((x) => <div key={x.kode} className="text-[12px] text-orange">{x.pesan}</div>)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Detail retur (+ konfirmasi barang keluar oleh Gudang) ───────────────
function DetailRetur({ A, finance, workspace, id, onClose, onChanged, onBukaDebitNote }) {
  const [r, setR] = useState(null);
  const [galat, setGalat] = useState("");
  const [mode, setMode] = useState(null); // "keluar" | "batal"
  const [f, setF] = useState({ pic: "", note: "", proofUrls: [], tanggal: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), alasan: "" });
  const kunci = useRef(kunciAksi("aksi"));
  const muat = useCallback(async () => { try { setR(await A.detail(id)); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat"); } }, [A, id]);
  useEffect(() => { muat(); }, [muat]);
  const dini = mode === "keluar" ? galatKeluar(f) : mode === "batal" && String(f.alasan).trim().length < 5 ? "Isi alasan pembatalan (minimal 5 karakter)" : null;
  const bolehKeluar = !finance && r?.status === "DRAFT";
  const bolehBatal = r && (r.status === "DRAFT" || (!finance && r.status === "KELUAR"));

  async function kirim() {
    setGalat("");
    try {
      if (mode === "keluar") await api.keluarkanReturGudang(id, { pic: f.pic.trim(), note: f.note.trim() || undefined, proofUrls: f.proofUrls, date: f.tanggal }, kunci.current);
      else await A.batal(id, { reason: f.alasan.trim() }, kunci.current);
      setMode(null); kunci.current = kunciAksi("aksi");
      await muat(); await onChanged?.();
    } catch (e) { setGalat(e.message || "Aksi gagal"); kunci.current = kunciAksi("aksi"); }
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} className="w-[820px]" title={r ? r.nomor : "Memuat retur…"}
      description={r ? `${r.supplier?.name} · PO ${r.po?.poNumber} · ${r.keputusanLabel}` : undefined}>
      {galat && <p role="alert" data-testid="galat-detail-retur" className="mb-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">{galat}</p>}
      {!r ? (galat ? null : <p className="py-6 text-[13px] text-ink3">Memuat…</p>) : (
        <div className="space-y-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2" data-testid="status-detail-retur">
            <Lencana peta={STATUS_RETUR} kode={r.status} />
            <span className="font-medium text-ink">{r.tahap}</span>
            {r.debitNote && <><Lencana peta={STATUS_DEBIT_NOTE} kode={r.debitNote.status} /><span className="font-mono text-[12px] text-ink2">{r.debitNote.nomor}</span></>}
          </div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <div><dt className="inline text-ink3">Alasan: </dt><dd className="inline">{r.alasanLabel} — {r.alasan}</dd></div>
            <div><dt className="inline text-ink3">Tanggal barang keluar: </dt><dd className="inline">{tanggalTeks(r.tanggalKeluar)}</dd></div>
            {r.konfirmasiKeluar && <div className="sm:col-span-2"><dt className="inline text-ink3">Dikonfirmasi keluar oleh PIC: </dt><dd className="inline">{r.konfirmasiKeluar.pic}{r.konfirmasiKeluar.catatan ? ` — ${r.konfirmasiKeluar.catatan}` : ""}</dd></div>}
            {r.dibatalkan && <div className="sm:col-span-2"><dt className="inline text-ink3">Dibatalkan: </dt><dd className="inline text-red">{r.dibatalkan.alasan}</dd></div>}
          </dl>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {r.lines.map((l) => (
              <li key={l.id} className="rounded-lg border border-line p-2.5" data-testid="baris-retur">
                <span className="font-medium text-ink">{l.kode} — {l.nama}</span> · {jumlahTeks(l.qty)} {l.satuan} · dari {l.nomorPenerimaan}
                {l.bagianBelumDitagih != null && <div className="text-[12px] text-ink2">Belum ditagih {jumlahTeks(l.bagianBelumDitagih)} · sudah ditagih {jumlahTeks(l.bagianSudahDitagih)}{finance && l.nilaiPersediaan != null ? ` · nilai persediaan ${rupiahTeks(l.nilaiPersediaan)}` : ""}</div>}
              </li>
            ))}
          </ul>
          {(r.bukti?.length > 0 || r.konfirmasiKeluar?.bukti?.length > 0) && <div className="flex flex-wrap gap-1.5">{[...r.bukti, ...(r.konfirmasiKeluar?.bukti ?? [])].map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Bukti retur" className="h-14 w-14 rounded-lg object-cover" /></a>)}</div>}
          {finance && r.debitNote && <Button variant="neutral" size="sm" onClick={() => onBukaDebitNote(r.debitNote.id)} data-testid="buka-debit-note">Buka Debit Note {r.debitNote.nomor}</Button>}

          {mode && (
            <div className="space-y-2 rounded-lg border border-line p-3" data-testid={`form-${mode}`}>
              {mode === "keluar" ? (
                <>
                  <p className="m-0 text-[12px] text-ink2">Konfirmasi hanya setelah barang <strong className="text-ink">benar-benar keluar</strong> dari gudang. Stok berkurang dan jurnal dibuat saat ini.</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="PIC yang menyerahkan" required><Input value={f.pic} onChange={(e) => setF({ ...f, pic: e.target.value })} placeholder="mis. Budi (Gudang)" aria-label="PIC yang menyerahkan" /></Field>
                    <Field label="Tanggal barang keluar" required><Input type="date" value={f.tanggal} onChange={(e) => setF({ ...f, tanggal: e.target.value })} aria-label="Tanggal barang keluar" /></Field>
                  </div>
                  <Field label="Catatan penyerahan (opsional)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
                  <UnggahBukti workspace={workspace} value={f.proofUrls} onChange={(v) => setF({ ...f, proofUrls: v })} unggah={A.unggah} />
                </>
              ) : (
                <Field label={r.status === "KELUAR" ? "Alasan pembatalan (barang kembali ke stok)" : "Alasan pembatalan"} required><Input value={f.alasan} onChange={(e) => setF({ ...f, alasan: e.target.value })} aria-label="Alasan pembatalan" /></Field>
              )}
              {dini && <p className="m-0 text-[12px] text-orange">{dini}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="neutral" size="sm" onClick={() => setMode(null)} className="max-sm:min-h-11">Kembali</Button>
                <TombolAksi size="sm" disabled={!!dini} onClick={kirim} data-testid={`kirim-${mode}`}>{mode === "keluar" ? "Konfirmasi Barang Keluar" : "Batalkan Retur"}</TombolAksi>
              </div>
            </div>
          )}
          {!mode && (
            <div className="flex flex-wrap justify-end gap-2">
              {bolehBatal && <Button variant="neutral" size="sm" onClick={() => setMode("batal")} className="max-sm:min-h-11" data-testid="aksi-batal">Batalkan Retur</Button>}
              {bolehKeluar && <Button size="sm" onClick={() => setMode("keluar")} className="max-sm:min-h-11" data-testid="aksi-keluar">Konfirmasi Barang Keluar</Button>}
              {finance && r.status === "DRAFT" && <p className="m-0 w-full text-right text-[12px] text-ink3">Barang dikeluarkan oleh Gudang; Finance menyetujui Debit Note setelahnya.</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Finance: Debit Note ──────────────────────────────────────────────────
function DaftarDebitNote({ data, onBuka }) {
  if (data.length === 0) return <Card><EmptyState icon={ScrollText} title="Belum ada Debit Note" description="Debit Note lahir saat barang yang sudah ditagih keluar dari gudang." /></Card>;
  return (
    <ul className="list-none space-y-2 p-0" data-testid="daftar-debit-note">
      {data.map((d) => (
        <li key={d.id}>
          <button type="button" onClick={() => onBuka(d.id)} data-testid="kartu-debit-note" data-nomor={d.nomor} className="w-full rounded-lg border border-line bg-surface p-3 text-left hover:bg-hovertint max-sm:min-h-11">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13.5px] font-semibold text-ink">{d.nomor}</span><Lencana peta={STATUS_DEBIT_NOTE} kode={d.status} /></div>
            <div className="mt-0.5 text-[12.5px] text-ink2">{d.supplier?.name} · retur {d.retur?.returnNumber}</div>
            <div className="mt-1 text-[12px] tabular-nums text-ink2">Nilai {rupiahTeks(d.nilai)} · kurangi sisa utang {rupiahTeks(d.kurangiSisaUtang)} · saldo kredit {rupiahTeks(d.jadiSaldoKredit)}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DialogDebitNote({ id, onClose, onChanged }) {
  const [p, setP] = useState(null);
  const [galat, setGalat] = useState("");
  const [mode, setMode] = useState(null);
  const [catatan, setCatatan] = useState("");
  const kunci = useRef(kunciAksi("dn"));
  const muat = useCallback(async () => { try { setP(await api.getPratinjauDebitNote(id)); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat"); } }, [id]);
  useEffect(() => { muat(); }, [muat]);
  async function kirim() {
    setGalat("");
    try {
      if (mode === "setuju") await api.setujuiDebitNote(id, { note: catatan.trim() || undefined, kurangiSisaDiharapkan: p.kurangiSisaUtang }, kunci.current);
      else await api.batalDebitNote(id, { reason: catatan.trim() }, kunci.current);
      setMode(null); setCatatan(""); kunci.current = kunciAksi("dn");
      await muat(); await onChanged?.();
    } catch (e) { setGalat(e.message || "Aksi gagal"); kunci.current = kunciAksi("dn"); }
  }
  const dini = mode === "batal" && catatan.trim().length < 5 ? "Isi alasan pembatalan (minimal 5 karakter)" : null;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} className="w-[820px]" title={p ? `Debit Note ${p.nomor}` : "Memuat debit note…"} description={p ? `${p.supplier?.name} · retur ${p.retur?.returnNumber}` : undefined}>
      {galat && <p role="alert" data-testid="galat-debit-note" className="mb-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">{galat}</p>}
      {!p ? (galat ? null : <p className="py-6 text-[13px] text-ink3">Memuat…</p>) : (
        <div className="space-y-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2"><Lencana peta={STATUS_DEBIT_NOTE} kode={p.status} /><span className="text-ink2" data-testid="dampak-debit-note">{kalimatDampakDebitNote(p)}</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Nilai debit note", p.nilai], ["Nilai persediaan (penutup GRNI)", p.nilaiPersediaan], ["Mengurangi sisa utang", p.kurangiSisaUtang], ["Menjadi saldo kredit", p.jadiSaldoKredit]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-inset px-3 py-2"><div className="text-[11px] text-ink3">{l}</div><div className="text-[14px] font-semibold tabular-nums text-ink">{rupiahTeks(v)}</div></div>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Per faktur</div>
            <ul className="m-0 list-none space-y-1 p-0">{p.perFaktur.map((f) => <li key={f.billId} className="rounded-lg border border-line px-3 py-1.5 tabular-nums" data-testid="baris-faktur-dn"><span className="font-mono text-[12px] text-ink">{f.nomor}</span> ({f.status}) — debit {rupiahTeks(f.nilaiDebit)} · kurangi sisa {rupiahTeks(f.kurangiSisa)} · kredit {rupiahTeks(f.jadiKredit)}</li>)}</ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Jurnal tertaut saat disetujui</div>
            <ul className="m-0 list-none space-y-0.5 p-0 tabular-nums text-ink2">{p.jurnal.map((j) => <li key={j.akun}>{j.debit > 0 ? `Dr ${j.akun} ${rupiahTeks(j.debit)}` : `Cr ${j.akun} ${rupiahTeks(j.kredit)}`}</li>)}</ul>
          </div>
          <p className="m-0 text-[12px] text-ink3">{p.keterangan}</p>
          {mode && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <Field label={mode === "setuju" ? "Catatan persetujuan (opsional)" : "Alasan pembatalan"} required={mode === "batal"}><Input value={catatan} onChange={(e) => setCatatan(e.target.value)} aria-label="Catatan" /></Field>
              {dini && <p className="m-0 text-[12px] text-orange">{dini}</p>}
              <div className="flex flex-wrap justify-end gap-2"><Button variant="neutral" size="sm" onClick={() => setMode(null)}>Kembali</Button><TombolAksi size="sm" disabled={!!dini} onClick={kirim} data-testid={`kirim-dn-${mode}`}>{mode === "setuju" ? "Setujui Debit Note" : "Batalkan Debit Note"}</TombolAksi></div>
            </div>
          )}
          {!mode && (
            <div className="flex flex-wrap justify-end gap-2">
              {p.status !== "DIBATALKAN" && <Button variant="neutral" size="sm" onClick={() => setMode("batal")} className="max-sm:min-h-11" data-testid="aksi-batal-dn">Batalkan</Button>}
              {p.status === "MENUNGGU" && <Button size="sm" onClick={() => setMode("setuju")} className="max-sm:min-h-11" data-testid="aksi-setuju-dn">Setujui</Button>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Finance: saldo kredit ────────────────────────────────────────────────
function DaftarKredit({ data, total, onPakai, onBatalPakai }) {
  const [galat, setGalat] = useState("");
  async function batal(appId) {
    const alasan = window.prompt("Alasan membatalkan pemakaian saldo kredit (minimal 5 karakter):") ?? "";
    if (alasan.trim().length < 5) return;
    try { await api.batalPemakaianKredit(appId, { reason: alasan.trim() }); await onBatalPakai(); } catch (e) { setGalat(e.message || "Gagal membatalkan"); }
  }
  if (data.length === 0) return <Card><EmptyState icon={Wallet} title="Tidak ada saldo kredit" description="Saldo kredit lahir dari Debit Note yang melebihi sisa utang faktur (faktur sudah dibayar)." /></Card>;
  return (
    <div className="space-y-2" data-testid="daftar-kredit">
      <p className="m-0 text-[12.5px] text-ink2">Total saldo kredit aktif <strong className="tabular-nums text-ink">{rupiahTeks(total)}</strong>. Dipakai pada faktur berikutnya hanya atas pilihan dan konfirmasi Finance; tidak ada uang kembali otomatis.</p>
      {galat && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
      <ul className="list-none space-y-2 p-0">
        {data.map((k) => (
          <li key={k.id} className="rounded-lg border border-line bg-surface p-3" data-testid="kartu-kredit">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13.5px] font-semibold text-ink">{k.supplier}</span><Badge variant={k.sisa > 0 ? "accent" : "neutral"}>Sisa {rupiahTeks(k.sisa)}</Badge></div>
            <div className="mt-0.5 text-[12px] tabular-nums text-ink2">Dari {k.debitNote} · jumlah {rupiahTeks(k.jumlah)} · terpakai {rupiahTeks(k.terpakai)}</div>
            {k.pemakaian.map((a) => <div key={a.id} className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink2">Dipakai {rupiahTeks(a.jumlah)} pada {a.faktur}<button type="button" onClick={() => batal(a.id)} className="text-accent underline max-sm:min-h-11">batalkan</button></div>)}
            {k.sisa > 0 && <div className="mt-2"><Button size="sm" onClick={() => onPakai(k.id)} className="max-sm:min-h-11" data-testid="pakai-kredit">Pakai pada faktur…</Button></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DialogPakaiKredit({ kredit, onClose, onDone }) {
  const [pv, setPv] = useState(null);
  const [billId, setBillId] = useState("");
  const [jumlah, setJumlah] = useState("");
  const [yakin, setYakin] = useState(false);
  const [galat, setGalat] = useState("");
  const kunci = useRef(kunciAksi("kredit"));
  const muat = useCallback(async (b = "", j = "") => {
    try { setPv(await api.getPratinjauPemakaianKredit(kredit.id, { billId: b || undefined, jumlah: j || undefined })); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat pratinjau"); }
  }, [kredit.id]);
  useEffect(() => { muat(); }, [muat]);
  const pilih = (b) => { setBillId(b); setYakin(false); const f = pv?.faktur.find((x) => x.billId === b); setJumlah(f ? String(f.maksimalDipakai) : ""); muat(b, f ? String(f.maksimalDipakai) : ""); };
  const ubahJumlah = (v) => { setJumlah(v); setYakin(false); if (billId) muat(billId, v); };
  async function terapkan() {
    setGalat("");
    try { await api.terapkanSaldoKredit(kredit.id, { billId, jumlah: Number(jumlah), konfirmasi: true, sisaFakturDilihat: pv.pilihan.sisaUtangSebelum }, kunci.current); await onDone(); }
    catch (e) { setGalat(e.message || "Gagal memakai saldo kredit"); kunci.current = kunciAksi("kredit"); }
  }
  const sah = pv?.pilihan && Number(jumlah) > 0 && Number(jumlah) <= pv.pilihan.maksimal && yakin;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} className="w-[640px]" title={`Pakai saldo kredit — ${kredit.supplier}`} description={`Sisa saldo ${rupiahTeks(pv?.sisaKredit ?? kredit.sisa)}. Pilih faktur dan konfirmasi; tidak otomatis.`}
      footer={<div className="flex w-full flex-col gap-2">{galat && <p role="alert" data-testid="galat-kredit" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">{galat}</p>}<div className="flex justify-end gap-2"><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11">Batal</Button><TombolAksi disabled={!sah} onClick={terapkan} data-testid="terapkan-kredit">Pakai Saldo Kredit</TombolAksi></div></div>}>
      <div className="space-y-3 text-[12.5px]">
        <Field label="Faktur yang masih punya sisa utang" required>
          <Pilihan value={billId} onChange={pilih} aria-label="Faktur tujuan">
            <option value="">— pilih faktur —</option>
            {(pv?.faktur ?? []).map((f) => <option key={f.billId} value={f.billId}>{f.nomor}{f.nomorFaktur ? ` (${f.nomorFaktur})` : ""} — sisa {rupiahTeks(f.sisaUtang)}</option>)}
          </Pilihan>
        </Field>
        {pv && pv.faktur.length === 0 && <p className="m-0 text-ink3">Supplier ini belum punya faktur disetujui dengan sisa utang.</p>}
        {pv?.pilihan && (
          <>
            <Field label="Jumlah dipakai (Rp)" hint={`Maksimal ${rupiahTeks(pv.pilihan.maksimal)}`}><Input type="number" min="0" step="any" value={jumlah} onChange={(e) => ubahJumlah(e.target.value)} aria-label="Jumlah dipakai" /></Field>
            <div className="rounded-lg bg-inset px-3 py-2 tabular-nums" data-testid="pratinjau-kredit">
              Sisa utang faktur {rupiahTeks(pv.pilihan.sisaUtangSebelum)} → <strong className="text-ink">{rupiahTeks(pv.pilihan.sisaUtangSesudah)}</strong> · sisa saldo kredit → <strong className="text-ink">{rupiahTeks(pv.pilihan.sisaKreditSesudah)}</strong>. Tidak ada jurnal baru dan tidak ada uang keluar.
            </div>
            <label className="flex items-start gap-2 max-sm:min-h-11"><input type="checkbox" checked={yakin} onChange={(e) => setYakin(e.target.checked)} className="mt-0.5" aria-label="Konfirmasi pemakaian saldo kredit" /><span>Saya sudah memeriksa pratinjau dan mengonfirmasi pemakaian saldo kredit ini pada faktur tersebut.</span></label>
          </>
        )}
      </div>
    </Modal>
  );
}
