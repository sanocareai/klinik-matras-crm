import React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";

// Pratinjau SERVER sebelum "Catat Penjualan" / "Buat Order CRM": apa yang AKAN dibuat (order, item, unit, job pickup, job pengiriman) dan yang TIDAK dibuat (uang). Tanpa nominal.
// `data` = respons POST /finance/penjualan-karyawan/order-crm/pratinjau.
export function PratinjauOrderPkr({ data, className = "" }) {
  if (!data) return null;
  if (!data.valid) {
    return (
      <div role="alert" className={`flex items-start gap-2 rounded-lg bg-redbg px-3 py-2.5 text-[12.5px] text-red ${className}`} data-testid="pratinjau-galat">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{data.galat?.pesan || "Isian belum valid"}</span>
      </div>
    );
  }
  const d = data;
  return (
    <div className={`space-y-3 ${className}`} data-testid="pratinjau-order">
      {d.sudahAdaOrder && (
        <p role="status" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="pratinjau-sudah-ada">
          Penjualan ini sudah punya order {d.sudahAdaOrder.nomor}. Tidak ada order baru yang dibuat; gunakan “Lengkapi spesifikasi” untuk mengubah.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="pratinjau-ringkas">
        {[["Item", d.order.jumlahItem], ["Unit produksi", d.order.jumlahUnit], ["Job pickup", d.pickup.adaJob ? "1" : "0"], ["Job pengiriman", d.delivery.adaJobPengiriman ? "1" : "0"]].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-inset px-3 py-2"><p className="m-0 text-[11px] text-ink3">{l}</p><p className="m-0 text-[15px] font-semibold tabular-nums text-ink">{v}</p></div>
        ))}
      </div>

      <ul className="m-0 list-none space-y-2 p-0" data-testid="pratinjau-item">
        {d.items.map((i) => (
          <li key={i.no} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Item {i.no}</span>
              <span className="text-ink2">{i.kategoriNama}{i.produk ? ` · ${i.produk}` : ""}</span>
              <Badge variant="neutral">× {i.jumlah}</Badge>
              <Badge variant={i.perluDikirim === true ? "accent" : "neutral"}>{i.kirimLabel}</Badge>
            </div>
            <p className="m-0 mt-1 text-ink2">{i.ukuran || "Ukuran belum diisi"}{i.spesifikasi ? ` — ${i.spesifikasi}` : ""}</p>
            <p className="m-0 mt-1 text-[12px] text-ink3">Unit {i.unit.nomorUnit.join(", ")}: {i.unit.statusAwalLabel}{i.layananProduksiOtomatis ? " · layanan produksi ditetapkan dari katalog" : ""}</p>
            {i.kurang.length > 0 && <p className="m-0 mt-1 text-[12px] text-orange" data-testid="pratinjau-kurang">Belum diisi: {i.kurang.join(", ")}</p>}
          </li>
        ))}
      </ul>

      <div className={`rounded-lg px-3 py-2 text-[12.5px] ${d.produksi.lengkap ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`} data-testid="pratinjau-produksi">
        <strong>{d.produksi.status}.</strong>{" "}
        {d.produksi.lengkap ? "Semua data item dan pilihan kirim sudah terisi." : `Data yang kurang: ${d.produksi.kurang.join("; ")}. Order tetap dibuat; lengkapi lewat “Lengkapi spesifikasi order”.`}
      </div>

      {d.delivery.catatan && <p className="m-0 text-[12px] text-ink3" data-testid="pratinjau-delivery">{d.delivery.catatan}{d.delivery.itemDiambilSendiri.length ? ` Item ${d.delivery.itemDiambilSendiri.join(", ")} diambil sendiri (tanpa pengiriman).` : ""}</p>}

      {d.peringatan.map((w) => (
        <p key={w.kode} role="status" className="m-0 flex items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="pratinjau-peringatan">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{w.pesan}</span>
        </p>
      ))}

      <div className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="pratinjau-tidak-dibuat">
        <p className="m-0 mb-1 flex items-center gap-1.5 font-semibold text-ink"><CheckCircle2 size={13} /> Tidak dibuat oleh order ini</p>
        <p className="m-0">{d.tidakDibuat.join(" · ")}. Nominal, pembayaran, piutang, dan jurnal tetap hanya di Penjualan Karyawan.</p>
      </div>
    </div>
  );
}
