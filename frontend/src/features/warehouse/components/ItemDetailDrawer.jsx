import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { FokusOverlay } from "@/components/ui/fokus-overlay.jsx";
import { ISTILAH, TEKS_DRAWER, labelStatusStok, teksAngkaStok } from "../stok/drawerBahanLogic.js";
import { api } from "@/api.js";
import RiwayatReferensiBahan from "./RiwayatReferensiBahan.jsx";
import IkonBahan from "../stok/IkonBahan.jsx";
import { tampilHargaDaftar } from "../stok/koreksiSaldoLogic.js";
import { riwayatLokasi } from "../stok/stokLogic.js";
import { dokumenAsal } from "../stok/stokTampilanLogic.js";
import HargaBerlakuPanel from "../stok/HargaBerlakuPanel.jsx";
import KoreksiSaldoPanel from "../stok/KoreksiSaldoPanel.jsx";
import { IkAwas, IkEdit, IkLokasi } from "@/components/gudangIcons.jsx";
import { CATEGORY_REAL, SERVICE_LINE_REAL, MOVEMENT_LABEL_REAL, UNIT_LABEL, formatQty } from "../inventoryReal.js";
import { formatRupiah } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";

// RUANG KERJA BAHAN (redesain Gudang, 3 Nov 2026) — panel kanan (≥1200px) atau layar penuh (HP) dengan empat tab: Saldo · Harga · Pergerakan · Informasi bahan.
// Riwayat pergerakan diambil dari ledger (GET /inventory/movements?materialId=) — sumber kebenaran yang SAMA dengan saldo. Tidak ada angka di sini yang disimpan terpisah.
// BATAS YANG DIJUJURKAN: pergerakan dimuat 50 TERBARU (server maksimal 200 per permintaan, tanpa halaman berikutnya) — layar menyebut jumlah yang tampil, bukan seluruh riwayat.
// ⚠️ Bagian yang SENGAJA TIDAK ADA (lihat FIELDS_NOT_IN_BACKEND di inventoryReal.js): saldo per rak/bin, batch/lot, barcode, dimensi. Lokasi = riwayat penerimaan terakhir, bukan lokasi stok saat ini.
// Harga Berlaku (HPP operasional) tetap dibedakan dari nilai persediaan Finance; tidak ada perkalian stok × harga yang disebut angka pembukuan.
const keIndonesia = (peta) => Object.fromEntries(Object.entries(peta).map(([k, v]) => [k, { ...v, label: v.labelId || v.label }]));
const PERGERAKAN_ID = keIndonesia(MOVEMENT_LABEL_REAL);
const waktu = (s) => new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const NADA_PERGERAKAN = { RECEIPT: "green", RETURN: "green", ISSUE: "orange", WASTE: "red", ADJUSTMENT: "accent", TRANSFER: "neutral", SUPPLIER_RETURN: "orange" };
const TAB = [{ k: "saldo", label: "Saldo" }, { k: "harga", label: "Harga" }, { k: "pergerakan", label: "Pergerakan" }, { k: "info", label: "Informasi bahan" }];

function Baris({ label, children }) {
  return (
    <div className="gud-dl-baris">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function ItemDetailDrawer({ item, baris = null, hargaPeta = null, onClose, onEdit, onChanged }) {
  const [movements, setMovements] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("saldo");
  const [tanyaAktif, setTanyaAktif] = useState(false); // konfirmasi aktif/nonaktif di dalam aplikasi
  const bantuanSaldo = useInfoToggle();
  const [keadaan, setKeadaan] = useState(null); // keadaanSaldo dari panel Koreksi saldo → label status header yang membedakan belum diketahui / nol / minus

  const materialId = item?.materialId || item?.id;

  useEffect(() => { setTab("saldo"); setTanyaAktif(false); setError(""); }, [materialId]);
  useEffect(() => {
    if (!materialId) return undefined;
    let batal = false; setLoading(true); setError("");
    api.getStockMovements({ materialId, limit: 50 }).then((d) => { if (!batal) setMovements(d); }).catch((e) => { if (!batal) setError(e.message); }).finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [materialId]);

  if (!item) return null;

  const status = labelStatusStok(item, keadaan);
  // Dua sumber vendor BEDA maksud — sengaja ditampilkan terpisah: item.vendor = vendor LANGGANAN dari data referensi; supplierTerakhir = supplier pada penerimaan TERAKHIR di ledger.
  const supplierTerakhir = movements?.find((m) => m.type === "RECEIPT" && m.supplier)?.supplier;

  async function ubahAktif() {
    if (busy) return; setBusy(true); setError("");
    try { await api.updateMaterial(materialId, { active: !item.active }); onChanged(); onClose(); }
    catch (e) { setError(e.message); setTanyaAktif(false); } finally { setBusy(false); }
  }

  const satuanTeks = UNIT_LABEL[item.unit] || item.unit;
  const ringkasHargaHeader = hargaPeta ? tampilHargaDaftar(hargaPeta, materialId) : null; // sama dengan kolom harga di daftar; tanpa izin Finance = tidak tampil; belum ada = bukan Rp0
  const lokasiTerima = baris ? riwayatLokasi(baris) : null;
  const adaReferensi = item.referenceUnitCost != null || item.referenceStockValue != null;

  return (
    <FokusOverlay
      open onClose={onClose} tempel testid="drawer-bahan" className="gud-bahan"
      title={<span data-testid="drawer-nama">{item.name}</span>}
      subtitle={<span data-testid="drawer-kode-satuan">{item.code} · satuan {satuanTeks}</span>}
      aksiHeader={<button type="button" className="gud-tombol gud-tombol-kecil gud-tombol-header" onClick={() => onEdit(item)} data-testid="edit-bahan"><IkEdit size={16} /> Ubah informasi</button>}
      header={(
        <div className="gud-bahan-kepala">
          <div className="gud-bahan-baris">
            <IkonBahan kode={baris?.kelompok?.kode} ukuran="lg" />
            <div className="gud-bahan-pil">
              <span className="gud-pill gud-pill-titik" data-warna={status.tone === "green" ? "green" : status.tone === "red" ? "red" : status.tone === "orange" ? "orange" : "neutral"} data-testid="status-stok" data-status={status.key}>{status.label}</span>
              {baris?.kelompok?.label && <span className="gud-pill" data-warna="neutral" data-testid="drawer-kelompok">{baris.kelompok.label}</span>}
              {ringkasHargaHeader && <span className={cn("gud-bahan-harga", !ringkasHargaHeader.ada && "gud-redup")} data-testid="header-harga">{ringkasHargaHeader.ada ? `Rp${Number(ringkasHargaHeader.harga).toLocaleString("id-ID", { maximumFractionDigits: 4 })} / ${ringkasHargaHeader.satuan ?? ""}` : ringkasHargaHeader.teks}</span>}
            </div>
          </div>
          <div role="tablist" aria-label="Bagian rincian bahan" className="gud-tab gud-tab-lipat" data-testid="tab-bahan">
            {TAB.map((t) => <button key={t.k} type="button" role="tab" id={`bahan-tab-${t.k}`} aria-selected={tab === t.k} aria-controls={`bahan-isi-${t.k}`} onClick={() => setTab(t.k)} data-testid={`tab-${t.k}`} className="max-sm:min-h-11">{t.label}</button>)}
          </div>
        </div>
      )}
    >
      <div className="gud-bahan-isi">
        {/* ── Saldo ── */}
        <section id="bahan-isi-saldo" role="tabpanel" aria-labelledby="bahan-tab-saldo" hidden={tab !== "saldo"} className="gud-bahan-bagian" aria-label="Stok bahan" data-testid="kartu-stok">
          <div className="gud-saldo-utama">
            <div className="gud-saldo-label">{ISTILAH.tersedia}</div>
            <div className="gud-saldo-angka" data-testid="stok-tersedia">{teksAngkaStok(item.available, keadaan, (n) => formatQty(n, item.unit))}</div>
            <dl className="gud-saldo-komponen">
              <div><dt>Saldo tercatat</dt><dd data-testid="stok-saldo">{teksAngkaStok(item.balance, keadaan, (n) => formatQty(n, item.unit))}</dd></div>
              <div><dt>{ISTILAH.dipesan}</dt><dd data-testid="stok-dipesan">{formatQty(item.reserved, item.unit)}</dd></div>
            </dl>
            <p className="gud-petunjuk gud-baris-bantuan" data-testid="definisi-saldo">Tersedia = saldo tercatat − sudah dipesan. <InfoToggleButton info={bantuanSaldo} label="cara menghitung saldo dan batas lokasi" /></p>
            <InfoToggleIsi info={bantuanSaldo}>
              <p className="m-0" data-testid="rumus-stok">{ISTILAH.rumusStok}</p>
              <p className="m-0" data-testid="sumber-angka">Sumber angka: {baris?.sumberAngka?.teks ?? "belum ada catatan pergerakan stok untuk bahan ini"}.</p>
              <p className="m-0" data-testid="catatan-lokasi">{TEKS_DRAWER.catatanLokasi} Lokasi di bawah hanya riwayat penerimaan, bukan lokasi stok saat ini.</p>
            </InfoToggleIsi>
          </div>
          <dl className="gud-dl">
            <Baris label="Satuan">{satuanTeks}</Baris>
            <Baris label="Batas minimum">{item.reorderPoint != null ? formatQty(item.reorderPoint, item.unit) : <em>belum diatur</em>}</Baris>
            <Baris label="Lokasi dari riwayat penerimaan">{lokasiTerima
              ? <span data-testid="drawer-riwayat-penerimaan" title="Dari riwayat penerimaan. Sistem tidak menyimpan saldo per lokasi, jadi ini bukan lokasi stok saat ini."><IkLokasi size={14} aria-hidden /> {lokasiTerima.teks.replace("Terakhir diterima di ", "")}</span>
              : <em>belum ada penerimaan berlokasi</em>}</Baris>
          </dl>
          {item.dataNote && (
            <div className="gud-info" data-nada="awas" data-testid="data-belum-lengkap"><IkAwas size={16} aria-hidden /> <span><strong>Data belum lengkap: </strong>{item.dataNote}</span></div>
          )}
          <div className="gud-bahan-pendukung">
            <h3 className="gud-bahan-sub">Koreksi saldo</h3>
            <KoreksiSaldoPanel materialId={materialId} onChanged={onChanged} onKeadaan={setKeadaan} />
          </div>
        </section>

        {/* ── Harga ── */}
        <section id="bahan-isi-harga" role="tabpanel" aria-labelledby="bahan-tab-harga" hidden={tab !== "harga"} className="gud-bahan-bagian">
          <HargaBerlakuPanel materialId={materialId} />
          {adaReferensi && (
            <div className="gud-bahan-pendukung" data-testid="lipat-referensi-harga">
              <h3 className="gud-bahan-sub">Harga dan nilai stok referensi lama</h3>
              <dl className="gud-dl">
                <Baris label="Harga referensi">{item.referenceUnitCost != null ? <>{formatRupiah(item.referenceUnitCost)} <span className="gud-redup">({item.referenceUnitCostMonth})</span></> : <em>Tidak tercatat</em>}</Baris>
                <Baris label="Nilai stok referensi">{item.referenceStockValue != null ? <>{formatRupiah(item.referenceStockValue)} <span className="gud-redup">({item.referenceStockValueMonth})</span></> : <em>Tidak tercatat</em>}</Baris>
              </dl>
              <p className="gud-petunjuk">{TEKS_DRAWER.referensi}</p>
            </div>
          )}
        </section>

        {/* ── Pergerakan ── */}
        <section id="bahan-isi-pergerakan" role="tabpanel" aria-labelledby="bahan-tab-pergerakan" hidden={tab !== "pergerakan"} className="gud-bahan-bagian" data-testid="lipat-pergerakan">
          <h3 className="gud-bahan-sub">Riwayat pergerakan <span className="gud-redup">{loading ? "memuat…" : movements ? `${movements.length} terbaru` : ""}</span></h3>
          {loading && <p className="gud-petunjuk" role="status">Memuat riwayat…</p>}
          {!loading && movements?.length === 0 && <p className="gud-petunjuk" data-testid="pergerakan-kosong">Belum ada pergerakan stok untuk bahan ini.</p>}
          {!loading && movements?.length > 0 && (
            <>
              <ul className="gud-gerak" data-testid="daftar-pergerakan">
                {movements.map((m) => {
                  const dok = dokumenAsal(m); const qty = Number(m.qty);
                  const satuanBaris = m.satuanCatat || item.unit; // satuan SAAT dicatat (transisi satuan); API lama tanpa field ini = satuan master sekarang
                  return (
                    <li key={m.id} data-testid="baris-pergerakan" data-tipe={m.type}>
                      <div className="gud-gerak-isi">
                        <div className="gud-gerak-atas"><span className="gud-pill" data-warna={NADA_PERGERAKAN[m.type] ?? "neutral"}>{PERGERAKAN_ID[m.type]?.label ?? m.type}</span><span className="gud-sekunder">{waktu(m.createdAt)}</span></div>
                        <span className="gud-sekunder" data-testid="dokumen-asal">{dok ? <Link to={dok.ke} className="gud-tautan-nomor" data-testid="tautan-dokumen">{dok.jenis}</Link> : "Tanpa dokumen tertaut"}</span>
                        {(m.reason || m.note) && <span className="gud-sekunder">{m.reason || m.note}</span>}
                        {m.supplier && <span className="gud-sekunder">Supplier {m.supplier}</span>}
                        {m.unit?.unitCode && <span className="gud-sekunder">Unit {m.unit.unitCode}</span>}
                        {m.createdBy?.name && <span className="gud-sekunder">oleh {m.createdBy.name}</span>}
                        {m.satuanCatat && m.satuanCatat !== item.unit && <span className="gud-sekunder" data-testid="satuan-asal">Dicatat dalam {UNIT_LABEL[m.satuanCatat] || m.satuanCatat} (satuan lama; saldo sekarang dalam {satuanTeks})</span>}
                      </div>
                      <span className={cn("gud-gerak-qty", qty < 0 ? "gud-minus" : "gud-plus")} data-testid="qty-pergerakan" data-arah={qty < 0 ? "keluar" : "masuk"} data-satuan={satuanBaris}>{qty > 0 ? "+" : ""}{formatQty(qty, satuanBaris).replace(/^-/, "−")}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="gud-petunjuk" data-testid="batas-pergerakan">Menampilkan {movements.length} pergerakan terbaru{movements.length >= 50 ? " — riwayat yang lebih lama tidak dimuat di sini" : " (seluruhnya)"}. Angka saldo tidak dihitung dari daftar ini.</p>
            </>
          )}
          <RiwayatReferensiBahan materialId={materialId} />
        </section>

        {/* ── Informasi bahan ── */}
        <section id="bahan-isi-info" role="tabpanel" aria-labelledby="bahan-tab-info" hidden={tab !== "info"} className="gud-bahan-bagian" data-testid="lipat-detail-bahan">
          <dl className="gud-dl">
            <Baris label="Kode">{item.code}</Baris>
            <Baris label="Kategori">{item.category ? `${CATEGORY_REAL[item.category]?.label} · ${CATEGORY_REAL[item.category]?.labelId}` : <em>Tanpa kategori</em>}</Baris>
            <Baris label="Lini layanan">{item.serviceLine ? SERVICE_LINE_REAL[item.serviceLine]?.labelId : <em>Lintas lini</em>}</Baris>
            <Baris label="Satuan">{satuanTeks}</Baris>
            <Baris label="Batas minimum (titik restok)">{item.reorderPoint != null ? formatQty(item.reorderPoint, item.unit) : <em>belum diatur</em>}</Baris>
            <Baris label="Jumlah restok standar">{item.reorderQty != null ? formatQty(item.reorderQty, item.unit) : <em>—</em>}</Baris>
            <Baris label="Vendor langganan">{item.vendor || <em>Tidak tercatat</em>}</Baris>
            <Baris label="Supplier terakhir">{supplierTerakhir || <em>Belum ada penerimaan</em>}</Baris>
            {baris?.kelompok?.label && <Baris label="Kelompok">{baris.kelompok.kode === "BELUM" ? <span className="gud-awas-teks">Belum dikelompokkan</span> : baris.kelompok.label}</Baris>}
            <Baris label="Sub-kategori">{item.itemGroup || <em>—</em>}</Baris>
            <Baris label="Status bahan">{item.active ? "Aktif" : "Nonaktif"}</Baris>
            {item.createdVia === "PO" && <Baris label="Asal SKU"><span data-testid="asal-sku-po">Dibuat dari Purchase Order{item.kind ? ` · ${item.kind === "PERLENGKAPAN_STOK" ? "Perlengkapan Stok (hanya Gudang)" : "Bahan Produksi"}` : ""}</span></Baris>}
            {item.specification && <Baris label="Spesifikasi">{item.specification}</Baris>}
            {item.storageHint && <Baris label="Lokasi penyimpanan">{item.storageHint}</Baris>}
          </dl>
          <p className="gud-petunjuk">Mengubah informasi bahan tidak mengubah saldo, harga, atau dokumen lama. Satuan dan kode dikunci setelah bahan dibuat; perubahan saldo dan harga memakai jalurnya sendiri (tab Saldo dan Harga).</p>
          <div className="gud-bahan-pendukung" data-testid="aksi-bahan">
            <h3 className="gud-bahan-sub">Status bahan</h3>
            {error && <p className="gud-f-galat" role="alert">{error}</p>}
            {tanyaAktif ? (
              <div className="gud-panel-aksi" role="alertdialog" aria-label="Konfirmasi" data-testid="konfirmasi-aktif">
                <p className="gud-info" data-nada="awas">{item.active ? "Nonaktifkan bahan ini? Bahan tidak muncul di daftar aktif dan tidak bisa dipakai untuk dokumen baru. Riwayat, saldo, dan dokumen lama tidak berubah; bisa diaktifkan lagi kapan saja." : "Aktifkan kembali bahan ini? Bahan muncul lagi di daftar aktif dan bisa dipakai untuk dokumen baru. Riwayat dan dokumen lama tidak berubah."}</p>
                <div className="gud-form-aksi">
                  <button type="button" className="gud-tombol" onClick={() => setTanyaAktif(false)} disabled={busy}>Batal</button>
                  <button type="button" className="gud-tombol gud-tombol-utama" onClick={ubahAktif} disabled={busy} data-testid="ya-ubah-aktif">{item.active ? "Ya, nonaktifkan" : "Ya, aktifkan"}</button>
                </div>
              </div>
            ) : (
              <div className="gud-aksi-baris">
                <button type="button" className={cn("gud-tombol", item.active && "gud-tombol-awas")} onClick={() => setTanyaAktif(true)} disabled={busy} data-testid="ubah-aktif">{item.active ? "Nonaktifkan bahan" : "Aktifkan bahan"}</button>
              </div>
            )}
          </div>
        </section>
      </div>
    </FokusOverlay>
  );
}
