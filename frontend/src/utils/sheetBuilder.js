// Pembangun sheet XLSX murni (tanpa dependensi DOM/alias) — dipakai exportLaporan.js dan dapat diuji di Node.
import * as XLSX from "xlsx";

export const FMT = {
  rp:    '"Rp"#,##0',
  int:   "#,##0",
  pct:   '0.0"%"',
  pct0:  '0"%"',
  menit: '#,##0" mnt"',
};

// Angka yang boleh kosong. `null` ditulis sebagai "—" (teks) supaya beda jelas
// dari 0 — "belum ada datanya" dan "nol" adalah dua hal berbeda di laporan.
export function num(v, z = FMT.int) {
  return v == null || Number.isNaN(v) ? "—" : { v: Number(v), z };
}
export const rp  = (v) => num(v, FMT.rp);
export const pct = (v) => num(v, FMT.pct);

export class SheetBuilder {
  constructor() { this.aoa = []; this.fmts = []; }

  // cells: nilai biasa, atau { v, z } untuk nilai + number format.
  row(cells = []) {
    const r = this.aoa.length;
    const out = cells.map((c, i) => {
      if (c && typeof c === "object" && "v" in c) {
        if (c.z) this.fmts.push({ r, c: i, z: c.z });
        return c.v;
      }
      return c;
    });
    this.aoa.push(out);
    return this;
  }

  blank() { return this.row([]); }
  rows(list) { list.forEach((r) => this.row(r)); return this; }

  build(widths) {
    const ws = XLSX.utils.aoa_to_sheet(this.aoa);
    for (const f of this.fmts) {
      const addr = XLSX.utils.encode_cell({ r: f.r, c: f.c });
      if (ws[addr]) ws[addr].z = f.z;
    }
    if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
    return ws;
  }
}

export function judul(sb, teks, periode) {
  sb.row([teks]);
  sb.row([`Periode: ${periode}`]);
  sb.row([`Dibuat: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`]);
  sb.row(["Zona waktu: WIB (UTC+7). Basis tanggal tiap angka: lihat sheet \"Definisi Angka\"."]);
  sb.blank();
  return sb;
}
