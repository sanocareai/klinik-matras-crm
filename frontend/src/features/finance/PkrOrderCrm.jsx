import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan, TombolAksi } from "@/features/finance/shared.jsx";
import {
  KATEGORI_PKR_OPSI, KIRIM_OPSI, orderCrmKosong, orderCrmDariSinkron, galatOrderCrm, bodyOrderCrm,
  VARIAN_PRODUKSI, varianDelivery, VARIAN_BAYAR_PKR, teksKurang,
} from "@/features/finance/pkrOrderCrmLogic.js";

// Sinkronisasi Penjualan Karyawan -> Order CRM (Okt 2026). Order CRM hanya DOKUMEN OPERASIONAL (unit produksi + pengiriman). Nominal, pembayaran, piutang, dan jurnal tetap di Penjualan Karyawan.

/** Ringkasan satu baris: nomor order + status Produksi + status Delivery. Tanpa nominal. */
export function RingkasOrderCrm({ sinkron, className = "" }) {
  if (!sinkron?.order) {
    return <Badge variant={sinkron?.statusPkr === "DIBATALKAN" ? "neutral" : "orange"} data-testid="order-crm-belum">{sinkron?.statusPkr === "DIBATALKAN" ? "Tanpa order" : "Belum ada order"}</Badge>;
  }
  const o = sinkron.order;
  return (
    <div className={`min-w-0 space-y-1 ${className}`} data-testid="order-crm-ringkas">
      <div className="truncate font-mono text-[11.5px] font-semibold text-ink">{o.nomor || "—"}</div>
      <div className="flex flex-wrap gap-1">
        <Badge variant={VARIAN_PRODUKSI[sinkron.produksi?.kode] || "neutral"} title={teksKurang(sinkron) || undefined}>Produksi: {sinkron.produksi?.label}</Badge>
        <Badge variant={varianDelivery(sinkron.delivery?.kode)}>Delivery: {sinkron.delivery?.label}</Badge>
      </div>
    </div>
  );
}

/** Isian spesifikasi produksi + logistik. `baru`: tampilkan jenis pekerjaan & jumlah unit (tidak bisa diubah setelah order ada). */
export function FormOrderCrm({ nilai, onChange, baru = true, terkunciSpek = false }) {
  const set = (k, v) => onChange({ ...nilai, [k]: v });
  return (
    <div className="space-y-3" data-testid="form-order-crm">
      {baru && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Jenis pekerjaan">
            <Pilihan value={nilai.kategori} onChange={(v) => set("kategori", v)} aria-label="Jenis pekerjaan produksi">
              {KATEGORI_PKR_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Pilihan>
          </Field>
          <Field label="Jumlah unit kasur"><Input type="number" min="1" max="20" inputMode="numeric" value={nilai.jumlahUnit} onChange={(e) => set("jumlahUnit", e.target.value)} aria-label="Jumlah unit" /></Field>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Merk kasur"><Input value={nilai.merk} disabled={terkunciSpek} onChange={(e) => set("merk", e.target.value)} placeholder="mis. Sano" /></Field>
        <Field label="Ukuran" hint={terkunciSpek ? "Produksi sudah mulai — merk dan ukuran terkunci." : undefined}><Input value={nilai.ukuran} disabled={terkunciSpek} onChange={(e) => set("ukuran", e.target.value)} placeholder="mis. 160 x 200" /></Field>
      </div>
      <Field label="Dikirim atau diambil sendiri?" hint="Job pengiriman hanya dibuat bila dipilih “Dikirim”.">
        <Pilihan value={nilai.kirim} onChange={(v) => set("kirim", v)} aria-label="Dikirim atau diambil sendiri">
          {KIRIM_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Pilihan>
      </Field>
      {nilai.kirim === "ya" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Alamat pengiriman" className="sm:col-span-2"><Input value={nilai.alamat} onChange={(e) => set("alamat", e.target.value)} placeholder="mis. Jl. Mawar 5, Bekasi" /></Field>
          <Field label="Kota"><Input value={nilai.kota} onChange={(e) => set("kota", e.target.value)} /></Field>
          <Field label="Rencana tanggal kirim" hint="Opsional. Penjadwalan sebenarnya dilakukan Delivery."><Input type="date" value={nilai.tanggalKirim} onChange={(e) => set("tanggalKirim", e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}

/** Modal "Buat/Tautkan Order CRM" (PKR lama) dan "Lengkapi spesifikasi". onSubmit(body) → Promise. */
export function ModalOrderCrm({ penjualan, mode, onClose, onSubmit }) {
  const lengkapi = mode === "lengkapi";
  const [f, setF] = useState(orderCrmKosong);
  const [galat, setGalat] = useState("");
  useEffect(() => { if (penjualan) { setF(lengkapi ? orderCrmDariSinkron(penjualan.sinkron) : orderCrmKosong()); setGalat(""); } }, [penjualan, lengkapi]);
  if (!penjualan) return null;
  const terkunci = lengkapi && (penjualan.sinkron?.units || []).some((u) => !["AWAITING_PICKUP", "RECEIVED", "CANCELLED"].includes(u.status));
  const g = galatOrderCrm(f, { baru: !lengkapi });
  async function kirim() {
    setGalat("");
    try { await onSubmit(bodyOrderCrm(f, { baru: !lengkapi })); } catch (e) { setGalat(e.message || "Gagal menyimpan"); }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={lengkapi ? `Lengkapi spesifikasi — ${penjualan.nomor}` : `Buat Order CRM — ${penjualan.nomor}`}
      description={lengkapi
        ? "Perubahan alamat disinkronkan ke job yang belum selesai. Tercatat di riwayat."
        : "Membuat SATU order operasional + unit produksi untuk penjualan ini. Tidak ada pembayaran, invoice, atau jurnal baru."}
      className="w-[620px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {(galat || g) && <p role="alert" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">{galat || g}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <TombolAksi disabled={!!g} onClick={kirim}>{lengkapi ? "Simpan Spesifikasi" : "Buat Order CRM"}</TombolAksi>
          </div>
        </div>
      )}
    >
      <FormOrderCrm nilai={f} onChange={setF} baru={!lengkapi} terkunciSpek={terkunci} />
      {!lengkapi && <p className="mt-3 text-[12px] text-ink3">Boleh dikosongkan dulu. Order tetap dibuat dengan status “Perlu dilengkapi” dan Produksi belum bisa memulai sampai merk, ukuran, dan pilihan kirim terisi.</p>}
    </Modal>
  );
}

/** Badge sumber status bayar order PKR (dibaca dari ledger Penjualan Karyawan, bukan dari kolom Order). */
export function BadgeBayarPkr({ pkr }) {
  const p = pkr?.pembayaran;
  if (!p) return null;
  return <Badge variant={VARIAN_BAYAR_PKR[p.status] || "neutral"} title="Status pembayaran dibaca dari Penjualan Karyawan di Finance" data-testid="bayar-pkr">{p.label}</Badge>;
}

/** Label kecil di kartu/baris order CRM: "Penjualan Karyawan · PKR-… · Perlu dilengkapi". */
export function LabelOrderPkr({ pkr, className = "" }) {
  if (!pkr) return null;
  const kurang = pkr.order?.spesifikasi?.lengkap === false;
  return (
    <span className={`block whitespace-normal font-sans text-[10px] font-semibold text-accent ${className}`} data-testid="label-order-pkr">
      Penjualan Karyawan · {pkr.nomor}{kurang ? <span className="ml-1 rounded bg-orangebg px-1 text-orange">Perlu dilengkapi</span> : null}
    </span>
  );
}
