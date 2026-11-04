import React from "react";
import { Pencil, FileText, Lock, History, Banknote, ArrowRight } from "@/components/ikApple.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { tanggalPendek } from "@/features/finance/shared.jsx";
import { ChipStatusTagihan } from "./DaftarTagihan.jsx";
import { kemampuanUbah, formatUangTepat, statusTempo, nomorFakturTampil, tampilSisa } from "./tagihanLogika.js";

// Satu pintu "Ubah tagihan" (dari rincian dan menu baris). Dialog ini TIDAK mengubah apa pun sendiri: ia menampilkan apa yang boleh diubah menurut status
// dokumen dan izin akun, lalu membuka form/endpoint yang sudah ada (faktur PO, edit isi, informasi dokumen, koreksi). Kontrak server tidak berubah.
// onPilih(kunci, bagian): "faktur-po" | "isi" | "info" | "koreksi" | "riwayat" | "versi-baru" | "pembayaran" | "batalkan"

const IKON = { "faktur-po": FileText, isi: Pencil, info: FileText, koreksi: Pencil };
const tgl = (v) => (v ? tanggalPendek(String(v).slice(0, 10)) : "—");

function Bagian({ bagian, onPilih }) {
  const Ikon = IKON[bagian.kunci] || Pencil;
  return (
    <section className="fin-tg-ubah-kartu" data-testid={`ubah-${bagian.kunci}`} data-tersedia={bagian.tersedia ? "1" : "0"}>
      <div className="fin-tg-ubah-kepala">
        <Ikon size={18} aria-hidden="true" />
        <h3>{bagian.judul}</h3>
      </div>
      <p className="fin-tg-ubah-ket">{bagian.ket}</p>
      <ul className="fin-tg-ubah-bidang" aria-label="Yang bisa diubah">
        {bagian.bidang.map((x) => <li key={x}>{x}</li>)}
      </ul>
      {bagian.tersedia ? (
        <Button size="sm" onClick={() => onPilih(bagian.aksi, bagian)} data-testid={`ubah-buka-${bagian.kunci}`} className="max-sm:min-h-11">{bagian.label}</Button>
      ) : (
        <div className="fin-tg-ubah-kunci">
          <p className="fin-tg-ubah-alasan" data-testid={`ubah-alasan-${bagian.kunci}`}><Lock size={14} aria-hidden="true" /> <span>{bagian.alasan}</span></p>
          {(bagian.jalan || []).map((j) => (
            <button key={j.kunci} type="button" className="fin-tg-pendukung-tombol" onClick={() => onPilih(j.kunci, bagian)} data-testid={`ubah-jalan-${j.kunci}`}>{j.label} <ArrowRight size={14} aria-hidden="true" /></button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function UbahTagihan({ b, admin, bolehPost, onClose, onPilih }) {
  const k = kemampuanUbah(b, { admin, bolehPost });
  const sisa = tampilSisa(b);
  const alokasi = (b.allocations || []).filter((x) => !x.payment?.cancelledAt);
  const nomor = nomorFakturTampil(b);
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title="Ubah tagihan"
      description={`${nomor || "Nomor faktur belum diisi"} · ${b.supplier?.name || ""} · ${b.billNumber}`}
      className="fin-tg-modal fin-tg-ubah w-[680px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      <div className="space-y-3" data-testid="ubah-tagihan" data-mode={k.mode}>
        <dl className="fin-tg-ubah-ringkas">
          <div><dt>Status</dt><dd><ChipStatusTagihan status={b.status} tempo={statusTempo(b)} /></dd></div>
          <div><dt>Nilai</dt><dd>{formatUangTepat(b.amount)}</dd></div>
          <div><dt>Terbayar</dt><dd>{Number(b.terbayar) > 0 ? formatUangTepat(b.terbayar) : "—"}</dd></div>
          <div><dt>Sisa utang</dt><dd>{sisa.tampil ? formatUangTepat(sisa.nilai) : "—"}</dd></div>
        </dl>

        <p className="fin-tg-info" data-nada={k.mode === "NONAKTIF" ? "jingga" : "biru"} data-testid="ubah-pesan">{k.pesan}</p>

        {k.bayar && (
          <section className="fin-tg-ubah-bayar" data-testid="ubah-pembayaran-terkait">
            <h3><Banknote size={16} aria-hidden="true" /> Pembayaran terkait</h3>
            {alokasi.length === 0
              ? <p className="fin-tg-ubah-ket">Tidak ada alokasi pembayaran aktif yang tercatat pada tagihan ini.</p>
              : <ul className="fin-tg-r-bayar">{alokasi.map((x, i) => <li key={x.payment?.id || i}><span className="fin-tg-kode">{x.payment?.paymentNumber}</span><span className="fin-tg-r-bayar-tgl">{tgl(x.payment?.date)}</span><strong>{formatUangTepat(x.amount)}</strong></li>)}</ul>}
            <p className="fin-tg-ubah-ket">Mengubah tagihan tidak membatalkan, memindahkan, atau mengurangi pembayaran secara otomatis. Pembayaran hanya berubah lewat pembatalannya sendiri di Pembayaran.</p>
          </section>
        )}

        {k.bagian.map((x) => <Bagian key={x.kunci} bagian={x} onPilih={onPilih} />)}

        {k.mode === "NONAKTIF" && (
          <div className="fin-tg-ubah-kunci">
            {k.jalan.map((j) => <button key={j.kunci} type="button" className="fin-tg-pendukung-tombol" onClick={() => onPilih(j.kunci, j)} data-testid={`ubah-jalan-${j.kunci}`}>{j.kunci === "riwayat" && <History size={14} aria-hidden="true" />} {j.label}</button>)}
            {!k.jalan.some((j) => j.kunci === "riwayat") && <button type="button" className="fin-tg-pendukung-tombol" onClick={() => onPilih("riwayat")} data-testid="ubah-jalan-riwayat"><History size={14} aria-hidden="true" /> Lihat riwayat</button>}
          </div>
        )}

        {(k.terkunci || []).length > 0 && (
          <section className="fin-tg-ubah-terkunci" data-testid="ubah-terkunci">
            <h3><Lock size={14} aria-hidden="true" /> Tidak bisa diubah di sini</h3>
            <ul>{k.terkunci.map((t) => <li key={t.judul}><strong>{t.judul}</strong><span>{t.alasan}</span></li>)}</ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
