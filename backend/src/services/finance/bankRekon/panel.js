// PANEL REKONSILIASI (V2) — saldo buku vs saldo rekening koran (atau hitung fisik kas), selisih, dan PENJELASANNYA.
//
// Identitas yang dipakai (selisih = saldo buku − saldo bank, sampai tanggal T; semua dihitung server dengan Decimal):
//   selisih = (buku sebelum data bank yang belum dicocokkan − saldo awal bank)      → "Selisih saldo awal"
//           + Σ perbedaan kelompok pencocokan yang melewati batas T                  → "Perbedaan cutoff (pencocokan melewati batas)"
//           + Σ (buku − bank) baris DIKECUALIKAN                                     → "Dikecualikan"
//           + Σ buku belum muncul di bank                                            → "Buku belum muncul di bank" / cutoff / penyesuaian buku
//           − Σ bank belum dibukukan                                                 → "Bank belum dibukukan"
//           + sisa                                                                    → "Selisih belum dijelaskan" (SELALU diperiksa; bukan angka isian)
// Sisa ≠ 0 berarti rekening koran belum lengkap (baris hilang / saldo akhir tidak cocok dengan rantai saldo), BUKAN ada "uang hilang" yang bisa diabaikan.
//
// Panel BACA-SAJA kecuali penyelesaian periode, pembatalan periode, dan hitung fisik kas (tabel fin_bank_recon_periods / fin_cash_counts) — tidak pernah menulis jurnal.
import crypto from "node:crypto";
import { STATUS_DIHITUNG } from "../journal.js";
import { toMoney, ZERO } from "../money.js";
import { saldoKasBank } from "../reports.js";
import { saldoBukuRekening } from "../rekonSnapshot.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../../lib/activityLog.js";
import { muatData, normalisasi, klasifikasi, bentukBank, bentukBuku, labelSumber } from "./pencocokan.js";
import { RekonError, wajibRekonV2Aktif, rekonV2Aktif, ambilRekening, uang, tgl, waktu, tanggalKolom, POLA_UUID, maskNomor } from "./shared.js";

const SKENARIO_UNTAGGED_MAKS = 50;

// ── Exception ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Exception rekening (data lama yang TIDAK diubah/ditebak): baris jurnal pada akun kas/bank TANPA rekening (mis. JV-25092026-731 "Fee Farhan Agustus" Rp6.715.170) dan baris
 * yang ditandai rekening tetapi berakun lain. `kandidatRekening` = rekening yang berbagi akun COA yang sama — HANYA petunjuk, tidak pernah ditautkan otomatis.
 */
export async function laporanJurnalTanpaRekening(db, { sampai = null } = {}) {
  const batas = tanggalKolom(sampai);
  const rekAktif = await db.finCashAccount.findMany({ select: { id: true, name: true, kind: true, accountId: true, active: true }, orderBy: { name: "asc" } });
  const akunIds = [...new Set(rekAktif.map((r) => r.accountId))];
  const tanpa = await db.finJournalLine.findMany({
    where: { cashAccountId: null, accountId: { in: akunIds }, entry: { status: { in: STATUS_DIHITUNG }, ...(batas ? { date: { lte: batas } } : {}) } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { entryNumber: "asc" } }],
    select: { id: true, debit: true, credit: true, description: true, accountId: true, account: { select: { code: true, name: true } }, entry: { select: { id: true, entryNumber: true, date: true, createdAt: true, source: true, description: true, status: true, reversalOfId: true, reversedBy: { select: { id: true } }, createdBy: { select: { name: true } } } } },
  });
  // Jurnal lama tanpa rekening yang SUDAH dikoreksi (dibalik, lalu diganti jurnal bertanda rekening) tidak lagi menjadi exception: asli + pembaliknya saling meniadakan.
  const terkoreksi = tanpa.filter((l) => l.entry.status === "REVERSED" || l.entry.reversalOfId);
  const aktifTanpa = tanpa.filter((l) => !(l.entry.status === "REVERSED" || l.entry.reversalOfId));
  const ditinjau = await db.finReconExceptionReview.findMany({ where: { code: "REKENING_TANPA_TANDA", refId: { in: aktifTanpa.map((l) => l.id) } }, select: { refId: true, note: true, reviewedAt: true } });
  const petaTinjau = new Map(ditinjau.map((d) => [d.refId, d]));
  const salah = await db.finJournalLine.findMany({
    where: { cashAccountId: { not: null }, entry: { status: { in: STATUS_DIHITUNG }, ...(batas ? { date: { lte: batas } } : {}) } },
    select: { id: true, accountId: true, debit: true, credit: true, cashAccountId: true, cashAccount: { select: { name: true, accountId: true } }, entry: { select: { entryNumber: true, date: true } }, account: { select: { code: true, name: true } } },
  });
  const salahTanda = salah.filter((l) => l.cashAccount && l.cashAccount.accountId !== l.accountId);
  const items = aktifTanpa.map((l) => {
    const nilai = toMoney(l.debit).minus(toMoney(l.credit));
    const tinjau = petaTinjau.get(l.id);
    return {
      lineId: l.id, jurnalId: l.entry.id, nomor: l.entry.entryNumber, tanggalBuku: tgl(l.entry.date), dibuatPada: waktu(l.entry.createdAt), sumber: l.entry.source, sumberLabel: labelSumber(l.entry.source),
      keterangan: l.description || l.entry.description, aktor: l.entry.createdBy?.name ?? null, akun: `${l.account.code} ${l.account.name}`, masuk: nilai.greaterThan(0) ? uang(nilai) : null, keluar: nilai.isNegative() ? uang(nilai.abs()) : null, nilai: uang(nilai),
      kandidatRekening: rekAktif.filter((r) => r.accountId === l.accountId && r.active).map((r) => ({ id: r.id, nama: r.name })),
      ditinjau: !!tinjau, catatanTinjau: tinjau?.note ?? null,
      tindakan: "Lengkapi rekeningnya lewat jurnal koreksi (balik + jurnal pengganti dengan rekening yang benar). Data lama tidak diubah dan rekeningnya TIDAK ditebak.",
    };
  });
  const total = items.reduce((t, i) => t.plus(i.nilai), ZERO);
  return {
    jumlah: items.length, terkoreksi: terkoreksi.length, jumlahTerbuka: items.filter((i) => !i.ditinjau).length, nilaiBersih: uang(total), items,
    salahTanda: { jumlah: salahTanda.length, items: salahTanda.slice(0, 50).map((l) => ({ lineId: l.id, nomor: l.entry.entryNumber, tanggalBuku: tgl(l.entry.date), akun: `${l.account.code} ${l.account.name}`, rekening: l.cashAccount.name, nilai: uang(toMoney(l.debit).minus(toMoney(l.credit))) })) },
    catatan: "Baris pada akun Kas/Bank tanpa rekening tidak muncul di saldo/mutasi rekening mana pun. Posting baru menolak kondisi ini; data lama dilaporkan di sini dan sengaja tidak diubah.",
  };
}

/** Tandai exception jurnal tanpa rekening sebagai SUDAH DITINJAU (catatan wajib). Tidak mengubah jurnal; hanya mencabut statusnya sebagai penghalang periode. */
export async function tinjauJurnalTanpaRekening(db, { lineId, catatan, userId = null }) {
  await wajibRekonV2Aktif(db);
  if (!POLA_UUID.test(String(lineId || ""))) throw new RekonError("Baris jurnal tidak valid", 400);
  const teks = String(catatan ?? "").trim();
  if (teks.length < 10) throw new RekonError("Catatan tinjauan wajib diisi (minimal 10 karakter)", 400, "ALASAN_WAJIB");
  const rekening = await db.finCashAccount.findMany({ select: { accountId: true } });
  const l = await db.finJournalLine.findUnique({ where: { id: lineId }, select: { id: true, cashAccountId: true, accountId: true, entry: { select: { entryNumber: true, status: true } } } });
  if (!l || l.cashAccountId || !rekening.some((r) => r.accountId === l.accountId)) throw new RekonError("Baris ini bukan exception jurnal tanpa rekening", 404, "BUKAN_EXCEPTION");
  return db.$transaction(async (tx) => {
    await tx.finReconExceptionReview.upsert({ where: { code_refId: { code: "REKENING_TANPA_TANDA", refId: lineId } }, create: { code: "REKENING_TANPA_TANDA", refId: lineId, note: teks, reviewedById: userId }, update: {} });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: lineId, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "dikecualikan", alasan: `Exception jurnal tanpa rekening (${l.entry.entryNumber}) ditinjau: ${teks}` } });
    return { lineId, ditinjau: true };
  });
}

// ── Opname kas ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function catatOpnameKas(db, { cashAccountId, tanggal, jumlah, catatan = null, userId = null }) {
  await wajibRekonV2Aktif(db);
  const rek = await ambilRekening(db, cashAccountId);
  if (rek.kind !== "KAS") throw new RekonError("Hitung fisik hanya untuk rekening tunai (Uang Kas). Rekening bank memakai rekening koran.", 422, "BUKAN_KAS");
  const t = tanggalKolom(tanggal);
  if (!t) throw new RekonError("Tanggal hitung fisik wajib diisi (YYYY-MM-DD)", 400, "TANGGAL_WAJIB");
  if (jumlah == null || jumlah === "") throw new RekonError("Jumlah uang fisik wajib diisi", 400, "JUMLAH_WAJIB");
  const nilai = toMoney(jumlah, { field: "Jumlah uang fisik" });
  if (nilai.isNegative()) throw new RekonError("Jumlah uang fisik tidak boleh negatif", 400);
  return db.$transaction(async (tx) => {
    const c = await tx.finCashCount.create({ data: { cashAccountId: rek.id, countDate: t, amount: nilai, note: catatan ? String(catatan).slice(0, 500) : null, countedById: userId } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: c.id, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "opname", cashAccountId: rek.id, rekening: rek.name, tanggal, jumlah: nilai.toFixed(2), alasan: catatan || null } });
    return { id: c.id, tanggal, jumlah: nilai.toFixed(2) };
  });
}

// ── Penghitungan panel ──────────────────────────────────────────────────────────────────────────────────────────
const jum = (arr, f) => arr.reduce((t, x) => t.plus(f(x)), ZERO);

/** Hash isi buku rekening sampai T (id:nilai:status jurnal) + keadaan pencocokan aktif — dasar snapshot. Status ikut supaya jurnal yang dibalik SETELAH periode selesai terdeteksi. */
function hashSnapshot(buku, kelompok) {
  const isi = buku.map((x) => `${x.id}:${x.nilai.toFixed(2)}:${x.statusJurnal}`).sort().join("\n");
  const cocok = kelompok.map((g) => g).sort().join("\n");
  return crypto.createHash("sha256").update(`${isi}\n--\n${cocok}`).digest("hex");
}

/** Exception yang masih TERBUKA untuk panel: semua yang menghalangi penyelesaian periode. */
async function hitungException(db, rek, { to, klas, paritasOk, salahTanda }) {
  const hasil = [];
  const laporan = await laporanJurnalTanpaRekening(db, { sampai: to });
  const sebabAkun = laporan.items.filter((i) => i.kandidatRekening.some((k) => k.id === rek.id));
  for (const i of sebabAkun) hasil.push({ kode: "JURNAL_TANPA_REKENING", ref: i.lineId, terbuka: !i.ditinjau, pesan: `${i.nomor} (${i.tanggalBuku}) ${i.keluar ? `keluar ${i.keluar}` : `masuk ${i.masuk}`} pada akun kas/bank tidak menyebut rekening`, nilai: i.nilai, nomor: i.nomor });
  if (salahTanda.length) hasil.push({ kode: "BARIS_SALAH_TANDA", ref: rek.id, terbuka: true, pesan: `${salahTanda.length} baris ditandai rekening ini padahal berakun lain`, nilai: null });
  if (!paritasOk) hasil.push({ kode: "PARITAS_SALDO", ref: rek.id, terbuka: true, pesan: "Saldo kartu Kas & Bank berbeda dari saldo mutasi — periksa definisi saldo", nilai: null });
  const bankBelum = klas.bank.filter((x) => !x.grup);
  if (bankBelum.length) hasil.push({ kode: "BANK_BELUM_DIBUKUKAN", ref: rek.id, terbuka: true, pesan: `${bankBelum.length} baris rekening koran belum dicocokkan/dibukukan (netto ${uang(jum(bankBelum, (x) => x.nilai))})`, nilai: uang(jum(bankBelum, (x) => x.nilai)) });
  return hasil;
}

async function sumberSaldoBank(db, rek, to) {
  const batas = tanggalKolom(to);
  const akhir = await db.finBankImportLine.findFirst({ where: { cashAccountId: rek.id, rolledBackAt: null, txDate: { lte: batas }, runningBalance: { not: null } }, orderBy: [{ txDate: "desc" }, { lineNo: "desc" }], select: { runningBalance: true, txDate: true } });
  const awal = await db.finBankImportLine.findFirst({ where: { cashAccountId: rek.id, rolledBackAt: null, txDate: { lte: batas }, runningBalance: { not: null } }, orderBy: [{ txDate: "asc" }, { lineNo: "asc" }], select: { runningBalance: true, credit: true, debit: true, txDate: true } });
  return {
    akhir: akhir ? toMoney(akhir.runningBalance) : null, tanggalAkhir: akhir ? tgl(akhir.txDate) : null,
    awal: awal ? toMoney(awal.runningBalance).minus(toMoney(awal.credit)).plus(toMoney(awal.debit)) : null,
  };
}

/**
 * Hitung panel rekonsiliasi sebuah rekening sampai tanggal `to`. `saldoBankAkhir` (opsional) menggantikan saldo akhir dari rantai saldo rekening koran —
 * dipakai bila berkas tidak punya kolom saldo; nilainya dikonfirmasi pengguna dan dicatat di snapshot.
 */
export async function hitungPanel(db, { cashAccountId, to, saldoBankAkhir = null, saldoBankAwal = null }) {
  const rek = await ambilRekening(db, cashAccountId);
  if (!tanggalKolom(to)) throw new RekonError("Tanggal akhir (to, YYYY-MM-DD) wajib diisi", 400, "TANGGAL_WAJIB");
  const aktif = await rekonV2Aktif(db);
  const saldoBuku = await saldoBukuRekening(db, rek.id, to);
  const kartu = (await saldoKasBank(db, { to: new Date(`${to}T12:00:00+07:00`) })).find((r) => r.id === rek.id);
  const saldoKartu = kartu ? toMoney(kartu.saldo) : saldoBuku;
  const paritasOk = !kartu || saldoKartu.equals(saldoBuku);
  const salahTandaRows = await db.finJournalLine.findMany({ where: { cashAccountId: rek.id, NOT: { accountId: rek.accountId }, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: tanggalKolom(to) } } }, select: { id: true } });

  if (rek.kind === "KAS") return panelKas(db, rek, { to, saldoBuku, paritasOk, aktif, salahTanda: salahTandaRows });

  const mentah = await muatData(db, rek, { sampai: to });
  const klas = klasifikasi(normalisasi(mentah));
  const adaBank = klas.bank.length > 0;
  const tglPertama = klas.bank[0]?.tanggal ?? null;
  const tglTerakhir = klas.bank.at(-1)?.tanggal ?? null;

  const tertulis = await sumberSaldoBank(db, rek, to);
  let saldoBank = null, sumber = null;
  if (saldoBankAkhir != null && saldoBankAkhir !== "") { saldoBank = toMoney(saldoBankAkhir, { field: "Saldo rekening koran" }); sumber = "DIISI_PENGGUNA"; }
  else if (tertulis.akhir) { saldoBank = tertulis.akhir; sumber = "RANTAI_SALDO_KORAN"; }
  const saldoBankPembuka = saldoBankAwal != null && saldoBankAwal !== "" ? toMoney(saldoBankAwal, { field: "Saldo awal rekening koran" }) : tertulis.awal;

  const bankBelum = klas.bank.filter((x) => !x.grup);
  // Tanpa data rekening koran tidak ada yang bisa "belum dicocokkan": seluruh selisih = belum dijelaskan sampai berkas diimpor.
  const bukuBelum = adaBank ? klas.buku.filter((x) => !x.grup && !x.dikecualikanOtomatis) : [];
  const awalData = tglPertama;
  const sebelumData = (x) => awalData && x.tanggal < awalData;
  const penyesuaian = bukuBelum.filter((x) => x.penyesuaianBuku && !sebelumData(x));
  const cutoff = bukuBelum.filter((x) => !x.penyesuaianBuku && tglTerakhir && x.tanggal > tglTerakhir);
  const regular = bukuBelum.filter((x) => !x.penyesuaianBuku && !sebelumData(x) && !(tglTerakhir && x.tanggal > tglTerakhir));
  const sebelumDataBelum = bukuBelum.filter(sebelumData);

  // Kelompok pencocokan aktif: perbedaan bila sebagian anggotanya melewati T (tidak ikut termuat) — dihitung dari data dalam T vs anggota penuh kelompok.
  const idDalamBank = new Set(klas.bank.map((x) => x.id)), idDalamBuku = new Set(klas.buku.map((x) => x.id));
  const grupAktif = await db.finBankMatchGroup.findMany({ where: { cashAccountId: rek.id, undoneAt: null, kind: { not: "KECUALI" } }, select: { id: true, items: { where: { active: true }, select: { bankLineId: true, journalLineId: true } } } });
  let beda = ZERO; const kelompokPatah = [];
  const nilaiBankPer = new Map(klas.bank.map((x) => [x.id, x.nilai])), nilaiBukuPer = new Map(klas.buku.map((x) => [x.id, x.nilai]));
  for (const g of grupAktif) {
    const b = g.items.filter((i) => i.bankLineId && idDalamBank.has(i.bankLineId)).reduce((t, i) => t.plus(nilaiBankPer.get(i.bankLineId)), ZERO);
    const j = g.items.filter((i) => i.journalLineId && idDalamBuku.has(i.journalLineId)).reduce((t, i) => t.plus(nilaiBukuPer.get(i.journalLineId)), ZERO);
    const lengkap = g.items.every((i) => (i.bankLineId ? idDalamBank.has(i.bankLineId) : idDalamBuku.has(i.journalLineId)));
    if (!lengkap && !j.equals(b)) { beda = beda.plus(j.minus(b)); kelompokPatah.push(g.id); }
  }

  const kecuali = { bank: klas.bank.filter((x) => x.grup?.kind === "KECUALI"), buku: klas.buku.filter((x) => x.grup?.kind === "KECUALI") };
  const efekDikecualikan = jum(kecuali.buku, (x) => x.nilai).minus(jum(kecuali.bank, (x) => x.nilai));
  const efek = {
    bankBelumDibukukan: jum(bankBelum, (x) => x.nilai).negated(),
    bukuBelumMuncul: jum(regular, (x) => x.nilai),
    perbedaanCutoff: jum(cutoff, (x) => x.nilai).plus(beda),
    penyesuaianBuku: jum(penyesuaian, (x) => x.nilai),
    dikecualikan: efekDikecualikan,
  };
  // Selisih saldo awal: buku sebelum data bank yang BELUM dicocokkan, dikurangi saldo awal bank (bila diketahui).
  const bukuSebelumBelum = jum(sebelumDataBelum, (x) => x.nilai);
  const selisihAwal = saldoBankPembuka ? bukuSebelumBelum.minus(saldoBankPembuka) : null;

  const selisih = saldoBank ? saldoBuku.minus(saldoBank) : null; // buku − bank
  // Bila saldo awal bank TIDAK diketahui, selisih saldo awal tidak bisa dipisahkan dan otomatis ikut "belum dijelaskan" (tidak dikurangkan).
  const belumDijelaskan = selisih ? selisih.minus(efek.bankBelumDibukukan.plus(efek.bukuBelumMuncul).plus(efek.perbedaanCutoff).plus(efek.penyesuaianBuku).plus(efek.dikecualikan).plus(selisihAwal ?? ZERO)) : null;

  const exception = await hitungException(db, rek, { to, klas, paritasOk, salahTanda: salahTandaRows });
  const terbuka = exception.filter((e) => e.terbuka);

  // Skenario jurnal tanpa rekening: bila terbukti baris itu milik rekening ini, selisih berubah sebesar nilainya (TIDAK ditautkan; hanya perhitungan "bagaimana jika").
  const laporan = await laporanJurnalTanpaRekening(db, { sampai: to });
  const skenario = laporan.items.filter((i) => i.kandidatRekening.some((k) => k.id === rek.id)).slice(0, SKENARIO_UNTAGGED_MAKS).map((i) => ({
    nomor: i.nomor, keterangan: i.keterangan, nilai: i.nilai, tanggalBuku: i.tanggalBuku,
    jikaMilikRekeningIni: { saldoBuku: uang(saldoBuku.plus(i.nilai)), selisihBukuMinusBank: selisih ? uang(saldoBuku.plus(i.nilai).minus(saldoBank)) : null },
  }));

  const hwmAt = new Date();
  const kelompokAktifIds = grupAktif.map((g) => `${g.id}:${g.items.map((i) => i.bankLineId ?? i.journalLineId).sort().join(",")}`);
  const hash = hashSnapshot(klas.buku, kelompokAktifIds);

  const syarat = [
    { kode: "SAKELAR", ok: aktif, teks: "Rekonsiliasi Bank V2 diaktifkan" },
    { kode: "SALDO_BANK", ok: !!saldoBank, teks: "Saldo rekening koran diketahui (impor berkas dengan kolom saldo, atau isi manual)" },
    { kode: "RESIDUAL_NOL", ok: !!belumDijelaskan && belumDijelaskan.isZero(), teks: "Selisih belum dijelaskan Rp0" },
    { kode: "TANPA_EXCEPTION", ok: terbuka.length === 0, teks: "Tidak ada exception terbuka (jurnal tanpa rekening, bank belum dibukukan, baris salah tanda)" },
    { kode: "SNAPSHOT_VALID", ok: true, teks: "Snapshot periode berlaku" },
  ];

  const periode = await daftarPeriode(db, rek.id);
  return {
    rekening: { id: rek.id, nama: rek.name, jenis: rek.kind, bank: rek.bankName, nomor: maskNomor(rek.accountNumber), aktif: rek.active },
    sampai: to, sakelarAktif: aktif, adaDataBank: adaBank, jenisSaldo: "REKENING_KORAN",
    saldoBuku: uang(saldoBuku), saldoKartu: uang(saldoKartu), paritas: { cocok: paritasOk },
    saldoBank: saldoBank ? uang(saldoBank) : null, sumberSaldoBank: sumber, tanggalSaldoBank: sumber === "RANTAI_SALDO_KORAN" ? tertulis.tanggalAkhir : null,
    saldoBankAwal: saldoBankPembuka ? uang(saldoBankPembuka) : null, rentangDataBank: adaBank ? { dari: tglPertama, sampai: tglTerakhir } : null,
    selisih: selisih ? uang(selisih) : null, arahSelisih: selisih ? (selisih.isZero() ? "SAMA" : selisih.greaterThan(0) ? "BUKU_LEBIH_TINGGI" : "BANK_LEBIH_TINGGI") : null,
    komponen: {
      bankBelumDibukukan: { efek: uang(efek.bankBelumDibukukan), jumlah: bankBelum.length, baris: bankBelum.slice(0, 200).map((x) => bentukBank(x)) },
      bukuBelumMuncul: { efek: uang(efek.bukuBelumMuncul), jumlah: regular.length, baris: regular.slice(0, 200).map(bentukBuku) },
      perbedaanCutoff: { efek: uang(efek.perbedaanCutoff), jumlah: cutoff.length + kelompokPatah.length, baris: cutoff.slice(0, 200).map(bentukBuku), kelompokMelewatiBatas: kelompokPatah.length },
      penyesuaianBuku: { efek: uang(efek.penyesuaianBuku), jumlah: penyesuaian.length, baris: penyesuaian.slice(0, 100).map(bentukBuku) },
      dikecualikan: { efek: uang(efek.dikecualikan), jumlahBank: kecuali.bank.length, jumlahBuku: kecuali.buku.length },
      selisihSaldoAwal: { diketahui: !!selisihAwal, efek: selisihAwal ? uang(selisihAwal) : null, catatan: selisihAwal ? "Buku sebelum data bank yang belum dicocokkan dikurangi saldo awal rekening koran" : "Saldo awal rekening koran tidak diketahui (berkas tanpa kolom saldo) — selisih saldo awal ikut dalam angka belum dijelaskan" },
    },
    belumDijelaskan: belumDijelaskan ? uang(belumDijelaskan) : null,
    ringkasanStatus: { bank: hitungStatus(klas.bank), buku: hitungStatus(klas.buku), bisaOtomatis: klas.otomatis.length },
    exception, exceptionTerbuka: terbuka.length, skenarioJurnalTanpaRekening: skenario,
    syarat, bisaSelesai: syarat.every((s) => s.ok), alasanBelumBisa: syarat.filter((s) => !s.ok).map((s) => s.teks),
    snapshotCalon: { hash, hwmAt: hwmAt.toISOString(), jumlahBarisBuku: klas.buku.length, jumlahBarisBank: klas.bank.length },
    periode, definisi: DEFINISI_ANGKA, diperbaruiPada: hwmAt.toISOString(),
  };
}

const hitungStatus = (arr) => arr.reduce((o, x) => { o[x.status] = (o[x.status] ?? 0) + 1; return o; }, {});

export const DEFINISI_ANGKA = Object.freeze({
  saldoBuku: "Saldo menurut buku (jurnal terposting pada akun kas/bank rekening ini) sampai tanggal akhir.",
  saldoBank: "Saldo menurut rekening koran bank sampai tanggal akhir (dari kolom saldo berkas, atau diisi manual).",
  selisih: "Saldo buku dikurangi saldo bank. Positif = buku lebih tinggi dari bank.",
  bankBelumDibukukan: "Mutasi ada di rekening koran tetapi belum ada/cocok di buku. Harus dicatat lewat dokumen normal (pengeluaran, pemasukan, transfer) — bukan otomatis dari bank.",
  bukuBelumMuncul: "Tercatat di buku tetapi belum terlihat di rekening koran padahal tanggalnya sudah tercakup data bank.",
  perbedaanCutoff: "Tercatat di buku setelah tanggal terakhir data bank, atau kelompok pencocokan yang sebagian anggotanya melewati tanggal akhir.",
  penyesuaianBuku: "Jurnal penyesuaian saldo (kalibrasi/saldo awal) — bukan transaksi bank.",
  dikecualikan: "Baris yang sengaja dikecualikan dengan alasan; tetap dihitung sebagai bagian selisih yang diterima.",
  belumDijelaskan: "Bagian selisih yang tidak bisa dijelaskan oleh daftar di atas — biasanya rekening koran belum lengkap atau saldo akhir tidak sesuai rantai saldo. Harus Rp0 untuk menyelesaikan periode.",
});

// ── KAS (opname) ────────────────────────────────────────────────────────────────────────────────────────────────
async function panelKas(db, rek, { to, saldoBuku, paritasOk, aktif, salahTanda }) {
  const batas = tanggalKolom(to);
  const opname = await db.finCashCount.findFirst({ where: { cashAccountId: rek.id, countDate: { lte: batas } }, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], include: { countedBy: { select: { id: true, name: true } } } });
  const riwayat = await db.finCashCount.findMany({ where: { cashAccountId: rek.id }, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], take: 20, include: { countedBy: { select: { id: true, name: true } } } });
  const fisik = opname ? toMoney(opname.amount) : null;
  // Saldo buku PADA tanggal opname (bukan T): hitung fisik hari itu dibandingkan dengan buku hari itu.
  const bukuPadaOpname = opname ? await saldoBukuRekening(db, rek.id, tgl(opname.countDate)) : null;
  const selisih = fisik ? bukuPadaOpname.minus(fisik) : null;
  const exception = [];
  if (!paritasOk) exception.push({ kode: "PARITAS_SALDO", ref: rek.id, terbuka: true, pesan: "Saldo kartu Kas & Bank berbeda dari saldo mutasi", nilai: null });
  if (salahTanda.length) exception.push({ kode: "BARIS_SALAH_TANDA", ref: rek.id, terbuka: true, pesan: `${salahTanda.length} baris ditandai rekening ini padahal berakun lain`, nilai: null });
  const laporan = await laporanJurnalTanpaRekening(db, { sampai: to });
  for (const i of laporan.items.filter((x) => x.kandidatRekening.some((k) => k.id === rek.id))) exception.push({ kode: "JURNAL_TANPA_REKENING", ref: i.lineId, terbuka: !i.ditinjau, pesan: `${i.nomor} pada akun kas tanpa rekening`, nilai: i.nilai, nomor: i.nomor });
  const terbuka = exception.filter((e) => e.terbuka);
  const syarat = [
    { kode: "SAKELAR", ok: aktif, teks: "Rekonsiliasi Bank V2 diaktifkan" },
    { kode: "OPNAME", ok: !!fisik, teks: "Hitung fisik kas dicatat pada/sebelum tanggal ini" },
    { kode: "RESIDUAL_NOL", ok: !!selisih && selisih.isZero(), teks: "Selisih buku dan hitung fisik Rp0" },
    { kode: "TANPA_EXCEPTION", ok: terbuka.length === 0, teks: "Tidak ada exception terbuka" },
    { kode: "SNAPSHOT_VALID", ok: true, teks: "Snapshot periode berlaku" },
  ];
  const barisKas = await db.finJournalLine.findMany({ where: { cashAccountId: rek.id, accountId: rek.accountId, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: batas } } }, select: { id: true, debit: true, credit: true, entry: { select: { status: true } } } });
  const kelompokHash = hashSnapshot(barisKas.map((l) => ({ id: l.id, nilai: toMoney(l.debit).minus(toMoney(l.credit)), statusJurnal: l.entry.status })), []);
  return {
    rekening: { id: rek.id, nama: rek.name, jenis: rek.kind, aktif: rek.active }, sampai: to, sakelarAktif: aktif, jenisSaldo: "OPNAME_FISIK", adaDataBank: false,
    saldoBuku: uang(saldoBuku), saldoKartu: uang(saldoBuku), paritas: { cocok: paritasOk },
    saldoBank: fisik ? uang(fisik) : null, sumberSaldoBank: fisik ? "OPNAME_FISIK" : null, tanggalSaldoBank: opname ? tgl(opname.countDate) : null,
    saldoBukuPadaOpname: bukuPadaOpname ? uang(bukuPadaOpname) : null,
    selisih: selisih ? uang(selisih) : null, arahSelisih: selisih ? (selisih.isZero() ? "SAMA" : selisih.greaterThan(0) ? "BUKU_LEBIH_TINGGI" : "BANK_LEBIH_TINGGI") : null,
    komponen: null, belumDijelaskan: selisih ? uang(selisih) : null,
    opname: opname ? { id: opname.id, tanggal: tgl(opname.countDate), jumlah: uang(opname.amount), oleh: opname.countedBy?.name ?? null, catatan: opname.note } : null,
    riwayatOpname: riwayat.map((c) => ({ id: c.id, tanggal: tgl(c.countDate), jumlah: uang(c.amount), oleh: c.countedBy?.name ?? null, catatan: c.note, dicatatPada: waktu(c.createdAt) })),
    exception, exceptionTerbuka: terbuka.length, skenarioJurnalTanpaRekening: [], syarat, bisaSelesai: syarat.every((s) => s.ok), alasanBelumBisa: syarat.filter((s) => !s.ok).map((s) => s.teks),
    snapshotCalon: { hash: kelompokHash, hwmAt: new Date().toISOString(), jumlahBarisBuku: barisKas.length, jumlahBarisBank: 0 },
    periode: await daftarPeriode(db, rek.id), definisi: { ...DEFINISI_ANGKA, saldoBank: "Untuk Uang Kas: jumlah uang fisik hasil hitung (opname) terakhir pada/sebelum tanggal akhir.", belumDijelaskan: "Selisih buku dan uang fisik. Harus Rp0 untuk menyelesaikan periode." },
    diperbaruiPada: new Date().toISOString(),
  };
}

// ── Periode ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function daftarPeriode(db, cashAccountId) {
  const rows = await db.finBankReconPeriod.findMany({
    where: { cashAccountId }, orderBy: { periodTo: "desc" }, take: 50,
    include: { completedBy: { select: { id: true, name: true } }, invalidatedBy: { select: { id: true, name: true } } },
  });
  const hasil = [];
  for (const p of rows) {
    const valid = p.invalidatedAt ? false : await snapshotMasihValid(db, p);
    hasil.push({
      id: p.id, dari: tgl(p.periodFrom), sampai: tgl(p.periodTo), sumber: p.balanceSource, saldoBank: uang(p.actualBalance), saldoBuku: uang(p.bookBalance), residual: uang(p.residual),
      diselesaikanOleh: p.completedBy ? { id: p.completedBy.id, name: p.completedBy.name } : null, diselesaikanPada: waktu(p.completedAt),
      berlaku: !p.invalidatedAt && valid, dibatalkan: !!p.invalidatedAt, alasanBatal: p.invalidReason, dibatalkanOleh: p.invalidatedBy ? { id: p.invalidatedBy.id, name: p.invalidatedBy.name } : null, dibatalkanPada: waktu(p.invalidatedAt),
      snapshotRusak: !p.invalidatedAt && !valid,
    });
  }
  return hasil;
}

/** Snapshot masih valid bila isi buku (id:nilai) rekening sampai T pada saat itu belum berubah. Dihitung ulang dari jurnal dengan created_at ≤ hwmAt. */
async function snapshotMasihValid(db, p) {
  const rek = await db.finCashAccount.findUnique({ where: { id: p.cashAccountId }, select: { id: true, accountId: true } });
  const lines = await db.finJournalLine.findMany({
    where: { cashAccountId: rek.id, accountId: rek.accountId, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: p.periodTo }, createdAt: { lte: p.hwmAt } } },
    select: { id: true, debit: true, credit: true, entry: { select: { status: true } } },
  });
  const buku = lines.map((l) => ({ id: l.id, nilai: toMoney(l.debit).minus(toMoney(l.credit)), statusJurnal: l.entry.status }));
  const saldo = buku.reduce((t, x) => t.plus(x.nilai), ZERO);
  const h = hashSnapshot(buku, p.snapshot?.kelompokAktif ?? []);
  return saldo.equals(toMoney(p.bookBalance)) && h === p.snapshotHash;
}

/**
 * Selesaikan periode: dihitung ULANG di dalam transaksi (kunci rekening) — bukan percaya angka layar. Syarat: residual Rp0, tidak ada exception terbuka, snapshot valid.
 * Membuat satu baris immutable fin_bank_recon_periods. Tidak menyentuh jurnal.
 */
export async function selesaikanPeriode(db, { cashAccountId, to, saldoBankAkhir = null, saldoBankAwal = null, userId = null }) {
  await wajibRekonV2Aktif(db);
  const rek = await ambilRekening(db, cashAccountId);
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `REKON_V2:${rek.id}`);
    const panel = await hitungPanel(tx, { cashAccountId, to, saldoBankAkhir, saldoBankAwal });
    if (!panel.bisaSelesai) throw new RekonError(`Periode belum bisa diselesaikan: ${panel.alasanBelumBisa.join("; ")}.`, 422, "BELUM_BISA_SELESAI");
    const ada = await tx.finBankReconPeriod.findFirst({ where: { cashAccountId: rek.id, periodTo: tanggalKolom(to), invalidatedAt: null }, select: { id: true } });
    if (ada) throw new RekonError("Periode sampai tanggal ini sudah diselesaikan.", 409, "PERIODE_SUDAH_ADA");
    const grupAktif = await tx.finBankMatchGroup.findMany({ where: { cashAccountId: rek.id, undoneAt: null, kind: { not: "KECUALI" } }, select: { id: true, items: { where: { active: true }, select: { bankLineId: true, journalLineId: true } } } });
    const kelompokAktif = grupAktif.map((g) => `${g.id}:${g.items.map((i) => i.bankLineId ?? i.journalLineId).sort().join(",")}`);
    const mulai = panel.rentangDataBank?.dari ?? to;
    const p = await tx.finBankReconPeriod.create({
      data: {
        cashAccountId: rek.id, periodFrom: tanggalKolom(mulai), periodTo: tanggalKolom(to), balanceSource: panel.jenisSaldo, actualBalance: toMoney(panel.saldoBank), bookBalance: toMoney(panel.saldoBuku),
        residual: toMoney(panel.belumDijelaskan), hwmAt: new Date(panel.snapshotCalon.hwmAt), snapshotHash: panel.snapshotCalon.hash,
        snapshot: { saldoBuku: panel.saldoBuku, saldoBank: panel.saldoBank, sumberSaldoBank: panel.sumberSaldoBank, selisih: panel.selisih, komponen: panel.komponen ? Object.fromEntries(Object.entries(panel.komponen).map(([k, v]) => [k, { efek: v.efek ?? null, jumlah: v.jumlah ?? null }])) : null, exceptionDitinjau: panel.exception.filter((e) => !e.terbuka).map((e) => ({ kode: e.kode, ref: e.ref })), kelompokAktif, jumlahBarisBuku: panel.snapshotCalon.jumlahBarisBuku, jumlahBarisBank: panel.snapshotCalon.jumlahBarisBank },
        completedById: userId,
      },
    });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: p.id, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "periode_selesai", cashAccountId: rek.id, rekening: rek.name, periode: `${mulai} s/d ${to}`, saldoBuku: panel.saldoBuku, saldoBank: panel.saldoBank } });
    return { periodeId: p.id, sampai: to };
  }, { timeout: 120_000, maxWait: 20_000 });
}

export async function batalkanPeriode(db, { periodeId, alasan, userId = null }) {
  await wajibRekonV2Aktif(db);
  if (!POLA_UUID.test(String(periodeId || ""))) throw new RekonError("Periode tidak valid", 400);
  const teks = String(alasan ?? "").trim();
  if (teks.length < 10) throw new RekonError("Alasan pembatalan periode wajib diisi (minimal 10 karakter)", 400, "ALASAN_WAJIB");
  return db.$transaction(async (tx) => {
    const p = await tx.finBankReconPeriod.findUnique({ where: { id: periodeId } });
    if (!p) throw new RekonError("Periode tidak ditemukan", 404);
    if (p.invalidatedAt) throw new RekonError("Periode ini sudah dinyatakan tidak berlaku", 409, "SUDAH_DIBATALKAN");
    await tx.finBankReconPeriod.update({ where: { id: periodeId }, data: { invalidatedAt: new Date(), invalidatedById: userId, invalidReason: teks } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: periodeId, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "periode_dibatalkan", cashAccountId: p.cashAccountId, alasan: teks } });
    return { periodeId };
  });
}

// ── Kartu per rekening ──────────────────────────────────────────────────────────────────────────────────────────
/** Kartu Kas & Bank: saldo buku, saldo bank/kas terakhir yang diketahui, selisih, jumlah belum cocok, terakhir direkonsiliasi. Ringan: tanpa saran kombinasi. */
export async function kartuRekening(db, { to }) {
  const rekening = await db.finCashAccount.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, bankName: true, accountNumber: true, accountId: true } });
  const saldo = await saldoKasBank(db, { to: new Date(`${to}T12:00:00+07:00`) });
  const aktif = await rekonV2Aktif(db);
  const hasil = [];
  for (const r of rekening) {
    const buku = toMoney(saldo.find((s) => s.id === r.id)?.saldo ?? 0);
    const terakhir = await db.finBankReconPeriod.findFirst({ where: { cashAccountId: r.id, invalidatedAt: null }, orderBy: { periodTo: "desc" }, select: { periodTo: true, completedAt: true } });
    let saldoBank = null, tanggalBank = null, sumber = null, belumCocok = 0;
    if (r.kind === "KAS") {
      const o = await db.finCashCount.findFirst({ where: { cashAccountId: r.id, countDate: { lte: tanggalKolom(to) } }, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], select: { amount: true, countDate: true } });
      if (o) { saldoBank = toMoney(o.amount); tanggalBank = tgl(o.countDate); sumber = "OPNAME_FISIK"; }
    } else {
      const a = await sumberSaldoBank(db, r, to);
      if (a.akhir) { saldoBank = a.akhir; tanggalBank = a.tanggalAkhir; sumber = "REKENING_KORAN"; }
      const pertama = await db.finBankImportLine.findFirst({ where: { cashAccountId: r.id, rolledBackAt: null, txDate: { lte: tanggalKolom(to) } }, orderBy: [{ txDate: "asc" }, { lineNo: "asc" }], select: { txDate: true } });
      const [bk, bu] = await Promise.all([
        db.finBankImportLine.count({ where: { cashAccountId: r.id, rolledBackAt: null, txDate: { lte: tanggalKolom(to) }, matchItems: { none: { active: true } } } }),
        pertama ? db.finJournalLine.count({ where: { cashAccountId: r.id, accountId: r.accountId, entry: { status: { in: STATUS_DIHITUNG }, source: { notIn: ["SALDO_AWAL", "REKONSILIASI_SEMENTARA"] }, date: { gte: new Date(pertama.txDate.getTime() - 7 * 86400000), lte: tanggalKolom(to) } }, bankMatchItems: { none: { active: true } } } }) : 0,
      ]);
      // Hanya baris buku di sekitar/ sesudah data bank pertama yang dihitung; riwayat sebelum itu tercakup saldo awal rekening koran. Tanpa impor sama sekali: 0.
      belumCocok = bk + bu;
    }
    hasil.push({
      id: r.id, nama: r.name, jenis: r.kind, bank: r.bankName, nomor: maskNomor(r.accountNumber), saldoBuku: uang(buku),
      saldoBank: saldoBank ? uang(saldoBank) : null, tanggalSaldoBank: tanggalBank, sumberSaldoBank: sumber,
      selisih: saldoBank ? uang(buku.minus(saldoBank)) : null, belumCocok, terakhirDirekonsiliasi: terakhir ? tgl(terakhir.periodTo) : null,
    });
  }
  return { sakelarAktif: aktif, sampai: to, rekening: hasil };
}
