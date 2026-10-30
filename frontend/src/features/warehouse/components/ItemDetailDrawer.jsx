import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Pencil, Loader2, History, TriangleAlert } from "lucide-react";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import Lipat from "../stok/Lipat.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { ISTILAH, TEKS_DRAWER, labelStatusStok, teksAngkaStok } from "../stok/drawerBahanLogic.js";
import { api } from "@/api.js";
import RiwayatReferensiBahan from "./RiwayatReferensiBahan.jsx";
import IkonBahan from "../stok/IkonBahan.jsx";
import "../stok/kontras.css";
import { tampilHargaDaftar } from "../stok/koreksiSaldoLogic.js";
import { riwayatLokasi } from "../stok/stokLogic.js";
import HargaBerlakuPanel from "../stok/HargaBerlakuPanel.jsx";
import KoreksiSaldoPanel from "../stok/KoreksiSaldoPanel.jsx";
import FotoBahan from "../stok/FotoBahan.jsx";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  CATEGORY_REAL, SERVICE_LINE_REAL, MOVEMENT_LABEL_REAL,
  UNIT_LABEL, formatQty,
} from "../inventoryReal.js";
import { formatRupiah } from "@/utils/format.js";

// Detail item — data NYATA. Riwayat pergerakan diambil dari ledger
// (GET /inventory/movements?materialId=), sumber kebenaran yang SAMA dengan
// saldo di header. Tidak ada angka di drawer ini yang disimpan terpisah.
//
// ⚠️ Bagian yang SENGAJA TIDAK ADA (lihat FIELDS_NOT_IN_BACKEND di
// inventoryReal.js): Location Stock per rak/bin, Batch/Lot, Reserved,
// barcode, dimensi. Belum ada kolomnya sama sekali — menampilkan section
// kosong yang tidak pernah bisa diisi siapa pun lebih menyesatkan daripada
// tidak menampilkannya (pelajaran yang sama dengan checklist POD di Delivery).
// Label berbahasa Indonesia untuk drawer (peta bersama tetap dwibahasa untuk daftar): teks tampil = labelId.
const keIndonesia = (peta) => Object.fromEntries(Object.entries(peta).map(([k, v]) => [k, { ...v, label: v.labelId || v.label }]));
const PERGERAKAN_ID = keIndonesia(MOVEMENT_LABEL_REAL);
const waktu = (s) => new Date(s).toLocaleString("id-ID", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function Baris({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-[11.5px] stok-t2">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] font-medium text-ink">{children}</dd>
    </div>
  );
}

export default function ItemDetailDrawer({ item, baris = null, hargaPeta = null, onClose, onEdit, onChanged }) {
  const [movements, setMovements] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const infoStok = useInfoToggle();
  const [keadaan, setKeadaan] = useState(null); // keadaanSaldo dari panel Koreksi saldo → label status header yang membedakan belum diketahui / nol / minus

  const materialId = item?.materialId || item?.id;
  // Foto bahan: awalnya dari baris Stok & Lokasi; setelah unggah/putar/hapus diperbarui langsung dari respons server (daftar di belakang ikut dimuat ulang lewat onChanged).
  const [foto, setFoto] = useState({ url: baris?.fotoUrl ?? null, thumb: baris?.fotoThumbUrl ?? null });
  useEffect(() => { setFoto({ url: baris?.fotoUrl ?? null, thumb: baris?.fotoThumbUrl ?? null }); }, [materialId, baris?.fotoUrl, baris?.fotoThumbUrl]);

  useEffect(() => {
    if (!materialId) return;
    setLoading(true);
    setError("");
    api.getStockMovements({ materialId, limit: 50 })
      .then(setMovements)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [materialId]);

  if (!item) return null;

  const status = labelStatusStok(item, keadaan);
  // Dua sumber vendor BEDA maksud — sengaja ditampilkan terpisah, bukan
  // ditimpa satu sama lain:
  //  - item.vendor: vendor LANGGANAN dari data referensi (snapshot import
  //    stock opname Excel 12 Sept 2026) — siapa yang BIASA memasok.
  //  - supplierTerakhir: supplier pada penerimaan TERAKHIR yang benar-benar
  //    tercatat di ledger — bisa beda kalau order terakhir dari vendor lain.
  const supplierTerakhir = movements?.find((m) => m.type === "RECEIPT" && m.supplier)?.supplier;

  async function toggleAktif() {
    setBusy(true);
    setError("");
    try {
      await api.updateMaterial(materialId, { active: !item.active });
      onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const satuanTeks = UNIT_LABEL[item.unit] || item.unit;
  const ringkasHargaHeader = hargaPeta ? tampilHargaDaftar(hargaPeta, materialId) : null; // sama dengan kolom harga di daftar; tanpa izin Finance = tidak tampil; belum ada = bukan Rp0
  const lokasiTerima = baris ? riwayatLokasi(baris) : null;
  const adaReferensi = item.referenceUnitCost != null || item.referenceStockValue != null;

  return (
    <Dialog.Root open={!!item} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/* Desktop: panel kanan membulat. HP: lembar dari bawah (92% tinggi layar), nyaman disentuh. */}
        <Dialog.Content
          aria-label="Detail item inventory"
          aria-describedby={undefined}
          data-testid="drawer-bahan"
          className="fixed z-[201] flex flex-col bg-base shadow-2xl outline-none data-[state=open]:animate-in max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[92dvh] max-sm:rounded-t-3xl max-sm:slide-in-from-bottom sm:right-0 sm:top-0 sm:h-full sm:w-[480px] sm:rounded-l-3xl sm:slide-in-from-right"
        >
          {/* Awal (transparansi halus): ikon kelompok, nama + kode/satuan, status, harga ringkas, tutup */}
          <div className="flex shrink-0 items-start gap-3 rounded-t-3xl bg-surface/85 px-4 pb-3 pt-4 backdrop-blur-xl sm:rounded-tl-3xl sm:rounded-tr-none">
            <IkonBahan kode={baris?.kelompok?.kode} ukuran="lg" fotoUrl={foto.thumb} />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="m-0 text-[18px] font-bold leading-snug text-ink" data-testid="drawer-nama">{item.name}</Dialog.Title>
              <p className="m-0 mt-0.5 truncate text-[12.5px] stok-t2" data-testid="drawer-kode-satuan">{item.code} · satuan {satuanTeks}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant={status.tone} className="shrink-0" data-testid="status-stok" data-status={status.key}>{status.label}</Badge>
                {baris?.kelompok?.label && <span className="rounded-full bg-inset px-2.5 py-0.5 text-[11.5px] font-medium stok-t2" data-testid="drawer-kelompok">{baris.kelompok.label}</span>}
                {ringkasHargaHeader && <span className={`text-[12.5px] ${ringkasHargaHeader.ada ? "font-semibold text-ink" : "italic stok-t2"}`} data-testid="header-harga">{ringkasHargaHeader.ada ? `Rp${Number(ringkasHargaHeader.harga).toLocaleString("id-ID", { maximumFractionDigits: 4 })} / ${ringkasHargaHeader.satuan}` : ringkasHargaHeader.teks}</span>}
              </div>
            </div>
            <Dialog.Close aria-label="Tutup" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-inset stok-t2 hover:bg-hovertint hover:text-ink max-sm:h-11 max-sm:w-11">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {/* Kartu Stok: Tersedia (angka utama), Saldo dan Dipesan (pendukung), peringatan + tombol Koreksi saldo / Riwayat */}
            <section className="rounded-card bg-surface p-4 shadow-card" aria-label="Stok bahan" data-testid="kartu-stok">
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1 text-[13px] font-semibold stok-t2">{ISTILAH.tersedia}</div>
                <InfoToggleButton info={infoStok} label="cara hitung stok" />
              </div>
              <div className="mt-1 text-[34px] font-extrabold leading-none tabular-nums text-ink" data-testid="stok-tersedia">
                {teksAngkaStok(item.available, keadaan, (n) => formatQty(n, item.unit))}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-inset px-3 py-2 text-[12.5px]">
                <div><dt className="text-[11.5px] stok-t2">{ISTILAH.saldo}</dt><dd className="m-0 text-[15px] font-semibold tabular-nums text-ink" data-testid="stok-saldo">{teksAngkaStok(item.balance, keadaan, (n) => formatQty(n, item.unit))}</dd></div>
                <div><dt className="text-[11.5px] stok-t2">{ISTILAH.dipesan}</dt><dd className="m-0 text-[15px] font-semibold tabular-nums text-ink" data-testid="stok-dipesan">{formatQty(item.reserved, item.unit)}</dd></div>
              </dl>
              <InfoToggleIsi info={infoStok}><p className="m-0" data-testid="rumus-stok">{ISTILAH.rumusStok}</p></InfoToggleIsi>
              <KoreksiSaldoPanel materialId={materialId} onChanged={onChanged} onKeadaan={setKeadaan} />
            </section>

            <FotoBahan materialId={materialId} nama={item.name} fotoUrl={foto.url} onUbah={(f) => { setFoto({ url: f.fotoUrl, thumb: f.fotoThumbUrl }); onChanged?.(); }} />

            <HargaBerlakuPanel materialId={materialId} />

            {item.dataNote && (
              <div className="flex items-start gap-2 rounded-card bg-orangebg px-4 py-3" data-testid="data-belum-lengkap">
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />
                <p className="m-0 text-[11.5px] leading-relaxed stok-t2">
                  <span className="font-semibold text-orange">Data belum lengkap: </span>
                  {item.dataNote}
                </p>
              </div>
            )}

            {/* Bagian terlipat dengan judul jelas */}
            <div className="rounded-card bg-surface px-4 shadow-card [&>details:first-child]:border-t-0">
              {adaReferensi && (
                <Lipat judul="Harga dan nilai stok referensi lama" testid="lipat-referensi-harga">
                  <dl className="m-0 divide-y divide-line">
                    <Baris label="Harga referensi">
                      {item.referenceUnitCost != null
                        ? <>{formatRupiah(item.referenceUnitCost)} <span className="stok-t2">({item.referenceUnitCostMonth})</span></>
                        : <span className="stok-t2">Tidak tercatat</span>}
                    </Baris>
                    <Baris label="Nilai stok referensi">
                      {item.referenceStockValue != null
                        ? <>{formatRupiah(item.referenceStockValue)} <span className="stok-t2">({item.referenceStockValueMonth})</span></>
                        : <span className="stok-t2">Tidak tercatat</span>}
                    </Baris>
                  </dl>
                  <p className="m-0 mt-1 text-[11px] leading-relaxed stok-t2">{TEKS_DRAWER.referensi}</p>
                </Lipat>
              )}

              <Lipat judul="Detail bahan" testid="lipat-detail-bahan">
                <dl className="m-0 divide-y divide-line">
                  <Baris label="Kategori">
                    {item.category
                      ? `${CATEGORY_REAL[item.category]?.label} · ${CATEGORY_REAL[item.category]?.labelId}`
                      : <span className="stok-t2">Tanpa kategori</span>}
                  </Baris>
                  <Baris label="Lini layanan">
                    {item.serviceLine ? SERVICE_LINE_REAL[item.serviceLine]?.labelId : <span className="stok-t2">Lintas lini</span>}
                  </Baris>
                  <Baris label="Satuan">{satuanTeks}</Baris>
                  <Baris label="Batas minimum (titik restok)">
                    {item.reorderPoint != null
                      ? formatQty(item.reorderPoint, item.unit)
                      : <span className="stok-t2">belum diatur</span>}
                  </Baris>
                  <Baris label="Jumlah restok standar">
                    {item.reorderQty != null ? formatQty(item.reorderQty, item.unit) : <span className="stok-t2">—</span>}
                  </Baris>
                  <Baris label="Vendor langganan">
                    {item.vendor || <span className="stok-t2">Tidak tercatat</span>}
                  </Baris>
                  <Baris label="Supplier terakhir">
                    {supplierTerakhir || <span className="stok-t2">Belum ada penerimaan</span>}
                  </Baris>
                  {baris?.kelompok?.label && <Baris label="Kelompok">{baris.kelompok.kode === "BELUM" ? <span className="text-orange">Belum dikelompokkan</span> : baris.kelompok.label}</Baris>}
                  <Baris label="Riwayat penerimaan">{lokasiTerima ? <span data-testid="drawer-riwayat-penerimaan" title="Dari riwayat penerimaan. Sistem tidak menyimpan saldo per lokasi, jadi ini bukan lokasi stok saat ini.">{lokasiTerima.teks.replace("Terakhir diterima di ", "")}</span> : <span className="stok-t2">tidak ada riwayat</span>}</Baris>
                  <Baris label="Sub-kategori">
                    {item.itemGroup || <span className="stok-t2">—</span>}
                  </Baris>
                  <Baris label="Status item">{item.active ? "Aktif" : "Nonaktif"}</Baris>
                  {item.createdVia === "PO" && (
                    <Baris label="Asal SKU">
                      <span data-testid="asal-sku-po">Dibuat dari Purchase Order{item.kind ? ` · ${item.kind === "PERLENGKAPAN_STOK" ? "Perlengkapan Stok (hanya Gudang)" : "Bahan Produksi"}` : ""}</span>
                    </Baris>
                  )}
                  {item.specification && <Baris label="Spesifikasi">{item.specification}</Baris>}
                  {item.storageHint && <Baris label="Lokasi penyimpanan">{item.storageHint}</Baris>}
                </dl>
                <p className="m-0 mt-1 text-[11px] leading-relaxed stok-t2">{TEKS_DRAWER.catatanLokasi}</p>
              </Lipat>

              <Lipat judul="Riwayat pergerakan" ringkas={loading ? "memuat…" : movements ? `${movements.length} terbaru` : null} testid="lipat-pergerakan">
                <h4 className="sr-only"><History size={12} aria-hidden /> Riwayat pergerakan</h4>
                {loading && (
                  <p className="m-0 flex items-center gap-1.5 py-2 text-[12px] stok-t2">
                    <Loader2 size={12} className="animate-spin" /> Memuat riwayat…
                  </p>
                )}
                {!loading && movements?.length === 0 && (
                  <p className="m-0 py-2 text-[12px] stok-t2">
                    Belum ada pergerakan stok untuk item ini.
                  </p>
                )}
                {!loading && movements?.length > 0 && (
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {movements.map((m) => (
                      <li key={m.id} className="flex items-start gap-2 py-2">
                        <StatusBadge map={PERGERAKAN_ID} value={m.type} className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[11px] stok-t2">{waktu(m.createdAt)}</p>
                          {(m.reason || m.note) && (
                            <p className="m-0 truncate text-[11.5px] stok-t2">{m.reason || m.note}</p>
                          )}
                          {m.unit?.unitCode && <p className="m-0 text-[11px] stok-t2">Unit {m.unit.unitCode}</p>}
                          {m.createdBy?.name && <p className="m-0 text-[10.5px] stok-t2">oleh {m.createdBy.name}</p>}
                        </div>
                        <span className={`shrink-0 text-[12.5px] font-bold tabular-nums ${Number(m.qty) < 0 ? "text-red" : "text-green"}`}>
                          {Number(m.qty) > 0 ? "+" : ""}{Number(m.qty)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Lipat>

              <RiwayatReferensiBahan materialId={materialId} />
            </div>
          </div>

          <div className="shrink-0 bg-surface/85 p-3 backdrop-blur-xl max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="h-11 flex-1 rounded-xl" onClick={() => onEdit(item)}>
                <Pencil size={14} /> Edit Item
              </Button>
              <Button variant="neutral" size="sm" className="h-11 rounded-xl" onClick={toggleAktif} disabled={busy}>
                {busy && <Loader2 size={14} className="animate-spin" />}
                {item.active ? "Nonaktifkan" : "Aktifkan"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
