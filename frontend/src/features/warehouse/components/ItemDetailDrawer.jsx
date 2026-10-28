import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Pencil, Loader2, History, TriangleAlert } from "lucide-react";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import Lipat from "../stok/Lipat.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { ISTILAH, TEKS_DRAWER, labelStatusStok, teksAngkaStok } from "../stok/drawerBahanLogic.js";
import { api } from "@/api.js";
import RiwayatReferensiBahan from "./RiwayatReferensiBahan.jsx";
import HargaBerlakuPanel from "../stok/HargaBerlakuPanel.jsx";
import KoreksiSaldoPanel from "../stok/KoreksiSaldoPanel.jsx";
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
      <dt className="shrink-0 text-[11.5px] text-ink3">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] font-medium text-ink">{children}</dd>
    </div>
  );
}

export default function ItemDetailDrawer({ item, onClose, onEdit, onChanged }) {
  const [movements, setMovements] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const infoStok = useInfoToggle();
  const [keadaan, setKeadaan] = useState(null); // keadaanSaldo dari panel Koreksi saldo → label status header yang membedakan belum diketahui / nol / minus

  const materialId = item?.materialId || item?.id;

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
  const adaReferensi = item.referenceUnitCost != null || item.referenceStockValue != null;

  return (
    <Dialog.Root open={!!item} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail item inventory"
          aria-describedby={undefined}
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]"
        >
          {/* Awal: nama bahan + satuan (kode sebagai keterangan), status, tutup */}
          <div className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="m-0 text-[15px] font-bold leading-snug text-ink" data-testid="drawer-nama">{item.name}</Dialog.Title>
              <p className="m-0 mt-0.5 truncate text-[11.5px] text-ink3" data-testid="drawer-kode-satuan">{item.code} · satuan {satuanTeks}</p>
            </div>
            <Badge variant={status.tone} className="mt-0.5 shrink-0" data-testid="status-stok" data-status={status.key}>{status.label}</Badge>
            <Dialog.Close aria-label="Tutup" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink max-sm:h-11 max-sm:w-11">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {/* Kartu Stok: Tersedia (angka utama), Saldo dan Dipesan (pendukung), peringatan + tombol Koreksi saldo / Riwayat */}
            <section className="rounded-btn border border-border p-3" aria-label="Stok bahan" data-testid="kartu-stok">
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wide text-ink3">{ISTILAH.tersedia}</div>
                <InfoToggleButton info={infoStok} label="cara hitung stok" />
              </div>
              <div className="mt-0.5 text-[26px] font-extrabold leading-none tabular-nums text-ink" data-testid="stok-tersedia">
                {teksAngkaStok(item.available, keadaan, (n) => formatQty(n, item.unit))}
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                <div className="flex gap-1.5"><dt className="text-ink3">{ISTILAH.saldo}</dt><dd className="m-0 font-semibold tabular-nums text-ink" data-testid="stok-saldo">{teksAngkaStok(item.balance, keadaan, (n) => formatQty(n, item.unit))}</dd></div>
                <div className="flex gap-1.5"><dt className="text-ink3">{ISTILAH.dipesan}</dt><dd className="m-0 font-semibold tabular-nums text-ink" data-testid="stok-dipesan">{formatQty(item.reserved, item.unit)}</dd></div>
              </dl>
              <InfoToggleIsi info={infoStok}><p className="m-0" data-testid="rumus-stok">{ISTILAH.rumusStok}</p></InfoToggleIsi>
              <KoreksiSaldoPanel materialId={materialId} onChanged={onChanged} onKeadaan={setKeadaan} />
            </section>

            <HargaBerlakuPanel materialId={materialId} />

            {item.dataNote && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-orange/30 bg-orange/10 px-3 py-2" data-testid="data-belum-lengkap">
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />
                <p className="m-0 text-[11.5px] leading-relaxed text-ink2">
                  <span className="font-semibold text-orange">Data belum lengkap: </span>
                  {item.dataNote}
                </p>
              </div>
            )}

            {/* Bagian terlipat dengan judul jelas */}
            <div className="mt-4 border-b border-line">
              {adaReferensi && (
                <Lipat judul="Harga dan nilai stok referensi lama" testid="lipat-referensi-harga">
                  <dl className="m-0 divide-y divide-line">
                    <Baris label="Harga referensi">
                      {item.referenceUnitCost != null
                        ? <>{formatRupiah(item.referenceUnitCost)} <span className="text-ink3">({item.referenceUnitCostMonth})</span></>
                        : <span className="text-ink3">Tidak tercatat</span>}
                    </Baris>
                    <Baris label="Nilai stok referensi">
                      {item.referenceStockValue != null
                        ? <>{formatRupiah(item.referenceStockValue)} <span className="text-ink3">({item.referenceStockValueMonth})</span></>
                        : <span className="text-ink3">Tidak tercatat</span>}
                    </Baris>
                  </dl>
                  <p className="m-0 mt-1 text-[11px] leading-relaxed text-ink3">{TEKS_DRAWER.referensi}</p>
                </Lipat>
              )}

              <Lipat judul="Detail bahan" testid="lipat-detail-bahan">
                <dl className="m-0 divide-y divide-line">
                  <Baris label="Kategori">
                    {item.category
                      ? `${CATEGORY_REAL[item.category]?.label} · ${CATEGORY_REAL[item.category]?.labelId}`
                      : <span className="text-ink3">Tanpa kategori</span>}
                  </Baris>
                  <Baris label="Lini layanan">
                    {item.serviceLine ? SERVICE_LINE_REAL[item.serviceLine]?.labelId : <span className="text-ink3">Lintas lini</span>}
                  </Baris>
                  <Baris label="Satuan">{satuanTeks}</Baris>
                  <Baris label="Batas minimum (titik restok)">
                    {item.reorderPoint != null
                      ? formatQty(item.reorderPoint, item.unit)
                      : <span className="text-ink3">belum diatur</span>}
                  </Baris>
                  <Baris label="Jumlah restok standar">
                    {item.reorderQty != null ? formatQty(item.reorderQty, item.unit) : <span className="text-ink3">—</span>}
                  </Baris>
                  <Baris label="Vendor langganan">
                    {item.vendor || <span className="text-ink3">Tidak tercatat</span>}
                  </Baris>
                  <Baris label="Supplier terakhir">
                    {supplierTerakhir || <span className="text-ink3">Belum ada penerimaan</span>}
                  </Baris>
                  <Baris label="Sub-kategori">
                    {item.itemGroup || <span className="text-ink3">—</span>}
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
                <p className="m-0 mt-1 text-[11px] leading-relaxed text-ink3">{TEKS_DRAWER.catatanLokasi}</p>
              </Lipat>

              <Lipat judul="Riwayat pergerakan" ringkas={loading ? "memuat…" : movements ? `${movements.length} terbaru` : null} testid="lipat-pergerakan">
                <h4 className="sr-only"><History size={12} aria-hidden /> Riwayat pergerakan</h4>
                {loading && (
                  <p className="m-0 flex items-center gap-1.5 py-2 text-[12px] text-ink3">
                    <Loader2 size={12} className="animate-spin" /> Memuat riwayat…
                  </p>
                )}
                {!loading && movements?.length === 0 && (
                  <p className="m-0 py-2 text-[12px] text-ink3">
                    Belum ada pergerakan stok untuk item ini.
                  </p>
                )}
                {!loading && movements?.length > 0 && (
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {movements.map((m) => (
                      <li key={m.id} className="flex items-start gap-2 py-2">
                        <StatusBadge map={PERGERAKAN_ID} value={m.type} className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[11px] text-ink3">{waktu(m.createdAt)}</p>
                          {(m.reason || m.note) && (
                            <p className="m-0 truncate text-[11.5px] text-ink2">{m.reason || m.note}</p>
                          )}
                          {m.unit?.unitCode && <p className="m-0 text-[11px] text-ink3">Unit {m.unit.unitCode}</p>}
                          {m.createdBy?.name && <p className="m-0 text-[10.5px] text-ink3">oleh {m.createdBy.name}</p>}
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

          <div className="shrink-0 border-t border-line p-3">
            {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1 max-sm:min-h-11" onClick={() => onEdit(item)}>
                <Pencil size={14} /> Edit Item
              </Button>
              <Button variant="ghost" size="sm" className="max-sm:min-h-11" onClick={toggleAktif} disabled={busy}>
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
