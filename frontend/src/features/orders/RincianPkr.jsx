import React from "react";
import { ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import SumberPkr from "@/features/orders/SumberPkr.jsx";

// Rincian order Penjualan Karyawan di drawer CRM: Customer & Kontak, Alamat & Maps (tautan dapat diklik), Keluhan & Catatan, sumber PKR. Semua dari identitas kanonis server
// (pkrIdentitas) — tidak ada label yang dibentuk sendiri di sini. Tanpa nominal; status pembayaran hanya bila server mengirimnya.
const Baris = ({ label, children }) => (children === null || children === undefined || children === "" ? null : (
  <div className="grid grid-cols-[110px_1fr] gap-2 border-b border-line px-2.5 py-1.5 text-[12.5px] last:border-0">
    <dt className="text-ink3">{label}</dt>
    <dd className="m-0 min-w-0 whitespace-pre-wrap break-words text-ink">{children}</dd>
  </div>
));
const Seksi = ({ judul, children, testid }) => (
  <section className="rounded-xl bg-surface p-2.5 shadow-card" aria-label={judul} data-testid={testid}>
    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink3">{judul}</p>
    <dl className="m-0 rounded-btn border border-line">{children}</dl>
  </section>
);

export default function RincianPkr({ pkr, onEdit = null, bolehEdit = false }) {
  const id = pkr?.identitas;
  if (!id) return null;
  const a = id.alamat || {};
  const c = id.catatan || {};
  const alamat = [a.teks, a.kota].filter(Boolean).join(", ");
  const waktu = [id.waktu?.pickup && `Pickup: ${id.waktu.pickup}`, id.waktu?.kirim && `Kirim: ${id.waktu.kirim}`].filter(Boolean).join(" · ");
  return (
    <div className="mt-3 space-y-2.5" data-testid="rincian-pkr">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SumberPkr pkr={pkr} />
        {bolehEdit && onEdit && (
          <Button size="sm" variant="neutral" onClick={onEdit} data-testid="edit-customer-pkr" className="max-sm:min-h-11">
            <Pencil size={13} aria-hidden="true" /> {id.legacy ? "Lengkapi Data Customer" : "Edit Data Customer"}
          </Button>
        )}
      </div>
      <Seksi judul="Customer & kontak" testid="seksi-customer">
        <Baris label="Customer/pembeli">{id.customer?.nama}{id.legacy ? <Badge variant="orange" className="ml-1.5">Data customer belum lengkap</Badge> : null}</Baris>
        <Baris label="Nomor WhatsApp">{id.legacy ? "Belum diisi" : id.customer?.telepon}</Baris>
        <Baris label="Karyawan penjual">{id.karyawanPenjual?.nama ? `${id.karyawanPenjual.nama} (sumber transaksi)` : null}</Baris>
        <Baris label="Penerima">{id.penerima?.berbeda ? `${id.penerima.nama ?? "—"}${id.penerima.telepon ? ` · ${id.penerima.telepon}` : ""}` : id.legacy ? null : "Sama dengan pembeli"}</Baris>
      </Seksi>
      <Seksi judul="Alamat & Maps" testid="seksi-alamat">
        <Baris label="Alamat">{alamat || null}</Baris>
        <Baris label="Patokan">{a.patokan}</Baris>
        <Baris label="Google Maps">{a.lokasiUrl ? (
          <a href={a.lokasiUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-accent underline" data-testid="link-maps">
            Buka lokasi <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : null}</Baris>
        <Baris label="Waktu disarankan">{waktu || null}</Baris>
      </Seksi>
      {(c.keluhan || c.order || c.produksi || c.delivery) && (
        <Seksi judul="Keluhan & catatan" testid="seksi-keluhan">
          <Baris label="Keluhan">{c.keluhan}</Baris>
          <Baris label="Catatan umum">{c.order}</Baris>
          <Baris label="Catatan Produksi">{c.produksi}</Baris>
          <Baris label="Catatan Delivery">{c.delivery}</Baris>
        </Seksi>
      )}
    </div>
  );
}
