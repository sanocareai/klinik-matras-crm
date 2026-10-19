const fs = require("fs");
function edit(p, fn) { let t = fs.readFileSync(p, "utf8"); const c = t.includes("\r\n"); t = t.replace(/\r\n/g, "\n"); t = fn(t); if (c) t = t.replace(/\n/g, "\r\n"); fs.writeFileSync(p, t); }
const rep = (t, a, b) => { if (!t.includes(a)) throw new Error("tak ada: " + a.slice(0, 80)); return t.replace(a, () => b); };

edit("frontend/src/features/warehouse/opname/OpnameSesiTinjau.jsx", (t) => {
  t = rep(t, "const [riwayat, setRiwayat] = useState(null);", "const [riwayat, setRiwayat] = useState(null); const [cari, setCari] = useState(\"\");");
  t = rep(t, "  const tampil = (hanyaSelisih && tinjauAda ? baris.filter((b) => b.tj?.berselisih || b.l.perluPeriksa || (b.tj?.transaksi.belumDitandai ?? 0) > 0) : baris);",
    "  const kata = cari.trim().toLowerCase(); // pencarian menampilkan bahan mana pun (kode/nama), termasuk yang tidak berselisih\n  const tampil = kata ? baris.filter((b) => `${b.l.material.code} ${b.l.material.name}`.toLowerCase().includes(kata)) : (hanyaSelisih && tinjauAda ? baris.filter((b) => b.tj?.berselisih || b.l.perluPeriksa || (b.tj?.transaksi.belumDitandai ?? 0) > 0) : baris);");
  t = rep(t, `            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={hanyaSelisih}`, `            <input type="search" value={cari} onChange={(e) => { setCari(e.target.value); setBatas(60); }} placeholder="Cari kode atau nama bahan…" aria-label="Cari bahan di tinjauan" data-testid="cari-tinjau" className="min-w-[160px] flex-1 rounded-btn border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]" />
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={hanyaSelisih}`);
  return t;
});

edit("../km-gudang-iso/pp/flows9.mjs", (t) => {
  t = rep(t, 'await j("/act/gerak?kode=M0012&qty=5&menitLalu=5&catatan=GR%20sebelum%20dihitung");', 'await j("/act/gerak?kode=M0012&qty=5&menitLalu=0&catatan=GR%20sesaat%20sebelum%20dihitung"); // SESUDAH sesi dimulai dan sesaat sebelum bahan dihitung = jendela ragu');
  // D3: B mengisi alasan lebih dulu (angka tersimpan sudah ada) lalu menyimpan → konflik dari server
  t = rep(t, `    await ketik(B, kolom(kode), "40"); await klik(B, '[data-testid="simpan-perubahan"]'); await tidur(1300);
    rec("D3`, `    await ketik(B, kolom(kode), "40"); await B.type('[data-testid="alasan-koreksi"]', "Hitung ulang B di gudang"); await klik(B, '[data-testid="simpan-perubahan"]'); await tidur(1300);
    rec("D3`);
  t = rep(t, `await klik(B, '[data-testid="timpa-angka"]'); await tidur(300); await B.type('[data-testid="alasan-koreksi"]', "Hitung ulang B di gudang"); await klik(B, '[data-testid="simpan-perubahan"]'); await tidur(1500);`, `await klik(B, '[data-testid="timpa-angka"]'); await tidur(300); rec("D3b 'Timpa' mempertahankan angka dan alasan B, siap disimpan dengan revisi terbaru", (await B.evaluate((s) => document.querySelector(s)?.value, kolom(kode))) === "40"); await klik(B, '[data-testid="simpan-perubahan"]'); await tidur(1500);`);
  // F: cari bahan di tinjau
  t = rep(t, `  const baca = (kode) => T.evaluate((k) => {`, `  const baca = async (kode) => { await T.evaluate(() => { const i = document.querySelector('[data-testid="cari-tinjau"]'); if (i) { i.focus(); } }); await T.click('[data-testid="cari-tinjau"]', { clickCount: 3 }); await T.keyboard.press("Backspace"); await T.type('[data-testid="cari-tinjau"]', kode); await tidur(350); return bacaBaris(kode); };
  const bacaBaris = (kode) => T.evaluate((k) => {`);
  // F10: jumlah penyesuaian = jumlah bahan berselisih saat diselesaikan (dihitung dari API), bukan angka tetap
  t = rep(t, `  const mov2 = (await j("/state")).mov;
  await O.evaluate(() => { const b = document.querySelector('[data-testid="kirim-SELESAIKAN_OPNAME"]'); b.click(); b.click(); }); await tidur(3500); // klik ganda
  const st = await j("/state");
  rec("F10 penyelesaian resmi: penyesuaian tepat sekali per bahan berselisih (M0011 + 10 bahan minus = 11), klik ganda tidak menggandakan", st.adj === 11 && st.mov === mov2 + 11, \`adj=\${st.adj} mov \${mov2}→\${st.mov}\`);`, `  const mov2 = (await j("/state")).mov; const nBersel = (await API("nadya", "GET", \`/api/inventory/stock-counts/\${id}\`)).body.lines.filter((l) => l.tinjau?.berselisih).length;
  await O.evaluate(() => { const b = document.querySelector('[data-testid="kirim-SELESAIKAN_OPNAME"]'); b.click(); b.click(); }); await tidur(3500); // klik ganda
  const st = await j("/state");
  rec(\`F10 penyelesaian resmi: penyesuaian tepat sekali per bahan berselisih (\${nBersel} bahan), klik ganda tidak menggandakan\`, nBersel >= 12 && st.adj === nBersel && st.mov === mov2 + nBersel, \`adj=\${st.adj} dari \${nBersel} bahan berselisih, mov \${mov2}→\${st.mov}\`);`);
  return t;
});
console.log("ok");
