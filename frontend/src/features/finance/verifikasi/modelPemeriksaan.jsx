import React, { useEffect, useState } from "react";
import { api } from "@/api.js";
import { formatUang, tanggalJam, tanggalPendek } from "@/features/finance/shared.jsx";
import { STATUS_KLAIM_LABEL } from "@/features/klaim/klaimLunasLogic.js";
import {
  LABEL_CARA_BAYAR, LABEL_JENIS, alasanBatal, daftarBukti, statusPembayaran, teksGerbang, tidakDihitung,
} from "./verifikasiLogic.js";

// MODEL PANEL PEMERIKSAAN — menyusun isi panel dari data yang SUDAH dimuat daftar. Tidak ada rumus baru dan tidak ada klaim kecocokan bank:
// panel hanya mempertemukan data pembayaran/klaim dengan bukti yang diunggah supaya Finance bisa memeriksa dengan mata.

const WARNA_VERSI = { AKTIF: "green", DIGANTI: "orange", DIBATALKAN: "red" };
const LABEL_VERSI = { AKTIF: "Aktif", DIGANTI: "Diganti", DIBATALKAN: "Dibatalkan" };

/** Versi pembayaran (pengganti/asal) — dimuat otomatis hanya untuk pembayaran yang punya rantai versi; selain itu tersedia lewat tombol Riwayat. */
export function RiwayatVersi({ p, onRiwayatLengkap }) {
  const berantai = !!(p.cancelledAt || p.replacedBy || p.replacesPaymentId);
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  const [ulang, setUlang] = useState(0);
  useEffect(() => {
    if (!berantai) return undefined;
    let batal = false;
    setData(null); setGalat("");
    api.getRiwayatPembayaran(p.id).then((d) => { if (!batal) setData(d); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat riwayat"); });
    return () => { batal = true; };
  }, [p.id, berantai, ulang]);

  return (
    <section className="fin-vp-bagian" data-testid="panel-riwayat">
      <h3>Riwayat dan pembayaran pengganti</h3>
      {!berantai && <p className="fin-vp-redup">Belum ada koreksi atau pembatalan untuk pembayaran ini.</p>}
      {berantai && !data && !galat && <p className="fin-vp-redup" role="status">Memuat riwayat…</p>}
      {galat && <p className="fin-vp-galat" role="alert">{galat} <button type="button" className="fin-vp-kecil" onClick={() => setUlang((n) => n + 1)}>Coba lagi</button></p>}
      {data && (
        <ul className="fin-vp-versi">
          {data.versi.map((v) => (
            <li key={v.id} data-aktif={v.id === p.id ? "1" : "0"}>
              <div className="fin-vp-versi-atas">
                <span>Versi {v.nomorVersi} · <strong>{formatUang(v.nominal)}</strong>{v.id === p.id ? " (ini)" : ""}</span>
                <span className={`fin-chip fin-chip-${WARNA_VERSI[v.status] ?? "neutral"}`}>{LABEL_VERSI[v.status] ?? v.status}{v.terbaru && v.status === "AKTIF" ? " (terbaru)" : ""}</span>
              </div>
              <p className="fin-vp-redup">{tanggalPendek(v.tanggal)} · {LABEL_CARA_BAYAR[v.metode] || v.metode} · {v.rekening || "rekening standar"}</p>
              {v.alasanBatal && <p className="fin-vp-teks">Alasan: {v.alasanBatal}</p>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="fin-vp-kecil" onClick={onRiwayatLengkap}>Buka riwayat perubahan lengkap</button>
    </section>
  );
}

function barisIdentitasPembayaran(p) {
  const bagi = (p.finAllocations ?? []).map((a) => `${a.order?.orderNumber || "—"}: ${formatUang(a.amount)}`).join("; ");
  const v = p.verifications?.[0];
  return [
    { judul: "Pelanggan dan order", baris: [
      ["Pelanggan", p.order?.customer?.name], ["Order", p.order?.orderNumber], ["Jenis", p.jenisPembayaran ? LABEL_JENIS[p.jenisPembayaran] : null],
      ["Dibagi ke order", bagi || null], ["Dicatat oleh", p.recordedBy?.name],
    ] },
    { judul: "Pembayaran", baris: [
      ["Cara bayar", LABEL_CARA_BAYAR[p.method] || p.method], ["Nomor referensi", p.referenceNumber],
      ["Diverifikasi oleh", v ? `${v.verifiedBy?.name || "—"} · ${tanggalJam(v.createdAt)}` : null],
      ["Keterangan internal", p.internalNote],
    ] },
  ];
}

/** Pembayaran tercatat (customer-payments). `ctx`: { gate, cutoff, aksi, onRiwayatLengkap } */
export function modelPembayaran(p, ctx) {
  const st = statusPembayaran(p);
  const batal = alasanBatal(p);
  const bisaVerifikasi = !p.cancelledAt && !p.terverifikasi;
  const lama = !!ctx.cutoff && tglWIB(p.createdAt) < ctx.cutoff;
  return {
    jenisLabel: "Pembayaran tercatat",
    judul: p.order?.orderNumber || "Pembayaran", subjudul: p.order?.customer?.name || null,
    status: { label: st.label, nada: st.nada }, tidakDihitung: tidakDihitung(p),
    ringkas: [
      ["Nominal", formatUang(p.amount), tidakDihitung(p) ? "Nominal asli tetap tercatat; tidak masuk total" : null],
      ["Tanggal diterima", tanggalJam(p.createdAt)],
      ["Rekening tujuan", p.cashAccount?.name || "Belum dipilih", p.cashAccount ? null : "Memakai rekening standar cara bayar"],
    ],
    alasanBatal: batal ? {
      judul: st.kode === "DIGANTI" ? "Diganti versi baru" : "Alasan dibatalkan", alasan: batal.alasan, oleh: batal.oleh ? `Oleh ${batal.oleh}` : null,
      pada: batal.pada ? tanggalJam(batal.pada) : null, catatanNilai: `Nominal asli ${formatUang(p.amount)} tetap tercatat, tetapi tidak masuk total.`,
    } : null,
    bagian: barisIdentitasPembayaran(p),
    bukti: { items: daftarBukti(p).map((url, i) => ({ url, nama: `Bukti pembayaran ${i + 1}` })), kosong: bisaVerifikasi ? "Belum ada bukti pembayaran. Minta Sales atau driver melampirkannya sebelum diverifikasi." : "Tidak ada bukti yang diunggah untuk pembayaran ini." },
    catatan: p.notes || null,
    versi: <RiwayatVersi p={p} onRiwayatLengkap={ctx.onRiwayatLengkap} />,
    dampakJudul: "Bila diverifikasi",
    dampak: bisaVerifikasi ? [
      lama
        ? `Uang ini diterima sebelum saldo awal (${ctx.cutoff}), jadi sudah tercakup di saldo bank dan tidak menambah saldo.`
        : "Pembayaran masuk ke buku besar (kalau belum) pada rekening tujuan. Rekening dan cara bayar hanya bisa diubah selama belum masuk buku.",
      teksGerbang(ctx.gate),
      "Setelah terverifikasi, perubahan hanya lewat Koreksi Pembayaran (membalik jurnal, perlu PIN) — pembayaran tidak dihapus.",
    ] : [],
    aksi: ctx.aksi,
  };
}

const tglWIB = (t) => new Date(new Date(t).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** Klaim pembayaran dari Sales (OrderPaymentClaim). `ctx`: { aksi } */
export function modelKlaim(k, ctx) {
  const label = STATUS_KLAIM_LABEL[k.status] || k.status;
  return {
    jenisLabel: "Klaim pembayaran dari Sales",
    judul: k.order?.orderNumber || "Klaim", subjudul: k.order?.customerName || null,
    status: { label, nada: k.status === "SUBMITTED" ? "orange" : "neutral" }, tidakDihitung: false,
    ringkas: [
      ["Nominal klaim", formatUang(k.amount), `Sisa tagihan order ${formatUang(k.order?.sisa)}`],
      ["Tanggal bayar (klaim)", k.paymentDate ? tanggalPendek(k.paymentDate) : "—"],
      ["Rekening tujuan (klaim)", k.cashAccount?.name || "Belum dipilih Sales", "Diisi Sales; belum diperiksa Finance"],
    ],
    alasanBatal: null,
    bagian: [
      { judul: "Pelanggan dan order", baris: [
        ["Pelanggan", k.order?.customerName], ["Order", k.order?.orderNumber], ["Diajukan oleh", k.createdByName],
        ["Diajukan pada", k.submittedAt ? tanggalJam(k.submittedAt) : null], ["Cara bayar", LABEL_CARA_BAYAR[k.method] || k.method],
        ["Tagihan order", k.order?.tagihan != null ? formatUang(k.order.tagihan) : null], ["Sudah terbayar", k.order?.dibayar != null ? formatUang(k.order.dibayar) : null],
      ] },
      ...((k.peringatan ?? []).length ? [{ judul: "Peringatan", baris: k.peringatan.map((p) => [p.kode, p.pesan]) }] : []),
      ...(k.reviewReason ? [{ judul: "Pemeriksaan Finance", baris: [["Alasan", k.reviewReason]] }] : []),
    ],
    bukti: { items: (k.bukti ?? []).map((b) => ({ url: b.url, mime: b.mime, nama: b.nama })), kosong: "Klaim ini belum punya bukti pembayaran." },
    catatan: k.note || null,
    versi: null,
    dampakJudul: "Bila diverifikasi",
    dampak: k.status === "SUBMITTED" ? [
      "Membuat satu pembayaran resmi dari klaim ini, memakai bukti klaim sebagai bukti pembayaran.",
      "Status order dihitung ulang dari ledger: Lunas hanya bila pembayaran terverifikasi mencapai tagihan.",
      "Tanggal sebelum saldo awal tidak menambah saldo rekening — server mengalihkannya otomatis.",
    ] : [],
    aksi: ctx.aksi,
  };
}

/** Order ditandai lunas oleh Sales tanpa catatan pembayaran (klaim lama). `ctx`: { aksi, tgl } */
export function modelKlaimLama(i, ctx) {
  return {
    jenisLabel: "Order ditandai lunas oleh Sales",
    judul: i.orderNumber || "Order", subjudul: i.customerName || null,
    status: { label: i.kelompok === "BARU" ? "Perlu dicek" : `Sebelum ${ctx.tgl}`, nada: i.kelompok === "BARU" ? "orange" : "neutral" }, tidakDihitung: false,
    ringkas: [
      ["Perlu dicek", formatUang(i.sisa), `Nilai order ${formatUang(i.nilaiOrder)}`],
      ["Ditandai lunas", i.lunasSejak ? tanggalPendek(i.lunasSejak) : "Tanggal tidak diketahui"],
      ["Rekening tujuan", "Belum ada", "Belum ada catatan pembayaran"],
    ],
    alasanBatal: null,
    bagian: [
      { judul: "Pelanggan dan order", baris: [["Pelanggan", i.customerName], ["Order", i.orderNumber], ["Sales", i.salesName]] },
      ...(i.buktiDiminta ? [{ judul: "Permintaan bukti", baris: [["Diminta pada", tanggalPendek(String(i.buktiDiminta.pada).slice(0, 10))], ["Catatan", i.buktiDiminta.catatan]] }] : []),
    ],
    bukti: { items: [], kosong: "Belum ada bukti pembayaran. Status Lunas ini hanya penanda di CRM sampai Finance memeriksa uangnya." },
    catatan: null,
    versi: null,
    dampakJudul: "Bila diverifikasi",
    dampak: [
      "Sistem membuat catatan pembayaran, verifikasi, dan jurnalnya sekaligus pada rekening yang Anda pilih.",
      i.kelompok === "LAMA"
        ? `Order ini ditandai lunas sebelum ${ctx.tgl}: uangnya sudah ada di saldo bank awal, jadi saldo rekening tidak ditambah lagi.`
        : "Uang yang masuk lebih kecil dari nilai order? Ubah nominalnya di langkah berikut; sisanya tetap menunggu dicek.",
    ],
    aksi: ctx.aksi,
  };
}
