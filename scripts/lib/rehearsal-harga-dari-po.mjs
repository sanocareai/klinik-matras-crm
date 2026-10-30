import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-harga-dari-po.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Harga Berlaku dari PO hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Harga Berlaku otomatis dari PO": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini. Di salinan inilah bahan nyata ber-Harga Berlaku dipakai: harga tertulis saat PO disimpan, tanpa menyentuh stok/valuasi/jurnal; seluruh baris Harga Berlaku lama harus identik.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const buat = async (nama, role) => prisma.user.create({ data: { name: `REH ${nama}`, email: `reh-${nama.toLowerCase()}-${stamp}@example.test`, passwordHash: "x", role } });
// pembuat PO: finance:post TANPA izin harga (harga_berlaku:edit) bila ada — membuktikan tidak butuh izin harga tambahan
const penyimpan = info.filter((x) => bisa(x.rs, P.FINANCE_POST)); const tanpaIzinHarga = penyimpan.filter((x) => !bisa(x.rs, P.FINANCE_HARGA_BERLAKU_EDIT));
const uSimpan = (tanpaIzinHarga[0] ?? penyimpan[0])?.u ?? await buat("Simpan", "ADMIN"); const uSimpan2 = (tanpaIzinHarga[1] ?? penyimpan.find((x) => x.u.id !== uSimpan.id) ?? {}).u ?? await buat("Simpan2", "ADMIN");
const uSetuju = info.find((x) => bisa(x.rs, P.FINANCE_APPROVE))?.u ?? await buat("Setuju", "ADMIN"); const uHarga = info.find((x) => bisa(x.rs, P.FINANCE_HARGA_BERLAKU_EDIT))?.u ?? await buat("Harga", "OWNER");
const uTanpa = info.find((x) => !bisa(x.rs, P.FINANCE_POST))?.u ?? await buat("Sales", "SALES");
const tS = await token(uSimpan); const tS2 = await token(uSimpan2); const tA = await token(uSetuju); const tH = await token(uHarga); const tN = await token(uTanpa);
cek("akun uji tersedia: dua penyimpan PO (finance:post), penyetuju, pengubah harga manual, dan akun tanpa finance:post", !!uSimpan && !!uSimpan2 && uSimpan.id !== uSimpan2.id && !!uSetuju && !!uHarga && !!uTanpa, `penyimpan tanpa izin harga: ${bisa(await rolesDari(uSimpan), P.FINANCE_HARGA_BERLAKU_EDIT) ? "TIDAK (punya)" : "YA (tanpa finance:harga_berlaku:edit)"}`);
const H = async (metode, p, tok, body = null, kunci = null) => { const r = await fetch(BASE + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `po-reh-${p}-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 10)}`;
const PO = "/api/finance/purchase-orders"; const PV = `${PO}/pratinjau-harga`; const HB = "/api/finance/biaya-bahan/harga-berlaku";
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const sup = await prisma.finSupplier.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }) ?? await prisma.finSupplier.create({ data: { code: `SUP-REH-${stamp}`, name: "PEMASOK REH" } });
const bentukPO = (lines) => ({ supplierId: sup.id, orderDate: hariIni, expectedDate: hariIni, notes: "uji rehearsal harga dari PO", lines });
const jejak = async () => ({
  stok: await prisma.stockMovement.count(), valuasi: await num("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await prisma.finJournalEntry.count(), jurnalBaris: await prisma.finJournalLine.count(),
  biayaBeku: await prisma.stockMovementBiayaOperasional.count(), catatan: await prisma.unitUsageNote.count(), material: await prisma.material.count(),
});
const sama = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const semuaHarga = () => prisma.materialHargaBerlaku.count();
const hargaPO = () => num("select count(*)::int n from material_harga_berlaku where impact->>'sumber' = 'PO' or idempotency_key like 'po-harga:%'");
const barisH = (id) => prisma.materialHargaBerlaku.findMany({ where: { materialId: id }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
const poCount = () => prisma.finPurchaseOrder.count();
const riwayat = async (id) => (await H("GET", `${HB}/bahan/${id}/riwayat`, tH)).body?.riwayat ?? [];
const bulat = (x) => Math.round(Number(x) * 10000) / 10000;
const naik = (h, f = 1.1) => { const b = Math.round(Number(h) * f); return b === Math.round(Number(h)) ? b + 1 : b; };
const sidikHarga = async (ids) => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(h::text, '|' order by h.id::text)), '-') as n from material_harga_berlaku h where h.id::text = any($1::text[])", ids))[0].n);

// ── bahan NYATA di salinan restore (punya Harga Berlaku berlaku sekarang; satuan harga = satuan stok)
const nyata = await prisma.$queryRawUnsafe("select distinct on (h.material_id) h.material_id::text id, m.code, m.unit, h.unit_price::float8 harga from material_harga_berlaku h join materials m on m.id = h.material_id where h.jenis = 'HARGA' and h.effective_from <= now() and m.active = true and h.satuan = m.unit::text and h.unit_price > 100 and h.unit_price < 100000000 and not exists (select 1 from material_harga_berlaku k where k.corrects_id = h.id) order by h.material_id, h.effective_from desc, h.created_at desc limit 12");
cek("ada >= 3 bahan nyata ber-Harga Berlaku di salinan restore untuk uji", nyata.length >= 3, `${nyata.length} bahan`);
if (nyata.length < 3) { berhenti(); await prisma.$disconnect(); console.log("PEMERIKSAAN=" + n + " gagal=" + gagal); process.exit(1); }
const [A, B, C] = nyata; const t0 = new Date(Date.now() - 2000);
const asing = (m) => (m.unit === "BOX" ? "CAN" : "BOX"); // satuan beli SAH (SATUAN_VALID) yang berbeda dari satuan stok bahan
const idHargaAwal = (await prisma.materialHargaBerlaku.findMany({ select: { id: true } })).map((r) => r.id); const sidik0 = await sidikHarga(idHargaAwal);
const j0 = await jejak(); const hargaPO0 = await hargaPO(); const harga0 = await semuaHarga(); const po0 = await poCount();
cek(`PO historis di salinan: Harga Berlaku bersumber PO sebelum uji = ${hargaPO0} (rilis tidak memproses PO historis; bila >0 itu bukan dari rilis ini)`, true);

// ── 1. pratinjau formulir: baca-saja
const pv = await H("POST", PV, tS, { lines: [{ materialId: A.id, unitPrice: naik(A.harga) }] });
cek("pratinjau formulir: 200, status NAIK dengan harga lama = Harga Berlaku sekarang, akan menulis 1 — dan TIDAK menulis apa pun (Harga Berlaku & PO tidak bertambah)", pv.status === 200 && pv.body?.baris?.[0]?.status === "NAIK" && Number(pv.body.baris[0].hargaLama) === Number(A.harga) && pv.body.ringkas.akanMenulis === 1 && (await semuaHarga()) === harga0 && (await poCount()) === po0, `${pv.status} ${pv.body?.baris?.[0]?.status}`);

// ── 2. simpan PO BARU (draf): harga langsung jadi Harga Berlaku operasional oleh pembuat PO TANPA izin harga
const hargaA1 = naik(A.harga); const k1 = kunci("buat");
const r1 = await H("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 3, unitPrice: hargaA1 }, { materialId: B.id, qty: 2, unitPrice: B.harga }]), k1);
const hA = await barisH(A.id); const barisBaruA = hA[hA.length - 1];
cek("simpan PO baru: 201 DRAFT; Harga Berlaku bahan yang naik tertulis SAAT DISIMPAN (bukan menunggu persetujuan) dengan harga lama tercatat; bahan yang harganya sama TIDAK menulis baris baru", r1.status === 201 && r1.body?.status === "DRAFT" && hA.length >= 2 && Number(barisBaruA.unitPrice) === hargaA1 && Number(barisBaruA.previousPrice) === Number(A.harga) && (await barisH(B.id)).length === (await prisma.materialHargaBerlaku.count({ where: { materialId: B.id } })) && r1.body?.hargaDariPO?.diterapkan?.length === 1 && (await semuaHarga()) === harga0 + 1, `${r1.status} diterapkan=${r1.body?.hargaDariPO?.diterapkan?.length} baris=${(await semuaHarga()) - harga0}`);
cek("sumber tercatat lengkap: nomor PO, baris, revisi 0, pelaku = penyimpan, alasan otomatis, efektif saat disimpan (tanpa mundur), tanpa bukti ⇒ label ‘Belum didukung bukti’", barisBaruA.impact?.sumber === "PO" && barisBaruA.impact?.poId === r1.body.id && barisBaruA.impact?.barisPO === 1 && barisBaruA.impact?.revisi === 0 && barisBaruA.impact?.pelakuId === uSimpan.id && barisBaruA.createdById === uSimpan.id && String(barisBaruA.reason).startsWith(`Otomatis dari PO ${r1.body.poNumber} (baris 1, revisi 0)`) && Math.abs(barisBaruA.effectiveFrom.getTime() - barisBaruA.createdAt.getTime()) < 5 && barisBaruA.evidenceNote === null, String(barisBaruA.reason).slice(0, 120));
const rw = await riwayat(A.id);
cek("riwayat bahan menampilkan sumber ‘Dari PO <nomor> — belum diterima’ dan label bukti ‘Belum didukung bukti’; baris Harga Berlaku sebelumnya utuh (riwayat tidak dihapus)", rw[0]?.sumber?.teks === `Dari PO ${r1.body.poNumber} — belum diterima` && rw[0]?.teksLabelBukti === "Belum didukung bukti" && rw.length === hA.length, `${rw[0]?.sumber?.teks}`);
cek("stok, valuasi Finance, jurnal, baris jurnal, biaya beku operasional, catatan pemakaian, material TIDAK berubah oleh simpan PO", sama(await jejak(), j0), JSON.stringify(await jejak()));

// ── 3. klik ganda / retry: kunci sama, isi sama
const hCPO0 = (await barisH(C.id)).filter((x) => x.impact?.sumber === "PO").length;
const ganda = await Promise.all([H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: naik(C.harga) }]), "po-reh-ganda-" + stamp + "-0001xxxx"), H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: naik(C.harga) }]), "po-reh-ganda-" + stamp + "-0001xxxx")]);
const susulan = await H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: naik(C.harga) }]), "po-reh-ganda-" + stamp + "-0001xxxx");
const hC = await barisH(C.id); const hCPO = hC.filter((x) => x.impact?.sumber === "PO");
cek("klik ganda (paralel + susulan, kunci sama): tepat SATU PO dan SATU baris Harga Berlaku untuk bahan itu; respons susulan = PO yang sama", ganda.some((x) => x.status === 201) && ganda.every((x) => [200, 201, 409].includes(x.status)) && [200, 201].includes(susulan.status) && hCPO.length === hCPO0 + 1 && (await poCount()) === po0 + 2 && (new Set([...ganda, susulan].filter((x) => x.body?.id).map((x) => x.body.id))).size === 1, `${ganda.map((x) => x.status)} ${susulan.status} baris baru=${hCPO.length - hCPO0}`);

// ── 4. ubah draf: jumlah saja & simpan ulang tidak menulis; harga berubah menulis revisi baru; baris lama utuh
const nSebelumUbah = await semuaHarga();
const q = await H("PATCH", `${PO}/${r1.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 9, unitPrice: hargaA1 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
const q2 = await H("PATCH", `${PO}/${r1.body.id}`, tS2, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 9, unitPrice: hargaA1 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
cek("ubah jumlah saja, lalu simpan ulang yang sama (pengguna lain): 200 dan TIDAK ada baris Harga Berlaku baru (klik ganda/retry aman)", q.status === 200 && q2.status === 200 && q.body?.hargaDariPO?.diterapkan?.length === 0 && q2.body?.hargaDariPO?.diterapkan?.length === 0 && (await semuaHarga()) === nSebelumUbah, `${q.status}/${q2.status}`);
const hargaA2 = naik(hargaA1);
const u = await H("PATCH", `${PO}/${r1.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 9, unitPrice: hargaA2 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
const hA2 = await barisH(A.id); const rev1 = hA2[hA2.length - 1];
cek("ubah harga di draf: tepat 1 baris baru (revisi 1) dengan harga lama = baris sebelumnya; baris sebelumnya UTUH (append-only)", u.status === 200 && u.body?.hargaDariPO?.diterapkan?.length === 1 && Number(rev1.unitPrice) === hargaA2 && Number(rev1.previousPrice) === hargaA1 && rev1.impact?.revisi === 1 && /:r1$/.test(rev1.idempotencyKey) && sama(hA2.slice(0, hA.length).map((x) => x.id), hA.map((x) => x.id)) && Number(hA2[hA.length - 1].unitPrice) === hargaA1, `${u.status}`);

// ── 5. harga LEBIH BARU dari sumber lain tidak ditimpa: simpan ulang draf lama, lalu persetujuan
const manual = { materialId: A.id, hargaBaru: String(naik(hargaA2, 1.2)), satuan: A.unit, alasan: "Harga nota supplier (uji rehearsal)", berlakuMulai: null };
const pm = await H("POST", `${HB}/pratinjau`, tH, manual); const sm1 = await H("POST", HB, tH, { ...manual, hashPratinjau: pm.body?.hash }, "manual-reh-" + stamp + "-0001xxxx");
cek("Ubah harga manual tetap tersedia (pratinjau + simpan dengan alasan): 201", pm.status === 200 && sm1.status === 201, `${pm.status}/${sm1.status}`);
const nAkhirManual = await semuaHarga(); const hargaManual = bulat(manual.hargaBaru);
const basi = await H("PATCH", `${PO}/${r1.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 11, unitPrice: hargaA2 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
const hA3 = await barisH(A.id);
cek("simpan ulang draf LAMA (jumlah saja) sesudah ada harga yang lebih baru: harga TIDAK dikembalikan ke harga draf, tidak ada baris baru", basi.status === 200 && basi.body?.hargaDariPO?.diterapkan?.length === 0 && (await semuaHarga()) === nAkhirManual && Number(hA3[hA3.length - 1].unitPrice) === hargaManual, `${basi.status}`);
const ap = await H("POST", `${PO}/${r1.body.id}/approve`, tA, {}); const ap2 = await H("POST", `${PO}/${r1.body.id}/approve`, tA, {});
const hA4 = await barisH(A.id);
cek("persetujuan PO: 200 DISETUJUI, TIDAK menulis ulang dan TIDAK mengembalikan harga yang lebih baru (jumlah baris sama, harga terakhir = manual); persetujuan ulang 409", ap.status === 200 && ap.body?.status === "DISETUJUI" && ap2.status === 409 && (await semuaHarga()) === nAkhirManual && Number(hA4[hA4.length - 1].unitPrice) === hargaManual, `${ap.status}/${ap2.status}`);

// ── 6. harga terjadwal tetap mengikuti waktu berlakunya
const depan = new Date(Date.now() + 6 * 86_400_000).toISOString(); const jadwal = { materialId: B.id, hargaBaru: String(naik(B.harga, 1.3)), satuan: B.unit, alasan: "Kenaikan terjadwal (uji rehearsal)", berlakuMulai: depan };
const terjadwal0 = ((await H("GET", `${HB}/bahan/${B.id}`, tH)).body?.terjadwal ?? []).length;
const pj = await H("POST", `${HB}/pratinjau`, tH, jadwal); const sj = await H("POST", HB, tH, { ...jadwal, hashPratinjau: pj.body?.hash }, "jadwal-reh-" + stamp + "-0001xxxx");
const pvJ = await H("POST", PV, tS, { lines: [{ materialId: B.id, unitPrice: naik(B.harga, 1.05) }] });
const rB = await H("POST", PO, tS, bentukPO([{ materialId: B.id, qty: 1, unitPrice: naik(B.harga, 1.05) }]), kunci("jadwal"));
const ringB = (await H("GET", `${HB}/bahan/${B.id}`, tH)).body;
cek("harga TERJADWAL: pratinjau memperingatkan ADA_HARGA_TERJADWAL; PO menulis harga sekarang, sedangkan harga terjadwal tetap ada dengan waktu berlakunya (tidak berlaku lebih awal, tidak ditimpa)", sj.status === 201 && pvJ.body?.baris?.[0]?.peringatan?.some((x) => x.kode === "ADA_HARGA_TERJADWAL") && rB.status === 201 && ringB?.hargaBerlaku?.harga === naik(B.harga, 1.05) && ringB?.terjadwal?.length === terjadwal0 + 1 && ringB.terjadwal.some((x) => Number(x.harga) === bulat(jadwal.hargaBaru)), `${sj.status} ${rB.status} berlaku=${ringB?.hargaBerlaku?.harga} terjadwal=${ringB?.terjadwal?.length} (sebelum ${terjadwal0})`);

// ── 7. konflik & konversi tidak sah ditolak TANPA tulisan sebagian
const sebelumTolak = { po: await poCount(), harga: await semuaHarga(), jejak: await jejak() };
const tKonflik = await H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: C.harga }, { materialId: C.id, qty: 1, unitPrice: naik(C.harga, 1.5) }]), kunci("konflik"));
cek("dua baris bahan SAMA dengan harga stok berbeda: ditolak 4xx; tidak ada PO dan tidak ada Harga Berlaku yang tertulis", tKonflik.status >= 400 && tKonflik.status < 500 && (await poCount()) === sebelumTolak.po && (await semuaHarga()) === sebelumTolak.harga, `${tKonflik.status} ${String(tKonflik.body?.error ?? "").slice(0, 90)}`);
const tFaktor = await H("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 1, unitPrice: naik(hargaManual, 1.2) }, { materialId: B.id, qty: 1, unitPrice: B.harga, satuanBeli: asing(B) }]), kunci("faktor"));
cek("satuan beli beda TANPA faktor konversi di baris 2 (baris 1 valid dan harganya naik): ditolak 400 menunjuk BARIS 2; baris 1 TIDAK tertulis; PO tidak tersimpan", tFaktor.status === 400 && String(tFaktor.body?.error ?? "").startsWith("Baris 2 (") && /faktor/i.test(String(tFaktor.body?.error ?? "")) && (await poCount()) === sebelumTolak.po && (await semuaHarga()) === sebelumTolak.harga, `${tFaktor.status} ${String(tFaktor.body?.error ?? "").slice(0, 110)}`);
const tNol = await H("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 1, unitPrice: naik(hargaManual, 1.2) }, { materialId: B.id, qty: 1, unitPrice: B.harga, satuanBeli: asing(B), faktorKonversi: "0" }]), kunci("faktor0"));
cek("faktor konversi 0 (tidak sah): ditolak 4xx tanpa tulisan sebagian", tNol.status >= 400 && tNol.status < 500 && (await poCount()) === sebelumTolak.po && (await semuaHarga()) === sebelumTolak.harga, `${tNol.status}`);
const tUbahGagal = await H("PATCH", `${PO}/${rB.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: B.id, qty: 1, unitPrice: naik(B.harga, 1.07) }, { materialId: C.id, qty: 1, unitPrice: 1_500_000_000 }] });
const barisPoB = await prisma.finPurchaseOrderLine.findMany({ where: { purchaseOrderId: rB.body.id } });
cek("ubah draf yang gagal di baris 2 (harga tak masuk akal): ditolak 400 baris 2; isi PO TETAP; harga baris 1 yang valid tidak ditulis (atomik)", tUbahGagal.status === 400 && tUbahGagal.body?.baris === 2 && barisPoB.length === 1 && Number(barisPoB[0].unitPrice) === naik(B.harga, 1.05) && (await semuaHarga()) === sebelumTolak.harga, `${tUbahGagal.status} baris=${tUbahGagal.body?.baris}`);
const konversi = await H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: bulat(naik(C.harga, 1.2) * 4), satuanBeli: asing(C), faktorKonversi: "4" }]), kunci("konversi"));
const hCk = (await barisH(C.id)).filter((x) => x.impact?.sumber === "PO").pop();
cek("konversi sah (1 satuan beli sah = 4 satuan stok): tersimpan; Harga Berlaku = harga beli ÷ faktor dalam satuan stok, faktor tercatat pada sumber", konversi.status === 201 && Number(hCk.unitPrice) === naik(C.harga, 1.2) && hCk.impact?.faktor != null && Number(hCk.impact.faktor) === 4 && hCk.satuan === C.unit, `${konversi.status} ${hCk?.unitPrice}/${hCk?.satuan}`);

// ── 8. pembatalan tidak menghapus riwayat dan tidak mengembalikan harga
const nSebelumBatal = await semuaHarga(); const hargaTerakhirB = Number((await barisH(B.id)).pop().unitPrice);
const cb = await H("POST", `${PO}/${rB.body.id}/cancel`, tS, { reason: "Uji rehearsal pembatalan" }); const hB2 = await barisH(B.id);
const rwB = await riwayat(B.id);
cek("pembatalan PO: 200 DIBATALKAN; Harga Berlaku TIDAK dikembalikan dan tidak ada baris dihapus/ditambah; sumber di riwayat berlabel ‘PO dibatalkan’; respons memberi peringatan", cb.status === 200 && cb.body?.status === "DIBATALKAN" && (await semuaHarga()) === nSebelumBatal && Number(hB2[hB2.length - 1].unitPrice) === hargaTerakhirB && /PO dibatalkan/.test(rwB.find((x) => x.sumber?.poNumber === rB.body.poNumber)?.sumber?.teks ?? "") && /TIDAK dikembalikan/.test(String(cb.body?.peringatanHarga ?? "")), `${cb.status}`);

// ── 9. izin
const jIzin0 = { po: await poCount(), harga: await semuaHarga() };
const i401 = await H("POST", PO, null, bentukPO([{ materialId: A.id, qty: 1, unitPrice: 1 }]), kunci("i401")); const i403 = await H("POST", PO, tN, bentukPO([{ materialId: A.id, qty: 1, unitPrice: 1 }]), kunci("i403")); const p403 = await H("POST", PV, tN, { lines: [] });
cek("izin: tanpa token 401; akun tanpa finance:post 403 (simpan) dan tanpa finance:read 403 (pratinjau); tidak ada tulisan", i401.status === 401 && i403.status === 403 && p403.status === 403 && (await poCount()) === jIzin0.po && (await semuaHarga()) === jIzin0.harga, `${i401.status}/${i403.status}/${p403.status}`);

// ── 10. SAKLAR HARGA_DARI_PO=0: server kedua (kode yang sama) menghentikan penulisan harga, simpan PO tetap berfungsi
const PORT2 = PORT + 1; const BASE2 = `http://127.0.0.1:${PORT2}`;
const child2 = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT2), DISABLE_BACKGROUND_JOBS: "1", HARGA_DARI_PO: "0" }, stdio: ["ignore", "pipe", "pipe"] });
let log2 = ""; child2.stdout.on("data", (d) => { log2 += d; }); child2.stderr.on("data", (d) => { log2 += d; }); const berhenti2 = () => { try { child2.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat2 = false; for (let i = 0; i < 60 && !sehat2; i++) { try { sehat2 = (await fetch(BASE2 + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kedua dengan HARGA_DARI_PO=0 hidup (kode sama, hanya saklar yang berbeda)", sehat2, sehat2 ? "" : log2.slice(-300));
if (sehat2) {
  const H2 = async (metode, p, tok, body = null, kn = null) => { const r = await fetch(BASE2 + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kn ? { "Idempotency-Key": kn } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
  const nH = await semuaHarga(); const nP = await poCount();
  const pvOff = await H2("POST", PV, tS, { lines: [{ materialId: A.id, unitPrice: naik(hargaManual, 1.3) }] });
  const mati = await H2("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 1, unitPrice: naik(hargaManual, 1.3) }]), kunci("saklar"));
  const dr = mati.body?.id ? await H2("PATCH", `${PO}/${mati.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 2, unitPrice: naik(hargaManual, 1.4) }] }) : { status: 0 };
  cek("saklar HARGA_DARI_PO=0: simpan PO baru 201 dan ubah draf 200 TETAP berfungsi, tetapi TIDAK ada Harga Berlaku yang ditulis (aktif=false) dan pratinjau menyatakan tidak aktif", mati.status === 201 && dr.status === 200 && mati.body?.hargaDariPO?.aktif === false && pvOff.body?.aktif === false && (await semuaHarga()) === nH && (await poCount()) === nP + 1, `${mati.status}/${dr.status} aktif=${mati.body?.hargaDariPO?.aktif}`);
  berhenti2();
}

// ── 11. invarian: tidak ada yang selain PO + Harga Berlaku bersumber PO/manual uji yang berubah
const jAkhir = await jejak();
cek("SETELAH seluruh uji: stok, valuasi Finance, jurnal, baris jurnal, biaya beku operasional, catatan pemakaian, dan material IDENTIK dengan sebelum uji (tidak ada penilaian ulang pemakaian lama, tidak ada jurnal)", sama(jAkhir, j0), JSON.stringify({ sebelum: j0, sesudah: jAkhir }));
cek("SETELAH seluruh uji: SEMUA baris Harga Berlaku yang sudah ada sebelum uji identik (append-only; tidak ada yang diubah, ditulis ulang, atau dihapus)", (await sidikHarga(idHargaAwal)) === sidik0 && (await num("select count(*)::int n from material_harga_berlaku where id::text = any($1::text[])", idHargaAwal)) === idHargaAwal.length);
const barisPOBaru = (await hargaPO()) - hargaPO0;
cek(`Harga Berlaku bersumber PO bertambah HANYA oleh PO uji ini (${barisPOBaru} baris); tak satu pun PO historis diproses`, barisPOBaru > 0 && (await num("select count(*)::int n from material_harga_berlaku h where (h.impact->>'sumber' = 'PO') and not exists (select 1 from fin_purchase_orders p where p.id::text = h.impact->>'poId' and p.created_at >= $1)", t0)) === 0);

// ── 12. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_HARGA_PO: String(await hargaPO()), ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-700));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
