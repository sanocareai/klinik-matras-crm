import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { TombolAksi } from "@/features/finance/shared.jsx";
import { useKatalogPkr } from "@/features/finance/PkrOrderCrm.jsx";
import { FormItemProduksi } from "@/features/finance/PkrItemForm.jsx";
import { PratinjauKoreksi } from "@/features/finance/PkrPratinjau.jsx";
import { formKoreksiDariSinkron, operasiKoreksi, galatKoreksi, alasanValid, itemBaru, totalUnitKoreksi, MAKS_ITEM } from "@/features/finance/pkrItemLogic.js";

// KOREKSI ITEM PKR (Okt 2026): tambah/hapus item, ubah jumlah/ukuran/spesifikasi/dikirim-diambil SEBELUM unit dijadwalkan/diproses.
// Alur: isi perubahan -> PRATINJAU DAMPAK (server, tidak menulis) -> alasan wajib -> terapkan (revisi optimistis + Idempotency-Key, atomik).
// Item yang sudah dijadwalkan/diproses diblokir server dengan arahan pembatalan resmi — layar menampilkan pesannya apa adanya.

const AREA = "min-h-[72px] w-full rounded-lg bg-surface px-2.5 py-2 text-sm leading-normal text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:min-h-[96px]";
const kunciBaru = () => (globalThis.crypto?.randomUUID ? `pkr-koreksi-${globalThis.crypto.randomUUID()}` : `pkr-koreksi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export function ModalKoreksiItem({ penjualan, onClose, onSelesai }) {
  const { katalog, memuat, galat: galatKatalog } = useKatalogPkr(!!penjualan);
  const [f, setF] = useState(() => formKoreksiDariSinkron(penjualan?.sinkron));
  const [langkah, setLangkah] = useState("isi");
  const [pra, setPra] = useState(null);
  const [galat, setGalat] = useState("");
  const kunci = useRef(null);
  useEffect(() => {
    if (!penjualan) return;
    setF(formKoreksiDariSinkron(penjualan.sinkron)); setLangkah("isi"); setPra(null); setGalat(""); kunci.current = null;
  }, [penjualan]);
  if (!penjualan) return null;

  const revisi = penjualan.sinkron?.order?.revisi ?? null;
  const g = katalog ? galatKoreksi(f, katalog) : null;
  const ops = katalog ? operasiKoreksi(f, katalog) : [];
  const tinjau = langkah === "tinjau";

  async function pratinjau() {
    setGalat("");
    try {
      const r = await api.pratinjauKoreksiItemPkr(penjualan.id, { operasi: ops, expectedRevision: revisi });
      setPra(r); kunci.current = kunciBaru(); setLangkah("tinjau");
    } catch (e) { setGalat(e.message || "Gagal membuat pratinjau"); }
  }
  async function terapkan() {
    setGalat("");
    try {
      await api.koreksiItemPkr(penjualan.id, { operasi: ops, expectedRevision: revisi, alasan: f.alasan.trim() }, kunci.current);
      await onSelesai?.();
    } catch (e) { setGalat(e.message || "Gagal menerapkan koreksi"); }
  }
  const itemBaruForm = { items: f.baru, alamat: "", kota: "", tanggalKirim: "" };
  const unitSesudah = katalog ? totalUnitKoreksi(f, katalog) : 0;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Koreksi item — ${penjualan.nomor}`}
      description="Ubah jumlah, ukuran, spesifikasi, atau dikirim/diambil; tambah atau hapus item. Hanya untuk item yang unitnya belum dijadwalkan/diproses. Nominal & jurnal tidak berubah."
      className="w-[760px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {(galat || (!tinjau && g)) && <p role="alert" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="koreksi-galat">{galat || g}</p>}
          <div className="flex justify-end gap-2">
            {tinjau
              ? <Button variant="neutral" onClick={() => { setLangkah("isi"); setGalat(""); }} className="max-sm:min-h-11 max-sm:px-4">Kembali ubah</Button>
              : <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>}
            {tinjau
              ? <TombolAksi disabled={!pra?.valid || !alasanValid(f.alasan)} onClick={terapkan} data-testid="aksi-koreksi-terapkan">Terapkan Koreksi</TombolAksi>
              : <TombolAksi disabled={!!g || memuat || !katalog || revisi == null} onClick={pratinjau} data-testid="aksi-koreksi-tinjau">Tinjau Dampak</TombolAksi>}
          </div>
        </div>
      )}
    >
      {revisi == null && <p role="alert" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="koreksi-tanpa-item">Order ini memakai format lama (tanpa daftar item). Ubah lewat “Lengkapi spesifikasi order”; untuk menambah item, batalkan lalu catat ulang.</p>}
      {revisi != null && !tinjau && (
        <div className="space-y-4" data-testid="koreksi-isi">
          <p className="m-0 text-[12px] text-ink3">Revisi daftar item saat ini: <strong className="text-ink tabular-nums">{revisi}</strong>. Bila orang lain mengubah daftar ini lebih dulu, koreksi Anda ditolak dan perlu dibuka ulang.</p>
          <FormItemProduksi katalog={katalog} nilai={{ items: f.items, alamat: "", kota: "", tanggalKirim: "" }} onChange={(v) => setF((s) => ({ ...s, items: v.items }))} mode="koreksi" memuat={memuat} galatMuat={galatKatalog} sembunyikanLogistik />
          <section className="space-y-3" aria-label="Item baru">
            {f.baru.length > 0 && (
              <FormItemProduksi katalog={katalog} nilai={itemBaruForm} onChange={(v) => setF((s) => ({ ...s, baru: v.items }))} mode="baru" bolehKosong sembunyikanLogistik />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="neutral" disabled={!katalog || f.items.length + f.baru.length >= MAKS_ITEM} onClick={() => setF((s) => ({ ...s, baru: [...s.baru, itemBaru()] }))} className="max-sm:min-h-11" data-testid="koreksi-tambah-item">
                <Plus size={13} /> Tambah Item Produksi
              </Button>
              <p className="m-0 text-[12.5px] text-ink2" data-testid="koreksi-total-unit">Sesudah koreksi: <strong className="text-ink">{unitSesudah} unit</strong> produksi</p>
            </div>
          </section>
        </div>
      )}
      {revisi != null && tinjau && (
        <div className="space-y-4" data-testid="koreksi-tinjau">
          <PratinjauKoreksi data={pra} />
          {pra?.valid && (
            <Field label="Alasan koreksi" required hint="Wajib (minimal 5 karakter). Tercatat bersama data sebelum/sesudah di riwayat.">
              <textarea className={AREA} value={f.alasan} maxLength={500} onChange={(e) => setF((s) => ({ ...s, alasan: e.target.value }))} aria-label="Alasan koreksi" data-testid="koreksi-alasan" />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
