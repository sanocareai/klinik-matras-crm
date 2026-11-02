import React, { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TombolAksi } from "@/features/finance/shared.jsx";
import { formatUangTepat } from "./tagihanLogika.js";

// Dialog aplikasi untuk Tolak / Batalkan / Setujui tagihan, pengganti window.prompt dan window.confirm.
// Aturan yang sama dengan sebelumnya: alasan wajib (tidak boleh kosong), tidak ada transaksi baru — hanya memanggil endpoint yang sudah ada lewat onSubmit.
// Bila gagal, isian tetap ada dan pesan galat tampil di dalam dialog (fokus pindah ke pesan); TombolAksi mengunci klik ganda.

export function Galat({ pesan, testid = "galat-dialog-tagihan" }) {
  const ref = useRef(null);
  useEffect(() => { if (pesan) ref.current?.focus(); }, [pesan]);
  if (!pesan) return null;
  return <p ref={ref} tabIndex={-1} role="alert" data-testid={testid} className="fin-tg-dlg-galat">{pesan}</p>;
}

export function DialogAlasan({ judul, deskripsi, label, tombol, contoh, destruktif = true, onClose, onSubmit }) {
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const ada = alasan.trim().length > 0;
  async function kirim() {
    if (!ada) { setGalat("Alasan wajib diisi."); return; }
    setGalat("");
    try { await onSubmit(alasan.trim()); }
    catch (e) { setGalat(e?.message || "Gagal menyimpan. Isian Anda tetap ada; coba lagi."); }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={judul} description={deskripsi}
      className="fin-tg-modal fin-tg-dlg w-[520px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi variant={destruktif ? "destructive" : "primary"} onClick={kirim} disabled={!ada} data-testid="kirim-dialog-alasan">{tombol}</TombolAksi></>}
    >
      <div className="space-y-3">
        <Field label={label} required hint="Wajib — tercatat di riwayat audit">
          <Input autoFocus value={alasan} onChange={(e) => { setAlasan(e.target.value); if (galat) setGalat(""); }} placeholder={contoh} aria-label={label} data-testid="isi-dialog-alasan" onKeyDown={(e) => { if (e.key === "Enter" && ada) { e.preventDefault(); kirim(); } }} />
        </Field>
        <Galat pesan={galat} />
      </div>
    </Modal>
  );
}

export function DialogSetujui({ b, onClose, onSubmit }) {
  const [galat, setGalat] = useState("");
  async function kirim() {
    setGalat("");
    try { await onSubmit(); }
    catch (e) { setGalat(e?.message || "Gagal menyetujui tagihan."); }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Setujui ${b.billNumber}`}
      description="Setelah disetujui, tagihan menjadi utang resmi di buku besar."
      className="fin-tg-modal fin-tg-dlg w-[520px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={kirim} data-testid="kirim-setujui">Setujui tagihan</TombolAksi></>}
    >
      <div className="space-y-3">
        <dl className="fin-tg-dlg-ringkas">
          <div><dt>Supplier</dt><dd>{b.supplier?.name || "—"}</dd></div>
          <div><dt>Nilai tagihan</dt><dd className="fin-tg-besar">{formatUangTepat(b.amount)}</dd></div>
          <div><dt>Jenis tagihan</dt><dd>{b.jenisTagihan?.label || "Belum dipilih"}</dd></div>
        </dl>
        <p className="fin-tg-info" data-nada="biru">Jurnal utang dibuat saat disetujui. Isi tagihan lalu tidak bisa diedit bebas — hanya informasi dokumen atau koreksi resmi.</p>
        <Galat pesan={galat} />
      </div>
    </Modal>
  );
}
