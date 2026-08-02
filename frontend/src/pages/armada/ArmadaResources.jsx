import React, { useCallback, useEffect, useState } from "react";
import { Plus, User, Truck as TruckIcon } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import { VEHICLE_STATUS_REAL } from "@/features/armada/vehicleStatus.js";

// Driver & Armada — Delivery Tahap 3.
//
// ⚠️ TAB DRIVER SENGAJA TIPIS. Spesifikasi meminta phone, area, rating,
// working hours, document status per driver — TIDAK SATU PUN field itu ada di
// User model (lihat backend/prisma/schema.prisma: hanya id/name/email/
// passwordHash/avatarUrl). Menambahkannya berarti mengubah User yang dipakai
// SEMUA role (sales, admin, dst), bukan sekadar tabel Delivery — perubahan itu
// di luar batas modul ini dan butuh keputusan terpisah.
//
// Yang ditampilkan di sini HANYA yang bisa dijawab jujur dari data yang ada:
// nama, dan jumlah job (dihitung dari Job.driverId). TIDAK mengarang nomor
// telepon atau rating untuk driver SUNGGUHAN — itu beda dengan dashboard
// Tahap 1 yang datanya memang ditandai contoh; tabel ini isinya orang asli.
//
// TAB ARMADA data NYATA sepenuhnya — Vehicle baru ditambahkan Tahap 3 dan
// tabelnya masih kosong, jadi halaman ini SEKALIGUS jadi tempat mengisinya.

const TABS = [
  { key: "driver",  label: "Driver",  Icon: User },
  { key: "armada",  label: "Armada",  Icon: TruckIcon },
];

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
          <Input value={form.plateNumber} onChange={(e) => setForm((f) => ({ ...f, plateNumber: e.target.value }))} placeholder="B 9123 SAO" />
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

function DriverTab() {
  const [drivers, setDrivers] = useState(null);
  const [jobCounts, setJobCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getDrivers();
      setDrivers(list);
      // Hitung job aktif per driver dari data yang SUDAH kita punya cara
      // ambilnya (endpoint jobs Tahap 2) — bukan field baru, murni turunan.
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
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getVehicles().then((d) => setVehicles(d.vehicles)).catch(() => setVehicles([])).finally(() => setLoading(false));
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
          <div className="p-4"><TableSkeletonRows rows={4} cols={6} /></div>
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
                  <TH>Nomor Polisi</TH><TH>Tipe</TH><TH>Kapasitas</TH>
                  <TH>Status</TH><TH>KM</TH><TH>Servis Berikutnya</TH>
                </TR>
              </THead>
              <TBody>
                {vehicles.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-semibold text-ink">{v.plateNumber}</TD>
                    <TD className="text-ink2">{v.type}</TD>
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
                    <TD numeric>{v.mileageKm ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-ink2">
                      {v.nextServiceDate
                        ? new Date(v.nextServiceDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                        : "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <VehicleFormModal open={formOpen} onOpenChange={setFormOpen} onSaved={load} />
    </>
  );
}

export default function ArmadaResources() {
  const [tab, setTab] = useState("driver");

  return (
    <PageContainer>
      <PageHeader title="Driver &amp; Armada" subtitle="Kelola data driver dan kendaraan pengiriman." />
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

        {tab === "driver" ? <DriverTab /> : <VehicleTab />}
      </PageBody>
    </PageContainer>
  );
}
