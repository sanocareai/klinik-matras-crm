// Helper tes Export Excel Finance (B3.9): panggil endpoint ASLI, baca .xlsx hasilnya dengan exceljs.
import ExcelJS from "exceljs";

/** POST /api/finance/export/:modul → { status, headers, wb (ExcelJS.Workbook | null), json (bila galat) } */
export async function unduhExport(baseUrl, token, modul, body = {}) {
  const res = await fetch(`${baseUrl}/api/finance/export/${modul}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const tipe = res.headers.get("content-type") || "";
  if (!tipe.includes("spreadsheetml")) {
    let json = null; try { json = await res.json(); } catch { /* bukan JSON */ }
    return { status: res.status, headers: res.headers, wb: null, json };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return { status: res.status, headers: res.headers, wb, json: null };
}

const nilai = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) && "text" in c.value ? c.value.text : c.value);

/**
 * Sheet → { kepala:[A1..A4], header:[...], baris:[{header: nilai}], total: {header: nilai}|null }.
 * Kepala = baris 1-4, header = baris 6, data mulai baris 7; baris yang kolom pertamanya diawali "TOTAL" dianggap baris total.
 */
export function bacaSheet(wb, nama) {
  const ws = wb.getWorksheet(nama);
  if (!ws) throw new Error(`Sheet "${nama}" tidak ada. Sheet tersedia: ${wb.worksheets.map((w) => w.name).join(", ")}`);
  const header = [];
  ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = nilai(c); });
  const baris = [];
  let total = null;
  for (let r = 7; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.actualCellCount === 0) continue;
    const obj = {};
    header.forEach((h, i) => { obj[h] = nilai(row.getCell(i + 1)) ?? null; });
    const pertama = obj[header[0]];
    if (typeof pertama === "string" && /^TOTAL/i.test(pertama)) { total = obj; break; }
    baris.push(obj);
  }
  return { kepala: [1, 2, 3, 4].map((i) => ws.getCell(`A${i}`).value), header, baris, total };
}
