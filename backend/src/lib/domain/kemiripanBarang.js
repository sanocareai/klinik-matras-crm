// KEMIRIPAN BARANG untuk SKU baru dari Purchase Order — logika MURNI (tanpa DB), diuji tanpa server.
// Tujuan: membedakan tiga hal yang sebelumnya dicampur oleh kemiripan kata (Jaccard) saja:
//   SAMA     — barang yang benar-benar sama setelah normalisasi ejaan, spasi, huruf besar/kecil, tanda ×/x/*, satuan ukuran (cm/mm/m), urutan kata, dan kata satuan (lembar/sheet/pcs…).
//   BERBEDA  — varian yang JELAS berbeda: ukuran, ketebalan, grade/density, angka spesifikasi, atau merek/jenis berbeda pada kedua sisi. Hanya informasi; TIDAK memaksa konfirmasi/alasan.
//   AMBIGU   — mirip tetapi tidak bisa dipastikan (atribut tertulis di satu sisi saja, ejaan hampir sama, urutan ukuran terbalik, kata tambahan): perlu keputusan pengguna.
// Aturan yang dijaga: tidak ada angka/atribut yang "ditebak"; atribut yang tidak tertulis di salah satu sisi = tidak pasti (AMBIGU), bukan "berbeda" dan bukan "sama".

const KATA_SATUAN = new Set(["lembar", "lbr", "sheet", "pcs", "pc", "buah", "biji", "roll", "rol", "meter", "mtr", "kg", "kilo", "liter", "ltr", "box", "pack", "pak"]);
const EPS = 1e-6;

function dasar(teks) {
  return String(teks ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2").replace(/[×✕*]/g, "x");
}
const angkaCm = (n, satuan) => (satuan === "mm" ? n / 10 : satuan === "m" ? n * 100 : n);
const bulat = (n) => Math.round(n * 10000) / 10000;

/** Atribut terstruktur dari nama (dan spesifikasi sebagai cadangan untuk ukuran/grade yang tidak tertulis di nama). */
export function bacaAtribut(nama, spesifikasi = null) {
  const dariTeks = (teks) => {
    let s = dasar(teks); let dimensi = null; const grade = new Set();
    s = s.replace(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?\s*(mm|cm|m)?(?![a-z0-9])/, (_, a, b, c, u) => {
      dimensi = [angkaCm(Number(a), u), angkaCm(Number(b), u), ...(c !== undefined ? [angkaCm(Number(c), u)] : [])].map(bulat); return " ";
    });
    s = s.replace(/\b(?:density|dens|dnsty)\s*(\d{2,3})\b/g, (_, n) => { grade.add(`D${n}`); return " "; })
      .replace(/\b([dr])\s?-?\s?(\d{2,3})\b/g, (_, h, n) => { grade.add(`${h.toUpperCase()}${n}`); return " "; })
      .replace(/\b(\d{2,3})\s?ss\b/g, (_, n) => { grade.add(`SS${n}`); return " "; });
    const tokens = s.replace(/(\d)([a-z])/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((t) => t && !KATA_SATUAN.has(t) && (t.length > 1 || /\d/.test(t)));
    return { dimensi, grade, inti: new Set(tokens.filter((t) => !/\d/.test(t))), angka: new Set(tokens.filter((t) => /\d/.test(t))) };
  };
  const a = dariTeks(nama); const cad = spesifikasi ? dariTeks(spesifikasi) : null;
  return { dimensi: a.dimensi ?? cad?.dimensi ?? null, grade: a.grade.size ? a.grade : cad?.grade ?? new Set(), inti: a.inti, angka: a.angka };
}

/** Kunci kanonik: dua nama yang SAMA setelah normalisasi menghasilkan kunci identik (dipakai juga sebagai kunci kunci-advisory agar pembuatan paralel diserialkan). */
export function kunciKanonik(nama) {
  const a = bacaAtribut(nama);
  return JSON.stringify([[...a.inti].sort(), a.dimensi, [...a.grade].sort(), [...a.angka].sort()]);
}

function jarak(a, b) {
  const m = a.length; const n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) { const cur = [i]; for (let j = 1; j <= n; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
const selisih = (a, b) => [...a].filter((x) => !b.has(x));
const mirip = (x, y) => x.length >= 5 && y.length >= 5 && jarak(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 5)); // salah ketik, bukan merek lain
const teksDim = (d) => `${d.join("×")} cm`;
const samaDim = (p, q) => p.length === q.length && p.every((v, i) => Math.abs(v - q[i]) < EPS);

/**
 * Bandingkan dua atribut. Mengembalikan { beda: [{ kunci, label, baru, ada }], belumJelas: [teks] }.
 * beda = perbedaan PASTI (kedua sisi menyatakan nilai berbeda); belumJelas = tidak bisa dipastikan (satu sisi tidak menulis / ejaan hampir sama / urutan terbalik).
 */
export function bandingkanAtribut(baru, ada) {
  const beda = []; const belumJelas = [];
  const db = baru.dimensi; const da = ada.dimensi;
  if (db && da) {
    const plB = db.slice(0, 2); const plA = da.slice(0, 2);
    if (!samaDim(plB, plA)) {
      if (samaDim([...plB].sort((x, y) => x - y), [...plA].sort((x, y) => x - y))) belumJelas.push("Urutan panjang × lebar terbalik");
      else beda.push({ kunci: "ukuran", label: "Ukuran", baru: teksDim(plB), ada: teksDim(plA) });
    }
    if (db.length === 3 && da.length === 3) { if (Math.abs(db[2] - da[2]) >= EPS) beda.push({ kunci: "ketebalan", label: "Ketebalan", baru: `${db[2]} cm`, ada: `${da[2]} cm` }); }
    else if (db.length !== da.length) belumJelas.push("Ketebalan tertulis di salah satu nama saja");
  } else if (db || da) belumJelas.push("Ukuran tertulis di salah satu nama saja");
  const gb = baru.grade; const ga = ada.grade;
  if (gb.size && ga.size) { if (selisih(gb, ga).length || selisih(ga, gb).length) beda.push({ kunci: "grade", label: "Grade/density", baru: [...gb].sort().join(", "), ada: [...ga].sort().join(", ") }); }
  else if (gb.size || ga.size) belumJelas.push("Grade/density tertulis di salah satu nama saja");
  const ab = baru.angka; const aa = ada.angka;
  if (ab.size && aa.size) { if (selisih(ab, aa).length || selisih(aa, ab).length) beda.push({ kunci: "angka", label: "Angka spesifikasi", baru: [...ab].sort().join(" "), ada: [...aa].sort().join(" ") }); }
  else if (ab.size || aa.size) belumJelas.push("Angka spesifikasi tertulis di salah satu nama saja");
  const xb = selisih(baru.inti, ada.inti); const xa = selisih(ada.inti, baru.inti);
  if (xb.length && xa.length) {
    const ejaan = xb.length === xa.length && xb.every((t) => xa.some((u) => mirip(t, u)));
    if (ejaan) belumJelas.push(`Ejaan hampir sama (${xb.join(" ")} / ${xa.join(" ")})`);
    else beda.push({ kunci: "merek", label: "Merek/jenis", baru: xb.join(" "), ada: xa.join(" ") });
  } else if (xb.length || xa.length) belumJelas.push(`Kata tambahan pada salah satu nama (${[...xb, ...xa].join(" ")})`);
  return { beda, belumJelas };
}

/** Klasifikasi: "SAMA" | "BERBEDA" | "AMBIGU" + rincian. satuanSama = satuan stok kedua barang sama. */
export function klasifikasi(namaBaru, namaAda, { spesifikasiBaru = null, spesifikasiAda = null, satuanSama = true } = {}) {
  const r = bandingkanAtribut(bacaAtribut(namaBaru, spesifikasiBaru), bacaAtribut(namaAda, spesifikasiAda));
  if (r.beda.length) return { jenis: "BERBEDA", perbedaan: r.beda, belumJelas: r.belumJelas };
  if (r.belumJelas.length) return { jenis: "AMBIGU", perbedaan: [], belumJelas: r.belumJelas };
  return satuanSama ? { jenis: "SAMA", perbedaan: [], belumJelas: [] } : { jenis: "AMBIGU", perbedaan: [], belumJelas: ["Barang sama tetapi satuan stok berbeda"] };
}
