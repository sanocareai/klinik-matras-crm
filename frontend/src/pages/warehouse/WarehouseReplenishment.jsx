import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp, Plus, RefreshCw, Download } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { exportToCSV } from "@/utils/export.js";
import ReplenishmentFormModal from "@/features/warehouse/components/ReplenishmentFormModal.jsx";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import DaftarSederhana from "@/features/warehouse/dokumen/DaftarSederhana.jsx";
import { useTahapFilter } from "@/features/warehouse/dokumen/useTahapFilter.js";
import { PRIORITAS, SUMBER_RESTOK, TAHAP_FILTER_RESTOK, teksCari } from "@/features/warehouse/dokumen/labelDokumen.js";
import { cakupanBatasMinimum, kalimatCakupanBatasMinimum, tanggalPendek, teksJumlah } from "@/features/warehouse/dokumen/dokumenLogic.js";

// RESTOK — saran (dihitung dari batas minimum, tidak disimpan) + daftar permintaan restok (Draf → persetujuan → dipesan → selesai). Permintaan restok TIDAK PERNAH mengubah stok; selesai = ditautkan ke penerimaan barang.
// Bahan tanpa batas minimum tidak pernah disarankan: "tidak ada saran" bukan bukti stok aman, dan halaman menyatakannya. Batas minimum diisi petugas berwenang di Stok & Lokasi (Ubah Item); kosong = "belum diatur".
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();

export default function WarehouseReplenishment() {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState(null); const [cakupan, setCakupan] = useState(null);
  const [tahap, setTahap] = useTahapFilter(); const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false); const [prefill, setPrefill] = useState(null);

  const loadSuggestions = useCallback(() => {
    api.getReplenishmentSuggestions().then((d) => setSuggestions(d.suggestions)).catch(() => setSuggestions([]));
    api.getStokLokasi().then((d) => setCakupan(cakupanBatasMinimum(d.rows ?? []))).catch(() => setCakupan(null));
  }, []);
  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getReplenishmentRequests({}).then((d) => setRows(d.requests)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); loadSuggestions(); }, [load, loadSuggestions]);

  const refreshSemua = () => { load(); loadSuggestions(); };
  const buka = (r) => navigate(`/warehouse/replenishment/${r.id}`);
  function ekspor() {
    if (!rows || rows.length === 0) return;
    exportToCSV(rows.map((r) => ({
      "No. permintaan": r.requestNumber, Bahan: r.material.code, "Saldo saat dibuat": r.currentStockSnapshot, "Batas minimum": r.minimumStockSnapshot ?? "belum diatur", "Jumlah diminta": r.suggestedQty, Dibutuhkan: r.requiredDate || "",
      Sumber: SUMBER_RESTOK[r.source] ?? r.source, Pemasok: r.supplier || "", Prioritas: PRIORITAS[r.priority] ?? r.priority, Status: r.tampilan?.label ?? r.status,
    })), "permintaan-restok");
  }

  return (
    <PageContainer>
      <PageHeader title="Restok" subtitle="Saran restok dari batas minimum dan permintaan restok — dari pengajuan sampai barang diterima."
        actions={<>
          <Button variant="ghost" size="sm" onClick={refreshSemua} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
          <Button variant="secondary" size="sm" onClick={ekspor} disabled={!rows?.length}><Download size={14} /> Export</Button>
          <Button size="sm" onClick={() => { setPrefill(null); setFormOpen(true); }}><Plus size={14} /> Ajukan Manual</Button>
        </>} />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Saran restok</CardTitle>
            <CardDescription>Hanya bahan yang punya batas minimum: stok tersedia sudah di titik atau di bawah batas itu.</CardDescription>
          </CardHeader>
          {suggestions === null ? (
            <div className="px-5 pb-5"><div className="h-16 animate-pulse rounded-btn bg-inset" /></div>
          ) : suggestions.length === 0 ? (
            <div className="space-y-1 px-5 pb-5">
              <p className="m-0 text-[12.5px] text-ink3" data-testid="saran-kosong">{kalimatCakupanBatasMinimum(cakupan) ?? "Tidak ada saran restok saat ini."}</p>
              {cakupan && cakupan.belum > 0 && <Link to="/warehouse/inventory" className="text-[12.5px] font-semibold text-accent" data-testid="atur-batas-minimum">Atur batas minimum di Stok &amp; Lokasi (Ubah Item)</Link>}
            </div>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {suggestions.map((s) => (
                <li key={s.materialId} className="flex items-center gap-3 px-5 py-2.5" data-testid="saran-baris">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[12.5px] font-semibold text-ink">{s.code} — {s.name}</p>
                    <p className="m-0 text-[11px] text-ink3">Tersedia {teksJumlah(s.available)} / Batas minimum {teksJumlah(s.reorderPoint)}{s.reorderQty != null && ` · Saran jumlah ${teksJumlah(s.reorderQty)}`}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => { setPrefill(s); setFormOpen(true); }} className="max-sm:min-h-11">Buat Permintaan</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <DaftarSederhana filters={TAHAP_FILTER_RESTOK} rows={rows} loading={loading} error={error} tahap={tahap} onTahap={setTahap} cari={cari} onCari={setCari}
          placeholder="Cari no., bahan, pemasok" labelCari="Cari permintaan restok" labelTab="Saring tahap permintaan restok" teks={teksCari.restok} nomor={(r) => r.requestNumber} onBuka={buka}
          kolom={[
            { label: "Permintaan", kelas: "whitespace-nowrap", isi: (r) => <><div className="font-semibold text-ink">{r.requestNumber}</div><div className="text-[11px] text-ink3">{r.requestedBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}</div></> },
            { label: "Bahan", isi: (r) => <><div className="font-medium text-ink">{r.material.code}</div><div className="text-[11px] text-ink3">{r.material.name}</div></> },
            { label: "Jumlah diminta", numeric: true, isi: (r) => <span className="font-semibold text-ink">{teksJumlah(r.suggestedQty)} {satuan(r.material.unit)}</span> },
            { label: "Saldo / minimum", numeric: true, isi: (r) => <span className="text-ink2">{teksJumlah(r.currentStockSnapshot)} / {r.minimumStockSnapshot == null ? "belum diatur" : teksJumlah(r.minimumStockSnapshot)}</span> },
            { label: "Dibutuhkan", kelas: "whitespace-nowrap text-ink2", isi: (r) => tanggalPendek(r.requiredDate) },
            { label: "Sumber", kelas: "text-ink2", isi: (r) => SUMBER_RESTOK[r.source] ?? r.source },
          ]}
          kartu={(r) => ({ judul: r.requestNumber, baris: [<><span className="font-medium text-ink">{r.material.code}</span> · {teksJumlah(r.suggestedQty)} {satuan(r.material.unit)}</>, `${r.requestedBy?.name ?? "—"} · ${tanggalPendek(r.createdAt)}${r.requiredDate ? ` · butuh ${tanggalPendek(r.requiredDate)}` : ""}`] })}
          kosong={{ icon: TrendingUp, judul: "Belum ada Permintaan Restok", deskripsi: "Buat dari saran di atas, atau ajukan manual.", aksi: <Button size="sm" onClick={() => { setPrefill(null); setFormOpen(true); }}><Plus size={14} /> Ajukan Manual</Button> }} />
      </PageBody>
      <ReplenishmentFormModal open={formOpen} prefill={prefill} onClose={() => setFormOpen(false)} onCreated={(d) => { refreshSemua(); if (d?.id) navigate(`/warehouse/replenishment/${d.id}`); }} />
    </PageContainer>
  );
}
