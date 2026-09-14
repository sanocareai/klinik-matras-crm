import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, Wrench, Truck as TruckIcon, Camera, X, Pencil, Loader2, Trash2, Plus } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "@/lib/dateRange.js";
import KpiCard from "@/features/laporan/components/KpiCard.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { formatRupiah } from "@/utils/format.js";

// Biaya Armada — halaman TERPISAH (D-167, 14 September 2026, permintaan
// owner: "input rincian biaya pengeluaran per kendaraan, servis dan
// lainnya... skema saat ini masih repot sekali, harus ke pengaturan > klik
// detail per kendaraan... bisa buat terpisah dari pengaturan dan ada
// fieldnya sendiri").
//
// SEBELUM ini, satu-satunya jalan mencatat BBM/tol/servis/dst adalah:
// Pengaturan Delivery > tab Armada > klik "Detail" SATU kendaraan > modal
// 720px > sub-tab Biaya/Servis. Mencatat pengeluaran untuk 3 kendaraan
// berarti membuka-tutup modal itu 3 kali, dan kendaraannya SELALU implisit
// dari modal mana yang sedang terbuka (tidak kelihatan di form itu sendiri).
//
// Sekarang: 1 halaman sendiri di sidebar (bukan disembunyikan di dalam
// Pengaturan), form Tambah SELALU menyertakan pemilih Kendaraan (eksplisit,
// bisa ganti-ganti tanpa tutup-buka apa pun), dan daftarnya menampilkan
// SEMUA kendaraan sekaligus dengan filter — satu tempat untuk seluruh
// armada, bukan silo per-kendaraan. `?vehicleId=`/`?tab=` di URL dipakai
// link "Detail" kendaraan di Pengaturan (ArmadaPengaturan.jsx) untuk lompat
// ke sini dengan kendaraan itu SUDAH terisi/terfilter — bukan duplikasi
// fitur, cuma titik masuk kedua ke satu-satunya form yang sekarang ada.
//
// Ringkasan lintas-armada (per kendaraan/per supir, km/liter, dst) TETAP di
// Laporan Delivery (ArmadaDeliveryReport.jsx — sudah ada sebelum ini,
// D-084) — itu tempat yang benar untuk ANGKA AGREGAT per rentang tanggal,
// halaman ini tempat yang benar untuk MENCATAT. Baris "Total sesuai
// filter" di bawah cuma umpan balik cepat saat mengetik, bukan pengganti
// laporan itu.
//
// Insiden (kecelakaan/lecet/tilang) SENGAJA TIDAK dipindah ke sini —
// alurnya beda kelas (kronologi, foto multi-sudut, klaim asuransi), tetap
// di tab Armada > Detail > Insiden.

const EXPENSE_CATEGORIES = {
  BBM: "BBM", TOL: "Tol", PARKIR: "Parkir", CUCI: "Cuci Mobil", DENDA: "Denda/Tilang", LAINNYA: "Lainnya",
};
const SERVICE_TYPES = {
  RUTIN: "Servis Rutin", PERBAIKAN: "Perbaikan", GANTI_OLI: "Ganti Oli",
  GANTI_BAN: "Ganti Ban", BODY_REPAIR: "Body Repair", LAINNYA: "Lainnya",
};

const inputCls = "h-9 w-full rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent";

function fmtTanggal(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// Pemilih foto struk/nota — upload LANGSUNG saat file dipilih, balikin URL
// yang tinggal disisipkan ke receiptUrl. Sengaja diduplikasi kecil dari
// ArmadaPengaturan.jsx (bentuk file beda: standalone di sini, karena
// halaman ini bukan bagian dari modal kendaraan) — endpoint upload-nya SAMA
// (POST /armada/receipts/upload), jadi tidak ada drift perilaku, cuma UI.
function ReceiptPicker({ url, onChange }) {
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
      fd.append("receipt", file);
      const { url: uploaded } = await api.uploadVehicleReceiptStandalone(fd);
      onChange(uploaded);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="block h-9 w-9 shrink-0 overflow-hidden rounded-btn border border-border">
          <img src={url} alt="Struk" className="h-full w-full object-cover" />
        </a>
      )}
      <label className={`flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-btn border border-dashed px-2.5 text-[11.5px] transition-colors ${uploading ? "border-border text-ink3" : "border-border text-ink2 hover:border-accent hover:text-accent"}`}>
        {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
        {url ? "Ganti Foto" : "Foto Struk"}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
      </label>
      {url && (
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-ink3 hover:text-red" title="Hapus foto">
          <X size={14} />
        </button>
      )}
      {error && <span className="text-[11px] text-red">{error}</span>}
    </div>
  );
}

function VehiclePicker({ vehicles, value, onChange, allowAll, className }) {
  return (
    <select className={cn(inputCls, className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">Semua Kendaraan</option>}
      {!allowAll && <option value="" disabled>— Pilih kendaraan —</option>}
      {vehicles.map((v) => (
        <option key={v.id} value={v.id}>{v.plateNumber} · {[v.brand, v.model].filter(Boolean).join(" ") || v.type}</option>
      ))}
    </select>
  );
}

// ── Tab PENGELUARAN: BBM/tol/parkir/cuci/denda/lainnya ──────────────────
const KOSONG_EXPENSE = { date: "", vehicleId: "", category: "BBM", amount: "", odometerKm: "", liters: "", driverId: "", receiptUrl: "", notes: "" };

function PengeluaranTab({ vehicles, drivers, initialVehicleId }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(() => ({ ...KOSONG_EXPENSE, vehicleId: initialVehicleId || "" }));
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [filterVehicleId, setFilterVehicleId] = useState(initialVehicleId || "");
  const [filterCategory, setFilterCategory] = useState("");
  const [range, setRange] = useState(() => makeRange("last_30_days"));

  const load = useCallback(() => {
    const params = { ...toApiParams(range), vehicleId: filterVehicleId || undefined, category: filterCategory || undefined };
    if ((!!range.from) !== (!!range.to)) return;
    setRows(null);
    api.getVehicleExpenses(params).then(setRows).catch(() => setRows([]));
  }, [range, filterVehicleId, filterCategory]);
  useEffect(() => { load(); }, [load]);

  function mulaiEdit(r) {
    setEditingId(r.id);
    setForm({
      date: r.date.slice(0, 10), vehicleId: r.vehicle.id, category: r.category, amount: String(r.amount),
      odometerKm: r.odometerKm ?? "", liters: r.liters ?? "", driverId: r.driverId || "",
      receiptUrl: r.receiptUrl || "", notes: r.notes || "",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function batalEdit() {
    setEditingId(null);
    setForm({ ...KOSONG_EXPENSE, vehicleId: filterVehicleId || "" });
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.vehicleId) { setError("Kendaraan wajib dipilih"); return; }
    if (!form.date || !form.amount) { setError("Tanggal dan nominal wajib diisi"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        vehicleId: form.vehicleId, date: form.date, category: form.category, amount: Number(form.amount),
        odometerKm: form.odometerKm || null,
        liters: form.category === "BBM" && form.liters ? Number(form.liters) : null,
        driverId: form.driverId || null, receiptUrl: form.receiptUrl || null, notes: form.notes || null,
      };
      if (editingId) {
        await api.updateVehicleExpense(editingId, payload);
      } else {
        await api.createVehicleExpense(payload);
      }
      batalEdit();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function hapus(id) {
    if (!confirm("Hapus catatan biaya ini?")) return;
    if (editingId === id) batalEdit();
    await api.deleteVehicleExpense(id);
    load();
  }

  const totalTampil = useMemo(() => (rows || []).reduce((n, r) => n + r.amount, 0), [rows]);

  return (
    <div className="flex flex-col gap-4">
      {/* Form Tambah — SELALU menyertakan pemilih Kendaraan (D-167), beda
          dari versi lama yang implisit dari modal kendaraan mana yang
          sedang terbuka. */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
          {editingId ? <><Pencil size={14} className="text-accent" /> Mengedit Catatan</> : <><Plus size={14} className="text-accent" /> Catat Pengeluaran</>}
          {editingId && <button type="button" onClick={batalEdit} className="ml-2 text-[11.5px] font-semibold text-accent underline">batal</button>}
        </div>
        <form onSubmit={submit} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Field label="Kendaraan" required className="col-span-2">
            <VehiclePicker vehicles={vehicles} value={form.vehicleId} onChange={(v) => setForm((f) => ({ ...f, vehicleId: v }))} />
          </Field>
          <Field label="Tanggal" required><DatePicker value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} placeholder="Pilih tanggal" allowFuture={false} /></Field>
          <Field label="Kategori">
            <select className={inputCls} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Nominal (Rp)" required><Input type="number" min="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="Odometer (km)" hint={form.category === "BBM" ? "Kunci hitung km/liter" : "Opsional"}>
            <Input type="number" min="0" value={form.odometerKm} onChange={(e) => setForm((f) => ({ ...f, odometerKm: e.target.value }))} />
          </Field>
          {form.category === "BBM" && (
            <Field label="Liter" hint="Kunci hitung km/liter"><Input type="number" step="0.01" min="0" value={form.liters} onChange={(e) => setForm((f) => ({ ...f, liters: e.target.value }))} /></Field>
          )}
          <Field label="Supir">
            <select className={inputCls} value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}>
              <option value="">— Pilih —</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Dokumentasi" className="col-span-2 sm:col-span-2">
            <ReceiptPicker url={form.receiptUrl} onChange={(url) => setForm((f) => ({ ...f, receiptUrl: url || "" }))} />
          </Field>
          <Field label="Catatan" className="col-span-2 sm:col-span-4">
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Opsional" />
          </Field>
          {error && <p className="col-span-full text-[12px] text-red">{error}</p>}
          <div className="col-span-full flex justify-end">
            <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Tambah Catatan"}</Button>
          </div>
        </form>
      </Card>

      {/* Filter + ringkasan cepat — TIDAK menggantikan Laporan Delivery,
          cuma umpan balik langsung atas apa yang sedang difilter di sini. */}
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Kendaraan" className="w-52">
          <VehiclePicker vehicles={vehicles} value={filterVehicleId} onChange={setFilterVehicleId} allowAll />
        </Field>
        <Field label="Kategori" className="w-40">
          <select className={inputCls} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">Semua Kategori</option>
            {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <div className="ml-auto"><DateRangePicker value={range} onChange={setRange} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Sesuai Filter" numericValue={totalTampil} format={formatRupiah} index={0} />
        <KpiCard label="Jumlah Catatan" numericValue={(rows || []).length} index={1} />
      </div>

      {rows === null ? <TableSkeletonRows rows={4} cols={7} /> : rows.length === 0 ? (
        <EmptyState icon={Wallet} title="Belum ada catatan biaya" description="Tambahkan pengisian BBM/tol/dst lewat form di atas." />
      ) : (
        <TableWrap>
          <Table>
            <THead><TR><TH>Tanggal</TH><TH>Kendaraan</TH><TH>Kategori</TH><TH>Supir</TH><TH>Odo/Liter</TH><TH>Struk</TH><TH>Nominal</TH><TH /></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={editingId === r.id ? "bg-accentbg/40" : undefined}>
                  <TD className="whitespace-nowrap text-ink2">{fmtTanggal(r.date)}</TD>
                  <TD className="font-semibold text-ink">{r.vehicle?.plateNumber || "—"}</TD>
                  <TD>{EXPENSE_CATEGORIES[r.category] || r.category}</TD>
                  <TD className="text-ink2">{r.driver?.name || "—"}</TD>
                  <TD className="text-ink3">{r.odometerKm ? `${r.odometerKm} km` : "—"}{r.liters ? ` · ${r.liters} L` : ""}</TD>
                  <TD>
                    {r.receiptUrl ? (
                      <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="block h-8 w-8 overflow-hidden rounded-btn border border-border">
                        <img src={r.receiptUrl} alt="Struk" className="h-full w-full object-cover" />
                      </a>
                    ) : <span className="text-ink3">—</span>}
                  </TD>
                  <TD numeric className="font-semibold text-ink">{formatRupiah(r.amount)}</TD>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <button type="button" className="text-[11px] font-semibold text-accent hover:underline" onClick={() => mulaiEdit(r)}>Edit</button>
                      <button type="button" className="text-[11px] text-red hover:underline" onClick={() => hapus(r.id)}>Hapus</button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

// ── Tab SERVIS ────────────────────────────────────────────────────────────
const KOSONG_SERVICE = { date: "", vehicleId: "", type: "RUTIN", odometerKm: "", cost: "", workshop: "", description: "", receiptUrl: "", nextServiceKm: "", nextServiceDate: "" };

function ServisTab({ vehicles, initialVehicleId }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(() => ({ ...KOSONG_SERVICE, vehicleId: initialVehicleId || "" }));
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [filterVehicleId, setFilterVehicleId] = useState(initialVehicleId || "");
  const [range, setRange] = useState(() => makeRange("last_30_days"));

  const load = useCallback(() => {
    const params = { ...toApiParams(range), vehicleId: filterVehicleId || undefined };
    if ((!!range.from) !== (!!range.to)) return;
    setRows(null);
    api.getVehicleServices(params).then(setRows).catch(() => setRows([]));
  }, [range, filterVehicleId]);
  useEffect(() => { load(); }, [load]);

  function mulaiEdit(r) {
    setEditingId(r.id);
    setForm({
      date: r.date.slice(0, 10), vehicleId: r.vehicle.id, type: r.type, odometerKm: String(r.odometerKm), cost: String(r.cost),
      workshop: r.workshop || "", description: r.description || "", receiptUrl: r.receiptUrl || "",
      nextServiceKm: r.nextServiceKm ?? "", nextServiceDate: r.nextServiceDate?.slice(0, 10) || "",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function batalEdit() {
    setEditingId(null);
    setForm({ ...KOSONG_SERVICE, vehicleId: filterVehicleId || "" });
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.vehicleId) { setError("Kendaraan wajib dipilih"); return; }
    if (!form.date || !form.odometerKm || !form.cost) { setError("Tanggal, odometer, dan biaya wajib diisi"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        vehicleId: form.vehicleId, date: form.date, type: form.type, odometerKm: Number(form.odometerKm), cost: Number(form.cost),
        workshop: form.workshop || null, description: form.description || null, receiptUrl: form.receiptUrl || null,
        nextServiceKm: form.nextServiceKm || null, nextServiceDate: form.nextServiceDate || null,
      };
      if (editingId) {
        await api.updateVehicleService(editingId, payload);
      } else {
        await api.createVehicleService(payload);
      }
      batalEdit();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const totalTampil = useMemo(() => (rows || []).reduce((n, r) => n + r.cost, 0), [rows]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
          {editingId ? <><Pencil size={14} className="text-accent" /> Mengedit Catatan</> : <><Plus size={14} className="text-accent" /> Catat Servis</>}
          {editingId && <button type="button" onClick={batalEdit} className="ml-2 text-[11.5px] font-semibold text-accent underline">batal</button>}
        </div>
        <form onSubmit={submit} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Field label="Kendaraan" required className="col-span-2">
            <VehiclePicker vehicles={vehicles} value={form.vehicleId} onChange={(v) => setForm((f) => ({ ...f, vehicleId: v }))} />
          </Field>
          <Field label="Tanggal" required><DatePicker value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} placeholder="Pilih tanggal" allowFuture={false} /></Field>
          <Field label="Jenis">
            <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              {Object.entries(SERVICE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Odometer (km)" required><Input type="number" min="0" value={form.odometerKm} onChange={(e) => setForm((f) => ({ ...f, odometerKm: e.target.value }))} /></Field>
          <Field label="Biaya (Rp)" required><Input type="number" min="0" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} /></Field>
          <Field label="Bengkel"><Input value={form.workshop} onChange={(e) => setForm((f) => ({ ...f, workshop: e.target.value }))} /></Field>
          <Field label="Servis berikutnya (km)"><Input type="number" value={form.nextServiceKm} onChange={(e) => setForm((f) => ({ ...f, nextServiceKm: e.target.value }))} /></Field>
          <Field label="Servis berikutnya (tanggal)"><DatePicker value={form.nextServiceDate} onChange={(v) => setForm((f) => ({ ...f, nextServiceDate: v }))} placeholder="Opsional" /></Field>
          <Field label="Dokumentasi" className="col-span-2">
            <ReceiptPicker url={form.receiptUrl} onChange={(url) => setForm((f) => ({ ...f, receiptUrl: url || "" }))} />
          </Field>
          <Field label="Keterangan" className="col-span-2 sm:col-span-4">
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Opsional" />
          </Field>
          {error && <p className="col-span-full text-[12px] text-red">{error}</p>}
          <div className="col-span-full flex justify-end">
            <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Tambah Catatan"}</Button>
          </div>
        </form>
      </Card>

      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Kendaraan" className="w-52">
          <VehiclePicker vehicles={vehicles} value={filterVehicleId} onChange={setFilterVehicleId} allowAll />
        </Field>
        <div className="ml-auto"><DateRangePicker value={range} onChange={setRange} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Sesuai Filter" numericValue={totalTampil} format={formatRupiah} index={0} />
        <KpiCard label="Jumlah Catatan" numericValue={(rows || []).length} index={1} />
      </div>

      {rows === null ? <TableSkeletonRows rows={4} cols={7} /> : rows.length === 0 ? (
        <EmptyState icon={Wrench} title="Belum ada riwayat servis" />
      ) : (
        <TableWrap>
          <Table>
            <THead><TR><TH>Tanggal</TH><TH>Kendaraan</TH><TH>Jenis</TH><TH>Odometer</TH><TH>Bengkel</TH><TH>Nota</TH><TH>Biaya</TH><TH /></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={editingId === r.id ? "bg-accentbg/40" : undefined}>
                  <TD className="whitespace-nowrap text-ink2">{fmtTanggal(r.date)}</TD>
                  <TD className="font-semibold text-ink">{r.vehicle?.plateNumber || "—"}</TD>
                  <TD>{SERVICE_TYPES[r.type] || r.type}</TD>
                  <TD className="text-ink3">{r.odometerKm} km</TD>
                  <TD className="text-ink2">{r.workshop || "—"}</TD>
                  <TD>
                    {r.receiptUrl ? (
                      <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="block h-8 w-8 overflow-hidden rounded-btn border border-border">
                        <img src={r.receiptUrl} alt="Nota" className="h-full w-full object-cover" />
                      </a>
                    ) : <span className="text-ink3">—</span>}
                  </TD>
                  <TD numeric className="font-semibold text-ink">{formatRupiah(r.cost)}</TD>
                  <TD><button type="button" className="text-[11px] font-semibold text-accent hover:underline" onClick={() => mulaiEdit(r)}>Edit</button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

const TABS = [
  { key: "pengeluaran", label: "Pengeluaran", Icon: Wallet },
  { key: "servis",      label: "Servis",      Icon: Wrench },
];

function tabAwalDariUrl() {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((x) => x.key === t) ? t : "pengeluaran";
}

export default function ArmadaBiaya() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(tabAwalDariUrl);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  // ?vehicleId= (dari tombol "Kelola Biaya & Servis" di Pengaturan Delivery
  // > Armada > Detail, ArmadaPengaturan.jsx) — kendaraan itu SUDAH terisi
  // di form Tambah & filter saat halaman ini dibuka dari sana.
  const initialVehicleId = useMemo(() => new URLSearchParams(window.location.search).get("vehicleId") || "", []);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getVehicles(), api.getDrivers()])
      .then(([v, d]) => { setVehicles((v.vehicles || []).filter((x) => x.active)); setDrivers(d); })
      .catch(() => setVehicles([]))
      .finally(() => setLoading(false));
  }, []);

  function pindahTab(key) {
    setTab(key);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    navigate(`/armada/biaya?${params.toString()}`, { replace: true });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Biaya Armada"
        subtitle="Catat BBM, tol, parkir, dan servis — satu halaman untuk semua kendaraan, tanpa perlu buka detail satu per satu."
      />
      <PageBody>
        <div role="tablist" aria-label="Pilih tab" className="flex gap-1 border-b border-line pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => pindahTab(t.key)}
              className={`flex items-center gap-1.5 rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"
              }`}
            >
              <t.Icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <TableSkeletonRows rows={4} cols={7} />
        ) : vehicles.length === 0 ? (
          <EmptyState
            icon={TruckIcon}
            title="Belum ada kendaraan aktif"
            description="Tambahkan kendaraan dulu di Pengaturan Delivery > Armada sebelum mencatat biaya."
          />
        ) : tab === "pengeluaran" ? (
          <PengeluaranTab vehicles={vehicles} drivers={drivers} initialVehicleId={initialVehicleId} />
        ) : (
          <ServisTab vehicles={vehicles} initialVehicleId={initialVehicleId} />
        )}
      </PageBody>
    </PageContainer>
  );
}
