import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan, InputUang, TombolAksi, formatUang } from "@/features/finance/shared.jsx";
import { useKatalogPkr } from "@/features/finance/PkrOrderCrm.jsx";
import { FormItemPenjualan } from "@/features/finance/PkrItemPenjualanForm.jsx";
import { PratinjauKoreksiBaris } from "@/features/finance/PkrPratinjau.jsx";
import { formKoreksiBaris, operasiKoreksiBaris, galatKoreksiBaris, alasanValid, itemPenjualanBaru, KIRIM_ITEM_OPSI, MAKS_ITEM } from "@/features/finance/pkrItemLogic.js";
import { subtotalSen } from "@/features/finance/penjualanKaryawanLogic.js";
import { AREA } from "@/features/finance/PkrItemForm.jsx";

// KOREKSI ITEM PENJUALAN (Finance + operasional ATOMIK). Satu daftar: jumlah/harga/dikirim/hapus/tambah. Alur: isi perubahan -> PRATINJAU DAMPAK (server, tidak menulis: total, jurnal, item order, unit)
// -> alasan wajib -> terapkan (revisi optimistis + Idempotency-Key). Setelah Produksi berjalan hanya HARGA yang boleh berubah; sisanya diblokir server dengan arahan pembatalan resmi.
// Ukuran/spesifikasi per item diubah lewat "Lengkapi spesifikasi order".

const kunciBaru = () => (globalThis.crypto?.randomUUID ? `pkr-koreksi-baris-${globalThis.crypto.randomUUID()}` : `pkr-koreksi-baris-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

function BarisKoreksi({ b, onChange }) {
  const set = (k, v) => onChange({ ...b, [k]: v });
  const sub = subtotalSen(b.jumlah, b.harga) / 100;
  const kunci = b.terkunci;
  return (
    <div className={`space-y-3 rounded-lg border border-line bg-surface p-3 ${b.hapus ? "opacity-60" : ""}`} data-testid="koreksi-baris" data-item-no={b.no} data-hapus={b.hapus ? "ya" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`text-[13px] font-semibold text-ink ${b.hapus ? "line-through" : ""}`}>Item {b.no} · {b.nama}</span>
          <Badge variant="neutral">{b.pemenuhanLabel}</Badge>
          {b.set && <Badge variant="neutral" title="Satu harga untuk satu Set">Set</Badge>}
          {kunci && <Badge variant="orange" data-testid="badge-terkunci">Produksi sudah mulai — hanya harga yang bisa diubah</Badge>}
          {b.hapus && <Badge variant="orange">Akan dihapus</Badge>}
        </div>
        <Button size="sm" variant="neutral" disabled={kunci} aria-label={b.hapus ? `Batalkan hapus item ${b.no}` : `Hapus item ${b.no}`} onClick={() => set("hapus", !b.hapus)} className="max-sm:min-h-11" data-testid="koreksi-hapus-baris">
          <Trash2 size={13} /> {b.hapus ? "Batalkan hapus" : "Hapus"}
        </Button>
      </div>
      {!b.hapus && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {!b.unit && (
            <Field label="Nama item" className="col-span-2 sm:col-span-4">
              <Input value={b.nama} onChange={(e) => set("nama", e.target.value)} aria-label={`Nama item ${b.no}`} data-testid="koreksi-nama" />
            </Field>
          )}
          <Field label={b.set ? "Jumlah set" : "Jumlah"}>
            <Input type="text" inputMode="decimal" value={b.jumlah} disabled={kunci} onChange={(e) => set("jumlah", e.target.value)} aria-label={`Jumlah item ${b.no}`} data-testid="koreksi-jumlah" />
          </Field>
          <Field label={b.set ? "Harga satu set" : "Harga satuan"}>
            <InputUang value={b.harga} onChange={(v) => set("harga", v)} aria-label={`Harga item ${b.no}`} data-testid="koreksi-harga" />
          </Field>
          {b.unit && (
            <Field label="Dikirim/diambil">
              <Pilihan value={b.kirim} disabled={kunci} onChange={(v) => set("kirim", v)} aria-label={`Dikirim atau diambil sendiri item ${b.no}`} data-testid="koreksi-kirim">
                {KIRIM_ITEM_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </Pilihan>
            </Field>
          )}
          <div className="flex flex-col justify-end">
            <p className="m-0 text-[11.5px] text-ink3">Subtotal</p>
            <p className="m-0 text-[15px] font-semibold tabular-nums text-ink">{formatUang(sub)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModalKoreksiBaris({ penjualan, onClose, onSelesai }) {
  const { katalog, memuat, galat: galatKatalog } = useKatalogPkr(!!penjualan);
  const [f, setF] = useState(() => formKoreksiBaris(penjualan));
  const [langkah, setLangkah] = useState("isi");
  const [pra, setPra] = useState(null);
  const [galat, setGalat] = useState("");
  const kunci = useRef(null);
  useEffect(() => {
    if (!penjualan) return;
    setF(formKoreksiBaris(penjualan)); setLangkah("isi"); setPra(null); setGalat(""); kunci.current = null;
  }, [penjualan]);
  if (!penjualan) return null;

  const revisi = penjualan.sinkron?.order?.revisi ?? null;
  const g = katalog ? galatKoreksiBaris(f, katalog) : null;
  const ops = katalog ? operasiKoreksiBaris(f, katalog) : [];
  const tinjau = langkah === "tinjau";

  async function pratinjau() {
    setGalat("");
    try {
      const r = await api.pratinjauKoreksiBarisPkr(penjualan.id, { operasi: ops, expectedRevision: revisi });
      setPra(r); kunci.current = kunciBaru(); setLangkah("tinjau");
    } catch (e) { setGalat(e.message || "Gagal membuat pratinjau"); }
  }
  async function terapkan() {
    setGalat("");
    try {
      await api.koreksiBarisPkr(penjualan.id, { operasi: ops, expectedRevision: revisi, alasan: f.alasan.trim() }, kunci.current);
      await onSelesai?.();
    } catch (e) { setGalat(e.message || "Gagal menerapkan koreksi"); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Koreksi item penjualan — ${penjualan.nomor}`}
      description="Ubah jumlah, harga, atau dikirim/diambil; tambah atau hapus item. Tagihan, jurnal, item order, dan unit berubah bersama (atomik). Setelah Produksi berjalan hanya harga yang bisa diubah."
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
      {revisi == null && <p role="alert" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="koreksi-tanpa-item">Penjualan ini tidak punya order operasional atau memakai format lama — koreksi baris belum tersedia. Batalkan lalu catat ulang bila perlu.</p>}
      {revisi != null && !tinjau && (
        <div className="space-y-4" data-testid="koreksi-isi">
          <p className="m-0 text-[12px] text-ink3">Revisi saat ini: <strong className="text-ink tabular-nums">{revisi}</strong>. Bila orang lain mengubah daftar ini lebih dulu, koreksi Anda ditolak dan perlu dibuka ulang.</p>
          {f.baris.map((b, idx) => <BarisKoreksi key={b.id} b={b} onChange={(nb) => setF((s) => ({ ...s, baris: s.baris.map((x, n) => (n === idx ? nb : x)) }))} />)}
          <section className="space-y-3" aria-label="Item baru">
            {f.baru.length > 0 && (
              <FormItemPenjualan katalog={katalog} nilai={{ items: f.baru, alamat: "", kota: "", tanggalKirim: "" }} onChange={(v) => setF((s) => ({ ...s, baru: v.items }))} bolehKosong sembunyikanLogistik />
            )}
            <Button size="sm" variant="neutral" disabled={!katalog || f.baris.length + f.baru.length >= MAKS_ITEM} onClick={() => setF((s) => ({ ...s, baru: [...s.baru, itemPenjualanBaru()] }))} className="max-sm:min-h-11" data-testid="koreksi-tambah-item">
              <Plus size={13} /> Tambah Item
            </Button>
          </section>
          {galatKatalog && <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galatKatalog}</p>}
        </div>
      )}
      {revisi != null && tinjau && (
        <div className="space-y-4" data-testid="koreksi-tinjau">
          <PratinjauKoreksiBaris data={pra} />
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
