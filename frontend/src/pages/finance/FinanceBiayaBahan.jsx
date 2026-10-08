import React, { useCallback, useEffect, useRef, useState } from "react";
import { Boxes } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { HalamanFinance, JudulKartu, Penjelasan, tanggalPendek } from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import JejakBiayaBahan from "@/features/finance/JejakBiayaBahan.jsx";
import { teksRupiah } from "@/features/finance/biayaBahanLogic.js";

// BIAYA BAHAN PER UNIT — Finance. Murni baca: menelusuri PO → penerimaan → Material Issue → pemakaian PIC → waste/retur → faktur untuk satu unit.
// Tidak ada total biaya yang disimpan di Unit; nilai dibekukan saat pergerakan stok diposting Gudang. Nilai kosong ≠ Rp0.
const wib = (v) => (v ? tanggalPendek(new Date(new Date(v).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)) : "—");

export default function FinanceBiayaBahan() {
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pilih, setPilih] = useState(null);

  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try { setData(await api.getBiayaBahanUnits({ q: qTunda.trim() })); }
    catch (e) { if (!diam) setError(e.message || "Gagal memuat daftar unit"); }
    finally { if (!diam) setLoading(false); }
  }, [qTunda]);
  useEffect(() => { muat({ diam: pernahMuat.current }); pernahMuat.current = true; }, [muat]);

  const daftar = data?.units || [];
  const aktif = daftar.find((u) => u.unitId === pilih) || null;

  return (
    <HalamanFinance title="Biaya Bahan per Unit" subtitle="Jejak biaya bahan setiap unit produksi, dari PO sampai faktur." loading={loading} error={error} onRetry={muat}>
      <Penjelasan>
        Biaya persediaan dihitung dari <strong>harga PO/perolehan</strong> (rata-rata tertimbang) yang <strong>dibekukan saat Gudang memposting</strong> pergerakan stok — tidak berubah oleh transaksi bertanggal mundur.
        <strong> Selisih harga faktur</strong> ditampilkan terpisah. Bagian yang belum final ditandai <strong>Tanpa harga</strong> atau <strong>Belum final</strong>; angka kosong bukan Rp0. Halaman ini hanya membaca: stok keluar tetap hanya lewat Material Issue Gudang.
      </Penjelasan>

      <FilterBar q={q} onQ={setQ} placeholder="Cari kode unit atau nomor order…" filters={[]} ringkasan={`${daftar.length} unit`} onReset={() => setQ("")} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="overflow-hidden">
          <JudulKartu title="Unit dengan pemakaian bahan" description="Pilih unit untuk melihat jejaknya." />
          {daftar.length === 0 ? (
            <CardContent><EmptyState icon={Boxes} title="Belum ada pemakaian bahan ke unit" description="Unit muncul di sini setelah Gudang mengeluarkan bahan lewat Material Issue." /></CardContent>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0" data-testid="daftar-unit">
              {daftar.map((u) => (
                <li key={u.unitId}>
                  <button type="button" onClick={() => setPilih(u.unitId)} aria-pressed={pilih === u.unitId}
                    className={cn("w-full px-4 py-2.5 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset", pilih === u.unitId && "bg-accentbg")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12.5px] font-semibold text-ink">{u.unitCode}</span>
                      {u.jumlahTanpaHarga > 0 && <Badge variant="red">{u.jumlahTanpaHarga} tanpa harga</Badge>}
                      {u.jumlahBelumDibekukan > 0 && <Badge variant="orange">{u.jumlahBelumDibekukan} estimasi</Badge>}
                      <span className="ml-auto text-[12.5px] font-semibold tabular-nums text-ink">{teksRupiah(u.biayaPersediaan) ?? "Belum bisa dihitung"}</span>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-ink3">{u.orderNumber || "—"} · {u.jumlahPergerakan} pergerakan · terakhir {wib(u.terakhir)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardContent className="py-4">
            {!aktif ? <p className="text-[12.5px] text-ink3">Pilih unit di sebelah untuk melihat jejak biayanya.</p> : (
              <div className="space-y-2">
                <div className="font-mono text-[13px] font-bold text-ink">{aktif.unitCode} <span className="font-sans font-normal text-ink3">· {aktif.orderNumber || "tanpa nomor order"}</span></div>
                <JejakBiayaBahan key={aktif.unitId} unitId={aktif.unitId} sumber="finance" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </HalamanFinance>
  );
}
