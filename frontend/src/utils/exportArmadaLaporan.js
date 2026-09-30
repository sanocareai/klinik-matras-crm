import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { SheetBuilder, judul, num, rp } from "./exportLaporan.js";

// Export "Performa & Insentif Driver" (Laporan Delivery, 30 September 2026) — dipisah dari
// exportLaporan.js karena bidangnya beda (Armada/Delivery, bukan Laporan Analitik CRM utama), tapi
// memakai SheetBuilder/num/rp yang SAMA (angka Excel asli, bukan teks formatRupiah — lihat catatan
// panjang di exportLaporan.js kenapa itu penting untuk dijumlah/pivot pembaca laporan).

function sheetProduktivitas({ periode, driverProductivity }) {
  const sb = new SheetBuilder();
  judul(sb, "PRODUKTIVITAS DRIVER — Job Selesai", periode);
  sb.row(["Driver", "Job Selesai"]);
  driverProductivity.forEach((d) => sb.row([d.name, num(d.completed)]));
  return sb.build([28, 14]);
}

function sheetInsentif({ periode, insentif }) {
  const sb = new SheetBuilder();
  judul(sb, "ESTIMASI INSENTIF DRIVER & HELPER", periode);
  sb.row([
    `Rp${insentif.ratePerAlamat.withSim.toLocaleString("id-ID")}/alamat (punya SIM) · `
    + `Rp${insentif.ratePerAlamat.withoutSim.toLocaleString("id-ID")}/alamat (tidak punya SIM)`,
  ]);
  sb.row(["Estimasi — bisa berubah kalau ada koreksi POD/status SIM, bukan status sudah/akan dibayar."]);
  sb.blank();
  sb.row(["Nama", "Punya SIM", "Sebagai Driver", "Sebagai Helper", "Total Alamat", "Estimasi Insentif"]);
  insentif.orang.forEach((o) => sb.row([
    o.name, o.hasSim ? "Ya" : "Tidak", num(o.asDriver), num(o.asHelper), num(o.totalAlamat), rp(o.totalInsentif),
  ]));
  return sb.build([24, 12, 14, 14, 12, 18]);
}

/**
 * `driverProductivity`: array {name, completed} dari GET /armada/delivery-report.
 * `insentif`: respons GET /armada/incentive-summary ({ ratePerAlamat, orang }).
 * Sheet dengan data kosong DILEWATI (bukan bikin sheet kosong); kalau keduanya kosong, dilempar Error
 * supaya tombol Export bisa menampilkan pesan alih-alih diam-diam mengunduh file kosong.
 */
export function exportPerformaInsentifDriver({ periode, namaFile, driverProductivity, insentif }) {
  const wb = XLSX.utils.book_new();
  let ada = 0;
  if (driverProductivity?.length) {
    XLSX.utils.book_append_sheet(wb, sheetProduktivitas({ periode, driverProductivity }), "Produktivitas");
    ada++;
  }
  if (insentif?.orang?.length) {
    XLSX.utils.book_append_sheet(wb, sheetInsentif({ periode, insentif }), "Insentif");
    ada++;
  }
  if (ada === 0) throw new Error("Belum ada data performa/insentif driver pada periode ini.");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${namaFile}.xlsx`,
  );
}
