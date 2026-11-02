import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { AngkaGud, GudField, PilihGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { IkMuatUlang } from "@/components/gudangIcons.jsx";
import { UNIT_LABEL, ALL_UNITS, CATEGORY_REAL, SERVICE_LINE_REAL } from "../inventoryReal.js";

// Tambah / ubah bahan katalog — data NYATA (POST & PATCH /inventory/materials). Redesain Gudang (3 Nov 2026): pemilih dan kolom angka aplikasi, galat per kolom, isian bertahan saat gagal, klik ganda = satu permintaan.
//
// ⚠️ `code`, `unit`, dan `serviceLine` TIDAK BISA DIUBAH setelah bahan dibuat. Itu bukan kelalaian UI: backend menolaknya karena ledger sudah mengacu ke satuan itu — mengganti satuan diam-diam membuat riwayat
// qty tidak bisa dibandingkan. Kolomnya dikunci dan alasannya ditulis. Mengubah informasi bahan (nama, kategori, batas minimum, jumlah restok) TIDAK mengubah saldo, harga, atau dokumen lama;
// perubahan saldo dan harga memakai jalurnya sendiri (Koreksi saldo dan Ubah harga di rincian bahan).
const KOSONG = { code: "", name: "", unit: "PCS", category: "", serviceLine: "", reorderPoint: "", reorderQty: "" };
const angkaSah = (v) => v === "" || v === null || v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0);

export default function ItemFormModal({ open, item, onClose, onSaved }) {
  const ubah = !!item;
  const [form, setForm] = useState(KOSONG);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [galat, setGalat] = useState({});
  const kunci = useRef(false);

  useEffect(() => {
    if (!open) return;
    setErr(""); setGalat({});
    setForm(item
      ? { code: item.code, name: item.name, unit: item.unit, category: item.category || "", serviceLine: item.serviceLine || "", reorderPoint: item.reorderPoint ?? "", reorderQty: item.reorderQty ?? "" }
      : KOSONG);
  }, [open, item]);

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: typeof v === "string" ? v : v.target.value })); setGalat((g) => ({ ...g, [k]: undefined })); };
  const opsiSatuan = useMemo(() => ALL_UNITS.map((u) => ({ nilai: u, label: UNIT_LABEL[u] })), []);
  const opsiKategori = useMemo(() => [{ nilai: "", label: "Tanpa kategori" }, ...Object.entries(CATEGORY_REAL).map(([k, c]) => ({ nilai: k, label: `${c.label} — ${c.labelId}` }))], []);
  const opsiLini = useMemo(() => [{ nilai: "", label: "Lintas lini" }, ...Object.entries(SERVICE_LINE_REAL).map(([k, s]) => ({ nilai: k, label: s.labelId }))], []);

  function periksa() {
    const e = {};
    if (!String(form.code).trim()) e.code = "Kode wajib diisi";
    if (!String(form.name).trim()) e.name = "Nama wajib diisi";
    if (!angkaSah(form.reorderPoint)) e.reorderPoint = "Harus angka 0 atau lebih";
    if (!angkaSah(form.reorderQty)) e.reorderQty = "Harus angka 0 atau lebih";
    setGalat(e); return e;
  }

  async function simpan(e) {
    e.preventDefault();
    if (kunci.current) return;
    setErr("");
    if (Object.keys(periksa()).length) return;
    kunci.current = true; setBusy(true);
    try {
      if (ubah) {
        // code & unit sengaja TIDAK dikirim — backend menolaknya.
        await api.updateMaterial(item.materialId || item.id, {
          name: form.name,
          category: form.category,          // "" → dikosongkan
          reorderPoint: form.reorderPoint,  // "" → alert dimatikan
          reorderQty: form.reorderQty,
        });
      } else {
        await api.createMaterial({
          code: form.code, name: form.name, unit: form.unit,
          category: form.category || undefined,
          serviceLine: form.serviceLine || undefined,
          reorderPoint: form.reorderPoint || undefined,
          reorderQty: form.reorderQty || undefined,
        });
      }
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2.message); // isian TIDAK dihapus
    } finally {
      kunci.current = false; setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title={ubah ? "Ubah bahan" : "Tambah bahan"} description={ubah ? "Mengubah informasi bahan tidak mengubah saldo, harga, atau dokumen lama." : "Bahan baru belum punya saldo; stok baru bertambah lewat penerimaan resmi."} className="w-[600px] gud-modal">
      <form onSubmit={simpan} className="gud-form" noValidate data-testid="form-bahan">
        <div className="gud-form-baris">
          <GudField label="Kode bahan" htmlFor="wh-code" wajib galat={galat.code} hint={ubah ? "Kode tidak bisa diubah setelah bahan dibuat." : undefined}>
            <input id="wh-code" className="gud-f-teks" value={form.code} onChange={set("code")} disabled={ubah} placeholder="FOAM-HR-D18-5CM" aria-invalid={!!galat.code || undefined} data-testid="input-kode" />
          </GudField>
          <GudField label="Satuan stok" htmlFor="wh-unit" wajib hint={ubah ? "Satuan dikunci — ledger sudah memakainya." : "Tidak bisa diubah setelah bahan dibuat."}>
            <PilihGud id="wh-unit" value={form.unit} onChange={set("unit")} opsi={opsiSatuan} disabled={ubah} data-testid="pilih-satuan" />
          </GudField>
        </div>
        <GudField label="Nama bahan" htmlFor="wh-name" wajib galat={galat.name}>
          <input id="wh-name" className="gud-f-teks" value={form.name} onChange={set("name")} placeholder="Busa HR Density 18 — 5cm" aria-invalid={!!galat.name || undefined} data-testid="input-nama" />
        </GudField>
        <div className="gud-form-baris">
          <GudField label="Kategori" htmlFor="wh-cat"><PilihGud id="wh-cat" value={form.category} onChange={set("category")} opsi={opsiKategori} data-testid="pilih-kategori" /></GudField>
          <GudField label="Lini layanan" htmlFor="wh-line" hint={ubah ? "Dikunci setelah bahan dibuat." : undefined}><PilihGud id="wh-line" value={form.serviceLine} onChange={set("serviceLine")} opsi={opsiLini} disabled={ubah} data-testid="pilih-lini" /></GudField>
        </div>
        <div className="gud-form-baris">
          <GudField label="Batas minimum (titik restok)" htmlFor="wh-rop" galat={galat.reorderPoint}>
            <AngkaGud id="wh-rop" value={String(form.reorderPoint ?? "")} onChange={set("reorderPoint")} satuan={String(form.unit ?? "").toLowerCase()} invalid={!!galat.reorderPoint} placeholder="kosong = belum diatur" data-testid="input-batas-minimum" />
          </GudField>
          <GudField label="Jumlah restok standar" htmlFor="wh-roq" galat={galat.reorderQty}>
            <AngkaGud id="wh-roq" value={String(form.reorderQty ?? "")} onChange={set("reorderQty")} satuan={String(form.unit ?? "").toLowerCase()} invalid={!!galat.reorderQty} placeholder="jumlah restok" data-testid="input-jumlah-restok" />
          </GudField>
        </div>
        <p className="gud-petunjuk">Batas minimum kosong berarti <strong>belum diatur</strong>: bahan ini tidak pernah muncul sebagai saran Restok (bukan "restok di angka nol"). Hanya petugas berwenang yang mengisinya; sistem tidak membuat angka sendiri.</p>

        {err && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-bahan">{err}</p>}

        <div className="gud-form-aksi">
          <button type="button" className="gud-tombol" onClick={onClose}>Batal</button>
          <button type="submit" className="gud-tombol gud-tombol-utama" disabled={busy} data-testid="simpan-bahan">
            {busy && <IkMuatUlang size={14} className="animate-spin" />} {ubah ? "Simpan perubahan" : "Tambah bahan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
