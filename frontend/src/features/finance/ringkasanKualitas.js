// Logika MURNI halaman Ringkasan Keuangan (tanpa React, tanpa perhitungan akuntansi baru): hanya menyusun ulang angka yang SUDAH dihitung backend
// menjadi (1) daftar "kualitas data" yang harus tampil di atas, (2) tiga jenis piutang yang tidak boleh tercampur, dan (3) aging piutang.
// Tidak menjumlahkan/menyimpulkan apa pun yang tidak ada di respons API.

export const LABEL_BANNER = "Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final.";
export const LABEL_REKONSILIASI = "Rekonsiliasi sementara tanpa rekening koran. Saldo akhir telah dikonfirmasi owner, tetapi mutasi individual belum seluruhnya diverifikasi.";

const angka = (v) => Number(v) || 0;

/**
 * Butir kualitas data (urutan = prioritas tampil). `jumlah` bisa null = datanya tidak tersedia (bukan nol): UI menampilkan "Tidak tersedia", bukan 0.
 * `belumFinal` benar bila ada satu saja butir bermasalah ATAU sumbernya tidak tersedia.
 */
export function hitungKualitasData({ antrean, catatan, backfill, riil }) {
  const lunas = antrean?.lunasBelumDicatat;
  const layak = backfill?.kelas?.find?.((k) => k.kelas === "LAYAK");
  const selisihRek = (riil?.rekening ?? []).filter((r) => r.status === "SELISIH");
  const butir = [
    {
      id: "pembayaran_belum_tercatat", label: "Pembayaran belum tercatat", jumlah: lunas ? angka(lunas.jumlah) : null, nilai: lunas ? angka(lunas.total) : null,
      hint: "Order berstatus lunas di CRM, tetapi belum ada catatan pembayaran & rekening (belum ada jurnal kas).", tujuan: "/finance/payments",
    },
    {
      id: "order_belum_diakui", label: "Order belum diakui", jumlah: layak ? angka(layak.jumlah) : null, nilai: layak ? angka(layak.nilai) : null,
      hint: "Order sudah selesai/diserahterimakan, tetapi pendapatannya belum dibukukan (backfill belum dijalankan).", tujuan: "/finance/pemasukan",
    },
    {
      id: "transaksi_belum_lengkap", label: "Transaksi belum lengkap", jumlah: catatan ? angka(catatan.gapTerbuka) : null, nilai: null,
      hint: "Transaksi tertahan karena data belum lengkap (mis. rekening belum dipetakan). Belum masuk buku besar.", tujuan: "/finance/settings",
    },
  ];
  if (riil) {
    if (selisihRek.length === 0) {
      butir.push({ id: "selisih_rekening", label: "Selisih rekonsiliasi rekening", jumlah: 0, nilai: 0, hint: "Saldo buku sama dengan saldo riil terkonfirmasi pada cutoff yang sama.", tujuan: "/finance/reconciliation", satuan: "rupiah" });
    } else {
      for (const r of selisihRek) {
        butir.push({
          id: `selisih_${r.id}`, label: `Selisih ${r.name.replace(/\s*-\s*Sano Bank/i, "").trim()}`, jumlah: Math.abs(angka(r.selisih)), nilai: angka(r.selisih), satuan: "rupiah",
          hint: `Saldo buku ${angka(r.selisih) > 0 ? "lebih tinggi" : "lebih rendah"} dari saldo riil terkonfirmasi (cutoff ${riil.cutoffLabel}). Menunggu rekening koran.`, tujuan: r.periodeId ? `/finance/reconciliation?periode=${r.periodeId}` : "/finance/reconciliation",
        });
      }
    }
  } else {
    butir.push({ id: "selisih_rekening", label: "Selisih rekonsiliasi rekening", jumlah: null, nilai: null, hint: "Data saldo riil tidak tersedia.", tujuan: "/finance/reconciliation", satuan: "rupiah" });
  }
  const bermasalah = (b) => b.jumlah === null || b.jumlah > 0;
  return { butir, belumFinal: butir.some(bermasalah), jumlahBermasalah: butir.filter((b) => b.jumlah !== null && b.jumlah > 0).length, tidakTersedia: butir.filter((b) => b.jumlah === null).map((b) => b.id) };
}

/** Margin hanya boleh tampil sebagai angka bila TIDAK ada indikasi pendapatan belum lengkap. */
export function margin(kualitas, lr) {
  const nilai = lr?.marginBersih;
  if (nilai === null || nilai === undefined) return { tampil: false, alasan: "Belum ada pendapatan pada periode ini" };
  const belumLengkap = kualitas.butir.filter((b) => (b.id === "order_belum_diakui" || b.id === "transaksi_belum_lengkap") && (b.jumlah === null || b.jumlah > 0));
  if (belumLengkap.length > 0) return { tampil: false, alasan: "Margin tidak ditampilkan — pendapatan belum lengkap" };
  return { tampil: true, nilai: Number(nilai) };
}

/**
 * Tiga jenis piutang yang berbeda (JANGAN dijumlahkan satu sama lain):
 *  - bukuBesar: saldo Piutang Usaha di buku besar (= tagihan operasional + order lunas di CRM yang menunggu verifikasi)
 *  - operasional: tagihan operasional (order diserahkan, belum lunas menurut CRM)
 *  - pembayaranBelumTercatat: uang yang KATANYA sudah diterima (lunas di CRM) tetapi belum ada catatan pembayaran/jurnal kas
 */
export function pisahkanPiutang(data) {
  const operasional = angka(data?.piutang?.total);
  const menungguVerifikasi = angka(data?.piutang?.menungguVerifikasi?.total);
  const l = data?.antrean?.lunasBelumDicatat;
  return {
    bukuBesar: operasional + menungguVerifikasi,
    operasional,
    menungguVerifikasi: { jumlah: angka(data?.piutang?.menungguVerifikasi?.jumlah), total: menungguVerifikasi },
    pembayaranBelumTercatat: { jumlah: l ? angka(l.jumlah) : null, total: l ? angka(l.total) : null },
    pembayaranBelumDiverifikasi: angka(data?.antrean?.jumlahPembayaranBelumVerifikasi),
  };
}

/** Aging: belum jatuh tempo, lewat jatuh tempo (jumlah + rincian), dan yang tertua. `teratas` sudah terurut dari umur terbesar (backend). */
export function ringkasAging(piutang) {
  const r = piutang?.ringkasan ?? {};
  const rincian = [
    { key: "1_30", label: "1–30 hari", nilai: angka(r["1_30"]) },
    { key: "31_60", label: "31–60 hari", nilai: angka(r["31_60"]) },
    { key: "61_90", label: "61–90 hari", nilai: angka(r["61_90"]) },
    { key: "90_plus", label: "Lebih dari 90 hari", nilai: angka(r["90_plus"]) },
  ];
  const lewat = rincian.reduce((s, x) => s + x.nilai, 0);
  const belum = angka(r.belum_jatuh_tempo);
  const baris = [...(piutang?.teratas ?? [])].sort((a, b) => angka(b.hariLewat) - angka(a.hariLewat));
  const tertua = baris.length && angka(baris[0].hariLewat) > 0 ? { hari: angka(baris[0].hariLewat), order: baris[0].orderNumber || null, sisa: angka(baris[0].sisaTagihan), dariTanggalOrder: baris[0].sumberJatuhTempo === "tanggal_order" } : null;
  const total = belum + lewat;
  const bagian = [{ key: "belum", label: "Belum jatuh tempo", nilai: belum }, ...rincian].map((x) => ({ ...x, persen: total > 0 ? Math.round((x.nilai / total) * 1000) / 10 : 0 }));
  return { belumJatuhTempo: belum, lewatJatuhTempo: lewat, rincian, tertua, total, bagian };
}
