import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, User, Truck as TruckIcon, AlertTriangle, Wallet, Wrench, ShieldAlert, Info, Camera, X, Pencil, Loader2 } from "lucide-react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import { VEHICLE_STATUS_REAL } from "@/features/armada/vehicleStatus.js";
import { formatRupiah } from "@/utils/format.js";

// Driver & Armada — Delivery Tahap 3, diperluas D-035 (22 Agustus 2026).
//
// ⚠️ TAB DRIVER SENGAJA TIPIS — lihat catatan lama di bawah, tidak berubah.
//
// D-035 menambah 3 hal ke TAB ARMADA: (1) detail kendaraan lengkap + dokumen
// (STNK/pajak/KIR/asuransi) lewat modal Detail per baris, (2) pencatatan
// biaya/servis/insiden di dalam modal yang sama, (3) tab baru "Ringkasan
// Biaya" yang menjawab "mobil/supir mana lebih hemat" dari data yang sudah
// masuk. Lihat komentar panjang di backend/prisma/schema.prisma untuk kenapa
// km/liter (bukan cuma rupiah) yang jadi metrik utamanya.
//
// FOTO STRUK/BUKTI SENGAJA BELUM ADA di form-form di bawah — upload file
// butuh komponen terpisah (pola sama dengan foto job driver) dan ditunda
// supaya pencatatan dasarnya bisa langsung dipakai hari ini. receiptUrl/
// photoUrls tetap ada di skema, tinggal disambungkan nanti.

const TABS = [
  { key: "driver",  label: "Driver",  Icon: User },
  { key: "armada",  label: "Armada",  Icon: TruckIcon },
  { key: "biaya",   label: "Ringkasan Biaya", Icon: Wallet },
];

const EXPENSE_CATEGORIES = {
  BBM: "BBM", TOL: "Tol", PARKIR: "Parkir", CUCI: "Cuci Mobil", DENDA: "Denda/Tilang", LAINNYA: "Lainnya",
};
const SERVICE_TYPES = {
  RUTIN: "Servis Rutin", PERBAIKAN: "Perbaikan", GANTI_OLI: "Ganti Oli",
  GANTI_BAN: "Ganti Ban", BODY_REPAIR: "Body Repair", LAINNYA: "Lainnya",
};
const INCIDENT_TYPES = { KECELAKAAN: "Kecelakaan", LECET: "Lecet", MOGOK: "Mogok", TILANG: "Tilang", LAINNYA: "Lainnya" };
const SEVERITIES = { RINGAN: "Ringan", SEDANG: "Sedang", BERAT: "Berat" };
const FAULT_PARTIES = { DRIVER_KITA: "Supir Kita", PIHAK_LAIN: "Pihak Lain", TIDAK_JELAS: "Belum Jelas" };
const CLAIM_STATUSES = { TIDAK_DIKLAIM: "Tidak Diklaim", DIAJUKAN: "Diajukan", DISETUJUI: "Disetujui", DITOLAK: "Ditolak" };

function fmtTanggal(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// Dipakai badge kadaluarsa dokumen — merah kalau sudah lewat, oranye kalau
// <30 hari lagi, tidak tampil sama sekali kalau masih aman/kosong. Supaya
// dispatcher tidak perlu buka tiap kendaraan satu-satu untuk tahu STNK mana
// yang mau habis — persis skenario "STNK kadaluarsa" yang jadi alasan D-035.
function statusKadaluarsa(tanggal) {
  if (!tanggal) return null;
  const sisaHari = Math.floor((new Date(tanggal) - new Date()) / 86400000);
  if (sisaHari < 0) return { tone: "red", label: "Kadaluarsa" };
  if (sisaHari <= 30) return { tone: "orange", label: `${sisaHari}h lagi` };
  return null;
}

const inputCls = "h-9 w-full rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent";

function VehicleFormModal({ open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ plateNumber: "", type: "", capacitySlots: "6", mileageKm: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setForm({ plateNumber: "", type: "", capacitySlots: "6", mileageKm: "", notes: "" }); setError(""); }
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    if (!form.plateNumber.trim() || !form.type.trim()) {
      setError("Nomor polisi dan tipe kendaraan wajib diisi");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createVehicle({
        plateNumber: form.plateNumber,
        type: form.type,
        capacitySlots: form.capacitySlots,
        mileageKm: form.mileageKm || undefined,
        notes: form.notes || undefined,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Tambah Kendaraan">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nomor polisi" required>
          <Input value={form.plateNumber} onChange={(e) => setForm((f) => ({ ...f, plateNumber: e.target.value }))} placeholder="B 1234 XYZ" />
        </Field>
        <Field label="Tipe kendaraan" required hint="Bebas, mis. Box Sedang, Pickup, Truk Engkel">
          <Input value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} placeholder="Box Sedang" />
        </Field>
        <Field label="Kapasitas (slot kasur)" required>
          <Input type="number" min="1" value={form.capacitySlots} onChange={(e) => setForm((f) => ({ ...f, capacitySlots: e.target.value }))} />
        </Field>
        <Field label="Kilometer saat ini" hint="Opsional">
          <Input type="number" min="0" value={form.mileageKm} onChange={(e) => setForm((f) => ({ ...f, mileageKm: e.target.value }))} />
        </Field>
        <Field label="Catatan" hint="Opsional">
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        {error && <p className="text-[12.5px] text-red">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Sub-tab INFO: identitas + dokumen kendaraan ─────────────────────────
function InfoTab({ vehicle, drivers, onSaved }) {
  const [form, setForm] = useState(() => ({
    brand: vehicle.brand || "", model: vehicle.model || "", year: vehicle.year || "",
    color: vehicle.color || "", chassisNumber: vehicle.chassisNumber || "", engineNumber: vehicle.engineNumber || "",
    stnkNumber: vehicle.stnkNumber || "", stnkExpiry: vehicle.stnkExpiry?.slice(0, 10) || "",
    taxExpiry: vehicle.taxExpiry?.slice(0, 10) || "", kirExpiry: vehicle.kirExpiry?.slice(0, 10) || "",
    insurancePolicy: vehicle.insurancePolicy || "", insuranceExpiry: vehicle.insuranceExpiry?.slice(0, 10) || "",
    picDriverId: vehicle.picDriverId || "",
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await api.updateVehicle(vehicle.id, {
        ...form,
        year: form.year ? Number(form.year) : null,
        picDriverId: form.picDriverId || null,
      });
      setSaved(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Merk"><Input value={form.brand} onChange={set("brand")} placeholder="Mitsubishi" /></Field>
        <Field label="Model"><Input value={form.model} onChange={set("model")} placeholder="L300" /></Field>
        <Field label="Tahun"><Input type="number" value={form.year} onChange={set("year")} placeholder="2022" /></Field>
        <Field label="Warna"><Input value={form.color} onChange={set("color")} /></Field>
        <Field label="No. Rangka"><Input value={form.chassisNumber} onChange={set("chassisNumber")} /></Field>
        <Field label="No. Mesin"><Input value={form.engineNumber} onChange={set("engineNumber")} /></Field>
      </div>

      <div className="border-t border-line pt-4">
        <h4 className="mb-3 text-[12.5px] font-bold text-ink">Dokumen &amp; Masa Berlaku</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nomor STNK"><Input value={form.stnkNumber} onChange={set("stnkNumber")} /></Field>
          <Field label="STNK berlaku s/d"><input type="date" className={inputCls} value={form.stnkExpiry} onChange={set("stnkExpiry")} /></Field>
          <Field label="Pajak tahunan s/d"><input type="date" className={inputCls} value={form.taxExpiry} onChange={set("taxExpiry")} /></Field>
          <Field label="KIR s/d"><input type="date" className={inputCls} value={form.kirExpiry} onChange={set("kirExpiry")} /></Field>
          <Field label="No. Polis Asuransi"><Input value={form.insurancePolicy} onChange={set("insurancePolicy")} /></Field>
          <Field label="Asuransi s/d"><input type="date" className={inputCls} value={form.insuranceExpiry} onChange={set("insuranceExpiry")} /></Field>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <Field label="PIC Supir Tetap" hint="Penanggung jawab harian kendaraan ini — beda dari penugasan job">
          <select className={inputCls} value={form.picDriverId} onChange={set("picDriverId")}>
            <option value="">— Belum ditentukan —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        {saved && <span className="text-[12px] text-green">Tersimpan</span>}
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan…" : "Simpan Perubahan"}</Button>
      </div>
    </form>
  );
}

// ── Sub-tab BIAYA: BBM/tol/parkir/dst ────────────────────────────────────
// ── Pemilih foto struk/nota — upload LANGSUNG saat file dipilih (bukan
// nunggu form disubmit), balikin URL yang tinggal disisipkan ke
// receiptUrl. Dipakai bareng di form Biaya & Servis — "dokumentasinya"
// yang diminta eksplisit, dibuat sesederhana mungkin: 1 tombol, 1 file.
function ReceiptPicker({ url, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // supaya memilih file YANG SAMA lagi tetap memicu onChange
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

const KOSONG_EXPENSE = { date: "", category: "BBM", amount: "", odometerKm: "", liters: "", driverId: "", receiptUrl: "", notes: "" };

function BiayaTab({ vehicle, drivers }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(KOSONG_EXPENSE);
  const [editingId, setEditingId] = useState(null); // null = mode Tambah, terisi = mode Edit
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.getVehicleExpenses({ vehicleId: vehicle.id }).then(setRows).catch(() => setRows([]));
  }, [vehicle.id]);
  useEffect(() => { load(); }, [load]);

  function mulaiEdit(r) {
    setEditingId(r.id);
    setForm({
      date: r.date.slice(0, 10), category: r.category, amount: String(r.amount),
      odometerKm: r.odometerKm ?? "", liters: r.liters ?? "", driverId: r.driverId || "",
      receiptUrl: r.receiptUrl || "", notes: r.notes || "",
    });
    setError("");
  }
  function batalEdit() {
    setEditingId(null);
    setForm(KOSONG_EXPENSE);
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.date || !form.amount) { setError("Tanggal dan nominal wajib diisi"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        date: form.date, category: form.category, amount: Number(form.amount),
        odometerKm: form.odometerKm || null,
        liters: form.category === "BBM" && form.liters ? Number(form.liters) : null,
        driverId: form.driverId || null, receiptUrl: form.receiptUrl || null, notes: form.notes || null,
      };
      if (editingId) {
        await api.updateVehicleExpense(editingId, payload);
      } else {
        await api.createVehicleExpense({ ...payload, vehicleId: vehicle.id });
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

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="grid grid-cols-3 gap-2.5 rounded-2xl bg-inset/60 p-3">
        {editingId && (
          <div className="col-span-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-accent">
            <Pencil size={12} /> Mengedit catatan — <button type="button" onClick={batalEdit} className="underline">batal</button>
          </div>
        )}
        <Field label="Tanggal" required><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
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
        <Field label="Dokumentasi" className="col-span-3">
          <ReceiptPicker url={form.receiptUrl} onChange={(url) => setForm((f) => ({ ...f, receiptUrl: url || "" }))} />
        </Field>
        <div className="col-span-3 flex items-center gap-2">
          <Input className="flex-1" placeholder="Catatan (opsional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Tambah"}</Button>
        </div>
        {error && <p className="col-span-3 text-[12px] text-red">{error}</p>}
      </form>

      {rows === null ? <TableSkeletonRows rows={3} cols={6} /> : rows.length === 0 ? (
        <EmptyState icon={Wallet} title="Belum ada catatan biaya" description="Tambahkan pengisian BBM/tol/dst lewat form di atas." />
      ) : (
        <TableWrap>
          <Table>
            <THead><TR><TH>Tanggal</TH><TH>Kategori</TH><TH>Supir</TH><TH>Odo/Liter</TH><TH>Struk</TH><TH>Nominal</TH><TH /></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={editingId === r.id ? "bg-accentbg/40" : undefined}>
                  <TD className="whitespace-nowrap text-ink2">{fmtTanggal(r.date)}</TD>
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

// ── Sub-tab SERVIS ────────────────────────────────────────────────────────
const KOSONG_SERVICE = { date: "", type: "RUTIN", odometerKm: "", cost: "", workshop: "", description: "", receiptUrl: "", nextServiceKm: "", nextServiceDate: "" };

function ServisTab({ vehicle }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(KOSONG_SERVICE);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.getVehicleServices({ vehicleId: vehicle.id }).then(setRows).catch(() => setRows([]));
  }, [vehicle.id]);
  useEffect(() => { load(); }, [load]);

  function mulaiEdit(r) {
    setEditingId(r.id);
    setForm({
      date: r.date.slice(0, 10), type: r.type, odometerKm: String(r.odometerKm), cost: String(r.cost),
      workshop: r.workshop || "", description: r.description || "", receiptUrl: r.receiptUrl || "",
      nextServiceKm: r.nextServiceKm ?? "", nextServiceDate: r.nextServiceDate?.slice(0, 10) || "",
    });
    setError("");
  }
  function batalEdit() { setEditingId(null); setForm(KOSONG_SERVICE); setError(""); }

  async function submit(e) {
    e.preventDefault();
    if (!form.date || !form.odometerKm || !form.cost) { setError("Tanggal, odometer, dan biaya wajib diisi"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        date: form.date, type: form.type, odometerKm: Number(form.odometerKm), cost: Number(form.cost),
        workshop: form.workshop || null, description: form.description || null, receiptUrl: form.receiptUrl || null,
        nextServiceKm: form.nextServiceKm || null, nextServiceDate: form.nextServiceDate || null,
      };
      if (editingId) {
        await api.updateVehicleService(editingId, payload);
      } else {
        await api.createVehicleService({ ...payload, vehicleId: vehicle.id });
      }
      batalEdit();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="grid grid-cols-3 gap-2.5 rounded-2xl bg-inset/60 p-3">
        {editingId && (
          <div className="col-span-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-accent">
            <Pencil size={12} /> Mengedit catatan — <button type="button" onClick={batalEdit} className="underline">batal</button>
          </div>
        )}
        <Field label="Tanggal" required><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
        <Field label="Jenis">
          <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {Object.entries(SERVICE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Odometer (km)" required><Input type="number" min="0" value={form.odometerKm} onChange={(e) => setForm((f) => ({ ...f, odometerKm: e.target.value }))} /></Field>
        <Field label="Biaya (Rp)" required><Input type="number" min="0" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} /></Field>
        <Field label="Bengkel"><Input value={form.workshop} onChange={(e) => setForm((f) => ({ ...f, workshop: e.target.value }))} /></Field>
        <Field label="Servis berikutnya (km)"><Input type="number" value={form.nextServiceKm} onChange={(e) => setForm((f) => ({ ...f, nextServiceKm: e.target.value }))} /></Field>
        <Field label="Servis berikutnya (tanggal)"><input type="date" className={inputCls} value={form.nextServiceDate} onChange={(e) => setForm((f) => ({ ...f, nextServiceDate: e.target.value }))} /></Field>
        <Field label="Dokumentasi" className="col-span-3">
          <ReceiptPicker url={form.receiptUrl} onChange={(url) => setForm((f) => ({ ...f, receiptUrl: url || "" }))} />
        </Field>
        <div className="col-span-2 flex items-center gap-2">
          <Input className="flex-1" placeholder="Keterangan (opsional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Tambah"}</Button>
        </div>
        {error && <p className="col-span-3 text-[12px] text-red">{error}</p>}
      </form>

      {rows === null ? <TableSkeletonRows rows={3} cols={6} /> : rows.length === 0 ? (
        <EmptyState icon={Wrench} title="Belum ada riwayat servis" />
      ) : (
        <TableWrap>
          <Table>
            <THead><TR><TH>Tanggal</TH><TH>Jenis</TH><TH>Odometer</TH><TH>Bengkel</TH><TH>Nota</TH><TH>Biaya</TH><TH /></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={editingId === r.id ? "bg-accentbg/40" : undefined}>
                  <TD className="whitespace-nowrap text-ink2">{fmtTanggal(r.date)}</TD>
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

// ── Sub-tab INSIDEN ───────────────────────────────────────────────────────
const KOSONG_INCIDENT = {
  date: "", driverId: "", type: "KECELAKAAN", severity: "RINGAN", description: "",
  location: "", repairCost: "", faultParty: "TIDAK_JELAS", downtimeDays: "",
};

// Upload multi-foto SETELAH insiden tersimpan (beda dari ReceiptPicker
// biaya/servis yang upload-lalu-tempel — kecelakaan sering butuh beberapa
// sudut foto, dan foto pertama biasanya baru ada sesudah insiden dicatat
// buru-buru dari lapangan). Tombol ini muncul di tiap kartu, foto langsung
// bertambah ke galeri tanpa perlu buka form edit.
function TambahFotoInsiden({ incidentId, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("photos", f));
      const updated = await api.uploadVehicleIncidentPhotos(incidentId, fd);
      onUploaded(updated);
    } catch (err) {
      alert("Gagal upload foto: " + err.message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <label className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-chip border border-dashed border-border px-2 text-[11px] text-ink2 hover:border-accent hover:text-accent">
      {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
      {uploading ? "Mengunggah…" : "Tambah Foto"}
      <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
    </label>
  );
}

function InsidenTab({ vehicle, drivers }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(KOSONG_INCIDENT);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.getVehicleIncidents({ vehicleId: vehicle.id }).then(setRows).catch(() => setRows([]));
  }, [vehicle.id]);
  useEffect(() => { load(); }, [load]);

  function mulaiEdit(r) {
    setEditingId(r.id);
    setForm({
      date: r.date.slice(0, 10), driverId: r.driverId || "", type: r.type, severity: r.severity,
      description: r.description, location: r.location || "", repairCost: r.repairCost ?? "",
      faultParty: r.faultParty, downtimeDays: r.downtimeDays ?? "",
    });
    setError("");
  }
  function batalEdit() { setEditingId(null); setForm(KOSONG_INCIDENT); setError(""); }

  function updateRowLocal(updated) {
    setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.date || !form.description.trim()) { setError("Tanggal dan kronologi wajib diisi"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        driverId: form.driverId || null, date: form.date, type: form.type, severity: form.severity,
        description: form.description.trim(), location: form.location || null,
        repairCost: form.repairCost || null, faultParty: form.faultParty, downtimeDays: form.downtimeDays || null,
      };
      if (editingId) {
        await api.updateVehicleIncident(editingId, payload);
      } else {
        await api.createVehicleIncident({ ...payload, vehicleId: vehicle.id });
      }
      batalEdit();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateKlaim(id, insuranceClaim) {
    const updated = await api.updateVehicleIncident(id, { insuranceClaim });
    updateRowLocal(updated);
  }

  const severityTone = { RINGAN: "text-ink2", SEDANG: "text-orange", BERAT: "text-red" };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-2xl bg-red/10 p-3 text-[11.5px] text-red">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>Catatan ini BUKAN skor keselamatan supir — dengan jumlah kejadian yang masih sedikit, jangan bandingkan antar-supir dari angka ini. Nilainya ada di riwayat &amp; biaya yang terlacak.</span>
      </div>

      <form onSubmit={submit} className="grid grid-cols-3 gap-2.5 rounded-2xl bg-inset/60 p-3">
        {editingId && (
          <div className="col-span-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-accent">
            <Pencil size={12} /> Mengedit insiden — <button type="button" onClick={batalEdit} className="underline">batal</button>
          </div>
        )}
        <Field label="Tanggal" required><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
        <Field label="Supir">
          <select className={inputCls} value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}>
            <option value="">— Pilih —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Jenis">
          <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {Object.entries(INCIDENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Tingkat Keparahan">
          <select className={inputCls} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
            {Object.entries(SEVERITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Pihak yang Salah">
          <select className={inputCls} value={form.faultParty} onChange={(e) => setForm((f) => ({ ...f, faultParty: e.target.value }))}>
            {Object.entries(FAULT_PARTIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Lokasi"><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></Field>
        <Field label="Biaya Perbaikan (Rp)" hint="Boleh diisi belakangan"><Input type="number" min="0" value={form.repairCost} onChange={(e) => setForm((f) => ({ ...f, repairCost: e.target.value }))} /></Field>
        <Field label="Hari Tidak Bisa Jalan"><Input type="number" min="0" value={form.downtimeDays} onChange={(e) => setForm((f) => ({ ...f, downtimeDays: e.target.value }))} /></Field>
        <div />
        <Field className="col-span-3" label="Kronologi" required>
          <textarea rows={3} className={inputCls + " resize-none py-2"} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <div className="col-span-3 flex justify-end">
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Catat Insiden"}</Button>
        </div>
        {error && <p className="col-span-3 text-[12px] text-red">{error}</p>}
      </form>

      {rows === null ? <TableSkeletonRows rows={2} cols={4} /> : rows.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="Belum ada insiden tercatat" />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className={`rounded-2xl p-3 shadow-card ${editingId === r.id ? "bg-accentbg/40" : "bg-surface"}`}>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="font-bold text-ink">{INCIDENT_TYPES[r.type] || r.type}</span>
                <span className={`font-semibold ${severityTone[r.severity]}`}>{SEVERITIES[r.severity]}</span>
                <span className="text-ink3">· {fmtTanggal(r.date)}</span>
                <span className="text-ink3">· {r.driver?.name || r.driverName || "Supir tidak dicatat"}</span>
                <span className="ml-auto text-ink3">{FAULT_PARTIES[r.faultParty]}</span>
                <button type="button" className="text-[11px] font-semibold text-accent hover:underline" onClick={() => mulaiEdit(r)}>Edit</button>
              </div>
              <p className="mt-1.5 text-[12.5px] text-ink2">{r.description}</p>

              {r.photoUrls?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.photoUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-btn border border-border">
                      <img src={url} alt={`Foto insiden ${i + 1}`} className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-ink3">
                {r.location && <span>📍 {r.location}</span>}
                {r.repairCost != null && <span>Biaya: <b className="text-ink">{formatRupiah(r.repairCost)}</b></span>}
                {r.downtimeDays != null && <span>{r.downtimeDays} hari tidak jalan</span>}
                <TambahFotoInsiden incidentId={r.id} onUploaded={updateRowLocal} />
                <label className="ml-auto flex items-center gap-1.5">
                  Klaim:
                  <select
                    value={r.insuranceClaim}
                    onChange={(e) => updateKlaim(r.id, e.target.value)}
                    className="h-6 rounded-chip border border-border bg-surface px-1 text-[11px] text-ink outline-none focus:border-accent"
                  >
                    {Object.entries(CLAIM_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleDetailModal({ vehicle, drivers, onOpenChange, onSaved }) {
  return (
    <Modal
      open={!!vehicle}
      onOpenChange={onOpenChange}
      title={vehicle ? `${vehicle.plateNumber} — ${vehicle.type}` : ""}
      className="w-[720px]"
    >
      {vehicle && (
        <Tabs defaultValue="info">
          <TabsList>
            <TabsTrigger value="info"><Info size={13} /> Info &amp; Dokumen</TabsTrigger>
            <TabsTrigger value="biaya"><Wallet size={13} /> Biaya</TabsTrigger>
            <TabsTrigger value="servis"><Wrench size={13} /> Servis</TabsTrigger>
            <TabsTrigger value="insiden"><ShieldAlert size={13} /> Insiden</TabsTrigger>
          </TabsList>
          <div className="mt-4 max-h-[62vh] overflow-y-auto pr-1">
            <TabsContent value="info"><InfoTab vehicle={vehicle} drivers={drivers} onSaved={onSaved} /></TabsContent>
            <TabsContent value="biaya"><BiayaTab vehicle={vehicle} drivers={drivers} /></TabsContent>
            <TabsContent value="servis"><ServisTab vehicle={vehicle} /></TabsContent>
            <TabsContent value="insiden"><InsidenTab vehicle={vehicle} drivers={drivers} /></TabsContent>
          </div>
        </Tabs>
      )}
    </Modal>
  );
}

function DriverTab() {
  const [drivers, setDrivers] = useState(null);
  const [jobCounts, setJobCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getDrivers();
      setDrivers(list);
      const { jobs } = await api.getArmadaJobs({ take: 500 });
      const counts = {};
      for (const j of jobs) {
        if (!j.driverId) continue;
        counts[j.driverId] = (counts[j.driverId] || 0) + 1;
      }
      setJobCounts(counts);
    } catch {
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="overflow-hidden">
      {loading ? (
        <div className="p-4"><TableSkeletonRows rows={4} cols={3} /></div>
      ) : drivers.length === 0 ? (
        <EmptyState
          icon={User}
          title="Belum ada driver"
          description="Driver ditambahkan lewat Pengguna & Peran dengan role DRIVER, bukan dari halaman ini."
        />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <TR><TH>Nama</TH><TH>Job Terkait</TH></TR>
            </THead>
            <TBody>
              {drivers.map((d) => (
                <TR key={d.id}>
                  <TD className="font-semibold text-ink">{d.name}</TD>
                  <TD numeric>{jobCounts[d.id] || 0}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-ink3">
        Nomor telepon, area, jam kerja, rating, dan status dokumen belum tersedia —
        field-nya belum ada di data driver. Menambahkannya mengubah data akun yang
        dipakai semua role, bukan cuma Delivery, jadi butuh keputusan terpisah.
      </p>
    </Card>
  );
}

function VehicleTab() {
  const [vehicles, setVehicles] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  // ?action=tambah (dari shortcut "Tambah Kendaraan" di Dashboard) langsung
  // membuka modal-nya — supaya benar-benar SATU klik dari luar halaman ini,
  // bukan cuma mendarat di tab yang benar lalu masih harus klik lagi.
  const [formOpen, setFormOpen] = useState(() => new URLSearchParams(window.location.search).get("action") === "tambah");
  const [detailVehicle, setDetailVehicle] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.getVehicles(), api.getDrivers()])
      .then(([v, d]) => { setVehicles(v.vehicles); setDrivers(d); })
      .catch(() => setVehicles([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function ubahStatus(vehicle, status) {
    const sebelum = vehicles;
    setVehicles((list) => list.map((v) => (v.id === vehicle.id ? { ...v, status } : v)));
    try {
      await api.updateVehicle(vehicle.id, { status });
    } catch (err) {
      setVehicles(sebelum);
      alert("Gagal mengubah status: " + err.message);
    }
  }

  // Dokumen mana yang paling mendesak per kendaraan — dipakai badge di tabel.
  function dokumenTerdekat(v) {
    const cek = [
      ["STNK", v.stnkExpiry], ["Pajak", v.taxExpiry], ["KIR", v.kirExpiry], ["Asuransi", v.insuranceExpiry],
    ].map(([docName, tgl]) => {
      const status = statusKadaluarsa(tgl);
      return status ? { docName, ...status } : null;
    }).filter(Boolean);
    if (cek.length === 0) return null;
    // Merah (sudah lewat) diprioritaskan di atas oranye (mau habis).
    return cek.sort((a, b) => (a.tone === "red" ? -1 : 1))[0];
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-bold text-ink">Daftar Kendaraan</h3>
          <Button size="sm" className="ml-auto" onClick={() => setFormOpen(true)}>
            <Plus size={14} /> Tambah Kendaraan
          </Button>
        </div>

        {loading ? (
          <div className="p-4"><TableSkeletonRows rows={4} cols={7} /></div>
        ) : vehicles.length === 0 ? (
          <EmptyState
            icon={TruckIcon}
            title="Belum ada kendaraan terdaftar"
            description="Tambahkan kendaraan supaya bisa dipilih di Route Planner."
            action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Tambah Kendaraan</Button>}
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Nomor Polisi</TH><TH>Tipe</TH><TH>PIC Supir</TH><TH>Kapasitas</TH>
                  <TH>Status</TH><TH>Dokumen</TH><TH /></TR>
              </THead>
              <TBody>
                {vehicles.map((v) => {
                  const dok = dokumenTerdekat(v);
                  return (
                    <TR key={v.id}>
                      <TD className="font-semibold text-ink">{v.plateNumber}</TD>
                      <TD className="text-ink2">{[v.brand, v.model].filter(Boolean).join(" ") || v.type}</TD>
                      <TD className="text-ink2">{v.picDriver?.name || "—"}</TD>
                      <TD numeric>{v.capacitySlots} slot</TD>
                      <TD>
                        <select
                          value={v.status}
                          onChange={(e) => ubahStatus(v, e.target.value)}
                          aria-label={`Ubah status ${v.plateNumber}`}
                          className="h-7 rounded-chip border border-border bg-surface px-1.5 text-[11px] text-ink outline-none focus:border-accent"
                        >
                          {Object.entries(VEHICLE_STATUS_REAL).map(([k, s]) => (
                            <option key={k} value={k}>{s.label}</option>
                          ))}
                        </select>
                      </TD>
                      <TD>
                        {dok ? (
                          <span className={`inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[10.5px] font-semibold ${dok.tone === "red" ? "bg-red/10 text-red" : "bg-orange/10 text-orange"}`}>
                            <AlertTriangle size={11} /> {dok.docName}: {dok.label}
                          </span>
                        ) : <span className="text-ink3">—</span>}
                      </TD>
                      <TD>
                        <button type="button" className="text-[11.5px] font-semibold text-accent hover:underline" onClick={() => setDetailVehicle(v)}>
                          Detail
                        </button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <VehicleFormModal open={formOpen} onOpenChange={setFormOpen} onSaved={load} />
      <VehicleDetailModal vehicle={detailVehicle} drivers={drivers} onOpenChange={(o) => !o && setDetailVehicle(null)} onSaved={load} />
    </>
  );
}

// ── Tab RINGKASAN BIAYA — jawaban "mobil/supir mana lebih hemat" ─────────
function RingkasanBiayaTab() {
  const [data, setData] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(() => {
    api.getFleetSummary({ from: from || undefined, to: to || undefined }).then(setData).catch(() => setData({ perKendaraan: [], perSupir: [] }));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const EfisiensiCell = ({ e }) => e.alasanKosong ? (
    <span className="text-[11px] italic text-ink3" title={e.alasanKosong}>Belum cukup data</span>
  ) : (
    <span className="font-semibold text-ink">{e.kmPerLiter} km/L <span className="font-normal text-ink3">· {formatRupiah(e.rupiahPerKm)}/km</span></span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Field label="Dari"><DatePicker value={from} onChange={setFrom} placeholder="Semua tanggal" /></Field>
        <Field label="Sampai"><DatePicker value={to} onChange={setTo} placeholder="Semua tanggal" /></Field>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h3 className="text-[13px] font-bold text-ink">Per Kendaraan</h3></div>
        {!data ? <div className="p-4"><TableSkeletonRows rows={3} cols={5} /></div> : data.perKendaraan.length === 0 ? (
          <EmptyState icon={TruckIcon} title="Belum ada kendaraan aktif" />
        ) : (
          <TableWrap>
            <Table>
              <THead><TR><TH>Kendaraan</TH><TH>PIC</TH><TH>Efisiensi</TH><TH>Total Biaya</TH><TH>Servis</TH><TH>Insiden</TH></TR></THead>
              <TBody>
                {data.perKendaraan.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-semibold text-ink">{v.plateNumber}</TD>
                    <TD className="text-ink2">{v.picDriver?.name || "—"}</TD>
                    <TD><EfisiensiCell e={v.efisiensi} /></TD>
                    <TD numeric>{formatRupiah(v.totalBiaya)}</TD>
                    <TD numeric className="text-ink2">{formatRupiah(v.biayaServis)}</TD>
                    <TD numeric className={v.jumlahInsiden > 0 ? "font-semibold text-red" : "text-ink3"}>{v.jumlahInsiden}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h3 className="text-[13px] font-bold text-ink">Per Supir</h3></div>
        {!data ? <div className="p-4"><TableSkeletonRows rows={3} cols={5} /></div> : data.perSupir.length === 0 ? (
          <EmptyState icon={User} title="Belum ada catatan biaya/insiden per supir" description="Muncul begitu ada biaya atau insiden yang ditautkan ke supir." />
        ) : (
          <TableWrap>
            <Table>
              <THead><TR><TH>Supir</TH><TH>Efisiensi</TH><TH>Total Biaya</TH><TH>Insiden</TH><TH>Salah Sendiri</TH></TR></THead>
              <TBody>
                {data.perSupir.map((s) => (
                  <TR key={s.driverId}>
                    <TD className="font-semibold text-ink">{s.name}</TD>
                    <TD><EfisiensiCell e={s.efisiensi} /></TD>
                    <TD numeric>{formatRupiah(s.totalBiaya)}</TD>
                    <TD numeric className={s.jumlahInsiden > 0 ? "font-semibold text-red" : "text-ink3"}>{s.jumlahInsiden}</TD>
                    <TD numeric className="text-ink3">{s.insidenSalahSendiri}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <p className="text-[11px] leading-relaxed text-ink3">
        km/liter dihitung dari selisih odometer tertinggi−terendah dibagi total liter periode ini (minimal 2 pengisian BBM ber-odometer). Rp/km ikut naik-turun mengikuti harga BBM — km/liter yang murni mengukur cara bawa mobil.
      </p>
    </div>
  );
}

// Tab awal dari ?tab= di URL — dipakai shortcut dari Dashboard ("+ Tambah
// Kendaraan" langsung ke tab Armada, bukan mendarat di tab Driver lalu
// harus klik lagi). Kalau nilainya tidak dikenal, jatuh ke default "driver"
// biar tidak pernah menampilkan halaman kosong gara-gara query asing.
function tabAwalDariUrl() {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((x) => x.key === t) ? t : "driver";
}

export default function ArmadaResources() {
  const [tab, setTab] = useState(tabAwalDariUrl);

  return (
    <PageContainer>
      <PageHeader title="Driver &amp; Armada" subtitle="Kelola data driver, kendaraan, dan biaya operasional pengiriman." />
      <PageBody>
        <div role="tablist" aria-label="Pilih tab" className="flex gap-1 border-b border-line pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"
              }`}
            >
              <t.Icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {tab === "driver" ? <DriverTab /> : tab === "armada" ? <VehicleTab /> : <RingkasanBiayaTab />}
      </PageBody>
    </PageContainer>
  );
}
