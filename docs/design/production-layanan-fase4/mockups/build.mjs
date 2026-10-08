// Generator mockup Fase 4 (statis, HTML). Visual mengikuti aplikasi lantai Sano (token tokens.css): foto besar, kartu ringkas, progres, bottom navigation, satu tombol utama lengket.
// SEMUA ANGKA = CONTOH ILUSTRASI (bukan data sistem). Penurunan fondasi dan penurunan kasur utuh TIDAK dijumlahkan.
// Pakai:  node build.mjs   (menulis *.html di folder ini)   lalu  node shoot.mjs  (screenshot 390/1440).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));

const CSS = `
:root{--bg:#F5F5F7;--surface:#fff;--inset:#F2F2F5;--ink:#1D1D1F;--ink2:rgba(29,29,31,.62);--ink3:rgba(29,29,31,.42);--line:rgba(0,0,0,.08);--accent:#1457D9;--accentbg:rgba(20,87,217,.10);--red:#D70015;--redbg:rgba(215,0,21,.10);--orange:#C93400;--orangebg:rgba(201,52,0,.11);--green:#248A3D;--greenbg:rgba(36,138,61,.11);--shadow:0 1px 3px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.05)}
[data-theme=dark]{--bg:#000;--surface:#1C1C1E;--inset:#2C2C2E;--ink:#F5F5F7;--ink2:rgba(245,245,247,.62);--ink3:rgba(245,245,247,.5);--line:rgba(255,255,255,.1);--accent:#4C8DFF;--accentbg:rgba(10,132,255,.18);--red:#FF453A;--redbg:rgba(255,69,58,.18);--orange:#FF9F0A;--orangebg:rgba(255,159,10,.18);--green:#30D158;--greenbg:rgba(48,209,88,.18);--shadow:0 1px 3px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.2)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 "Manrope","Inter",system-ui,-apple-system,"Segoe UI",sans-serif}
.ribbon{background:#2A1B00;color:#FFD27A;font-size:11.5px;font-weight:800;letter-spacing:.02em;text-align:center;padding:5px 8px}
.app{max-width:390px;margin:0 auto;min-height:100vh;position:relative;padding-bottom:150px}
.hdr{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--surface) 95%,transparent);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:8px 12px}
.logo{width:34px;height:34px;border-radius:11px;background:#0B2454;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
.hdr b{display:block;font-size:16px;line-height:1.15}.hdr small{color:var(--ink3);font-size:12px}
.wrap{padding:14px 12px;display:flex;flex-direction:column;gap:12px}
.card{background:var(--surface);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}.pad{padding:14px}
.photo{aspect-ratio:16/9;background:linear-gradient(135deg,#0B2454,#2B5FC4);display:flex;align-items:flex-end;padding:12px;position:relative;color:#fff}
.photo.big{aspect-ratio:4/3}.photo small{background:rgba(7,26,58,.78);padding:3px 9px;border-radius:999px;font-weight:700;font-size:12px;backdrop-filter:blur(6px)}
.photo .tag{position:absolute;top:10px;right:10px;background:#C93400;color:#fff;border-radius:999px;font-size:12px;font-weight:800;padding:3px 10px}
.photo.vid:after{content:"▶";position:absolute;inset:0;margin:auto;width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,.88);color:#0B2454;display:flex;align-items:center;justify-content:center;font-size:20px}
h1{font-size:21px;margin:0;line-height:1.2}h2{font-size:15px;margin:0 0 8px}h3{font-size:13px;margin:0 0 6px;color:var(--ink2);text-transform:uppercase;letter-spacing:.04em}
.muted{color:var(--ink2)}.tiny{font-size:12px;color:var(--ink3)}
.chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800;background:var(--inset);color:var(--ink2)}
.chip.g{background:var(--greenbg);color:var(--green)}.chip.o{background:var(--orangebg);color:var(--orange)}.chip.r{background:var(--redbg);color:var(--red)}.chip.b{background:var(--accentbg);color:var(--accent)}
.prog{height:8px;border-radius:99px;background:var(--inset);overflow:hidden}.prog i{display:block;height:100%;background:var(--accent);border-radius:99px}
.steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}.steps li{display:flex;gap:10px;align-items:center;padding:7px 4px;border-radius:12px;font-size:14px}
.steps .n{width:24px;height:24px;border-radius:50%;background:var(--inset);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:var(--ink2)}
.steps .done .n{background:var(--green);color:#fff}.steps .cur{background:var(--accentbg);font-weight:800}.steps .cur .n{background:var(--accent);color:#fff}
.banner{border-radius:16px;padding:11px 13px;font-size:13.5px;display:flex;gap:9px;align-items:flex-start}.banner.o{background:var(--orangebg);color:var(--orange)}.banner.b{background:var(--accentbg);color:var(--accent)}.banner.g{background:var(--greenbg);color:var(--green)}.banner.r{background:var(--redbg);color:var(--red)}.banner b{display:block}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cmp>div{background:var(--inset);border-radius:14px;padding:10px;min-width:0}.cmp .h{font-size:11px;font-weight:800;color:var(--ink3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
.cmp b{display:block;word-break:break-word}.cmp .s{font-size:12px;color:var(--ink2)}
.row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}.row:first-child{border-top:0}.row span:first-child{color:var(--ink2)}
.num{font-variant-numeric:tabular-nums;font-weight:800}
.field{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--ink2)}.inp{background:var(--surface);border:1.5px solid var(--line);border-radius:14px;min-height:46px;padding:11px 12px;font-size:15px;color:var(--ink);font-weight:600}.inp.empty{color:var(--ink3);font-weight:500}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.check{display:flex;gap:10px;align-items:center;background:var(--inset);border-radius:14px;padding:11px 12px;font-size:14px;font-weight:700}.box{width:22px;height:22px;border-radius:7px;border:2px solid var(--ink3);display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:14px;color:#fff}.box.on{background:var(--accent);border-color:var(--accent)}
.chips{display:flex;gap:8px;flex-wrap:wrap}.opt{border-radius:14px;padding:11px 13px;background:var(--inset);font-weight:700;font-size:14px}.opt.on{background:var(--accent);color:#fff}.opt.ok.on{background:var(--green)}.opt.bad.on{background:var(--red)}
.thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.thumbs .photo{aspect-ratio:1;border-radius:12px;padding:6px;font-size:11px}
.bar{position:fixed;left:0;right:0;bottom:62px;display:flex;justify-content:center;padding:10px 12px;background:linear-gradient(to top,var(--bg) 60%,transparent);z-index:6}.btn{width:100%;max-width:366px;min-height:58px;border:0;border-radius:18px;background:var(--accent);color:#fff;font-weight:800;font-size:17px;box-shadow:0 6px 18px rgba(20,87,217,.28)}.btn.off{background:var(--inset);color:var(--ink3);box-shadow:none}.btn.red{background:var(--red)}.btn.green{background:var(--green)}
.nav{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;background:color-mix(in srgb,var(--surface) 94%,transparent);border-top:1px solid var(--line);padding:6px 8px;z-index:7}.nav div{display:grid;grid-template-columns:repeat(4,1fr);width:100%;max-width:390px;gap:4px}.nav span{display:flex;flex-direction:column;align-items:center;gap:2px;min-height:50px;justify-content:center;border-radius:16px;font-size:11.5px;font-weight:600;color:var(--ink2)}.nav .cur{background:var(--accentbg);color:var(--accent);font-weight:800}
.tl{display:flex;flex-direction:column;gap:12px}.tl .card{position:relative}.stage{display:flex;align-items:center;gap:8px;margin-bottom:8px}.stage .dot{width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
.d{display:grid;grid-template-columns:420px 1fr;gap:18px;max-width:1340px;margin:0 auto;padding:20px}.d3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}.dside{display:flex;flex-direction:column;gap:12px}
.dhdr{display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--line);padding:12px 24px}.dhdr .tabs{display:flex;gap:6px;margin-left:auto}.dhdr .tabs span{padding:8px 14px;border-radius:12px;font-weight:700;color:var(--ink2);font-size:14px}.dhdr .tabs .cur{background:var(--accentbg);color:var(--accent)}
.q{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:12px;border-radius:14px;background:var(--inset);margin-bottom:8px}.q.cur{outline:2px solid var(--accent)}
`;

// ---------------------------------------------------------------- data contoh (ilustrasi) ----
const U = { code: "RES-0710-014", cust: "Ibu Maya", merk: "King Koil · 180x200", meja: "Meja 2", komplain: "Sakit pinggang, tengah terasa amblas", req: "Minta tekstur firm di pinggang" };
const K = { spring: "SPR-PKT-25 · Pocket spring 25 cm", busa: "FOAM-HR44-5 · Busa HR D44 5 cm", latex: "LTX-NAT-3 · Latex natural 3 cm" };
const NAV = (cur) => `<div class="nav"><div>${["Kerja", "Bahan", "Aktivitas", "Akun"].map((t, i) => `<span class="${i === cur ? "cur" : ""}">${["◧", "▣", "◔", "◉"][i]}<small>${t}</small></span>`).join("")}</div></div>`;
const NAVQC = (cur) => `<div class="nav"><div>${["Antrean", "Unit", "Akun", ""].map((t, i) => (t ? `<span class="${i === cur ? "cur" : ""}">${["✓", "▤", "◉"][i]}<small>${t}</small></span>` : "<span></span>")).join("")}</div></div>`;
const hdr = (title, sub) => `<div class="hdr"><div class="logo">S</div><div><b>${title}</b><small>${sub}</small></div></div>`;
const unitCard = (tag = "Diproses") => `<div class="card"><div class="photo big"><span class="tag">${tag}</span><small>Foto unit (contoh)</small></div><div class="pad"><h1>${U.cust}</h1><div class="muted">${U.code} · ${U.merk} · ${U.meja}</div><div class="tiny" style="margin-top:6px">“${U.req}”</div></div></div>`;
const steps = (cur, done) => `<ul class="steps">${[["1", "Sebelum Bongkar"], ["2", "Uji Rasa Awal"], ["3", "Hasil Bongkar"], ["4", "Uji Fondasi Lama"], ["5", "Diagnosa Teknis"], ["6", "Fondasi Baru"], ["7", "Lapisan Baru"], ["8", "Uji Kasur Jadi"]].map(([n, l]) => `<li class="${+n < done ? "done" : +n === cur ? "cur" : ""}"><span class="n">${+n < done ? "✓" : n}</span>${l}</li>`).join("")}</ul>`;
const cmp = (h1, a, as, h2, b, bs) => `<div class="cmp"><div><div class="h">${h1}</div><b>${a}</b><div class="s">${as}</div></div><div><div class="h">${h2}</div><b>${b}</b><div class="s">${bs}</div></div></div>`;
const NB = `<span class="muted" style="font-style:italic">Belum dicatat</span>`;
const page = ({ title, body, bar, nav, theme = "light", ribbon = "CONTOH ILUSTRASI — angka & nama bukan data sistem" }) => `<!doctype html><html lang="id" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style></head><body><div class="ribbon">${ribbon}</div>${body}${bar || ""}${nav || ""}</body></html>`;
const bar = (label, cls = "") => `<div class="bar"><button class="btn ${cls}">${label}</button></div>`;

// ---------------------------------------------------------------- 01 Pekerjaan Meja
function s01(state, theme) {
  const kosong = state === "kosong";
  const rac = kosong
    ? `<div class="banner o"><span>⚠</span><div><b>Racikan rencana ${NB}</b>PIC Meja/PIC QC perlu menentukan racikan dulu (Catatan Komponen). Rakit fondasi tetap menunggu.</div></div>`
    : `<div class="card pad"><h3>Racikan Fase 3 disetujui</h3><div class="row"><span>Fondasi</span><b>Diganti · ${K.spring}</b></div><div class="row"><span>Lapisan 1</span><b>Diganti · ${K.latex} · 3 cm</b></div><div class="row"><span>Lapisan 2</span><b>Diganti · ${K.busa} · 5 cm</b></div><div class="row"><span>Lapisan 3</span><b>Dipertahankan · 4 cm <span class="tiny">(dari catatan awal)</span></b></div><div class="row"><span>Total tinggi lapisan</span><b class="num">12 cm</b></div><div class="row"><span>BOM / diserahkan</span><b>3 bahan · <span style="color:var(--green)">sudah diserahkan Gudang</span></b></div></div>`;
  return page({ theme, title: "Pekerjaan Meja", body: `<div class="app">${hdr("Pekerjaan Meja", "Aplikasi Meja · " + U.meja)}<div class="wrap">${unitCard()}<div class="card pad"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><b>Progres</b><span class="tiny">5/12 tahap</span></div><div class="prog"><i style="width:42%"></i></div><div style="margin-top:10px">${steps(6, 6)}</div></div>${rac}<div class="card pad"><h3>Konteks (baca saja)</h3><div class="row"><span>Keluhan</span><b>${U.komplain}</b></div><div class="row"><span>Kondisi awal</span><b>Kasur utuh turun 3 cm · fondasi 25 → 15 cm</b></div></div></div></div>`, bar: bar(kosong ? "Rakit Fondasi (menunggu racikan)" : "Mulai: Rakit Fondasi", kosong ? "off" : ""), nav: NAV(0) });
}
// ---------------------------------------------------------------- 02 Fondasi Terakit
function s02(state, theme) {
  const tunggu = state === "menunggu";
  const beda = state === "beda";
  return page({ theme, title: "Fondasi Terakit", body: `<div class="app">${hdr("Fondasi Terakit", U.code + " · tahap 6")}<div class="wrap"><div class="card"><div class="photo vid"><small>Video fondasi terpasang (contoh)</small></div><div class="pad"><h1>Fondasi baru terpasang</h1><div class="muted">Pocket spring dipasang & dikencangkan</div></div></div>
  <div class="card pad"><h3>Rencana ↔ Hasil aktual</h3>${cmp("Rencana", "Diganti · " + K.spring, "dari racikan Fase 3", "Hasil aktual", beda ? "Diperbaiki · Per bonnell lama + penguat" : "Diganti · " + K.spring, beda ? "berbeda dari rencana" : "sesuai rencana")}
  ${beda ? `<div class="banner o" style="margin-top:10px"><span>✎</span><div><b>Alasan perbedaan wajib diisi</b>Mis. stok pocket spring habis; per lama masih baik.</div></div><div class="field" style="margin-top:8px">Alasan perbedaan<div class="inp">Pocket spring 25 cm kosong di Gudang, per lama masih layak</div></div><div class="tiny" style="margin-top:6px">Disimpan sebagai revisi berversi (v2) di Catatan Komponen — riwayat tidak ditimpa.</div>` : ""}</div>
  <div class="card pad"><h3>Bahan (tertaut)</h3><div class="row"><span>BOM rencana</span><b class="num">1 pcs</b></div><div class="row"><span>Diserahkan Gudang</span><b class="num">1 pcs</b></div><div class="row"><span>Dipakai (PIC Bahan)</span><b>${NB}</b></div></div>
  ${tunggu ? `<div class="banner b"><span>⏳</span><div><b>Menunggu PIC QC</b>PIC QC menguji fondasi baru (tinggi tanpa beban, dibebani, foto/video). Lapisan baru bisa disusun setelah itu.</div></div>` : `<div class="banner g"><span>✓</span><div><b>Siap dikirim ke PIC QC</b>Setelah dikirim, Anda menunggu uji fondasi baru.</div></div>`}</div></div>`, bar: bar(tunggu ? "Menunggu PIC QC…" : "Kirim ke PIC QC untuk Uji Fondasi", tunggu ? "off" : ""), nav: NAV(0) });
}
// ---------------------------------------------------------------- 03 Uji Fondasi PIC QC
function s03(state, theme) {
  const kosong = state === "kosong"; const tak = state === "tidak-sebanding";
  const berat = tak ? "60" : "75";
  return page({ theme, title: "Uji Fondasi PIC QC", body: `<div class="app">${hdr("Uji Fondasi Baru", "Aplikasi PIC QC · " + U.code)}<div class="wrap">
  <div class="card pad"><h3>Pengukuran fondasi AWAL (acuan)</h3><div class="row"><span>Tanpa beban → dibebani</span><b class="num">25 cm → 15 cm</b></div><div class="row"><span>Penurunan (dihitung sistem)</span><b class="num">10 cm</b></div><div class="row"><span>Berat penguji · metode</span><b>75 kg · beban di tengah rangka</b></div></div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:10px"><h3>Uji fondasi baru</h3>
  <div class="g2"><label class="field">Tinggi tanpa beban (cm) *<div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. 25" : "25"}</div></label><label class="field">Tinggi dibebani (cm) *<div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. 23" : "23"}</div></label></div>
  <div class="banner b"><span>∑</span><div><b>Penurunan fondasi: ${kosong ? NB : "2 cm"}</b><span class="tiny">dihitung sistem (tanpa beban − dibebani); bukan dijumlahkan dengan uji kasur utuh</span></div></div>
  <label class="field">Berat penguji aktual (kg) * <span class="tiny">tidak terisi otomatis</span><div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. 75" : berat}</div></label>
  <label class="field">Titik / metode pengujian *<div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. beban di tengah rangka" : "Beban di tengah rangka, 4 sudut"}</div></label>
  <div class="check"><span class="box ${kosong ? "" : "on"}">${kosong ? "" : "✓"}</span>Titik & metode sama dengan uji awal</div>
  <div class="field">Foto/video (wajib minimal 1)<div class="thumbs"><div class="photo vid"><small>video</small></div><div class="photo"><small>foto</small></div><div class="photo" style="background:var(--inset);color:var(--ink3);justify-content:center;align-items:center">+ tambah</div></div></div>
  <label class="field">Catatan<div class="inp empty">opsional</div></label></div>
  ${kosong ? `<div class="banner o"><span>⚠</span><div><b>Perbandingan dengan uji awal ${NB}</b>Isi angka dulu.</div></div>` : tak ? `<div class="banner o"><span>≠</span><div><b>Perbandingan langsung belum valid</b>Berat penguji berbeda (awal 75 kg, baru 60 kg). Kedua angka ditampilkan apa adanya: awal turun 10 cm · baru turun 2 cm. Tidak ada selisih yang dihitung.</div></div>` : `<div class="banner g"><span>✓</span><div><b>Sebanding dengan uji awal</b>Metode ditandai sama, berat 75 kg vs 75 kg. Turun 10 cm → 2 cm (selisih 8 cm lebih sedikit).</div></div>`}
  </div></div>`, bar: bar(kosong ? "Simpan Uji Fondasi Baru (lengkapi dulu)" : "Simpan Uji Fondasi Baru", kosong ? "off" : ""), nav: NAVQC(0) });
}
// ---------------------------------------------------------------- 04 Susun Lapisan
function s04(state, theme) {
  const kosong = state === "kosong"; const beda = state === "beda";
  const L = beda
    ? [["1", "Diganti · " + K.latex, "3 cm", "Diganti · " + K.latex, "3 cm", "ok"], ["2", "Diganti · " + K.busa, "5 cm", "Diganti · FOAM-HR44-4 · Busa HR D44 4 cm", "4 cm", "diff"], ["3", "Dipertahankan · busa lama", "4 cm (dari catatan awal)", "Dipertahankan · busa lama", "4 cm (dari catatan awal)", "ok"]]
    : [["1", "Diganti · " + K.latex, "3 cm", "Diganti · " + K.latex, "3 cm", "ok"], ["2", "Diganti · " + K.busa, "5 cm", "Diganti · " + K.busa, "5 cm", "ok"], ["3", "Dipertahankan · busa lama", "4 cm (dari catatan awal)", "Dipertahankan · busa lama", "4 cm (dari catatan awal)", "ok"]];
  return page({ theme, title: "Susun Lapisan", body: `<div class="app">${hdr("Susun Lapisan", U.code + " · tahap 7")}<div class="wrap">
  <div class="banner g"><span>✓</span><div><b>Uji fondasi baru sudah dicatat PIC QC</b>Fondasi turun 2 cm (contoh). Silakan susun lapisan sesuai racikan.</div></div>
  <div class="card"><div class="photo big"><small>${kosong ? "Belum ada foto/video susunan" : "Susunan lapisan terpasang (contoh)"}</small></div></div>
  <div class="card pad"><h3>Rencana ↔ Hasil aktual (atas → bawah)</h3>${kosong ? `<div class="banner o"><span>⚠</span><div><b>Hasil aktual ${NB}</b>Catat susunan yang benar-benar terpasang. Rencana ditampilkan di sisi kiri.</div></div>` : ""}
  ${L.map(([n, a, at, b, bt, st]) => `<div style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px"><b>Lapisan ${n}</b><span class="chip ${st === "ok" ? "g" : "o"}">${kosong ? "Belum dicatat" : st === "ok" ? "Sesuai rencana" : "Berbeda — tebal & bahan"}</span></div>${cmp("Rencana", a, at, "Hasil aktual", kosong ? NB : b, kosong ? "" : bt)}</div>`).join("")}
  <div class="row" style="margin-top:12px"><span>Total tinggi lapisan</span><b class="num">rencana 12 cm · aktual ${kosong ? NB : beda ? "11 cm" : "12 cm"}</b></div>${beda ? `<div class="row"><span>Selisih (dihitung)</span><b class="num">−1 cm</b></div><div class="field" style="margin-top:8px">Alasan perbedaan (wajib)<div class="inp">Busa D44 5 cm habis; dipakai 4 cm, tinggi total turun 1 cm</div></div><div class="tiny" style="margin-top:6px">Tersimpan sebagai revisi berversi; rencana tidak ditimpa.</div>` : ""}</div>
  <div class="card pad"><h3>Bahan (tertaut)</h3><div class="row"><span>BOM → diserahkan → dipakai</span><b class="num">2 → 2 → ${kosong ? "—" : "2"} pcs</b></div><div class="tiny">Menyimpan hasil aktual tidak mengeluarkan stok.</div></div></div></div>`, bar: bar(kosong ? "Catat Hasil Aktual" : "Simpan & Lanjut ke Uji Kasur Jadi"), nav: NAV(0) });
}
// ---------------------------------------------------------------- 05 Uji Kasur Jadi PIC QC
function s05(state, theme) {
  const rework = state === "perbaikan"; const ok = state === "sesuai"; const kosong = state === "kosong";
  const drop = rework ? "2" : "1";
  return page({ theme, title: "Uji Kasur Jadi PIC QC", body: `<div class="app">${hdr("Uji Kasur Jadi", "Aplikasi PIC QC · " + U.code)}<div class="wrap">
  <div class="card pad"><h3>Kondisi awal → racikan → hasil</h3><div class="row"><span>Keluhan awal</span><b>${U.komplain}</b></div><div class="row"><span>Kasur utuh awal</span><b class="num">turun 3 cm · 75 kg</b></div><div class="row"><span>Fondasi awal → baru</span><b class="num">turun 10 cm → 2 cm</b></div><div class="tiny" style="margin-top:6px">Penurunan kasur utuh dan fondasi adalah pengukuran berbeda — tidak dijumlahkan.</div></div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:10px"><h3>Uji kasur jadi</h3>
  <div class="field">Kesesuaian dengan keluhan awal *<div class="chips"><span class="opt ${ok ? "on ok" : ""}">Sesuai keluhan</span><span class="opt ${rework ? "on bad" : ""}">Sebagian</span><span class="opt">Tidak sesuai</span></div></div>
  <label class="field">Feel *<div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. tengah kokoh, pinggir rata" : rework ? "Tengah masih agak turun" : "Tengah kokoh, pinggir rata"}</div></label>
  <div class="g2"><label class="field">Berat penguji aktual (kg) *<div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. 75" : "75"}</div></label><label class="field">Penurunan kasur utuh (cm) *<div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. 1" : drop}</div></label></div>
  <label class="field">Titik / metode *<div class="inp ${kosong ? "empty" : ""}">${kosong ? "mis. duduk di tengah lalu berbaring" : "Berbaring di tengah 1 menit"}</div></label>
  <div class="check"><span class="box ${kosong ? "" : "on"}">${kosong ? "" : "✓"}</span>Metode & titik sama dengan uji awal</div>
  <div class="field">Foto/video (wajib)<div class="thumbs"><div class="photo vid"><small>video</small></div><div class="photo"><small>foto</small></div><div class="photo" style="background:var(--inset);color:var(--ink3);justify-content:center;align-items:center">+</div></div></div></div>
  ${kosong ? `<div class="banner o"><span>⚠</span><div><b>Perbandingan dengan uji awal ${NB}</b>Isi hasil uji dulu.</div></div>` : `<div class="banner ${rework ? "o" : "g"}"><span>${rework ? "!" : "✓"}</span><div><b>Perbandingan: kasur utuh turun 3 cm → ${drop} cm</b>Sebanding (berat & metode sama). ${rework ? "Penurunan masih besar — pertimbangkan perbaikan." : "Turun 2 cm lebih sedikit dari awal."} Tidak ada label “amblas” otomatis.</div></div>`}
  <div class="card pad"><h3>Putusan QC (jalur QC yang sudah ada)</h3><div class="chips"><span class="opt ${ok ? "on ok" : ""}">Sesuai → Corner</span><span class="opt ${rework ? "on bad" : ""}">Perlu perbaikan → Meja</span></div>${rework ? `<div class="banner r" style="margin-top:10px"><span>↩</span><div><b>Kembali ke PIC Meja: rakit fondasi</b>Jalur rework yang ada. Catatan: “Tengah masih agak turun”. Bahan tambahan lewat permintaan rework ke Gudang.</div></div>` : ok ? `<div class="banner g" style="margin-top:10px"><span>→</span><div><b>Lanjut ke Keputusan Corner</b>Hasil QC tercatat; Meja menyerahkan ke Corner.</div></div>` : ""}</div></div></div>`, bar: bar(kosong ? "Simpan Uji Kasur Jadi (lengkapi dulu)" : rework ? "Simpan & Kirim untuk Perbaikan" : "Simpan & Putuskan: Sesuai", kosong ? "off" : rework ? "red" : "green"), nav: NAVQC(0) });
}
// ---------------------------------------------------------------- 06 Ringkasan Unit 360
function s06(state, theme) {
  const kosong = state === "kosong"; const rework = state === "perbaikan";
  const awal = `<div class="card pad"><div class="stage"><span class="dot">1</span><b>Kondisi awal</b></div><div class="row"><span>Keluhan / feel</span><b>${U.komplain}</b></div><div class="row"><span>Kasur utuh</span><b class="num">turun 3 cm · 75 kg</b></div><div class="row"><span>Fondasi</span><b class="num">25 → 15 cm · turun 10 cm</b></div><div class="row"><span>Lapisan awal</span><b class="num">total 10 cm (3 lapisan)</b></div></div>`;
  const rac = `<div class="card pad"><div class="stage"><span class="dot">2</span><b>Racikan rencana</b></div><div class="row"><span>Fondasi</span><b>Diganti · ${K.spring}</b></div><div class="row"><span>Lapisan</span><b>3 cm latex · 5 cm busa · 4 cm lama</b></div><div class="row"><span>Total tinggi lapisan</span><b class="num">12 cm</b></div><div class="row"><span>BOM → diserahkan → dipakai</span><b class="num">3 → 3 → ${kosong ? "—" : "3"}</b></div></div>`;
  const akh = kosong
    ? `<div class="card pad"><div class="stage"><span class="dot">3</span><b>Hasil akhir</b></div><div class="banner o"><span>⚠</span><div><b>Hasil aktual ${NB}</b>Fondasi baru, susunan lapisan, dan uji kasur jadi ${NB}.</div></div></div>`
    : `<div class="card pad"><div class="stage"><span class="dot">3</span><b>Hasil akhir</b></div><div class="row"><span>Fondasi baru (uji QC)</span><b class="num">turun 2 cm · sebanding</b></div><div class="row"><span>Susunan lapisan</span><b class="num">aktual 12 cm · sesuai rencana</b></div><div class="row"><span>Kasur jadi (uji QC)</span><b class="num">turun ${rework ? "2" : "1"} cm · 75 kg</b></div><div class="row"><span>Putusan QC</span><b><span class="chip ${rework ? "r" : "g"}">${rework ? "Perlu perbaikan" : "Sesuai"}</span></b></div></div>`;
  return page({ theme, title: "Ringkasan Unit 360", body: `<div class="app">${hdr("Unit 360 · Ringkasan", U.code)}<div class="wrap">${unitCard(rework ? "Rework" : kosong ? "Diproses" : "Siap ke Corner")}<div class="tl">${awal}${rac}${akh}</div><div class="tiny">Penurunan fondasi dan penurunan kasur utuh ditampilkan terpisah dan tidak dijumlahkan.</div></div></div>`, bar: bar(kosong ? "Lihat Catatan Komponen" : rework ? "Lihat Jalur Rework" : "Buka Laporan Unit"), nav: NAV(2) });
}
// ---------------------------------------------------------------- Desktop 1440
function dQC(state, theme) {
  const tak = state === "tidak-sebanding";
  return page({ theme, title: "Aplikasi PIC QC — desktop", body: `<div class="dhdr"><div class="logo">S</div><b style="font-size:18px">Aplikasi PIC QC</b><div class="tabs"><span class="cur">Antrean</span><span>Akun</span></div></div><div class="d"><div class="dside"><h3>Antrean (3)</h3>
  <div class="q cur"><div><b>${U.code}</b><div class="tiny">Uji fondasi baru · ${U.meja}</div></div><span class="chip b">sekarang</span></div><div class="q"><div><b>RES-0710-019</b><div class="tiny">Uji kasur jadi · Meja 1</div></div><span class="chip">menunggu</span></div><div class="q"><div><b>RES-0710-021</b><div class="tiny">QC sebelum bongkar · Meja 3</div></div><span class="chip">menunggu</span></div>
  <div class="card pad"><h3>Konteks (baca saja)</h3><div class="row"><span>Keluhan</span><b>${U.komplain}</b></div><div class="row"><span>Racikan</span><b>Fondasi diganti · ${K.spring}</b></div><div class="row"><span>Hasil rakitan (Meja)</span><b>Sesuai rencana</b></div></div></div>
  <div style="display:flex;flex-direction:column;gap:12px"><div class="card pad"><h3>Pengukuran fondasi AWAL (acuan)</h3><div class="d3"><div class="cmp" style="grid-template-columns:1fr"><div><div class="h">Tanpa beban → dibebani</div><b class="num">25 → 15 cm</b></div></div><div class="cmp" style="grid-template-columns:1fr"><div><div class="h">Penurunan (sistem)</div><b class="num">10 cm</b></div></div><div class="cmp" style="grid-template-columns:1fr"><div><div class="h">Berat · metode</div><b>75 kg · beban di tengah rangka</b></div></div></div></div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:12px"><h2>Uji fondasi baru</h2><div class="d3"><label class="field">Tinggi tanpa beban (cm) *<div class="inp">25</div></label><label class="field">Tinggi dibebani (cm) *<div class="inp">23</div></label><label class="field">Berat penguji aktual (kg) *<div class="inp">${tak ? "60" : "75"}</div></label></div>
  <div class="banner b"><span>∑</span><div><b>Penurunan fondasi: 2 cm</b><span class="tiny">dihitung sistem; tidak dijumlahkan dengan uji kasur utuh</span></div></div><div class="d3"><label class="field" style="grid-column:span 2">Titik / metode *<div class="inp">Beban di tengah rangka, 4 sudut</div></label><div class="check"><span class="box on">✓</span>Sama dengan uji awal</div></div>
  <div class="thumbs" style="grid-template-columns:repeat(6,1fr)"><div class="photo vid"><small>video</small></div><div class="photo"><small>foto</small></div><div class="photo"><small>foto</small></div></div>
  ${tak ? `<div class="banner o"><span>≠</span><div><b>Perbandingan langsung belum valid</b>Berat penguji berbeda (awal 75 kg · baru 60 kg). Kedua angka tampil apa adanya: awal turun 10 cm · baru turun 2 cm. Tidak ada selisih yang dihitung.</div></div>` : `<div class="banner g"><span>✓</span><div><b>Sebanding dengan uji awal</b>Turun 10 cm → 2 cm (selisih 8 cm lebih sedikit). Tanpa label “amblas”.</div></div>`}
  <div style="display:flex;justify-content:flex-end"><button class="btn" style="max-width:340px">Simpan Uji Fondasi Baru</button></div></div></div></div>`, theme });
}
function dUnit(state, theme) {
  const rework = state === "perbaikan";
  return page({ theme, title: "Unit 360 — desktop", body: `<div class="dhdr"><div class="logo">S</div><div><b style="font-size:18px">Unit 360 · ${U.code}</b><div class="tiny">${U.cust} · ${U.merk}</div></div><div class="tabs"><span>Ringkasan</span><span class="cur">Dokumentasi</span><span>Bahan</span><span>Riwayat</span></div></div><div style="max-width:1340px;margin:0 auto;padding:20px"><div class="d3">
  <div class="card pad"><div class="stage"><span class="dot">1</span><b>Kondisi awal</b></div><div class="row"><span>Keluhan / feel</span><b>${U.komplain}</b></div><div class="row"><span>Kasur utuh</span><b class="num">turun 3 cm · 75 kg</b></div><div class="row"><span>Fondasi</span><b class="num">25 → 15 cm · turun 10 cm</b></div><div class="row"><span>Lapisan awal</span><b class="num">total 10 cm</b></div><div class="thumbs" style="margin-top:8px"><div class="photo vid"><small>QC awal</small></div><div class="photo"><small>bongkar</small></div><div class="photo"><small>lapisan</small></div></div></div>
  <div class="card pad"><div class="stage"><span class="dot">2</span><b>Racikan rencana</b></div><div class="row"><span>Fondasi</span><b>Diganti · ${K.spring}</b></div><div class="row"><span>Lapisan 1</span><b>${K.latex} · 3 cm</b></div><div class="row"><span>Lapisan 2</span><b>${K.busa} · 5 cm</b></div><div class="row"><span>Lapisan 3</span><b>dipertahankan · 4 cm</b></div><div class="row"><span>Total / BOM</span><b class="num">12 cm · 3 bahan</b></div><div class="row"><span>Diserahkan → dipakai</span><b class="num">3 → 3</b></div></div>
  <div class="card pad"><div class="stage"><span class="dot">3</span><b>Hasil akhir</b></div><div class="row"><span>Fondasi baru</span><b class="num">turun 2 cm · sebanding</b></div><div class="row"><span>Susunan aktual</span><b class="num">12 cm · sesuai rencana</b></div><div class="row"><span>Kasur jadi</span><b class="num">turun ${rework ? "2" : "1"} cm · 75 kg</b></div><div class="row"><span>Putusan QC</span><b><span class="chip ${rework ? "r" : "g"}">${rework ? "Perlu perbaikan" : "Sesuai"}</span></b></div><div class="thumbs" style="margin-top:8px"><div class="photo vid"><small>uji fondasi</small></div><div class="photo"><small>lapisan</small></div><div class="photo vid"><small>kasur jadi</small></div></div></div></div>
  <div class="tiny" style="margin-top:10px">CONTOH ILUSTRASI. Penurunan fondasi dan penurunan kasur utuh ditampilkan terpisah, tidak dijumlahkan; tanpa label “amblas” otomatis.</div></div>`, theme });
}

// ---------------------------------------------------------------- daftar berkas
const M = [];
const add = (name, html) => M.push([name, html]);
for (const th of ["light", "dark"]) {
  add(`01-pekerjaan-meja_${th}`, s01("default", th)); add(`01-pekerjaan-meja-kosong_${th}`, s01("kosong", th));
  add(`02-fondasi-terakit_${th}`, s02("default", th)); add(`02-fondasi-terakit-menunggu-qc_${th}`, s02("menunggu", th)); add(`02-fondasi-terakit-beda-rencana_${th}`, s02("beda", th));
  add(`03-uji-fondasi-qc_${th}`, s03("default", th)); add(`03-uji-fondasi-qc-kosong_${th}`, s03("kosong", th)); add(`03-uji-fondasi-qc-tidak-sebanding_${th}`, s03("tidak-sebanding", th));
  add(`04-susun-lapisan_${th}`, s04("default", th)); add(`04-susun-lapisan-beda-rencana_${th}`, s04("beda", th)); add(`04-susun-lapisan-kosong_${th}`, s04("kosong", th));
  add(`05-uji-kasur-jadi-qc-sesuai_${th}`, s05("sesuai", th)); add(`05-uji-kasur-jadi-qc-perlu-perbaikan_${th}`, s05("perbaikan", th)); add(`05-uji-kasur-jadi-qc-kosong_${th}`, s05("kosong", th));
  add(`06-ringkasan-unit360-sesuai_${th}`, s06("sesuai", th)); add(`06-ringkasan-unit360-perlu-perbaikan_${th}`, s06("perbaikan", th)); add(`06-ringkasan-unit360-kosong_${th}`, s06("kosong", th));
  add(`d1-qc-desktop_${th}`, dQC("sebanding", th)); add(`d1-qc-desktop-tidak-sebanding_${th}`, dQC("tidak-sebanding", th));
  add(`d2-unit360-desktop_${th}`, dUnit("sesuai", th)); add(`d2-unit360-desktop-perlu-perbaikan_${th}`, dUnit("perbaikan", th));
}
for (const [n, h] of M) fs.writeFileSync(path.join(here, `${n}.html`), h);
fs.writeFileSync(path.join(here, "files.json"), JSON.stringify(M.map(([n]) => n)));
console.log(M.length, "berkas HTML ditulis");
