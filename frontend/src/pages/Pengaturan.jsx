import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2, Lock, Wifi, Download, Save, Eye, EyeOff, CheckCircle,
  MessageSquare, Plus, Pencil, Trash2, X, Copy, TrendingUp, Palette,
  Bold, Italic, Strikethrough, Camera, Tag,
} from "lucide-react";
import { api } from "../api.js";
import { getSocket } from "../lib/socket.js";
import Avatar from "../components/Avatar.jsx";
// Lazy — lihat catatan yang sama di Customers.jsx: exportToExcel() (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.
import { formatRupiah, STAGE_LABELS, SOURCE_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "../utils/format.js";
import { WA_MARKERS, toggleWaFormat, parseWaFormatting } from "../utils/waFormat.jsx";

// Polling fallback (Fix UX sync-history) kalau socket putus/belum sempat
// connect — 3 detik sesuai spec.
import AppearanceSection from "@/features/settings/AppearanceSection.jsx";
import { isAdminUser } from "@/lib/roles.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Divider } from "@/components/ui/divider.jsx";
import { cn } from "@/lib/utils.js";

// Reskin 20 Agt 2026 (Sano DS v2 strangler-fig, lihat CLAUDE.md/dokumen
// migrasi) — halaman ini sebelumnya satu-satunya yang masih pakai kelas CSS
// lama (`.settings-card`/`.form-group`/`.wa-session-*`/dll dari index.css),
// jadi terlihat beda sendiri (kotak gelap penuh border) dibanding
// Order/Pelanggan yang sudah migrasi (kartu tanpa border, token bg-surface/
// bg-inset). Perubahan ini CUMA lapisan markup/style — semua state, handler,
// dan alur data di bawah TIDAK disentuh.
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

const SYNC_POLL_INTERVAL_MS = 3000;

const NAV_ITEMS = [
  { key: "profil",        label: "Profil Perusahaan", icon: Building2 },
  { key: "whatsapp",     label: "Status WhatsApp",    icon: Wifi },
  { key: "template",     label: "Template Pesan",     icon: MessageSquare },
  { key: "target-sales", label: "Target Sales",       icon: TrendingUp },
  { key: "promo",        label: "Promo",              icon: Tag },
  { key: "tampilan",     label: "Tampilan",           icon: Palette },
  { key: "keamanan",     label: "Keamanan Akun",      icon: Lock },
  { key: "data",         label: "Data & Backup",      icon: Download },
];

const KATEGORI_LABELS = {
  pembukaan: "Pembukaan",
  follow_up: "Follow Up",
  penawaran: "Offers/Negosiasi",
  konfirmasi: "Konfirmasi",
  penutupan: "Penutupan",
  lainnya: "Lainnya",
};

// Token DS v2 — dibatasi warna semantik yang tersedia (red/orange/green +
// SATU accent, aturan "satu accent"), bukan palet hex bebas seperti dulu.
const KATEGORI_TONE = {
  pembukaan:  "bg-accentbg text-accent",
  follow_up:  "bg-inset text-ink2",
  penawaran:  "bg-greenbg text-green",
  konfirmasi: "bg-orangebg text-orange",
  penutupan:  "bg-redbg text-red",
  lainnya:    "bg-inset text-ink3",
};

const EMPTY_TPL_FORM = { nama: "", kategori: "pembukaan", isi: "", isShared: false };

function formatSyncDuration(startedAt, finishedAt) {
  const seconds = Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000);
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} mnt ${rest} dtk`;
}

// Revisi 26 Jul 2026: dulu SATU daftar rata untuk semua orang (file JSON
// tanpa kepemilikan). Sekarang dipisah "Template Tim" (isShared, hanya ADMIN
// yang kelola) vs "Template Saya" (pribadi milik user yang login, SALES
// bebas bikin/edit/hapus punya sendiri) — sesuai keputusan 26 Jul 2026:
// "sales punya template masing-masing yang bisa dicustomize". Backend
// (routes/templates.js) yang menegakkan siapa boleh apa lewat `canManage`
// per-item; komponen ini cuma mengikuti flag itu, bukan menghitung ulang.
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

  // Dua daftar terpisah — bukan "daftar polos dikelompokkan kategori" seperti
  // dulu, karena kepemilikan sekarang bagian penting dari cara membacanya:
  // sales harus langsung lihat mana template MEREKA (bebas ubah) vs Template
  // Tim (cuma bisa pakai). Dalam tiap daftar tetap dikelompokkan kategori.
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
                      {/* Format WhatsApp langsung dirender di sini juga (bukan
                          teks mentah "*.../*") — supaya preview template SAMA
                          dengan tampilan di TemplatePicker Inbox dan pesan
                          yang benar-benar terkirim. */}
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
                      {/* Edit/Hapus HANYA kalau backend bilang boleh — server
                          yang menegakkan aturan (template Tim = admin saja,
                          template pribadi = pemiliknya saja), tombol ini
                          cuma mengikuti, tidak menghitung ulang aturannya. */}
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

      {/* Form tambah/edit */}
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

            {/* Toggle "jadikan Template Tim" HANYA untuk ADMIN — sales tidak
                bisa mempromosikan template pribadinya sendiri jadi milik
                tim (server juga menolak ini kalau dipaksa lewat API, lihat
                routes/templates.js). */}
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

      {/* Daftar template — dipisah Tim vs Saya */}
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

// 2 session WAHA aktif (lihat CLAUDE.md §"Multi-session WAHA aktif") — CS-1
// dan CS-2, masing-masing dicek terpisah lewat ?session= (backend tetap
// backward-compatible, default WAHA_SESSION kalau param tidak dikirim).
const WA_SESSIONS = [
  { key: "CS-1", label: "CS-1" },
  { key: "CS-2", label: "CS-2" },
];

function WaSessionCard({ session, label }) {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(false);

  async function checkStatus() {
    setLoading(true);
    try {
      const data = await api.getWhatsappStatus(session);
      setStatus(data);
    } catch (err) {
      setStatus({ status: "ERROR", connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { checkStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connected = status?.connected;

  return (
    <div className="rounded-btn bg-inset p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-ink">{label}</span>
        {status && (
          <span className={cn(
            "flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-[11px] font-bold",
            connected ? "bg-greenbg text-green" : "bg-redbg text-red"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-green" : "bg-red")} />
            {connected ? "WORKING" : (status.status || "DOWN")}
          </span>
        )}
      </div>
      {status?.error && (
        <p className="mt-2 text-[12px] text-red">{status.error}</p>
      )}
      <Button variant="secondary" size="sm" className="mt-3" onClick={checkStatus} disabled={loading}>
        <Wifi size={13} /> {loading ? "Mengecek..." : "Cek Status"}
      </Button>
    </div>
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
      setRows(data.map((r) => ({ userId: r.userId, name: r.name, targetValue: r.targetValue || 0 })));
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

      {/* Pilih bulan & tahun */}
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
                <span className="min-w-[120px] text-sm font-semibold text-ink">{row.name}</span>
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

// D-026 (20 Agustus 2026) — kelola katalog kampanye promo (mis. "Merdeka
// dari Sakit Pinggang" diskon hingga 17%). Admin-only (create/edit) — sales
// cuma MEMILIH promo dari dropdown ini saat input order (OrderSection.jsx),
// tidak pernah membuat kampanye baru sendiri.
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
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  <span className="font-mono text-[11px] text-ink3">{p.code}</span>
                  {p.discountPercent != null && (
                    <span className="text-[11px] font-bold text-accent">{p.discountPercent}%</span>
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

const NAV_KEYS = NAV_ITEMS.map((n) => n.key);

// Section yang boleh diakses SALES (bukan cuma ADMIN). Revisi 26 Jul 2026:
// sebelumnya SELURUH halaman Pengaturan diblokir untuk non-admin di satu
// gerbang paling atas ("Hanya admin yang bisa mengakses halaman
// Pengaturan") — akibatnya "Template Saya" yang justru dirancang supaya
// SETIAP sales bisa bikin template sendiri (lihat routes/templates.js,
// keputusan bisnis yang sama) tidak pernah bisa dibuka sales sama sekali,
// terlepas dari kepemilikan per-template di backend sudah benar. Sekarang
// gerbangnya PER-SECTION: SALES cuma bisa buka "Template Pesan" (untuk
// kelola template pribadinya), section lain (Profil Perusahaan, Status
// WhatsApp, Target Sales, Data & Backup) TETAP admin-only.
//
// "keamanan" DITAMBAHKAN (19 Agustus 2026, bareng fitur ganti foto profil
// web): ini section AKUN PRIBADI (password + foto profil sendiri), sama
// sifatnya dengan "template" — bukan pengaturan perusahaan/tim yang
// seharusnya admin-only. Sebelumnya ikut ke-lock tanpa alasan eksplisit,
// akibatnya SALES tidak bisa ganti password ATAU foto profilnya sendiri
// dari web sama sekali (cuma bisa dari aplikasi mobile).
const SALES_ALLOWED_SECTIONS = ["template", "keamanan"];

export default function Pengaturan({ user, onUserUpdate }) {
  const isAdmin = isAdminUser(user);

  // Deep link ?section=target-sales — dipakai widget Target Sales di
  // Dashboard supaya empty state bisa langsung buka tab yang relevan.
  // SALES: default ke "template" (satu-satunya section yang boleh dia
  // buka), bukan "profil" yang akan langsung kena gerbang akses-terbatas.
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const sectionValid = NAV_KEYS.includes(requestedSection)
    && (isAdmin || SALES_ALLOWED_SECTIONS.includes(requestedSection));
  const initialSection = sectionValid ? requestedSection : (isAdmin ? "profil" : "template");
  const [section, setSection] = useState(initialSection);

  // Sidebar/dropdown SALES cuma menampilkan section yang boleh dia buka —
  // bukan cuma disembunyikan di UI, gerbang di bawah (sebelum render body)
  // tetap menolak kalau section di-set lewat cara lain (mis. URL manual).
  const visibleNavItems = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter((n) => SALES_ALLOWED_SECTIONS.includes(n.key));

  // Settings
  const [settings, setSettings]   = useState(null);
  const [form, setForm]           = useState({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg]       = useState(null);

  // Sinkronisasi riwayat chat — job background (Fix UX timeout), bukan
  // request panjang yang di-await. syncJob = job dari backend penuh:
  // { jobId, status: running|done|failed, progress: {...}, error }.
  const [syncJob, setSyncJob] = useState(null);
  const syncPollRef = useRef(null);

  // Password change
  const [pwForm, setPwForm]       = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwMsg, setPwMsg]         = useState(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [showPw, setShowPw]       = useState({ current: false, new: false, confirm: false });

  // Foto profil — SEBELUMNYA cuma bisa diganti dari aplikasi mobile "Sano
  // Messenger" (ProfileScreen.js). Endpoint backend (POST /users/me/avatar)
  // sudah generik sejak awal, cuma web belum pernah punya UI-nya.
  const avatarInputRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg]             = useState(null);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // supaya pilih file YANG SAMA lagi tetap memicu onChange
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarMsg({ type: "error", text: "File harus berupa gambar" });
      return;
    }
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const updated = await api.uploadAvatar(fd);
      onUserUpdate?.({ avatarUrl: updated.avatarUrl });
      setAvatarMsg({ type: "success", text: "Foto profil berhasil diganti" });
    } catch (err) {
      setAvatarMsg({ type: "error", text: err.message });
    } finally {
      setUploadingAvatar(false);
    }
  }

  // Export data
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setForm(s);
    }).catch(() => {});
  }, []);

  function showMsg(setter, type, text) {
    setter({ type, text });
    setTimeout(() => setter(null), 4000);
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const updated = await api.updateSettings(form);
      setSettings(updated);
      showMsg(setSettingsMsg, "success", "Pengaturan berhasil disimpan.");
    } catch (err) {
      showMsg(setSettingsMsg, "error", err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  // Cek job yang mungkin masih berjalan (mis. admin refresh halaman di
  // tengah sync) — dipanggil saat mount, BUKAN cuma setelah klik tombol.
  useEffect(() => {
    api.getSyncHistoryStatus().then((job) => {
      if (job?.status === "running") setSyncJob(job);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket real-time (jalur utama) + polling 3 detik (fallback kalau socket
  // putus/belum connect) — SELALU jalan berdua selama job running, whichever
  // sampai duluan yang menang (keduanya idempotent, sama-sama cuma setState).
  useEffect(() => {
    if (syncJob?.status !== "running") {
      clearInterval(syncPollRef.current);
      return;
    }

    const socket = getSocket();
    function handleProgress(job) { setSyncJob(job); }
    function handleDone(job) { setSyncJob(job); }
    socket.on("sync:progress", handleProgress);
    socket.on("sync:done", handleDone);

    syncPollRef.current = setInterval(() => {
      api.getSyncHistoryStatus().then((job) => {
        if (job?.status) setSyncJob(job);
      }).catch(() => {});
    }, SYNC_POLL_INTERVAL_MS);

    return () => {
      socket.off("sync:progress", handleProgress);
      socket.off("sync:done", handleDone);
      clearInterval(syncPollRef.current);
    };
  }, [syncJob?.status]);

  async function handleSyncHistory() {
    try {
      const result = await api.syncChatHistory();
      setSyncJob({ jobId: result.jobId, status: "running", progress: { totalChats: 0, processedChats: 0, newMessages: 0, failedChats: 0, unsupportedMessages: 0, currentChat: null } });
    } catch (err) {
      // 409 = job lain sudah jalan (mis. admin lain klik duluan) — bukan
      // error sungguhan, cuma "nempel" ke job yang sedang berjalan itu.
      if (err.message === "Sinkronisasi sedang berjalan") {
        api.getSyncHistoryStatus().then((job) => job?.status === "running" && setSyncJob(job)).catch(() => {});
        return;
      }
      setSyncJob({ status: "failed", error: err.message, progress: {} });
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwMsg({ type: "error", text: "Password baru dan konfirmasi tidak cocok." });
      return;
    }
    if (pwForm.newPassword.length < 6) {
      setPwMsg({ type: "error", text: "Password baru minimal 6 karakter." });
      return;
    }
    setPwLoading(true);
    try {
      await api.changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showMsg(setPwMsg, "success", "Password berhasil diubah.");
    } catch (err) {
      showMsg(setPwMsg, "error", err.message);
    } finally {
      setPwLoading(false);
    }
  }

  async function handleExportCustomers() {
    const { exportToExcel } = await import("../utils/export.js");
    const HEALTH_LABELS = { SAKIT: "Sakit", TIDAK_SAKIT: "Tidak Sakit" };
    setExporting(true);
    try {
      const customers = await api.getCustomers();
      exportToExcel(
        customers.map((c) => ({
          /* Urutan kolom cocok dengan tabel Pelanggan */
          "Nama Pelanggan":     c.name || c.phone || c.instagramHandle || "",
          "ID Order":           c.latestOrderNumber || "",
          "No HP":              c.phone || "",
          Instagram:            c.instagramHandle ? "@" + c.instagramHandle : "",
          Email:                c.email || "",
          Pipeline:             STAGE_LABELS[c.pipelineStage] || c.pipelineStage || "",
          "Status Order":       ORDER_STATUS_LABELS[c.latestOrderStatus] || (c.latestOrderStatus ? c.latestOrderStatus : "Belum Ada Order"),
          "Status Pembayaran":  PAYMENT_STATUS_LABELS[c.latestPaymentStatus] || "",
          "Keluhan Terbaru":    c.latestKeluhan || "",
          "Merk Kasur":         c.latestMerkKasur || "",
          "Ukuran Kasur":       c.latestUkuranKasur || "",
          "Berat Badan (kg)":   c.latestBeratBadan || "",
          Layanan:              c.latestLayanan || "",
          "Status Kesehatan":   HEALTH_LABELS[c.healthStatus] || "Belum Diisi",
          Tags:                 (c.tags || []).join(", "),
          "Tipe Pelanggan":     c.customerType === "CORPORATE" ? "Korporat" : "End User",
          Kota:                 c.city || "",
          "Sumber Lead":        SOURCE_LABELS[c.leadSource] || c.leadSource || "",
          "Jumlah Order":       c.orderCount || 0,
          "Total Nilai Order":  formatRupiah(c.orderValue || 0),
          "Pernah Komplain":    c.pernahKomplain ? "Ya" : "Tidak",
          "Sales Person":       c.assignedSales?.name || "",
        })),
        `export-pelanggan-${new Date().toISOString().slice(0, 10)}`
      );
    } catch (err) {
      alert("Gagal export: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  // Gerbang PER-SECTION (bukan seluruh halaman lagi) — lihat komentar
  // SALES_ALLOWED_SECTIONS di atas. `section` di sini SUDAH divalidasi lewat
  // `sectionValid` saat inisialisasi awal, tapi dicek ULANG di sini karena
  // `setSection` bisa dipanggil kapan saja lewat klik sidebar/dropdown —
  // keduanya sudah difilter ke `visibleNavItems` untuk SALES, tapi gerbang
  // ini tetap jaring terakhir kalau ada jalan lain mengubah `section`.
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
        title={isAdmin ? "Pengaturan" : "Template Pesan"}
        subtitle={isAdmin ? "Konfigurasi sistem CRM Klinik Matras" : "Kelola template balasan cepat milik Anda sendiri"}
      />

      {/* Dropdown sub-menu — mobile saja (sidebar disembunyikan di breakpoint
          ini, lihat md:block di bawah). SALES cuma punya 1 opsi (Template
          Pesan), jadi dropdown-nya tidak perlu ditampilkan sama sekali —
          dropdown 1-opsi cuma bingung, bukan navigasi. */}
      {visibleNavItems.length > 1 && (
        // `style` (bukan cuma className bg-surface) SENGAJA dipakai di sini —
        // select ini duduk LANGSUNG di atas bg page (bukan di dalam Card),
        // dan ada rule CSS lama di index.css (selector element polos `select`,
        // tidak masuk @layer) yang menang atas utility Tailwind `bg-surface`
        // (Tailwind v4: utility ada di @layer, cascade layer TANPA nama selalu
        // menang lawan layer manapun terlepas dari spesifisitas) — hasilnya
        // dropdown ini KELIHATAN NYARIS TRANSPARAN (F5F5F7 di atas F5F5F7,
        // sama-sama warna page). `style` inline SELALU menang di luar isu
        // layer itu, jadi paling aman dipakai cuma di titik ini.
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
        {/* Sidebar — disembunyikan total untuk SALES (cuma 1 section, sidebar
            navigasi tidak ada gunanya untuk 1 pilihan). */}
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

        {/* Main */}
        <PageBody className="min-w-0 flex-1">

          {/* ── PROFIL PERUSAHAAN ── */}
          {section === "profil" && (
            <Card>
              <CardTitle className="mb-5">Profil Perusahaan</CardTitle>
              {settingsMsg && (
                <div className="mb-4"><InlineFeedback msg={settingsMsg} /></div>
              )}
              <form onSubmit={handleSaveSettings} className="flex flex-col gap-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[
                    { key: "companyName",    label: "Nama Perusahaan",  placeholder: "Klinik Matras" },
                    { key: "companyTagline", label: "Tagline",          placeholder: "Spesialis Kasur Berkualitas" },
                    { key: "companyEmail",   label: "Email Perusahaan", placeholder: "info@klinikmatras.com", type: "email" },
                    { key: "companyPhone",   label: "Nomor Telepon",    placeholder: "628xxxx" },
                    { key: "companyAddress", label: "Alamat",           placeholder: "Jl. Contoh No. 1", full: true },
                    { key: "companyCity",    label: "Kota",             placeholder: "Bandung" },
                  ].map(({ key, label, placeholder, type, full }) => (
                    <Field key={key} label={label} className={full ? "sm:col-span-2" : undefined}>
                      <Input type={type || "text"} value={form[key] || ""} placeholder={placeholder}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                    </Field>
                  ))}
                </div>

                <Divider inset={false} />
                <div>
                  <h3 className="mb-3 text-[15px] font-bold text-ink">Target & Mata Uang</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Target Penjualan Bulanan (Rp)" hint={`Saat ini: ${formatRupiah(form.targetBulanan || 0)}`}>
                      <Input type="number" value={form.targetBulanan || ""} placeholder="500000000"
                        onChange={(e) => setForm((f) => ({ ...f, targetBulanan: Number(e.target.value) }))} />
                    </Field>
                    <Field label="Timezone">
                      <select value={form.timezone || "Asia/Jakarta"} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} className={selectCls}>
                        <option value="Asia/Jakarta">WIB — Asia/Jakarta</option>
                        <option value="Asia/Makassar">WITA — Asia/Makassar</option>
                        <option value="Asia/Jayapura">WIT — Asia/Jayapura</option>
                      </select>
                    </Field>
                  </div>
                </div>

                <Divider inset={false} />
                <div>
                  <h3 className="mb-3 text-[15px] font-bold text-ink">Koneksi WAHA</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="WAHA Base URL">
                      <Input type="text" value={form.wahaBaseUrl || ""} placeholder="http://localhost:3000"
                        onChange={(e) => setForm((f) => ({ ...f, wahaBaseUrl: e.target.value }))} />
                    </Field>
                    <Field label="WAHA Session Name">
                      <Input type="text" value={form.wahaSession || ""} placeholder="default"
                        onChange={(e) => setForm((f) => ({ ...f, wahaSession: e.target.value }))} />
                    </Field>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={savingSettings}>
                    <Save size={15} /> {savingSettings ? "Menyimpan..." : "Simpan Pengaturan"}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {/* ── STATUS WHATSAPP ── */}
          {section === "whatsapp" && (
            <Card>
              <CardHeader>
                <CardTitle>Status Koneksi WhatsApp</CardTitle>
                <CardDescription>Status real-time koneksi WAHA self-hosted untuk kedua nomor CS.</CardDescription>
              </CardHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {WA_SESSIONS.map((s) => (
                  <WaSessionCard key={s.key} session={s.key} label={s.label} />
                ))}
              </div>

              <div className="mt-5">
                <Button variant="secondary" onClick={handleSyncHistory} disabled={syncJob?.status === "running"}>
                  <Download size={15} /> {syncJob?.status === "running" ? "Sedang sinkronisasi..." : "Sinkronisasi Riwayat Chat"}
                </Button>
              </div>

              {syncJob?.status === "running" && (
                <div className="mt-3.5 max-w-[420px]">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{
                        width: `${syncJob.progress.totalChats ? Math.min(100, Math.round((syncJob.progress.processedChats / syncJob.progress.totalChats) * 100)) : 0}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ink3">
                    {syncJob.progress.processedChats}/{syncJob.progress.totalChats || "?"} chat diproses
                    {syncJob.progress.currentChat && <> — Memproses {syncJob.progress.currentChat}...</>}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink3">
                    {syncJob.progress.newMessages} pesan baru ditemukan
                  </p>
                </div>
              )}

              {syncJob?.status === "done" && (
                <div className="mt-3.5">
                  <InlineFeedback msg={{
                    type: "success",
                    text: (
                      <>
                        <strong>Selesai:</strong> {syncJob.progress.processedChats} chat diproses, {syncJob.progress.newMessages} pesan baru
                        {syncJob.progress.failedChats > 0 && <> · {syncJob.progress.failedChats} chat gagal (lihat log)</>}
                        {syncJob.progress.unsupportedMessages > 0 && <> · {syncJob.progress.unsupportedMessages} pesan tipe tidak dikenal (lihat log)</>}
                        {syncJob.startedAt && syncJob.finishedAt && <> · durasi {formatSyncDuration(syncJob.startedAt, syncJob.finishedAt)}</>}
                      </>
                    ),
                  }} />
                </div>
              )}
              {syncJob?.status === "failed" && (
                <div className="mt-3.5">
                  <InlineFeedback msg={{ type: "error", text: `Gagal sinkronisasi: ${syncJob.error}` }} />
                </div>
              )}

              <div className="mt-6 rounded-btn bg-inset p-4">
                <h3 className="mb-2 text-sm font-bold text-ink">Cara menghubungkan ulang</h3>
                <ol className="m-0 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink2">
                  <li>Buka WAHA dashboard di browser (URL dari pengaturan profil)</li>
                  <li>Pilih session &ldquo;CS-1&rdquo; atau &ldquo;CS-2&rdquo; sesuai nomor yang terputus</li>
                  <li>Klik &ldquo;Start&rdquo; → scan QR code dengan WhatsApp di HP</li>
                  <li>Tunggu status berubah menjadi &ldquo;WORKING&rdquo;</li>
                  <li>Klik &ldquo;Cek Status&rdquo; di card di atas untuk verifikasi</li>
                </ol>
              </div>
            </Card>
          )}

          {/* ── TEMPLATE PESAN ── */}
          {section === "tampilan" && <AppearanceSection />}

          {section === "template" && <TemplateSection user={user} />}

          {/* ── TARGET SALES ── */}
          {section === "target-sales" && <SalesTargetSection />}

          {/* ── PROMO (D-026) ── */}
          {section === "promo" && <PromoSection />}

          {/* ── KEAMANAN ── */}
          {section === "keamanan" && (
            <>
              {/* Foto profil — CATATAN 19 Agustus 2026: dulu cuma bisa diganti
                  dari mobile "Sano Messenger". Sekarang jalur yang sama persis
                  (POST /users/me/avatar, crop persegi 256px di server) juga
                  dibuka di sini. */}
              <Card className="mb-4">
                <CardTitle className="mb-1">Foto Profil</CardTitle>
                <CardDescription className="mb-4">
                  Terlihat di sidebar, header, dan mana pun nama Anda muncul di CRM.
                </CardDescription>
                {avatarMsg && <div className="mb-4"><InlineFeedback msg={avatarMsg} /></div>}
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    title="Ganti foto profil"
                    className={cn("relative rounded-full border-0 bg-transparent p-0", uploadingAvatar ? "cursor-wait" : "cursor-pointer")}
                  >
                    <Avatar name={user?.name} src={user?.avatarUrl} size="xl" />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-surface bg-accent text-white">
                      <Camera size={13} />
                    </span>
                  </button>
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                    >
                      {uploadingAvatar ? "Mengunggah..." : "Ganti Foto"}
                    </Button>
                    <p className="mt-1.5 text-[11.5px] text-ink3">JPG/PNG, otomatis dipotong persegi</p>
                  </div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleAvatarChange}
                  />
                </div>
              </Card>

              <Card>
              <CardTitle className="mb-1">Ganti Password</CardTitle>
              <CardDescription className="mb-5">
                Ubah password login Anda. Gunakan kombinasi huruf, angka, dan simbol.
              </CardDescription>
              {pwMsg && <div className="mb-4"><InlineFeedback msg={pwMsg} /></div>}
              <form onSubmit={handleChangePassword} className="flex max-w-[400px] flex-col gap-4">
                {[
                  { key: "currentPassword", label: "Password Saat Ini",  show: "current" },
                  { key: "newPassword",     label: "Password Baru",       show: "new" },
                  { key: "confirmPassword", label: "Konfirmasi Password Baru", show: "confirm" },
                ].map(({ key, label, show }) => (
                  <Field key={key} label={label}>
                    <div className="relative">
                      <Input
                        type={showPw[show] ? "text" : "password"}
                        value={pwForm[key]}
                        onChange={(e) => setPwForm((f) => ({ ...f, [key]: e.target.value }))}
                        placeholder="••••••••"
                        className="pr-10"
                      />
                      <button type="button" onClick={() => setShowPw((s) => ({ ...s, [show]: !s[show] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink2">
                        {showPw[show] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </Field>
                ))}
                <div className="flex justify-end">
                  <Button type="submit" disabled={pwLoading}>
                    <Lock size={15} /> {pwLoading ? "Menyimpan..." : "Ubah Password"}
                  </Button>
                </div>
              </form>
              </Card>
            </>
          )}

          {/* ── DATA & BACKUP ── */}
          {section === "data" && (
            <Card>
              <CardTitle className="mb-1">Data & Backup</CardTitle>
              <CardDescription className="mb-6">
                Export data CRM ke format Excel untuk backup atau analisis eksternal.
              </CardDescription>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between rounded-btn bg-inset px-5 py-4">
                  <div>
                    <p className="m-0 font-bold text-ink">Data Pelanggan</p>
                    <p className="mt-0.5 text-[13px] text-ink3">Semua data pelanggan beserta info kontak, pipeline, dan nilai order</p>
                  </div>
                  <Button variant="tertiary" onClick={handleExportCustomers} disabled={exporting}>
                    <Download size={14} /> {exporting ? "Mengunduh..." : "Export Excel"}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-btn bg-inset px-5 py-4">
                  <div>
                    <p className="m-0 font-bold text-ink">FAQ & Knowledge Base</p>
                    <p className="mt-0.5 text-[13px] text-ink3">Daftar pertanyaan & jawaban yang tersimpan di Knowledge Base AI</p>
                  </div>
                  <Button variant="tertiary" onClick={async () => {
                    try {
                      const [{ exportToExcel }, faq] = await Promise.all([import("../utils/export.js"), api.getFaq()]);
                      exportToExcel(faq.map((q) => ({ Pertanyaan: q.question, Jawaban: q.answer })), "faq-knowledge-base");
                    } catch (e) { alert("Gagal export FAQ: " + e.message); }
                  }}>
                    <Download size={14} /> Export Excel
                  </Button>
                </div>
              </div>

              <div className="mt-6 rounded-btn bg-orangebg p-4">
                <p className="m-0 text-[13px] font-semibold text-orange">
                  Catatan: Data percakapan dan pesan tidak dapat diexport secara massal karena volume yang besar. Gunakan Prisma Studio untuk akses database langsung jika diperlukan.
                </p>
              </div>
            </Card>
          )}
        </PageBody>
      </div>
    </PageContainer>
  );
}
