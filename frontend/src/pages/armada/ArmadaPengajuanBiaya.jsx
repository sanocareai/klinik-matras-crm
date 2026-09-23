import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Receipt, Plus, Pencil, Send, Undo2, Ban, Camera, Loader2,
  AlertTriangle, Copy, FileText, MessageCircle, Bookmark, History, Zap,
} from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "@/lib/dateRange.js";
import KpiCard from "@/features/laporan/components/KpiCard.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { formatRupiah } from "@/utils/format.js";

// Pengajuan Biaya (Pengajuan Biaya Lintas Divisi, pilot Delivery, 24
// September 2026) — untuk biaya yang BUTUH persetujuan Finance (servis
// besar, sewa, denda, dll). TERPISAH dari "Biaya Armada" (ArmadaBiaya.jsx,
// VehicleExpense) yang tetap jadi pencatatan operasional harian TANPA
// approval — dua-duanya SENGAJA hidup berdampingan (lihat banner prinsip di
// backend/prisma/schema.prisma#ExpenseSubmission). Mengajukan di sini
// membuat/menautkan SATU FinExpense lewat service bersama
// (services/expenseSubmission/service.js) — tidak ada jurnal/tabel paralel.
//
// Kendaraan yang dipakai di sini BOLEH ditautkan ke baris VehicleExpense
// (konteks operasional: odometer/liter) TANPA membuatnya diposting dua kali
// — backend menjaga itu (postVehicleExpense() melewati baris yang tertaut
// ke pengajuan). WhatsApp/laporan lisan BUKAN sumber pencatatan; halaman
// ini satu-satunya tempat mengajukan, FinExpense satu-satunya tempat
// persetujuan/pembayaran/jurnal.

const WORKSPACE = "DELIVERY";

const STATUS_LABEL = {
  DRAFT: "Draf",
  MENUNGGU_PERSETUJUAN: "Menunggu Persetujuan",
  OTOMATIS_DISETUJUI: "Disetujui Otomatis",
  DISETUJUI: "Disetujui",
  DIBAYAR: "Dibayar",
  DITOLAK: "Ditolak",
  DIBATALKAN: "Dibatalkan",
};
const STATUS_VARIANT = {
  DRAFT: "neutral",
  MENUNGGU_PERSETUJUAN: "orange",
  OTOMATIS_DISETUJUI: "green",
  DISETUJUI: "accent",
  DIBAYAR: "green",
  DITOLAK: "red",
  DIBATALKAN: "neutral",
};
const STATUS_FILTERS = ["", "DRAFT", "MENUNGGU_PERSETUJUAN", "OTOMATIS_DISETUJUI", "DISETUJUI", "DIBAYAR", "DITOLAK", "DIBATALKAN"];

const inputCls = "h-9 w-full rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent";

function fmtTanggal(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
function fmtWaktu(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }) {
  return <Badge variant={STATUS_VARIANT[status] || "neutral"}>{STATUS_LABEL[status] || status}</Badge>;
}

function MetaField({ field, value, onChange }) {
  if (field.type === "date") {
    return <DatePicker value={value || ""} onChange={(v) => onChange(field.key, v)} placeholder="Opsional" />;
  }
  if (field.type === "number") {
    return <Input type="number" value={value ?? ""} onChange={(e) => onChange(field.key, e.target.value)} />;
  }
  if (field.type === "decimal") {
    return <Input type="number" step="0.01" value={value ?? ""} onChange={(e) => onChange(field.key, e.target.value)} />;
  }
  if (field.type === "money") {
    return <Input type="number" min="0" value={value ?? ""} onChange={(e) => onChange(field.key, e.target.value)} />;
  }
  return <Input type="text" value={value ?? ""} onChange={(e) => onChange(field.key, e.target.value)} />;
}

const KOSONG = {
  expenseType: "", date: "", amount: "", vendorName: "", paymentMethod: "", sumberDana: "",
  jobId: "", routeId: "", vehicleId: "", driverId: "", helperId: "", picUserId: "",
  description: "", notes: "", metadata: {},
  // Catat atas nama pengaju (Finance/Dispatcher, D-181) — kosong = pengaju sendiri.
  requestedById: "", requestedAt: "", urgentReason: "", sourceNote: "",
};

function fmtRp(n) { return "Rp" + Number(n || 0).toLocaleString("id-ID"); }

// Pemilih foto nota — upload LANGSUNG saat file dipilih (dipakai di Detail,
// setelah pengajuan sudah punya id). Versi baru tiap unggah (tidak overwrite).
function BuktiUploader({ submissionId, proofs, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("bukti", file);
      const proof = await api.uploadPengajuanBukti(submissionId, fd);
      onUploaded(proof);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {(proofs || []).map((p) => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-btn border border-border" title={`Versi ${p.version}`}>
            <img src={p.url} alt="Bukti" className="h-full w-full object-cover" />
          </a>
        ))}
        <label className={`flex h-14 w-14 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-btn border border-dashed text-[10px] transition-colors ${uploading ? "border-border text-ink3" : "border-border text-ink2 hover:border-accent hover:text-accent"}`}>
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {uploading ? "..." : "Nota"}
          <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
      </div>
      {error && <span className="text-[11px] text-red">{error}</span>}
    </div>
  );
}

export default function ArmadaPengajuanBiaya() {
  const [config, setConfig] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [helpers, setHelpers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [range, setRange] = useState(() => makeRange("last_30_days"));

  const [form, setForm] = useState({ ...KOSONG });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dupWarning, setDupWarning] = useState([]);

  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [koreksiReason, setKoreksiReason] = useState("");
  const [showKoreksi, setShowKoreksi] = useState(false);

  const [templates, setTemplates] = useState([]);
  const [recent, setRecent] = useState(null);
  const [showCatatAtasNama, setShowCatatAtasNama] = useState(false);

  const picOptions = useMemo(() => [...drivers, ...helpers], [drivers, helpers]);

  function muatTemplateRecent() {
    api.getPengajuanTemplates().then((res) => setTemplates(res.templates || [])).catch(() => {});
    api.getPengajuanRecent(WORKSPACE).then(setRecent).catch(() => {});
  }

  useEffect(() => {
    setLoadingMaster(true);
    const empatBelasHariLalu = new Date(); empatBelasHariLalu.setDate(empatBelasHariLalu.getDate() - 14);
    Promise.all([
      api.getExpenseSubmissionConfig(WORKSPACE),
      api.getVehicles(),
      api.getDrivers(),
      api.getHelpers(),
      api.getRoutes({ from: empatBelasHariLalu.toISOString().slice(0, 10) }),
    ])
      .then(([cfg, v, d, h, r]) => {
        setConfig(cfg);
        setVehicles((v.vehicles || v || []).filter((x) => x.active));
        setDrivers(d || []);
        setHelpers(h || []);
        setRoutes(r.routes || r || []);
      })
      .catch(() => {})
      .finally(() => setLoadingMaster(false));
    muatTemplateRecent();
  }, []);

  const load = useCallback(() => {
    const params = { ...toApiParams(range), status: statusFilter || undefined };
    if ((!!range.from) !== (!!range.to)) return;
    setRows(null);
    api.getExpenseSubmissions(params).then((res) => setRows(res.submissions || [])).catch(() => setRows([]));
  }, [range, statusFilter]);
  useEffect(() => { load(); }, [load]);

  const rowsTersaring = useMemo(() => {
    if (!rows) return rows;
    const kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => [
      r.submissionNumber, r.description, r.vendorName, r.vehiclePlateSnapshot, r.driverNameSnapshot,
    ].filter(Boolean).some((s) => s.toLowerCase().includes(kw)));
  }, [rows, q]);

  const totalTampil = useMemo(() => (rowsTersaring || []).reduce((n, r) => n + r.amount, 0), [rowsTersaring]);
  const jumlahMenunggu = useMemo(() => (rowsTersaring || []).filter((r) => r.status === "MENUNGGU_PERSETUJUAN").length, [rowsTersaring]);
  const jumlahDisetujui = useMemo(() => (rowsTersaring || []).filter((r) => r.status === "DISETUJUI" || r.status === "DIBAYAR").length, [rowsTersaring]);

  const metaFields = config && form.expenseType ? (config.metadataFieldsByType[form.expenseType] || []) : [];
  const akanOtomatis = !!(
    config?.autoApprove && form.expenseType && form.amount &&
    config.autoApprove.types.includes(form.expenseType) &&
    Number(form.amount) > 0 && Number(form.amount) <= config.autoApprove.maxAmount
  );

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setMeta(key, value) {
    setForm((f) => ({ ...f, metadata: { ...f.metadata, [key]: value } }));
  }

  function pilihRoute(routeId) {
    const r = routes.find((x) => x.id === routeId);
    setForm((f) => ({
      ...f,
      routeId,
      vehicleId: r?.vehicle?.id || f.vehicleId,
      driverId: r?.driver?.id || f.driverId,
      helperId: r?.helper?.id || f.helperId,
      picUserId: r?.driver?.id || f.picUserId,
    }));
  }

  function batalEdit() {
    setEditingId(null);
    setForm({ ...KOSONG });
    setError("");
    setDupWarning([]);
  }

  function mulaiEdit(r) {
    setEditingId(r.id);
    setForm({
      expenseType: r.expenseType, date: r.date.slice(0, 10), amount: String(r.amount),
      vendorName: r.vendorName || "", paymentMethod: r.paymentMethod || "", sumberDana: r.sumberDana || "",
      jobId: r.jobId || "", routeId: r.routeId || "", vehicleId: r.vehicleId || "",
      driverId: r.driverId || "", helperId: r.helperId || "", picUserId: r.picUserId || "",
      description: r.description || "", notes: r.notes || "", metadata: r.metadata || {},
      requestedById: r.requestedById || "", requestedAt: r.requestedAt ? r.requestedAt.slice(0, 16) : "",
      urgentReason: r.urgentReason || "", sourceNote: r.sourceNote || "",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function duplikasi(r) {
    setEditingId(null);
    setForm({
      expenseType: r.expenseType, date: "", amount: String(r.amount),
      vendorName: r.vendorName || "", paymentMethod: r.paymentMethod || "", sumberDana: r.sumberDana || "",
      jobId: "", routeId: "", vehicleId: r.vehicleId || "",
      driverId: r.driverId || "", helperId: r.helperId || "", picUserId: r.picUserId || "",
      description: "", notes: "", metadata: r.metadata || {},
      requestedById: "", requestedAt: "", urgentReason: "", sourceNote: "",
    });
    setDetail(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function muatTemplate(t) {
    setEditingId(null);
    setForm({ ...KOSONG, ...(t.payload || {}) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Deteksi kemungkinan duplikat — tanggal+nominal+kendaraan+PIC, peringatan
  // saja, tidak pernah memblokir (duplikat yang BENAR-BENAR identik dicegah
  // terpisah lewat idempotencyKey saat /ajukan, bukan di sini).
  useEffect(() => {
    if (!form.vehicleId || !form.expenseType || !form.date || !form.amount) { setDupWarning([]); return; }
    const t = setTimeout(() => {
      api.cekDuplikatPengajuan({
        division: WORKSPACE, vehicleId: form.vehicleId, expenseType: form.expenseType,
        date: form.date, amount: form.amount, picUserId: form.picUserId || undefined, excludeId: editingId || undefined,
      }).then((res) => setDupWarning(res.kandidat || [])).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [form.vehicleId, form.expenseType, form.date, form.amount, form.picUserId, editingId]);

  async function submit(e) {
    e.preventDefault();
    if (!form.expenseType) { setError("Jenis biaya wajib dipilih"); return; }
    if (!form.date || !form.amount) { setError("Tanggal dan nominal wajib diisi"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        workspace: WORKSPACE, expenseType: form.expenseType, date: form.date, amount: Number(form.amount),
        vendorName: form.vendorName || null, paymentMethod: form.paymentMethod || null, sumberDana: form.sumberDana || null,
        jobId: form.jobId || null, routeId: form.routeId || null, vehicleId: form.vehicleId || null,
        driverId: form.driverId || null, helperId: form.helperId || null, picUserId: form.picUserId || null,
        description: form.description || undefined, notes: form.notes || null, metadata: form.metadata,
        // Catat atas nama (D-181) — kosongkan berarti "diri sendiri", backend
        // menolak (403) kalau requestedById diisi orang lain tanpa izin.
        requestedById: form.requestedById || undefined,
        requestedAt: form.requestedAt || null, urgentReason: form.urgentReason || null, sourceNote: form.sourceNote || null,
      };
      if (editingId) {
        await api.updateExpenseSubmissionDraft(editingId, payload);
      } else {
        await api.createExpenseSubmission(payload);
      }
      batalEdit();
      load();
      muatTemplateRecent();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function simpanTemplate() {
    if (!form.expenseType) { setError("Isi jenis biaya dulu sebelum menyimpan sebagai template"); return; }
    const label = prompt("Nama template? (mis. \"BBM rute harian\")");
    if (!label?.trim()) return;
    try {
      const { requestedById, requestedAt, urgentReason, sourceNote, ...payloadTemplate } = form;
      await api.createPengajuanTemplate({ label: label.trim(), division: WORKSPACE, payload: payloadTemplate });
      muatTemplateRecent();
    } catch (err) {
      setError(err.message);
    }
  }

  async function hapusTemplate(id) {
    if (!confirm("Hapus template ini?")) return;
    await api.deletePengajuanTemplate(id);
    muatTemplateRecent();
  }

  async function bukaDetail(r) {
    setDetailError("");
    setShowKoreksi(false);
    setKoreksiReason("");
    try {
      const full = await api.getExpenseSubmission(r.id);
      setDetail(full);
    } catch (err) {
      setDetailError(err.message);
    }
  }

  async function ajukan() {
    if (!detail) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const updated = await api.ajukanPengajuanBiaya(detail.id);
      setDetail(updated);
      load();
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailBusy(false);
    }
  }
  async function tarik() {
    if (!detail) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const updated = await api.tarikPengajuanBiaya(detail.id);
      setDetail(updated);
      load();
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailBusy(false);
    }
  }
  async function batalkan() {
    if (!detail) return;
    const reason = prompt("Alasan pembatalan?");
    if (!reason?.trim()) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const updated = await api.batalkanPengajuanBiaya(detail.id, reason.trim());
      setDetail(updated);
      load();
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailBusy(false);
    }
  }
  async function simpanKoreksiMetadata() {
    if (!detail || !koreksiReason.trim()) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const changes = { description: detail.description, notes: detail.notes, vendorName: detail.vendorName };
      const updated = await api.koreksiMetadataPengajuan(detail.id, koreksiReason.trim(), changes);
      setDetail(updated);
      setShowKoreksi(false);
      setKoreksiReason("");
      load();
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailBusy(false);
    }
  }

  if (loadingMaster) {
    return (
      <PageContainer>
        <PageHeader title="Pengajuan Biaya" subtitle="Memuat…" />
        <PageBody><TableSkeletonRows rows={4} cols={7} /></PageBody>
      </PageContainer>
    );
  }

  if (!config) {
    return (
      <PageContainer>
        <PageHeader title="Pengajuan Biaya" />
        <PageBody>
          <EmptyState icon={AlertTriangle} title="Gagal memuat konfigurasi" description="Coba muat ulang halaman." />
        </PageBody>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Pengajuan Biaya"
        subtitle="Ajukan biaya yang butuh persetujuan Finance (servis besar, sewa, denda, dll) — satu pengajuan menghasilkan satu dokumen Finance."
      />
      <PageBody>
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
            {editingId ? <><Pencil size={14} className="text-accent" /> Mengedit Draf</> : <><Plus size={14} className="text-accent" /> Buat Pengajuan</>}
            {editingId && <button type="button" onClick={batalEdit} className="ml-2 text-[11.5px] font-semibold text-accent underline">batal</button>}
          </div>

          {!editingId && (templates.length > 0 || recent) && (
            <div className="mb-3 flex flex-col gap-2 rounded-btn bg-inset p-2.5">
              {templates.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-ink3"><Bookmark size={12} /> Template:</span>
                  {templates.map((t) => (
                    <span key={t.id} className="group inline-flex items-center gap-1 rounded-chip bg-surface px-2 py-1 text-[11.5px] text-ink2">
                      <button type="button" className="hover:text-accent" onClick={() => muatTemplate(t)}>{t.label}</button>
                      <button type="button" className="text-ink3 opacity-0 group-hover:opacity-100 hover:text-red" onClick={() => hapusTemplate(t.id)} title="Hapus template">×</button>
                    </span>
                  ))}
                </div>
              )}
              {recent && (recent.kendaraan?.length > 0 || recent.pic?.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-ink3"><History size={12} /> Terakhir:</span>
                  {recent.kendaraan?.slice(0, 4).map((k) => (
                    <button key={k.id} type="button" className="rounded-chip bg-surface px-2 py-1 text-[11.5px] text-ink2 hover:text-accent" onClick={() => setField("vehicleId", k.id)}>{k.label}</button>
                  ))}
                  {recent.pic?.slice(0, 4).map((p) => (
                    <button key={p.id} type="button" className="rounded-chip bg-surface px-2 py-1 text-[11.5px] text-ink2 hover:text-accent" onClick={() => setField("picUserId", p.id)}>{p.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          <form onSubmit={submit} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Field label="Jenis Biaya" required>
              <select className={inputCls} value={form.expenseType} onChange={(e) => setField("expenseType", e.target.value)}>
                <option value="">— Pilih —</option>
                {config.expenseTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Tanggal" required><DatePicker value={form.date} onChange={(v) => setField("date", v)} placeholder="Pilih tanggal" allowFuture={false} /></Field>
            <Field label="Nominal (Rp)" required><Input type="number" min="0" value={form.amount} onChange={(e) => setField("amount", e.target.value)} /></Field>
            <Field label="Sumber Dana" hint="Usulan — Finance yang menentukan rekening final">
              <select className={inputCls} value={form.sumberDana} onChange={(e) => setField("sumberDana", e.target.value)}>
                <option value="">— Belum ditentukan —</option>
                {config.sumberDana?.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Metode Bayar" hint="Opsional, diisi Finance saat pembayaran kalau kosong">
              <Input value={form.paymentMethod} onChange={(e) => setField("paymentMethod", e.target.value)} placeholder="Cth. Transfer BCA" />
            </Field>

            {akanOtomatis && (
              <div className="col-span-full flex items-center gap-2 rounded-btn bg-greenbg p-2.5 text-[11.5px] text-green">
                <Zap size={14} className="shrink-0" />
                <span>Jenis biaya & nominal ini akan disetujui OTOMATIS begitu diajukan (kebijakan {config.label}, ≤ {fmtRp(config.autoApprove.maxAmount)}) — tetap tercatat &amp; bisa diaudit.</span>
              </div>
            )}

            {config.relations.includes("route") && (
              <Field label="Rute Terkait" className="col-span-2" hint="Mengisi kendaraan & PIC otomatis, tetap bisa diganti">
                <select className={inputCls} value={form.routeId} onChange={(e) => pilihRoute(e.target.value)}>
                  <option value="">— Tanpa rute —</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {fmtTanggal(r.date)} · {r.vehicle?.plateNumber || "?"} · {r.driver?.name || "?"}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {config.relations.includes("vehicle") && (
              <Field label="Kendaraan">
                <select className={inputCls} value={form.vehicleId} onChange={(e) => setField("vehicleId", e.target.value)}>
                  <option value="">— Pilih —</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber} · {[v.brand, v.model].filter(Boolean).join(" ") || v.type}</option>)}
                </select>
              </Field>
            )}
            {(config.relations.includes("driver") || config.relations.includes("helper")) && (
              <Field label="PIC (Driver/Helper)">
                <select className={inputCls} value={form.picUserId} onChange={(e) => setField("picUserId", e.target.value)}>
                  <option value="">— Pilih —</option>
                  {picOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            )}

            {metaFields.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <MetaField field={f} value={form.metadata[f.key]} onChange={setMeta} />
              </Field>
            ))}
            <Field label="Vendor / Lokasi" className="col-span-2 sm:col-span-2">
              <Input value={form.vendorName} onChange={(e) => setField("vendorName", e.target.value)} placeholder="Opsional" />
            </Field>
            <Field label="Keterangan" className="col-span-2 sm:col-span-4" hint="Kosongkan untuk dibuat otomatis dari jenis biaya, kendaraan, dan vendor">
              <Input value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Otomatis kalau dikosongkan" />
            </Field>
            <Field label="Catatan" className="col-span-2 sm:col-span-4">
              <Input value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="Opsional" />
            </Field>

            {config.bolehCatatAtasNama && (
              <div className="col-span-full">
                <button type="button" onClick={() => setShowCatatAtasNama((v) => !v)} className="text-[11.5px] font-semibold text-accent hover:underline">
                  {showCatatAtasNama ? "− Sembunyikan" : "+ Catat atas nama pengaju lain"}
                </button>
                {showCatatAtasNama && (
                  <div className="mt-2 grid grid-cols-2 gap-2.5 rounded-btn border border-line p-2.5 sm:grid-cols-4">
                    <Field label="Pemohon Asli" hint="Kosongkan = Anda sendiri" className="col-span-2">
                      <select className={inputCls} value={form.requestedById} onChange={(e) => setField("requestedById", e.target.value)}>
                        <option value="">— Diri sendiri —</option>
                        {picOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Waktu Permintaan" hint="Kapan driver sebenarnya minta (bukan waktu dicatat)">
                      <input type="datetime-local" className={inputCls} value={form.requestedAt} onChange={(e) => setField("requestedAt", e.target.value)} />
                    </Field>
                    <Field label="Alasan Mendesak">
                      <Input value={form.urgentReason} onChange={(e) => setField("urgentReason", e.target.value)} placeholder="Opsional" />
                    </Field>
                    <Field label="Referensi Sumber" className="col-span-2 sm:col-span-3" hint="Cth. &quot;Chat WA Agung 23/9 14:20&quot; — WhatsApp hanya komunikasi, ini cuma jejak referensi">
                      <Input value={form.sourceNote} onChange={(e) => setField("sourceNote", e.target.value)} placeholder="Opsional" />
                    </Field>
                    <div className="flex items-end">
                      <a
                        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-btn bg-greenbg text-[12.5px] font-semibold text-green hover:bg-green/20"
                        target="_blank" rel="noreferrer"
                        href={`https://wa.me/?text=${encodeURIComponent(
                          `Pengajuan biaya mendesak — ${config.expenseTypes.find((t) => t.code === form.expenseType)?.label || form.expenseType || "?"}${form.amount ? `, ${fmtRp(form.amount)}` : ""}${form.urgentReason ? `. Alasan: ${form.urgentReason}` : ""}`
                        )}`}
                      >
                        <MessageCircle size={14} /> Buka WhatsApp
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {dupWarning.length > 0 && (
              <div className="col-span-full flex items-start gap-2 rounded-btn bg-orangebg p-2.5 text-[11.5px] text-orange">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <div>Ditemukan {dupWarning.length} pengajuan mirip (kendaraan/jenis/tanggal/nominal berdekatan) — cek dulu sebelum lanjut:</div>
                  <ul className="mt-1 list-disc pl-4">
                    {dupWarning.map((k) => (
                      <li key={k.id}>
                        {k.submissionNumber} · {k.vehiclePlateSnapshot || "?"} · {k.picNameSnapshot || "tanpa PIC"} · {k.adaBukti ? "sudah ada bukti" : "belum ada bukti"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {error && <p className="col-span-full text-[12px] text-red">{error}</p>}
            <div className="col-span-full flex justify-between">
              <Button type="button" variant="neutral" size="sm" onClick={simpanTemplate}><Bookmark size={13} /> Simpan sebagai Template</Button>
              <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Simpan Draf"}</Button>
            </div>
          </form>
        </Card>

        <div className="flex flex-wrap items-end gap-2.5">
          <Field label="Cari" className="w-52">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="No. pengajuan, kendaraan, vendor…" />
          </Field>
          <Field label="Status" className="w-48">
            <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s ? STATUS_LABEL[s] : "Semua Status"}</option>)}
            </select>
          </Field>
          <div className="ml-auto"><DateRangePicker value={range} onChange={setRange} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Total Sesuai Filter" numericValue={totalTampil} format={formatRupiah} index={0} />
          <KpiCard label="Jumlah Pengajuan" numericValue={(rowsTersaring || []).length} index={1} />
          <KpiCard label="Menunggu Persetujuan" numericValue={jumlahMenunggu} index={2} />
          <KpiCard label="Disetujui/Dibayar" numericValue={jumlahDisetujui} index={3} />
        </div>

        {rowsTersaring === null ? <TableSkeletonRows rows={4} cols={7} /> : rowsTersaring.length === 0 ? (
          <EmptyState icon={Receipt} title="Belum ada pengajuan" description="Buat pengajuan lewat form di atas." />
        ) : (
          <TableWrap>
            <Table>
              <THead><TR><TH>No. Pengajuan</TH><TH>Tanggal</TH><TH>Jenis</TH><TH>Kendaraan</TH><TH>PIC</TH><TH>Nominal</TH><TH>Status</TH></TR></THead>
              <TBody>
                {rowsTersaring.map((r) => (
                  <TR key={r.id} className="cursor-pointer" onClick={() => bukaDetail(r)}>
                    <TD className="font-semibold text-ink">{r.submissionNumber}</TD>
                    <TD className="whitespace-nowrap text-ink2">{fmtTanggal(r.date)}</TD>
                    <TD>{config.expenseTypes.find((t) => t.code === r.expenseType)?.label || r.expenseType}</TD>
                    <TD className="text-ink2">{r.vehiclePlateSnapshot || "—"}</TD>
                    <TD className="text-ink2">{r.picNameSnapshot || r.driverNameSnapshot || "—"}</TD>
                    <TD numeric className="font-semibold text-ink">{formatRupiah(r.amount)}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </PageBody>

      <Modal
        open={!!detail}
        onOpenChange={(o) => { if (!o) setDetail(null); }}
        title={detail?.submissionNumber}
        description={detail && <StatusBadge status={detail.status} />}
        footer={detail && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {detail.status === "DRAFT" && (
                <>
                  <Button variant="neutral" size="sm" onClick={() => { mulaiEdit(detail); setDetail(null); }}><Pencil size={13} /> Edit</Button>
                  <Button variant="tertiary" size="sm" onClick={() => duplikasi(detail)}><Copy size={13} /> Duplikasi</Button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {detail.status === "DRAFT" && (
                <>
                  <Button variant="destructive" size="sm" disabled={detailBusy} onClick={batalkan}><Ban size={13} /> Batalkan</Button>
                  <Button size="sm" disabled={detailBusy} onClick={ajukan}><Send size={13} /> {detailBusy ? "…" : "Ajukan"}</Button>
                </>
              )}
              {detail.status === "MENUNGGU_PERSETUJUAN" && (
                <Button variant="neutral" size="sm" disabled={detailBusy} onClick={tarik}><Undo2 size={13} /> Tarik Kembali</Button>
              )}
              {detail.status === "DISETUJUI" && !showKoreksi && (
                <Button variant="neutral" size="sm" onClick={() => setShowKoreksi(true)}><Pencil size={13} /> Koreksi Metadata</Button>
              )}
            </div>
          </div>
        )}
      >
        {detail && (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2.5">
              <div><span className="text-ink3">Jenis</span><div className="font-medium text-ink">{config.expenseTypes.find((t) => t.code === detail.expenseType)?.label || detail.expenseType}</div></div>
              <div><span className="text-ink3">Tanggal</span><div className="font-medium text-ink">{fmtTanggal(detail.date)}</div></div>
              <div><span className="text-ink3">Nominal</span><div className="font-medium text-ink">{formatRupiah(detail.amount)}</div></div>
              <div><span className="text-ink3">Kendaraan</span><div className="font-medium text-ink">{detail.vehiclePlateSnapshot || "—"}</div></div>
              <div><span className="text-ink3">PIC</span><div className="font-medium text-ink">{detail.picNameSnapshot || detail.driverNameSnapshot || "—"}</div></div>
              <div><span className="text-ink3">Vendor/Lokasi</span><div className="font-medium text-ink">{detail.vendorName || "—"}</div></div>
              <div><span className="text-ink3">Pemohon</span><div className="font-medium text-ink">{detail.requestedBy?.name || "—"}</div></div>
              <div><span className="text-ink3">Sumber Dana</span><div className="font-medium text-ink">{config.sumberDana?.find((s) => s.code === detail.sumberDana)?.label || "—"}</div></div>
            </div>
            <div><span className="text-ink3">Keterangan</span><div className="font-medium text-ink">{detail.description}</div></div>
            {detail.notes && <div><span className="text-ink3">Catatan</span><div className="text-ink2">{detail.notes}</div></div>}

            {detail.createdBy?.id !== detail.requestedBy?.id && (
              <div className="rounded-btn bg-orangebg p-2.5 text-[11.5px] text-orange">
                <div className="font-semibold">Dicatat atas nama {detail.requestedBy?.name}</div>
                <div>oleh {detail.createdBy?.name}{detail.requestedAt ? ` · diminta ${fmtWaktu(detail.requestedAt)}` : ""}</div>
                {detail.urgentReason && <div>Alasan mendesak: {detail.urgentReason}</div>}
                {detail.sourceNote && <div>Referensi: {detail.sourceNote}</div>}
              </div>
            )}

            {detail.finExpense && (
              <div className="rounded-btn bg-inset p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink2"><FileText size={13} /> Dokumen Finance</div>
                <div className="text-[12.5px] text-ink">{detail.finExpense.expenseNumber} — {STATUS_LABEL[detail.status]}</div>
                {detail.finExpense.paidAt && <div className="text-[11.5px] text-ink3">Dibayar {fmtWaktu(detail.finExpense.paidAt)}</div>}
                {detail.finExpense.rejectReason && <div className="text-[11.5px] text-red">Alasan tolak: {detail.finExpense.rejectReason}</div>}
              </div>
            )}

            {showKoreksi && (
              <div className="rounded-btn border border-line p-2.5">
                <Field label="Alasan koreksi metadata" required hint="Nominal/akun/rekening tidak bisa diubah di sini — itu lewat workflow koreksi Finance">
                  <Input value={koreksiReason} onChange={(e) => setKoreksiReason(e.target.value)} placeholder="Kenapa metadata ini dikoreksi?" />
                </Field>
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="neutral" size="sm" onClick={() => setShowKoreksi(false)}>Batal</Button>
                  <Button size="sm" disabled={detailBusy || !koreksiReason.trim()} onClick={simpanKoreksiMetadata}>Simpan</Button>
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-ink3">Bukti/Nota</div>
              <BuktiUploader submissionId={detail.id} proofs={detail.proofs} onUploaded={(p) => setDetail((d) => ({ ...d, proofs: [p, ...(d.proofs || [])] }))} />
            </div>

            {detail.auditTrail?.length > 0 && (
              <div>
                <div className="mb-1.5 text-ink3">Riwayat Perubahan</div>
                <div className="flex flex-col gap-1.5">
                  {detail.auditTrail.map((a) => (
                    <div key={a.id} className="text-[11.5px] text-ink3">
                      {fmtWaktu(a.createdAt)} · {a.actor?.name || "—"} mengubah <span className="font-medium text-ink2">{a.field}</span>: "{a.before || "-"}" → "{a.after || "-"}" ({a.reason})
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailError && <p className="text-[12px] text-red">{detailError}</p>}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
