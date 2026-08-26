import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Lock, MessageSquare, Plus, Pencil, Trash2, X, Copy, TrendingUp, Tag, Crown,
  Bold, Italic, Strikethrough, Save, CheckCircle,
} from "lucide-react";
import { api } from "../api.js";
import { formatRupiah } from "../utils/format.js";
import { WA_MARKERS, toggleWaFormat, parseWaFormatting } from "../utils/waFormat.jsx";
import { isAdminUser } from "@/lib/roles.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";

// ═══ PENGATURAN SALES & CRM ═══════════════════════════════════════════════
// Dipindah DARI Pengaturan.jsx (26 Agustus 2026, permintaan owner): Template
// Pesan/Target Sales/Promo adalah pengaturan KHUSUS urusan CRM (dipakai
// sehari-hari sales & admin Growth), bukan pengaturan lintas-divisi seperti
// Profil Perusahaan/Keamanan/Data & Backup yang tetap di /pengaturan (Main
// Hub). Sebelumnya SEMUA pengaturan digabung satu halaman yang cuma bisa
// dijangkau lewat Main Hub — sales harus keluar dari workspace CRM-nya
// setiap kali mau ubah template balasan, padahal itu alat kerja hariannya.
// Sekarang halaman ini muncul di sidebar workspace "Sales CRM & Omnichannel"
// sendiri (lihat DIVISIONS.growth di components/Layout.jsx).
//
// 3 komponen di bawah (TemplateSection/SalesTargetSection/PromoSection)
// DIPINDAH APA ADANYA dari Pengaturan.jsx — logika/state/handler TIDAK
// disentuh, cuma lokasi filenya yang berubah.
const selectCls =
  "h-9 w-full rounded-lg bg-surface px-3 text-sm text-ink outline-none transition-colors " +
  "focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

function InlineFeedback({ msg }) {
  if (!msg) return null;
  return (
    <p
      className={cn(
        "rounded-lg px-3 py-2 text-[13px] font-medium",
        msg.type === "success" ? "bg-green/10 text-green" : "bg-red/10 text-red"
      )}
    >
      {msg.text}
    </p>
  );
}

const NAV_ITEMS = [
  { key: "template",     label: "Template Pesan", icon: MessageSquare },
  { key: "target-sales", label: "Target Sales",   icon: TrendingUp },
  { key: "promo",        label: "Promo",          icon: Tag },
];
const NAV_KEYS = NAV_ITEMS.map((n) => n.key);

// SALES cuma boleh buka "Template Pesan" (kelola template pribadinya) —
// Target Sales & Promo tetap admin-only, sama seperti sebelum dipindah.
const SALES_ALLOWED_SECTIONS = ["template"];

const KATEGORI_LABELS = {
  pembukaan: "Pembukaan",
  follow_up: "Follow Up",
  penawaran: "Offers/Negosiasi",
  konfirmasi: "Konfirmasi",
  penutupan: "Penutupan",
  lainnya: "Lainnya",
};

const KATEGORI_TONE = {
  pembukaan:  "bg-accentbg text-accent",
  follow_up:  "bg-inset text-ink2",
  penawaran:  "bg-greenbg text-green",
  konfirmasi: "bg-orangebg text-orange",
  penutupan:  "bg-redbg text-red",
  lainnya:    "bg-inset text-ink3",
};

const EMPTY_TPL_FORM = { nama: "", kategori: "pembukaan", isi: "", isShared: false };

function TemplateFormatToolbar({ textareaRef, value, onChange }) {
  function apply(marker) {
    const el = textareaRef.current;
    if (!el) return;
    const { nextText, selStart, selEnd } = toggleWaFormat(el, value, marker);
    onChange(nextText);
    setTimeout(() => {
      el.focus();
      el.selectionStart = selStart;
      el.selectionEnd = selEnd;
    }, 0);
  }
  const btnCls = "flex items-center rounded-md bg-inset p-1.5 text-ink3 transition-colors hover:bg-hovertint hover:text-ink2";
  return (
    <div className="mb-1.5 flex gap-1.5">
      <button type="button" title="Tebal (*teks*)" className={btnCls} onClick={() => apply(WA_MARKERS.bold)}><Bold size={13} /></button>
      <button type="button" title="Miring (_teks_)" className={btnCls} onClick={() => apply(WA_MARKERS.italic)}><Italic size={13} /></button>
      <button type="button" title="Coret (~teks~)" className={btnCls} onClick={() => apply(WA_MARKERS.strike)}><Strikethrough size={13} /></button>
    </div>
  );
}

function TemplateSection({ user }) {
  const isAdmin = isAdminUser(user);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_TPL_FORM);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(null);
  const formTextareaRef = useRef(null);

  useEffect(() => {
    api.getTemplates()
      .then(setTemplates)
      .catch(() => setMsg({ type: "error", text: "Gagal memuat template" }))
      .finally(() => setLoading(false));
  }, []);

  function showMsg(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_TPL_FORM);
    setShowForm(true);
  }

  function openEdit(tpl) {
    setEditId(tpl.id);
    setForm({ nama: tpl.nama, kategori: tpl.kategori, isi: tpl.isi, isShared: tpl.isShared });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_TPL_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editId) {
        const updated = await api.updateTemplate(editId, form);
        setTemplates((prev) => prev.map((t) => (t.id === editId ? updated : t)));
        showMsg("success", "Template berhasil diperbarui");
      } else {
        const created = await api.createTemplate(form);
        setTemplates((prev) => [...prev, created]);
        showMsg("success", "Template berhasil ditambahkan");
      }
      cancelForm();
    } catch (err) {
      showMsg("error", err.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Hapus template ini?")) return;
    try {
      await api.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      showMsg("success", "Template dihapus");
    } catch (err) {
      showMsg("error", err.message);
    }
  }

  function handleCopy(tpl) {
    navigator.clipboard.writeText(tpl.isi).then(() => {
      setCopied(tpl.id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const templateTim   = templates.filter((t) => t.isShared);
  const templateSaya  = templates.filter((t) => !t.isShared);

  function renderDaftar(list) {
    const grouped = Object.keys(KATEGORI_LABELS).reduce((acc, k) => {
      acc[k] = list.filter((t) => t.kategori === k);
      return acc;
    }, {});
    return (
      <div className="flex flex-col gap-5">
        {Object.entries(KATEGORI_LABELS).map(([key, label]) => {
          const items = grouped[key] || [];
          if (items.length === 0) return null;
          return (
            <div key={key}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className={cn("rounded-chip px-2.5 py-1 text-[11px] font-bold", KATEGORI_TONE[key])}>
                  {label}
                </span>
                <span className="text-xs text-ink3">{items.length} template</span>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((tpl) => (
                  <div key={tpl.id} className="flex items-start gap-3 rounded-btn bg-inset p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-[13px] font-semibold text-ink">
                        {tpl.nama}
                        {tpl.isShared && tpl.author == null && (
                          <span className="ml-1.5 text-[10px] font-bold text-ink3">· TIM</span>
                        )}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink2">
                        {parseWaFormatting(tpl.isi)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        title="Salin isi template"
                        onClick={() => handleCopy(tpl)}
                        className={cn(
                          "rounded-md bg-surface p-1.5 transition-colors hover:bg-hovertint",
                          copied === tpl.id ? "text-green" : "text-ink3"
                        )}
                      >
                        {copied === tpl.id ? <CheckCircle size={13} /> : <Copy size={13} />}
                      </button>
                      {tpl.canManage && (
                        <>
                          <button
                            title="Edit"
                            onClick={() => openEdit(tpl)}
                            className="rounded-md bg-surface p-1.5 text-ink3 transition-colors hover:bg-hovertint"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            title="Hapus"
                            onClick={() => handleDelete(tpl.id)}
                            className="rounded-md bg-redbg p-1.5 text-red transition-colors hover:opacity-80"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[200px]">
          <CardTitle>Template Pesan</CardTitle>
          <CardDescription className="mt-1">
            Template siap pakai untuk mempercepat balasan di Inbox. Gunakan <code>{"{nama_customer}"}</code> untuk nama otomatis,
            dan tombol <strong>Tebal/Miring/Coret</strong> di bawah — formatnya akan tampil PERSIS begitu di WhatsApp customer.
          </CardDescription>
        </div>
        <Button size="sm" onClick={openAdd}><Plus size={14} /> Tambah Template</Button>
      </div>

      {msg && <div className="mb-4"><InlineFeedback msg={msg} /></div>}

      {showForm && (
        <div className="mb-6 rounded-btn bg-inset p-4">
          <div className="mb-3.5 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-ink">
              {editId ? "Edit Template" : "Template Baru"}
            </h3>
            <button onClick={cancelForm} className="text-ink3 hover:text-ink2">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nama Template *">
                <Input
                  value={form.nama}
                  onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
                  placeholder="Contoh: Salam Pembuka"
                  required
                />
              </Field>
              <Field label="Kategori">
                <select value={form.kategori} onChange={(e) => setForm((f) => ({ ...f, kategori: e.target.value }))} className={selectCls}>
                  {Object.entries(KATEGORI_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Isi Pesan *">
              <TemplateFormatToolbar
                textareaRef={formTextareaRef}
                value={form.isi}
                onChange={(v) => setForm((f) => ({ ...f, isi: v }))}
              />
              <textarea
                ref={formTextareaRef}
                value={form.isi}
                onChange={(e) => setForm((f) => ({ ...f, isi: e.target.value }))}
                placeholder={"Halo kak {nama_customer}, terima kasih sudah menghubungi Klinik Matras..."}
                rows={4}
                required
                className="w-full resize-y rounded-lg bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <p className="mt-1 text-[11px] text-ink3">
                Gunakan <code>{"{nama_customer}"}</code> — akan diganti otomatis dengan nama customer saat dipakai di Inbox.
                Pilih teks lalu klik tombol format di atas untuk menebalkan/memiringkan/mencoret
                (kotak ketik tetap teks polos dengan simbol WhatsApp — sama seperti WhatsApp asli,
                gayanya baru terlihat saat template dipakai/dikirim).
              </p>
              {form.isi && (
                <div className="mt-2 rounded-btn bg-surface p-2.5">
                  <p className="mb-1 text-[10px] font-bold uppercase text-ink3">Preview</p>
                  <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">
                    {parseWaFormatting(form.isi)}
                  </p>
                </div>
              )}
            </Field>

            {isAdmin && (
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink2">
                <input
                  type="checkbox"
                  checked={!!form.isShared}
                  onChange={(e) => setForm((f) => ({ ...f, isShared: e.target.checked }))}
                />
                Jadikan Template Tim (terlihat &amp; bisa dipakai semua sales)
              </label>
            )}

            <div className="flex gap-2">
              <Button type="submit" size="sm"><Save size={13} /> {editId ? "Simpan Perubahan" : "Buat Template"}</Button>
              <Button type="button" variant="neutral" size="sm" onClick={cancelForm}>Batal</Button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-ink3">Memuat...</p>
      ) : templates.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-ink3">
          Belum ada template. Klik "+ Tambah Template" untuk mulai.
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          <div>
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-ink3">
              Template Tim {templateTim.length > 0 && `(${templateTim.length})`}
            </h3>
            {templateTim.length === 0 ? (
              <p className="text-[13px] text-ink3">Belum ada template tim.</p>
            ) : renderDaftar(templateTim)}
          </div>
          <div>
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-ink3">
              Template Saya {templateSaya.length > 0 && `(${templateSaya.length})`}
            </h3>
            {templateSaya.length === 0 ? (
              <p className="text-[13px] text-ink3">
                Belum punya template pribadi. Klik "+ Tambah Template" — hanya Anda yang bisa lihat dan pakai.
              </p>
            ) : renderDaftar(templateSaya)}
          </div>
        </div>
      )}
    </Card>
  );
}

const BULAN_LABELS = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function SalesTargetSection() {
  const nowDate = new Date();
  const [year, setYear]   = useState(nowDate.getFullYear());
  const [month, setMonth] = useState(nowDate.getMonth() + 1);
  const [rows, setRows]   = useState([]); // [{ userId, name, targetValue }]
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg] = useState(null);

  function showMsg(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function load() {
    setLoading(true);
    try {
      const data = await api.getSalesTargets({ year, month });
      setRows(data.map((r) => ({ userId: r.userId, name: r.name, targetValue: r.targetValue || 0, isSalesTeamLead: !!r.isSalesTeamLead })));
    } catch (err) {
      showMsg("error", "Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [year, month]);

  async function handleSaveAll() {
    setSaving(true);
    try {
      await Promise.all(rows.map((r) =>
        api.updateSalesTarget({ userId: r.userId, year, month, targetValue: r.targetValue })
      ));
      showMsg("success", "Semua target berhasil disimpan");
    } catch (err) {
      showMsg("error", err.message);
    } finally {
      setSaving(false);
    }
  }

  const years = [nowDate.getFullYear() - 1, nowDate.getFullYear(), nowDate.getFullYear() + 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target Sales Bulanan</CardTitle>
        <CardDescription>
          Set target nilai order (Rupiah) per Sales Person per bulan. Digunakan untuk progress bar di Dashboard.
        </CardDescription>
      </CardHeader>

      {msg && <div className="mb-4"><InlineFeedback msg={msg} /></div>}

      <div className="mb-6 flex flex-wrap gap-3">
        <Field label="Bulan" className="min-w-[160px]">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={selectCls}>
            {BULAN_LABELS.slice(1).map((label, i) => (
              <option key={i + 1} value={i + 1}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Tahun" className="min-w-[110px]">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
      </div>

      {loading ? (
        <p className="text-[13px] text-ink3">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-ink3">Belum ada Sales Person terdaftar.</p>
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-2.5">
            {rows.map((row, idx) => (
              <div key={row.userId} className="flex items-center gap-3 rounded-btn bg-inset px-4 py-3">
                <div className="min-w-[120px]">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    {row.name}
                    {row.isSalesTeamLead && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-ink"
                        title="Target TIM (gabungan closing timnya + closing pribadi) — bukan target closing pribadi seperti sales lain"
                      >
                        <Crown size={10} /> Team Lead
                      </span>
                    )}
                  </span>
                  {row.isSalesTeamLead && (
                    <span className="mt-0.5 block text-[11px] text-ink3">Target tim (gabungan), bukan closing pribadi</span>
                  )}
                </div>
                <div className="flex flex-1 items-center gap-1.5">
                  <span className="text-[13px] text-ink3">Rp</span>
                  <input
                    type="number"
                    min="0"
                    step="1000000"
                    value={row.targetValue}
                    onChange={(e) => setRows((prev) => prev.map((r, i) => i === idx ? { ...r, targetValue: Number(e.target.value) } : r))}
                    className="h-8 max-w-[200px] flex-1 rounded-lg bg-surface px-2.5 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  />
                  {row.targetValue > 0 && (
                    <span className="text-xs text-ink3">= {formatRupiah(row.targetValue)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button onClick={handleSaveAll} disabled={saving}>
            <Save size={14} /> {saving ? "Menyimpan..." : "Simpan Semua Target"}
          </Button>
        </>
      )}
    </Card>
  );
}

function PromoSection() {
  const [promos, setPromos] = useState(null);
  const [msg, setMsg] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", discountPercent: "", validFrom: "", validUntil: "" });
  const [saving, setSaving] = useState(false);

  function showMsg(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  function load() {
    api.getPromos().then(setPromos).catch((err) => showMsg("error", err.message));
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      await api.createPromo({
        code: form.code, name: form.name,
        discountPercent: form.discountPercent || undefined,
        validFrom: form.validFrom || undefined,
        validUntil: form.validUntil || undefined,
      });
      setForm({ code: "", name: "", discountPercent: "", validFrom: "", validUntil: "" });
      setShowForm(false);
      showMsg("success", "Promo dibuat");
      load();
    } catch (err) {
      showMsg("error", err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(promo) {
    try {
      await api.updatePromo(promo.id, { active: !promo.active });
      load();
    } catch (err) {
      showMsg("error", err.message);
    }
  }

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <CardTitle>Promo</CardTitle>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}><Plus size={14} /> Promo Baru</Button>
      </div>
      <CardDescription className="mb-5">
        Kampanye yang bisa dipilih sales saat input order (mis. "Merdeka dari Sakit Pinggang").
        Diskonnya cuma PENANDA untuk laporan — harga akhir tetap diketik manual sales seperti biasa,
        tidak dihitung otomatis dari sini.
      </CardDescription>

      {msg && <div className="mb-4"><InlineFeedback msg={msg} /></div>}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-4 rounded-btn bg-inset p-3.5">
          <div className="flex flex-wrap gap-2.5">
            <Field label="Kode" className="min-w-[140px]">
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="MERDEKA17" className="uppercase" />
            </Field>
            <Field label="Nama Kampanye" className="min-w-[220px] flex-1">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Merdeka dari Sakit Pinggang" />
            </Field>
            <Field label="Diskon (%)" className="min-w-[100px]">
              <Input type="number" min="0" max="100" value={form.discountPercent}
                onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))} placeholder="17" />
            </Field>
            <Field label="Mulai">
              <Input type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} />
            </Field>
            <Field label="Sampai">
              <Input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan..." : "Simpan Promo"}</Button>
            <Button type="button" variant="neutral" size="sm" onClick={() => setShowForm(false)}>Batal</Button>
          </div>
        </form>
      )}

      {promos === null ? (
        <p className="text-[13px] text-ink3">Memuat...</p>
      ) : promos.length === 0 ? (
        <p className="text-[13px] text-ink3">Belum ada promo dibuat.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {promos.map((p) => (
            <div key={p.id} className={cn("flex items-center gap-3 rounded-btn bg-inset px-3.5 py-2.5", !p.active && "opacity-55")}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-chip bg-accentbg px-2 py-0.5 font-mono text-[12px] font-bold text-accent">{p.code}</span>
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  {p.discountPercent != null && (
                    <span className="text-[11px] font-bold text-green">{p.discountPercent}%</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink3">
                  {p.orderCount} order · {formatRupiah(p.totalValue)}
                  {(p.validFrom || p.validUntil) && (
                    <> · {p.validFrom ? new Date(p.validFrom).toLocaleDateString("id-ID") : "—"} s/d {p.validUntil ? new Date(p.validUntil).toLocaleDateString("id-ID") : "—"}</>
                  )}
                </p>
              </div>
              <Button variant="neutral" size="sm" onClick={() => toggleActive(p)}>
                {p.active ? "Nonaktifkan" : "Aktifkan"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function PengaturanSales({ user }) {
  const isAdmin = isAdminUser(user);

  // Deep link ?section= — sama pola dengan Pengaturan.jsx (Dashboard Target
  // Sales widget & sidebar Growth pakai ini).
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const sectionValid = NAV_KEYS.includes(requestedSection)
    && (isAdmin || SALES_ALLOWED_SECTIONS.includes(requestedSection));
  const initialSection = sectionValid ? requestedSection : "template";
  const [section, setSection] = useState(initialSection);

  const visibleNavItems = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter((n) => SALES_ALLOWED_SECTIONS.includes(n.key));

  if (!isAdmin && !SALES_ALLOWED_SECTIONS.includes(section)) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <Lock size={40} className="text-ink3" />
        <h2 className="m-0 text-ink3">Akses Terbatas</h2>
        <p className="text-sm text-ink3">Hanya admin yang bisa mengakses bagian ini.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={isAdmin ? "Pengaturan Sales & CRM" : "Template Pesan"}
        subtitle={isAdmin ? "Template pesan, target sales, dan promo — khusus workspace Sales CRM" : "Kelola template balasan cepat milik Anda sendiri"}
      />

      {visibleNavItems.length > 1 && (
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className={cn(selectCls, "mb-4 shadow-card md:hidden")}
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          {visibleNavItems.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      )}

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {visibleNavItems.length > 1 && (
          <nav className="hidden shrink-0 flex-col gap-0.5 rounded-card bg-surface p-2 shadow-card md:flex md:w-56">
            {visibleNavItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={cn(
                  "flex items-center gap-2.5 rounded-btn px-3 py-2 text-left text-[13px] font-medium transition-colors",
                  section === key ? "bg-accentbg text-accent" : "text-ink2 hover:bg-hovertint"
                )}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </nav>
        )}

        <PageBody className="min-w-0 flex-1">
          {section === "template" && <TemplateSection user={user} />}
          {section === "target-sales" && <SalesTargetSection />}
          {section === "promo" && <PromoSection />}
        </PageBody>
      </div>
    </PageContainer>
  );
}
