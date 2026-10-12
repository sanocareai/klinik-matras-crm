import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Uang, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { LABEL_STATUS_BAYAR } from "@/features/finance/piutangLogic.js";

// Spec drawer detail satu order piutang (dipakai PanelDetail). Angka tagihan = baris daftar yang SAMA (server); invoice, pembayaran, jurnal, riwayat dari
// GET /finance/reports/receivables/order/:orderId. Tidak menghitung ulang apa pun; hanya menampilkan dan menyediakan tautan ke tindakan yang sudah ada.
const SUMBER_JURNAL = {
  PENGAKUAN_PENDAPATAN: "Pengakuan pendapatan", PEMBAYARAN_DITERIMA: "Pembayaran diterima", REVERSAL: "Jurnal balik", REFUND: "Refund",
};
const labelSumber = (s) => SUMBER_JURNAL[s] || String(s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const METODE = { TUNAI: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS", KARTU: "Kartu", DEBIT: "Kartu debit", KREDIT: "Kartu kredit" };

function Daftar({ items, kosong }) {
  if (!items.length) return <span className="text-ink3">{kosong}</span>;
  return <ul className="m-0 list-none space-y-1.5 p-0">{items}</ul>;
}

/**
 * @param row     baris piutang dari daftar (server)
 * @param detail  respons detail order (atau null selagi dimuat)
 * @param opsi    { memuat, galat, onBukaVerifikasi, onBukaInvoice, onCobaLagi }
 */
export function specDetailPiutang(row, detail, { memuat = false, galat = "", onBukaVerifikasi, onBukaInvoice, onCobaLagi } = {}) {
  const t = detail?.tagihan ?? row;
  const statusBayar = row.statusBayar ? <Badge variant={row.statusBayar === "DIBAYAR_SEBAGIAN" ? "accent" : "neutral"}>{LABEL_STATUS_BAYAR[row.statusBayar] || row.statusBayar}</Badge> : null;
  const bagian = [
    {
      judul: "Tagihan",
      baris: [
        ["Pelanggan", row.customerName],
        ["Sales", row.salesName],
        ["Tanggal order", row.tanggalOrder ? tanggalPendek(row.tanggalOrder) : null],
        ["Jatuh tempo", row.dueDate ? `${tanggalPendek(row.dueDate)} (${row.sumberJatuhTempo === "invoice" ? "invoice" : "tanggal order"})` : "—"],
        ["Umur", row.hariLewat > 0 ? `${row.hariLewat} hari lewat jatuh tempo` : row.hariLewat === 0 ? "jatuh tempo hari ini" : `jatuh tempo ${Math.abs(row.hariLewat)} hari lagi`],
      ],
    },
  ];
  if (galat) {
    bagian.push({ judul: "Rincian", baris: [["Status", <span className="text-red">{galat} <Button size="sm" variant="neutral" onClick={onCobaLagi}>Coba lagi</Button></span>]] });
  } else if (memuat || !detail) {
    bagian.push({ judul: "Rincian", baris: [["Status", <span className="text-ink3" role="status">Memuat invoice, pembayaran, jurnal, dan riwayat…</span>]] });
  } else {
    bagian.push({
      judul: "Invoice",
      baris: detail.invoice
        ? [["Nomor", <span className="font-mono">{detail.invoice.nomor}</span>], ["Jatuh tempo", detail.invoice.jatuhTempo ? tanggalPendek(detail.invoice.jatuhTempo) : "—"], ["Tahap", detail.invoice.tahap]]
        : [["Invoice", "Belum ada invoice untuk order ini"]],
    });
    bagian.push({
      judul: `Pembayaran (${detail.pembayaran.length})`,
      baris: [["", (
        <Daftar
          kosong="Belum ada pembayaran tercatat."
          items={detail.pembayaran.map((p) => (
            <li key={p.id} className={`rounded-lg border border-line px-2.5 py-1.5 ${p.dibatalkan ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`font-semibold tabular-nums ${p.dibatalkan ? "line-through" : ""}`}>{formatUang(p.jumlah)}</span>
                <span className="flex gap-1">
                  {p.dibatalkan ? <Badge variant="neutral">Dibatalkan</Badge> : p.terverifikasi ? <Badge variant="green">Terverifikasi</Badge> : <Badge variant="orange">Belum diverifikasi</Badge>}
                </span>
              </div>
              <p className="m-0 mt-0.5 text-[12px] text-ink3">
                {[tanggalPendek(p.tanggal), METODE[p.metode] || p.metode, p.rekening, p.dicatatOleh && `oleh ${p.dicatatOleh}`, p.dibatalkan && p.alasanBatal && `batal: ${p.alasanBatal}`].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        />
      )]],
    });
    bagian.push({
      judul: `Jurnal Piutang Usaha (${detail.jurnal.length}${detail.terpotong?.jurnal ? "+" : ""})`,
      baris: [["", (
        <Daftar
          kosong="Belum ada jurnal piutang untuk order ini."
          items={detail.jurnal.map((j, i) => (
            <li key={`${j.nomor}-${i}`} className="rounded-lg border border-line px-2.5 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[12px]">{j.nomor}</span>
                <span className="tabular-nums">{j.debit > 0 ? <span>Dr {formatUang(j.debit)}</span> : <span>Cr {formatUang(j.kredit)}</span>}</span>
              </div>
              <p className="m-0 mt-0.5 text-[12px] text-ink3">{[tanggalPendek(j.tanggal), labelSumber(j.sumber), j.status === "REVERSED" && "dibalik"].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        />
      )]],
    });
    bagian.push({
      judul: `Riwayat (${detail.riwayat.length}${detail.terpotong?.riwayat ? "+" : ""})`,
      baris: [["", (
        <Daftar
          kosong="Belum ada riwayat aktivitas."
          items={detail.riwayat.map((e, i) => (
            <li key={`${e.kejadian}-${i}`} className="text-[12.5px]"><span className="text-ink3">{tanggalPendek(e.waktu)} · </span>{e.kalimat}</li>
          ))}
        />
      )]],
    });
  }
  return {
    judul: row.orderNumber || "Order",
    subjudul: `${row.customerName}${row.invoiceNumber ? ` · ${row.invoiceNumber}` : ""}`,
    badge: statusBayar,
    ringkas: [
      ["Total tagihan", formatUang(t.tagihanDiakui ?? row.tagihanDiakui ?? row.nilaiOrder)],
      ["Sudah dibayar", formatUang(t.sudahDilunasi ?? row.sudahDilunasi ?? 0), "hijau"],
      ["Sisa tagihan", formatUang(row.sisaTagihan), "merah"],
      ["Nilai order (CRM)", formatUang(row.nilaiOrder)],
    ],
    bagian,
    catatan: "Angka tagihan dihitung dari saldo akun Piutang Usaha per order di buku besar (sama dengan daftar). Tindakan koreksi dilakukan di halaman asalnya.",
    aksi: (
      <>
        {onBukaInvoice && <Button size="sm" variant="neutral" onClick={onBukaInvoice}>Buka Invoice</Button>}
        {onBukaVerifikasi && <Button size="sm" variant="neutral" onClick={onBukaVerifikasi}>Buka Verifikasi Pembayaran</Button>}
      </>
    ),
  };
}

export { Uang };
