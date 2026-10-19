import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useJendelaFokus } from "@/features/warehouse/dokumen/useJendelaFokus.js";
import OpnameDetail from "@/features/warehouse/dokumen/OpnameDetail.jsx";
import { ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import StockCountFormModal from "@/features/warehouse/components/StockCountFormModal.jsx";
import DaftarSederhana from "@/features/warehouse/dokumen/DaftarSederhana.jsx";
import { useTahapFilter } from "@/features/warehouse/dokumen/useTahapFilter.js";
import { JENIS_HITUNG, TAHAP_FILTER_OPNAME, teksCari } from "@/features/warehouse/dokumen/labelDokumen.js";
import { tanggalPendek } from "@/features/warehouse/dokumen/dokumenLogic.js";

// STOCK OPNAME — daftar sesi hitung (Terjadwal → Sedang dihitung → Menunggu tinjauan → Selesai). Detail dibuka sebagai halaman. Stok baru berubah saat sesi diselesaikan (satu penyesuaian per bahan berselisih);
// aturan pemisahan tugas (penyetuju bukan pembuat/penugas/pengisi hitungan) dan tanda pergerakan sesi tidak diubah.
const hitungDiisi = (r) => r.lines.filter((l) => l.countedQty != null).length;
const hitungSelisih = (r) => r.lines.filter((l) => l.systemQty != null && l.countedQty != null && Number(l.systemQty) !== Number(l.countedQty)).length;

export default function WarehouseStockCount() {
  const { id: bukaId } = useParams();
  const [tahap, setTahap] = useTahapFilter("/warehouse/stock-count");
  const { buka: bukaJ, tutup } = useJendelaFokus("/warehouse/stock-count", { saringan: tahap ? `?tahap=${tahap}` : "" }); const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getStockCounts({}).then((d) => setRows(d.counts)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const buka = (r) => bukaJ(r.id);
  const baru = <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Jadwalkan Hitungan</Button>;

  return (
    <PageContainer>
      <PageHeader title="Stock Opname" subtitle="Sesi penghitungan stok fisik dan penyelesaian selisih."
        actions={<><Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>{baru}</>} />
      <PageBody>
        <DaftarSederhana filters={TAHAP_FILTER_OPNAME} rows={rows} loading={loading} error={error} tahap={tahap} onTahap={setTahap} cari={cari} onCari={setCari}
          placeholder="Cari no., bahan, petugas" labelCari="Cari stock opname" labelTab="Saring tahap opname" teks={teksCari.opname} nomor={(r) => r.countNumber} onBuka={buka}
          kolom={[
            { label: "Sesi", kelas: "whitespace-nowrap", isi: (r) => <><div className="font-semibold text-ink">{r.countNumber}</div><div className="text-[11px] text-ink3">{r.createdBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}</div></> },
            { label: "Jenis", kelas: "text-ink2", isi: (r) => JENIS_HITUNG[r.countType] ?? r.countType },
            { label: "Jadwal", kelas: "whitespace-nowrap text-ink2", isi: (r) => tanggalPendek(r.scheduledDate) },
            { label: "Petugas", kelas: "text-ink2", isi: (r) => r.assignedTo?.name || "—" },
            { label: "Bahan dihitung", numeric: true, isi: (r) => `${hitungDiisi(r)}/${r.lines.length}` },
            { label: "Selisih", numeric: true, isi: (r) => (hitungSelisih(r) ? <span className="font-semibold text-red">{hitungSelisih(r)} bahan</span> : "—") },
          ]}
          kartu={(r) => ({ judul: r.countNumber, baris: [`${JENIS_HITUNG[r.countType] ?? r.countType} · ${r.lines.length} bahan`, `${r.assignedTo?.name ?? "belum ditugaskan"} · jadwal ${tanggalPendek(r.scheduledDate)}${hitungSelisih(r) ? ` · selisih ${hitungSelisih(r)} bahan` : ""}`] })}
          kosong={{ icon: ClipboardCheck, judul: "Belum ada Stock Opname", deskripsi: "Jadwalkan hitungan stok berkala untuk mulai.", aksi: baru }} />
      </PageBody>
      <StockCountFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(d) => { load(); if (d?.id) bukaJ(d.id); }} />
      {bukaId && <OpnameDetail key="fokus" id={bukaId} onTutup={tutup} onBerubah={load} />}
    </PageContainer>
  );
}
