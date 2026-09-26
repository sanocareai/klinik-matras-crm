import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, Loader2, Plus, Copy, Bookmark, Trash2, AlertTriangle, Info } from "lucide-react";
import { api } from "@/api.js";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { TableWrap, Table, ColGroup, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { useContainerTier } from "@/hooks/useContainerTier.js";
import { HalamanFinance, KartuAngka, JudulKartu, TombolAksi, Pilihan, InputUang, Uang, formatUang, tanggalPendek, tanggalJam } from "@/features/finance/shared.jsx";
import {
  statusLabel, statusVariant, STATUS_FILTERS, bolehEditAjukan, bolehTarik, bolehBatalkan, labelAjukan, deskripsiAudit, riwayatRevisi,
} from "@/features/armada/pengajuanBiayaStatus.js";
import {
  WORKSPACES_UI, FORM_KOSONG, bentukPayload, galatForm, kekuranganAjukan, konteksLabel, payloadTemplate, terapkanTemplate,
  terapkanPilihanTerakhir, teksDuplikat, LABEL_SUMBER_DANA, PESAN_BUKAN_STOK,
} from "@/features/pengajuanBiaya/logika.js";

// PENGAJUAN BIAYA PRODUKSI & GUDANG (C1). Halaman generik berbasis konfigurasi server (GET /expense-submissions/config):
// jenis biaya, tautan, metadata wajib, dan alasan mendesak datang dari backend. Mengajukan membuat SATU FinExpense lewat
// service bersama — approval, pembayaran, dan koreksi tetap di Finance (Pengeluaran + Edit & Koreksi Aman), tidak ada jalur ledger baru.

const tierKolom = (w) => (w >= 1250 ? "full" : w >= 768 ? "minimal" : "card");

function BuktiUploader({ id, proofs, onSaved, bisa }) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  async function pilih(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSibuk(true); setGalat("");
    try {
      const fd = new FormData();
      fd.append("bukti", file);
      await api.uploadPengajuanBukti(id, fd);
      onSaved();
    } catch (err) { setGalat(err.message); } finally { setSibuk(false); }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {(proofs || []).map((p) => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={`Versi ${p.version}`} className="block h-16 w-16 overflow-hidden rounded-lg border border-line">
            <img src={p.url} alt={`Foto nota versi ${p.version}`} className="h-full w-full object-cover" />
          </a>
        ))}
        {bisa && (
          <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-[11px] text-ink2 hover:border-accent hover:text-accent max-sm:h-20 max-sm:w-20">
            {sibuk ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            {sibuk ? "Mengunggah…" : (proofs || []).length ? "Ganti" : "Foto nota"}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={pilih} disabled={sibuk} />
          </label>
        )}
      </div>
      {galat && <p className="text-[12px] text-red">{galat}</p>}
    </div>
  );
}

export default function PengajuanBiayaWorkspace({ workspace }) {
  const ui = WORKSPACES_UI[workspace];
  const [cfg, setCfg] = useState(null);
  const [opsi, setOpsi] = useState({ mesin: [], gudang: [], material: [], unit: [], order: [], pengguna: [] });
  const [recent, setRecent] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tableRef, tier] = useContainerTier((w) => tierKolom(w));

  const [form, setForm] = useState({ ...FORM_KOSONG });
  const [editId, setEditId] = useState(null);
  const [formBuka, setFormBuka] = useState(false);
  const [galat, setGalat] = useState("");
  const [dup, setDup] = useState([]);
  const [uangMuka, setUangMuka] = useState([]);
  const [cariTeks, setCariTeks] = useState("");
  const [detail, setDetail] = useState(null);
  const [pesan, setPesan] = useState(null);
  const timer = useRef(null);

  const muatRingan = useCallback(async () => {
    const [t, r] = await Promise.all([api.getPengajuanTemplates().catch(() => ({ templates: [] })), api.getPengajuanRecent(ui.division).catch(() => null)]);
    setTemplates((t.templates || []).filter((x) => x.division === ui.division));
    setRecent(r);
  }, [ui.division]);

  const muatDaftar = useCallback(async () => {
    const res = await api.getExpenseSubmissions({ division: ui.division, status: status || undefined });
    setRows(res.submissions || []);
  }, [ui.division, status]);

  const muat = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [c, o] = await Promise.all([api.getExpenseSubmissionConfig(workspace), api.getPengajuanOpsi({ workspace })]);
      setCfg(c); setOpsi(o);
      await Promise.all([muatDaftar(), muatRingan()]);
    } catch (e) { setError(e.message || "Gagal memuat"); } finally { setLoading(false); }
  }, [workspace, muatDaftar, muatRingan]);
  useEffect(() => { muat(); }, [muat]);
  useEffect(() => { if (cfg) muatDaftar().catch(() => setRows([])); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // pencarian unit/order/material (server, min. 2 huruf)
  useEffect(() => {
    if (cariTeks.trim().length < 2) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => api.getPengajuanOpsi({ workspace, q: cariTeks.trim() }).then((o) => setOpsi((s) => ({ ...s, unit: o.unit, order: o.order, material: o.material }))).catch(() => {}), 350);
    return () => clearTimeout(timer.current);
  }, [cariTeks, workspace]);

  // peringatan duplikat (tidak pernah memblokir)
  useEffect(() => {
    if (!formBuka || !form.expenseType || !form.date || !form.amount) { setDup([]); return undefined; }
    const t = setTimeout(() => {
      api.cekDuplikatPengajuan({
        division: ui.division, expenseType: form.expenseType, date: form.date, amount: form.amount, picUserId: form.picUserId || undefined,
        workCenterId: form.workCenterId || undefined, warehouseId: form.warehouseId || undefined, unitId: form.unitId || undefined, excludeId: editId || undefined,
      }).then((r) => setDup(r.kandidat || [])).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [formBuka, form.expenseType, form.date, form.amount, form.picUserId, form.workCenterId, form.warehouseId, form.unitId, editId, ui.division]);

  const pakaiUangMuka = form.sumberDana === "UANG_MUKA_OPERASIONAL";
  useEffect(() => {
    if (!formBuka || !pakaiUangMuka) { setUangMuka([]); return; }
    api.getUangMukaAktifPengajuan({ requestedById: form.requestedById || undefined, picUserId: form.picUserId || undefined }).then((r) => setUangMuka(r.items || [])).catch(() => setUangMuka([]));
  }, [formBuka, pakaiUangMuka, form.requestedById, form.picUserId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setMeta = (k, v) => setForm((f) => ({ ...f, metadata: { ...f.metadata, [k]: v } }));
  const metaFields = cfg && form.expenseType ? (cfg.metadataFieldsByType[form.expenseType] || []) : [];
  const wajibMendesak = !!cfg?.wajibAlasanMendesak?.includes(form.expenseType);
  const tautan = new Set(cfg?.relations || []);

  function buka(awal = FORM_KOSONG, id = null) {
    setForm({ ...FORM_KOSONG, ...awal, date: awal.date || new Date().toISOString().slice(0, 10) });
    setEditId(id); setGalat(""); setFormBuka(true);
  }
  function edit(r) {
    buka({
      expenseType: r.expenseType, date: String(r.date).slice(0, 10), amount: String(r.amount), vendorName: r.vendorName || "", sumberDana: r.sumberDana || "", advanceId: r.advanceId || "",
      workCenterId: r.workCenterId || "", unitId: r.unitId || "", orderId: r.orderId || "", warehouseId: r.warehouseId || "", materialId: r.materialId || "", documentRef: r.documentRef || "",
      picUserId: r.picUserId || "", requestedById: r.requestedById || "", requestedAt: r.requestedAt ? r.requestedAt.slice(0, 16) : "", sourceNote: r.sourceNote || "",
      urgentReason: r.urgentReason || "", description: r.description || "", notes: r.notes || "", metadata: r.metadata || {},
    }, r.id);
    setDetail(null);
  }
  function duplikasi(r) {
    edit(r); setEditId(null); setForm((f) => ({ ...f, date: new Date().toISOString().slice(0, 10), documentRef: "", advanceId: "" })); setDetail(null);
  }

  async function simpan(bukaDetail) {
    const g = galatForm(form, cfg);
    if (g) { setGalat(g); return; }
    setGalat("");
    try {
      const payload = bentukPayload(form, cfg, workspace);
      const hasil = editId ? await api.updateExpenseSubmissionDraft(editId, payload) : await api.createExpenseSubmission(payload);
      setFormBuka(false);
      setPesan({ jenis: "ok", teks: editId ? "Draf diperbarui." : `Draf ${hasil.submissionNumber} dibuat. Unggah foto nota lalu ajukan.` });
      await Promise.all([muatDaftar(), muatRingan()]);
      if (bukaDetail) setDetail(await api.getExpenseSubmission(hasil.id));
    } catch (e) { setGalat(e.message); }
  }

  async function bukaDetail(r) { try { setDetail(await api.getExpenseSubmission(r.id)); } catch (e) { setPesan({ jenis: "galat", teks: e.message }); } }
  async function segarkanDetail(id) { setDetail(await api.getExpenseSubmission(id)); await muatDaftar(); }
  async function aksi(fn, ok, id) {
    try { await fn(); if (ok) setPesan({ jenis: "ok", teks: ok }); await segarkanDetail(id); } catch (e) { setPesan({ jenis: "galat", teks: e.message }); }
  }
  async function simpanTemplate() {
    const nama = window.prompt("Nama template (mis. Servis quilting rutin):");
    if (!nama?.trim()) return;
    try { await api.createPengajuanTemplate({ label: nama.trim(), division: ui.division, payload: payloadTemplate(form) }); setPesan({ jenis: "ok", teks: "Template disimpan (tanpa tanggal & nominal)." }); await muatRingan(); } catch (e) { setGalat(e.message); }
  }

  const tampil = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!rows) return rows;
    if (!kw) return rows;
    return rows.filter((r) => [r.submissionNumber, r.description, r.vendorName, konteksLabel(r), r.picNameSnapshot].filter(Boolean).some((s) => String(s).toLowerCase().includes(kw)));
  }, [rows, q]);
  const jenisLabel = (kode) => cfg?.expenseTypes.find((t) => t.code === kode)?.label || kode;
  const menunggu = (tampil || []).filter((r) => r.status === "MENUNGGU_PERSETUJUAN").length;
  const perluRevisi = (tampil || []).filter((r) => r.status === "PERLU_REVISI").length;

  return (
    <HalamanFinance
      title={ui.judul} subtitle={ui.ringkas} loading={loading} error={error} onRetry={muat}
      actions={<TombolAksi onClick={() => buka()}><Plus size={14} /> Ajukan biaya</TombolAksi>}
    >
      <div className="flex items-start gap-2 rounded-xl bg-accentbg px-3.5 py-2.5 text-[12.5px] text-ink2" data-testid="bukan-stok">
        <Info size={15} className="mt-0.5 shrink-0 text-accent" />
        <div>
          <p>{PESAN_BUKAN_STOK}</p>
          {(cfg?.arahanModulLain || []).length > 0 && (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {cfg.arahanModulLain.map((a) => <Link key={a.path} to={a.path} className="underline decoration-dotted underline-offset-2 hover:text-accent">{a.ke}</Link>)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KartuAngka label="Pengajuan" value={(tampil || []).length} sub="sesuai filter" />
        <KartuAngka label="Menunggu persetujuan" value={menunggu} tone={menunggu ? "orange" : "default"} />
        <KartuAngka label="Perlu revisi" value={perluRevisi} tone={perluRevisi ? "orange" : "default"} sub="perbaiki lalu ajukan ulang" />
        <KartuAngka label="Total nominal" value={formatUang((tampil || []).reduce((n, r) => n + r.amount, 0))} />
      </div>

      {pesan && <div role="status" className={pesan.jenis === "ok" ? "rounded-xl bg-greenbg px-4 py-3 text-[13px] text-green" : "rounded-xl bg-redbg px-4 py-3 text-[13px] text-red"}>{pesan.teks}</div>}

      {templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="template">
          <span className="text-[12px] text-ink3">Template:</span>
          {templates.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-inset pl-3 pr-1 text-[12.5px]">
              <button type="button" className="min-h-8 py-1" onClick={() => { setForm({ ...terapkanTemplate(t.payload), date: new Date().toISOString().slice(0, 10) }); setEditId(null); setGalat(""); setFormBuka(true); }}>{t.label}</button>
              <button type="button" aria-label={`Hapus template ${t.label}`} className="grid h-8 w-8 place-items-center text-ink3 hover:text-red" onClick={async () => { await api.deletePengajuanTemplate(t.id); muatRingan(); }}><Trash2 size={13} /></button>
            </span>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <JudulKartu title="Daftar pengajuan" description="Draf → Ajukan → Perlu Revisi / Disetujui / Ditolak → Dibayar. Persetujuan & pembayaran oleh Finance." />
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, vendor, mesin, gudang…" aria-label="Cari pengajuan" className="max-w-xs" />
            <Pilihan value={status} onChange={setStatus} className="max-w-[14rem]" aria-label="Filter status">
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s ? statusLabel(s) : "Semua status"}</option>)}
            </Pilihan>
          </div>
        </CardContent>
        <div ref={tableRef} data-tier={tier}>
          {tampil === null ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">Memuat…</p></CardContent>
          ) : tampil.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3" data-testid="kosong">Belum ada pengajuan. Tekan "Ajukan biaya" untuk membuat yang pertama.</p></CardContent>
          ) : tier === "card" ? (
            <div className="space-y-2 p-3">
              {tampil.map((r) => (
                <button key={r.id} type="button" onClick={() => bukaDetail(r)} className="block w-full rounded-xl border border-line bg-surface p-3 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><span className="block font-mono text-[11.5px] text-ink3">{r.submissionNumber}</span><span className="block break-words text-[13px] font-medium text-ink">{jenisLabel(r.expenseType)}</span></span>
                    <Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-ink2 break-words">{konteksLabel(r) || r.description}</p>
                  <div className="mt-1 flex items-center justify-between text-[12px] text-ink3"><span>{tanggalPendek(r.date)}</span><Uang value={r.amount} className="font-semibold text-ink" /></div>
                </button>
              ))}
            </div>
          ) : (
            <TableWrap className="dh-table">
              <Table fixed>
                <ColGroup widths={tier === "full" ? [150, 96, 170, null, 120, 150, 88] : [150, null, 120, 150, 88]} />
                <THead><TR>
                  <TH sticky>Nomor</TH>{tier === "full" && <TH>Tanggal</TH>}{tier === "full" && <TH>Jenis</TH>}<TH>{tier === "full" ? "Konteks" : "Jenis & konteks"}</TH>
                  <TH numeric>Nominal</TH><TH>Status</TH><TH>Aksi</TH>
                </TR></THead>
                <TBody>
                  {tampil.map((r) => (
                    <TR key={r.id}>
                      <TD sticky className="font-mono text-[12px]"><span className="block min-w-0 truncate" title={r.submissionNumber}>{r.submissionNumber}</span></TD>
                      {tier === "full" && <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(r.date)}</TD>}
                      {tier === "full" && <TD><span className="block truncate" title={jenisLabel(r.expenseType)}>{jenisLabel(r.expenseType)}</span></TD>}
                      <TD className="min-w-0 overflow-hidden">
                        <span className="block truncate" title={r.description}>{tier === "full" ? (konteksLabel(r) || "—") : jenisLabel(r.expenseType)}</span>
                        <span className="block truncate text-[11px] text-ink3">{tier === "full" ? r.vendorName || "" : (konteksLabel(r) || r.vendorName || "")}</span>
                      </TD>
                      <TD numeric><Uang value={r.amount} /></TD>
                      <TD><Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge></TD>
                      <TD><TombolAksi size="sm" variant="secondary" onClick={() => bukaDetail(r)}>Buka</TombolAksi></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </div>
      </Card>

      {/* ── FORM ─────────────────────────────────────────────────────────────────────────────────────────── */}
      <Modal open={formBuka} onOpenChange={(o) => !o && setFormBuka(false)} title={editId ? "Ubah draf pengajuan" : "Ajukan biaya"} description={ui.ringkas}
        footer={<div className="flex w-full flex-wrap justify-end gap-2">
          <TombolAksi variant="ghost" onClick={() => setFormBuka(false)}>Batal</TombolAksi>
          <TombolAksi variant="secondary" onClick={simpanTemplate}><Bookmark size={14} /> Simpan sebagai template</TombolAksi>
          <TombolAksi onClick={() => simpan(true)}>Simpan draf & unggah nota</TombolAksi>
        </div>}>
        <div className="space-y-3" data-testid="form-pengajuan">
          {recent && (recent.jenisBiaya?.length > 0 || recent.mesin?.length > 0 || recent.gudang?.length > 0) && (
            <div className="space-y-1" data-testid="pilihan-terakhir">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink3">Pilihan terakhir</p>
              <div className="flex flex-wrap gap-1.5">
                {(recent.jenisBiaya || []).slice(0, 3).map((v) => <button key={`j${v}`} type="button" className="min-h-8 rounded-full bg-inset px-3 text-[12px]" onClick={() => setForm((f) => terapkanPilihanTerakhir(f, "jenisBiaya", v))}>{jenisLabel(v)}</button>)}
                {(recent.mesin || []).slice(0, 3).map((v) => <button key={`m${v.id}`} type="button" className="min-h-8 rounded-full bg-inset px-3 text-[12px]" onClick={() => setForm((f) => terapkanPilihanTerakhir(f, "mesin", v.id))}>{v.label}</button>)}
                {(recent.gudang || []).slice(0, 3).map((v) => <button key={`g${v.id}`} type="button" className="min-h-8 rounded-full bg-inset px-3 text-[12px]" onClick={() => setForm((f) => terapkanPilihanTerakhir(f, "gudang", v.id))}>{v.label}</button>)}
                {(recent.pilihanPic || []).slice(0, 3).map((v) => <button key={`p${v.id}`} type="button" className="min-h-8 rounded-full bg-inset px-3 text-[12px]" onClick={() => setForm((f) => terapkanPilihanTerakhir(f, "pic", v.id))}>PIC {v.label}</button>)}
                {(recent.sumberDana || []).slice(0, 2).map((v) => <button key={`s${v}`} type="button" className="min-h-8 rounded-full bg-inset px-3 text-[12px]" onClick={() => setForm((f) => terapkanPilihanTerakhir(f, "sumberDana", v))}>{LABEL_SUMBER_DANA[v] || v}</button>)}
              </div>
            </div>
          )}

          <Field label="Jenis biaya" required>
            <Pilihan value={form.expenseType} onChange={(v) => setForm((f) => ({ ...f, expenseType: v, metadata: {} }))}>
              <option value="">— pilih jenis biaya —</option>
              {(cfg?.expenseTypes || []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </Pilihan>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Tanggal" required><DatePicker value={form.date} onChange={(v) => set("date", v)} placeholder="Pilih tanggal" block /></Field>
            <Field label="Nominal (Rp)" required><InputUang value={form.amount} onChange={(v) => set("amount", v)} /></Field>
          </div>

          {tautan.has("machine") && (
            <Field label={`Mesin / area kerja${cfg?.relasiWajib?.[form.expenseType]?.includes("machine") ? "" : " (opsional)"}`} required={!!cfg?.relasiWajib?.[form.expenseType]?.includes("machine")}>
              <Pilihan value={form.workCenterId} onChange={(v) => set("workCenterId", v)}><option value="">{cfg?.relasiWajib?.[form.expenseType]?.includes("machine") ? "— pilih mesin —" : "— tidak ditautkan —"}</option>{opsi.mesin.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Pilihan>
            </Field>
          )}
          {tautan.has("warehouse") && (
            <Field label="Gudang (opsional)"><Pilihan value={form.warehouseId} onChange={(v) => set("warehouseId", v)}><option value="">— tidak ditautkan —</option>{opsi.gudang.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Pilihan></Field>
          )}
          {(tautan.has("unit") || tautan.has("order") || tautan.has("material")) && (
            <Field label={tautan.has("material") ? "Cari material (opsional)" : "Cari unit / order (opsional)"} hint="Ketik minimal 2 huruf, lalu pilih hasilnya. Unit selalu ikut order-nya.">
              <Input value={cariTeks} onChange={(e) => setCariTeks(e.target.value)} placeholder={tautan.has("material") ? "Kode atau nama material" : "Kode unit atau nomor order"} />
            </Field>
          )}
          {tautan.has("unit") && (opsi.unit.length > 0 || form.unitId) && (
            <Field label="Unit produksi"><Pilihan value={form.unitId} onChange={(v) => set("unitId", v)}><option value="">— tidak ditautkan —</option>{opsi.unit.map((u) => <option key={u.id} value={u.id}>{u.unitCode} · order {u.order?.orderNumber}</option>)}</Pilihan></Field>
          )}
          {tautan.has("order") && !form.unitId && opsi.order.length > 0 && (
            <Field label="Order"><Pilihan value={form.orderId} onChange={(v) => set("orderId", v)}><option value="">— tidak ditautkan —</option>{opsi.order.map((o) => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}</Pilihan></Field>
          )}
          {tautan.has("material") && (opsi.material.length > 0 || form.materialId) && (
            <Field label="Material terkait (konteks, bukan pembelian)"><Pilihan value={form.materialId} onChange={(v) => set("materialId", v)}><option value="">— tidak ditautkan —</option>{opsi.material.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}</Pilihan></Field>
          )}
          {tautan.has("document") && (
            <Field label="Nomor dokumen terkait (opsional)" hint="Hanya sebagai konteks (mis. GR-… untuk ongkos kurir barang datang). Dokumen pembelian/tagihan/pengeluaran yang sudah ada akan ditolak agar tidak terhitung dua kali.">
              <Input value={form.documentRef} onChange={(e) => set("documentRef", e.target.value)} placeholder="GR-DDMMYYYY-001" />
            </Field>
          )}

          {metaFields.map((f) => (
            <Field key={f.key} label={f.label} required={f.required}>
              <Input type={f.type === "number" || f.type === "decimal" ? "number" : "text"} value={form.metadata?.[f.key] ?? ""} onChange={(e) => setMeta(f.key, e.target.value)} />
            </Field>
          ))}
          <Field label="Vendor / tukang / toko"><Input value={form.vendorName} onChange={(e) => set("vendorName", e.target.value)} /></Field>
          <Field label="PIC pelaksana">
            <Pilihan value={form.picUserId} onChange={(v) => set("picUserId", v)}><option value="">— sama dengan pemohon —</option>{opsi.pengguna.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Pilihan>
          </Field>
          <Field label="Sumber dana" hint="Usulan pengaju; Finance yang menentukan rekening saat membayar.">
            <Pilihan value={form.sumberDana} onChange={(v) => setForm((f) => ({ ...f, sumberDana: v, advanceId: "" }))}>
              <option value="">— pilih sumber dana —</option>
              {(cfg?.sumberDana || []).map((s) => <option key={s.code} value={s.code}>{LABEL_SUMBER_DANA[s.code] || s.label}</option>)}
            </Pilihan>
          </Field>
          {pakaiUangMuka && (
            <Field label="Uang muka aktif" required hint={uangMuka.length ? undefined : "Tidak ada uang muka aktif milik pemohon/PIC."}>
              <Pilihan value={form.advanceId} onChange={(v) => set("advanceId", v)}>
                <option value="">— pilih uang muka —</option>
                {uangMuka.map((u) => <option key={u.id} value={u.id}>{u.advanceNumber} · sisa {formatUang(u.saldo ?? u.balance ?? 0)}</option>)}
              </Pilihan>
            </Field>
          )}
          {(wajibMendesak || form.urgentReason) && (
            <Field label="Alasan mendesak" required={wajibMendesak}><Input value={form.urgentReason} onChange={(e) => set("urgentReason", e.target.value)} placeholder="Mengapa tidak bisa menunggu?" /></Field>
          )}
          {cfg?.bolehCatatAtasNama && (
            <div className="space-y-3 rounded-xl bg-inset p-3" data-testid="catat-atas-nama">
              <p className="text-[12px] font-semibold text-ink2">Catat atas nama pemohon (permintaan WhatsApp/telepon)</p>
              <Field label="Pemohon"><Pilihan value={form.requestedById} onChange={(v) => set("requestedById", v)}><option value="">— saya sendiri —</option>{opsi.pengguna.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Pilihan></Field>
              <Field label="Sumber permintaan"><Input value={form.sourceNote} onChange={(e) => set("sourceNote", e.target.value)} placeholder="mis. WhatsApp grup produksi" /></Field>
              <Field label="Waktu diminta"><Input type="datetime-local" value={form.requestedAt} onChange={(e) => set("requestedAt", e.target.value)} /></Field>
            </div>
          )}
          <Field label="Catatan"><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>

          {dup.length > 0 && (
            <div className="rounded-xl bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="peringatan-duplikat">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> Mirip dengan pengajuan lain — periksa dulu (tidak memblokir)</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{dup.map((k) => <li key={k.id}>{teksDuplikat(k)}</li>)}</ul>
            </div>
          )}
          {galat && <p role="alert" className="rounded-xl bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
        </div>
      </Modal>

      {/* ── DETAIL ───────────────────────────────────────────────────────────────────────────────────────── */}
      <Modal open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title={detail ? `${detail.submissionNumber} · ${jenisLabel(detail.expenseType)}` : ""} description={detail ? statusLabel(detail.status) : ""}
        footer={detail && (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {bolehEditAjukan(detail.status) && <TombolAksi variant="secondary" onClick={() => edit(detail)}>Ubah</TombolAksi>}
            <TombolAksi variant="ghost" onClick={() => duplikasi(detail)}><Copy size={14} /> Duplikasi</TombolAksi>
            {bolehTarik(detail.status) && <TombolAksi variant="secondary" confirmText="Tarik pengajuan kembali jadi draf?" onClick={() => aksi(() => api.tarikPengajuanBiaya(detail.id), "Pengajuan ditarik kembali.", detail.id)}>Tarik</TombolAksi>}
            {bolehBatalkan(detail.status) && <TombolAksi variant="ghost" confirmText="Batalkan pengajuan ini?" onClick={() => aksi(() => api.batalkanPengajuanBiaya(detail.id, "Dibatalkan pemohon"), "Pengajuan dibatalkan.", detail.id)}>Batalkan</TombolAksi>}
            {bolehEditAjukan(detail.status) && <TombolAksi onClick={() => aksi(() => api.ajukanPengajuanBiaya(detail.id), "Pengajuan dikirim ke Finance.", detail.id)}>{labelAjukan(detail.status)}</TombolAksi>}
          </div>
        )}>
        {detail && (
          <div className="space-y-3 text-[13px]" data-testid="detail-pengajuan">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              <div><dt className="text-ink3">Tanggal</dt><dd>{tanggalPendek(detail.date)}</dd></div>
              <div><dt className="text-ink3">Nominal</dt><dd className="font-semibold"><Uang value={detail.amount} /></dd></div>
              <div><dt className="text-ink3">Pemohon</dt><dd>{detail.requestedBy?.name || "—"}{detail.createdBy && detail.createdBy.id !== detail.requestedBy?.id ? <span className="text-ink3"> · dicatat {detail.createdBy.name}</span> : null}</dd></div>
              <div><dt className="text-ink3">PIC</dt><dd>{detail.picUser?.name || detail.picNameSnapshot || "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-ink3">Konteks</dt><dd className="break-words">{konteksLabel(detail) || "—"}</dd></div>
              <div><dt className="text-ink3">Sumber dana</dt><dd>{LABEL_SUMBER_DANA[detail.sumberDana] || "—"}{detail.advance ? ` · ${detail.advance.advanceNumber}` : ""}</dd></div>
              <div><dt className="text-ink3">Vendor</dt><dd className="break-words">{detail.vendorName || "—"}</dd></div>
              {detail.urgentReason && <div className="sm:col-span-2"><dt className="text-ink3">Alasan mendesak</dt><dd className="break-words">{detail.urgentReason}</dd></div>}
              {detail.sourceNote && <div className="sm:col-span-2"><dt className="text-ink3">Sumber permintaan</dt><dd className="break-words">{detail.sourceNote}{detail.requestedAt ? ` · ${tanggalJam(detail.requestedAt)}` : ""}</dd></div>}
              {detail.revisionReason && detail.status === "PERLU_REVISI" && <div className="sm:col-span-2 rounded-lg bg-orangebg px-3 py-2 text-orange"><dt className="font-semibold">Alasan revisi</dt><dd className="break-words">{detail.revisionReason}</dd></div>}
              {detail.finExpense && <div className="sm:col-span-2"><dt className="text-ink3">Dokumen Finance</dt><dd>{detail.finExpense.expenseNumber} · {detail.finExpense.status}</dd></div>}
            </dl>
            <div><p className="mb-1 text-ink3">Foto nota</p><BuktiUploader id={detail.id} proofs={detail.proofs} bisa={bolehEditAjukan(detail.status)} onSaved={() => segarkanDetail(detail.id)} /></div>
            {bolehEditAjukan(detail.status) && kekuranganAjukan(detail, cfg).length > 0 && (
              <ul className="list-disc rounded-xl bg-orangebg px-5 py-2 text-[12.5px] text-orange" data-testid="kekurangan">{kekuranganAjukan(detail, cfg).map((k) => <li key={k}>{k}</li>)}</ul>
            )}
            {["DISETUJUI", "DIBAYAR", "OTOMATIS_DISETUJUI"].includes(detail.status) && (
              <p className="text-[12px] text-ink3">Koreksi setelah masuk buku besar dilakukan Finance lewat Pengeluaran › Koreksi (Edit & Koreksi Aman) — bukan dari halaman ini.</p>
            )}
            {riwayatRevisi(detail.auditTrail).length > 0 && (
              <div><p className="text-ink3">Riwayat revisi</p><ul className="list-disc pl-5">{riwayatRevisi(detail.auditTrail).map((r, i) => <li key={i}>{tanggalJam(r.waktu)} · {r.oleh || "—"} · {r.jenis === "diminta" ? `Diminta revisi: ${r.alasan || "—"}` : r.jenis === "diajukan-ulang" ? "Diajukan ulang" : "Diakhiri"}</li>)}</ul></div>
            )}
            <details><summary className="cursor-pointer text-ink3">Jejak audit ({(detail.auditTrail || []).length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px]">{(detail.auditTrail || []).map((a) => <li key={a.id}>{tanggalJam(a.createdAt)} · {a.actor?.name || "Sistem"} · {deskripsiAudit(a)}</li>)}</ul>
            </details>
          </div>
        )}
      </Modal>
    </HalamanFinance>
  );
}
