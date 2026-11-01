import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUrlTab } from "@/lib/useUrlTab.js";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { api } from "@/api.js";
import { NominalDenganBiaya, nominalTeks } from "@/features/finance/biayaAdminTampil.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import {
  HalamanFinance, Pilihan, InputUang, TombolAksi, PeriodePicker, periodeDefault, tanggalPendek, formatUang,
} from "@/features/finance/shared.jsx";
import { useTertunda, cocok } from "@/features/finance/FilterBar.jsx";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { KoreksiDialog, RiwayatVersiDialog } from "@/features/finance/KoreksiAman.jsx";
import { aksiTransferAtauPemasukan } from "@/features/finance/matriksAksi.js";
import { bentukItemMenu, adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { resetSaatBuka } from "@/features/finance/resetSaatBuka.jsx";
import { hariIniWib } from "@/features/finance/rekonBankLogic.js";
import {
  TAB_KAS, tabAktifKas, saringRekening, cakupanTotal, saringTransfer, kalimatTransfer, statusPencocokan, catatanKartu,
  LABEL_JENIS,
} from "@/features/finance/kasbank/kasBankTampilan.js";
import {
  TotalSaldo, StripPencocokan, BannerTanpaRekening, ToolbarRekening, DaftarRekening, RincianKb, TombolSalin, tampilUang,
} from "@/features/finance/kasbank/KasBankPanels.jsx";
import DetailRekening from "@/features/finance/kasbank/DetailRekening.jsx";
import {
  ToolbarTransfer, DaftarTransfer, specTransfer, ToolbarPemasukanLain, DaftarPemasukanLain, specPemasukanLain,
} from "@/features/finance/kasbank/TransferPanels.jsx";
import { LogoBank } from "@/features/finance/RingkasanPanels.jsx";

// KAS & BANK — rekening yang benar-benar dipegang perusahaan, transfer antar rekening, dan pemasukan di luar order.
//
// Saldo di sini SELALU "menurut buku besar" — hasil penjumlahan seluruh
// jurnal yang menyentuh rekening itu. Saldo "menurut bank" (rekening koran / hitung fisik kas)
// ditampilkan terpisah di kartu rekening dan di tab Rekonsiliasi; memisahkan keduanya adalah inti
// rekonsiliasi itu sendiri, jadi keduanya tidak boleh ditampilkan seolah satu angka.
//
// Navigasi antar bagian (Rekening / Transfer antar-rekening / Pemasukan lain / Rekonsiliasi Bank) = tab hub di lib/financeHubs.js (satu lapis, tanpa tab ganda di halaman).
// Tampilan (kartu rekening, Mutasi Buku, transfer, rincian): features/finance/kasbank/*. File ini memuat data dan menyambungkan aksi;
// endpoint, izin, aturan transfer, dan koreksi/pembatalan SAMA dengan sebelumnya. Deep link lama (?tab=rekening|mutasi|transfer|pemasukan) tetap berlaku:
// "mutasi" menampilkan daftar rekening yang sama (rekening → Mutasi Buku).

export default function FinanceCash() {
  const [panelRincian, setPanelRincian] = useState(null); // spec rincian samping (rekening / transfer / pemasukan lain)
  const [tab, setTab] = useUrlTab([...TAB_KAS], "rekening"); // ?tab= (deep-link hub Kas & Bank)
  const tabUi = tabAktifKas(tab);
  // Pindah bagian lewat tab hub (Rekening / Transfer antar-rekening / Pemasukan lain) menutup Mutasi Buku yang sedang terbuka.
  useEffect(() => { setTerpilih(null); }, [tabUi]);
  const [periode, setPeriode] = useState(periodeDefault);
  const [rekening, setRekening] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [akunPendapatan, setAkunPendapatan] = useState([]);
  const [kartu, setKartu] = useState(null);
  const [ex, setEx] = useState(null);
  const [kartuGagal, setKartuGagal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modal, setModal] = useState(null); // "rekening" | "transfer" | "pemasukan"
  const [editRekening, setEditRekening] = useState(null); // akun yang sedang diedit, null = mode "tambah baru"
  const [terpilih, setTerpilih] = useState(null); // id rekening yang Mutasi Bukunya terbuka
  // Koreksi (dokumen sudah berjurnal) & riwayat versi: { jenis: "transfers"|"other-income", doc }
  const [koreksiUntuk, setKoreksiUntuk] = useState(null);
  const [versiUntuk, setVersiUntuk] = useState(null);
  // Pencarian & filter per tab (sisi-klien) — state tiap tab terpisah.
  const [qR, setQR] = useState("");
  const [fJenis, setFJenis] = useState("");
  const [fStatusR, setFStatusR] = useState("");
  const [qT, setQT] = useState("");
  const [fDari, setFDari] = useState("");
  const [fKe, setFKe] = useState("");
  const [fStatusT, setFStatusT] = useState("");
  const [qP, setQP] = useState("");
  const [fAkun, setFAkun] = useState("");
  const [fMasuk, setFMasuk] = useState("");
  const qRtunda = useTertunda(qR);
  const pernahMuat = useRef(false);
  // Respons permintaan LAMA yang terlambat (ganti periode cepat) tidak boleh menimpa data periode yang baru dipilih.
  const urutan = useRef(0);

  const semuaRekening = rekening?.accounts || [];
  const sakelarAktif = !!kartu?.sakelarAktif;
  const kartuDari = (id) => kartu?.rekening?.find((r) => r.id === id) || null;
  const rekeningTampil = useMemo(() => saringRekening(semuaRekening, { q: qRtunda, jenis: fJenis, status: fStatusR }), [semuaRekening, qRtunda, fJenis, fStatusR]);
  const transferTampil = useMemo(() => saringTransfer(transfers, { q: qT, dari: fDari, ke: fKe, status: fStatusT, tanggalPendek }), [transfers, qT, fDari, fKe, fStatusT]);
  const pemasukanTampil = useMemo(() => incomes.filter((i) =>
    (!fAkun || i.account?.name === fAkun) &&
    (!fMasuk || i.cashAccount?.name === fMasuk) &&
    cocok(qP, i.incomeNumber, i.date, tanggalPendek(i.date), i.description, i.account?.code, i.account?.name, i.cashAccount?.name, `${Math.round(Number(i.amount) || 0)} ${(Number(i.amount) || 0).toLocaleString("id-ID")}`)
  ), [incomes, qP, fAkun, fMasuk]);
  const unik = (arr) => [...new Set(arr.filter(Boolean))].sort();

  // { diam: true } = muat ulang di latar belakang (setelah simpan/koreksi): layar tidak berubah jadi "memuat".
  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    const saya = ++urutan.current;
    if (!diam) setLoading(true);
    setError(null);
    try {
      const [r, t, i, a] = await Promise.all([
        api.getFinanceCashAccounts(),
        api.getFinanceTransfers(periode),
        api.getFinanceOtherIncome(periode),
        api.getFinanceAccounts(),
      ]);
      if (saya !== urutan.current) return;
      setRekening(r);
      setTransfers(t.transfers);
      setIncomes(i.incomes);
      setAkunPendapatan(a.accounts.filter((x) => x.type === "PENDAPATAN" && x.isPostable && x.active));
    } catch (e) {
      if (saya !== urutan.current) return;
      if (diam) setPesan(e.message || "Gagal menyegarkan data kas & bank");
      else setError(e.message || "Gagal memuat data kas & bank");
    } finally {
      if (!diam && saya === urutan.current) setLoading(false);
    }
  }, [periode]);

  // Kartu pencocokan (saldo rekening koran/hitung fisik, selisih) & jurnal tanpa rekening: posisi HARI INI, terpisah dari periode transfer/pemasukan.
  const muatKartu = useCallback(async () => {
    setKartuGagal(false);
    try {
      const [k, e] = await Promise.all([api.getRekonKartu({ to: hariIniWib() }), api.getRekonExceptionTanpaRekening()]);
      setKartu(k); setEx(e);
    } catch { setKartuGagal(true); }
  }, []);

  useEffect(() => { muat({ diam: pernahMuat.current }); pernahMuat.current = true; }, [muat]);
  useEffect(() => { muatKartu(); }, [muatKartu]);

  async function aksi(fn) {
    try {
      await fn();
      setModal(null);
      setEditRekening(null);
      await muat({ diam: true });
      muatKartu();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const batalkan = (jenis, doc, nomor) => {
    const alasan = window.prompt(`Alasan membatalkan ${nomor}? Jurnalnya akan dibalik, riwayat tetap tersimpan:`);
    if (!alasan?.trim()) return;
    return aksi(() => (jenis === "transfers" ? api.cancelFinanceTransfer(doc.id, alasan.trim()) : api.cancelFinanceOtherIncome(doc.id, alasan.trim())));
  };
  // Isi menu dari matriks aksi: Koreksi / Riwayat / Batalkan; yang tidak tersedia (mis. sudah dibatalkan) tetap tampil dengan alasannya.
  const menuTransfer = (t) => ({
    primary: null,
    items: bentukItemMenu(aksiTransferAtauPemasukan(t, { admin: adminSaatIni(), nama: "transfer" }), {
      koreksi: () => setKoreksiUntuk({ jenis: "transfers", doc: t }),
      versi: () => setVersiUntuk({ jenis: "transfers", doc: t, nomor: t.transferNumber }),
      batal: () => batalkan("transfers", t, t.transferNumber),
    }),
  });
  const menuPemasukan = (i) => ({
    primary: null,
    items: bentukItemMenu(aksiTransferAtauPemasukan(i, { admin: adminSaatIni(), nama: "pemasukan" }), {
      koreksi: () => setKoreksiUntuk({ jenis: "other-income", doc: i }),
      versi: () => setVersiUntuk({ jenis: "other-income", doc: i, nomor: i.incomeNumber }),
      batal: () => batalkan("other-income", i, i.incomeNumber),
    }),
  });

  async function hapusRekening(a) {
    if (!confirm(`Hapus rekening "${a.name}" secara permanen? Aksi ini tidak bisa dibatalkan.`)) return;
    try {
      await api.deleteFinanceCashAccount(a.id);
      await muat({ diam: true });
      muatKartu();
    } catch (e) {
      // 409 = sudah punya transaksi — pesan dari backend sudah mengarahkan
      // ke "nonaktifkan lewat Edit", tampilkan apa adanya.
      setPesan(e.message);
    }
  }

  // Rincian rekening: identitas lengkap (nomor penuh bisa disalin), akun COA, dan status pencocokan beserta sumbernya.
  function bukaRincianRekening(a) {
    const k = a.active ? kartuDari(a.id) : null;
    const st = a.active ? statusPencocokan({ kind: a.kind, k, sakelarAktif, kartuTermuat: !!kartu, kartuGagal }) : { label: "Saldo tidak tersedia — rekening nonaktif" };
    const sumberLabel = k?.sumberSaldoBank === "OPNAME_FISIK" ? "Hitung fisik kas" : k?.sumberSaldoBank === "REKENING_KORAN" ? "Rekening koran yang diimpor" : null;
    const catatan = catatanKartu({ k, sakelarAktif });
    setPanelRincian({
      judul: a.name, sub: LABEL_JENIS[a.kind], logo: <LogoBank r={a} />, chip: a.active ? { label: "Aktif", nada: "hijau" } : { label: "Nonaktif", nada: "redup" },
      ringkas: [["Saldo pembukuan", a.active ? tampilUang(a.saldo) : "Tidak tersedia — rekening nonaktif"], ["Posisi", a.active ? tanggalPendek(hariIniWib()) : "—"]],
      bagian: [
        { judul: "Rekening", baris: [["Jenis", LABEL_JENIS[a.kind]], ["Bank / penyedia", a.bankName], ["Nomor rekening", a.accountNumber ? <span className="fin-ks-nomor-lengkap">{a.accountNumber} <TombolSalin teks={a.accountNumber} /></span> : null], ["Atas nama", a.accountHolder], ["Akun COA", a.account ? `${a.account.code} · ${a.account.name}` : null], ["Catatan", a.notes]] },
        { judul: "Pencocokan & konfirmasi", baris: [["Status", st.label], ["Sumber saldo pembanding", sumberLabel], ["Saldo pembanding", k?.saldoBank != null ? `${tampilUang(k.saldoBank)}${k.tanggalSaldoBank ? ` per ${tanggalPendek(k.tanggalSaldoBank)}` : ""}` : null], ["Selisih dengan buku", k?.selisih != null ? tampilUang(k.selisih) : null], ["Baris belum dipasangkan", k?.belumCocok > 0 ? String(k.belumCocok) : null], ["Terakhir direkonsiliasi", catatan.find((c) => c.tanggal)?.tanggal ? tanggalPendek(catatan.find((c) => c.tanggal).tanggal) : null]] },
      ],
      catatan: [{ teks: "Saldo pembukuan = jumlah seluruh jurnal rekening ini. Saldo rekening koran atau hitung fisik adalah sumber terpisah dan tidak otomatis sama; keduanya dibandingkan di Rekonsiliasi." }],
      aksi: (
        <>
          <button type="button" className="fin-ks-r-tombol-lembut" onClick={() => { setPanelRincian(null); setEditRekening(a); }}>Edit rekening</button>
          <button type="button" className="fin-ks-r-tombol" onClick={() => { setPanelRincian(null); setTerpilih(a.id); }}>Buka mutasi buku</button>
        </>
      ),
    });
  }

  const rekDetail = terpilih ? semuaRekening.find((a) => a.id === terpilih) : null;
  const periodeDiHeader = tabUi !== "rekening";

  return (
    <HalamanFinance
      className="fin-halaman"
      title="Kas & Bank"
      subtitle="Saldo pembukuan dan aktivitas rekening perusahaan."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          {periodeDiHeader && <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
          {!rekDetail && (
            <Button size="sm" onClick={() => setModal(tabUi)}>
              <Plus size={14} />
              {tabUi === "rekening" ? "Rekening baru" : tabUi === "transfer" ? "Catat transfer" : "Catat pemasukan"}
            </Button>
          )}
        </>
      }
    >
      <div className="fin-ring fin-ks">
        {pesan && (
          <div className="fin-ks-pesan" role="alert">
            <p>{pesan}</p>
            <button type="button" className="fin-tombol" onClick={() => setPesan(null)}><span>Tutup</span></button>
          </div>
        )}

        {tabUi === "rekening" && rekDetail && (
          <DetailRekening
            key={rekDetail.id} rek={rekDetail} periode={periode} onPeriode={setPeriode} sakelarAktif={sakelarAktif}
            onKembali={() => { setTerpilih(null); muatKartu(); }} onRincian={() => bukaRincianRekening(rekDetail)} onBerubah={muatKartu}
          />
        )}

        {tabUi === "rekening" && !rekDetail && (
          <>
            <TotalSaldo total={rekening?.totalSaldo ?? 0} cakupan={cakupanTotal({ accounts: semuaRekening, hariIni: hariIniWib() })} />
            {kartuGagal && (
              <div className="fin-ks-pesan" role="alert"><p>Status pencocokan rekening tidak dapat dimuat. Saldo pembukuan di bawah tetap berlaku.</p><button type="button" className="fin-tombol" onClick={muatKartu}><span>Coba lagi</span></button></div>
            )}
            <StripPencocokan tampil={!!kartu && !sakelarAktif} />
            <BannerTanpaRekening ex={ex} />
            <section className="fin-panel fin-ks-panel" aria-label="Daftar rekening">
              <ToolbarRekening
                q={qR} setQ={setQR} jenis={fJenis} setJenis={setFJenis} status={fStatusR} setStatus={setFStatusR}
                tampil={rekeningTampil.length} total={semuaRekening.length} aktif={[qR.trim(), fJenis, fStatusR].filter(Boolean).length}
                onReset={() => { setQR(""); setFJenis(""); setFStatusR(""); }}
              />
              <DaftarRekening
                semua={semuaRekening} tampil={rekeningTampil} kartuDari={kartuDari} kartuTermuat={!!kartu} kartuGagal={kartuGagal} sakelarAktif={sakelarAktif}
                onBuka={(a) => setTerpilih(a.id)} onRincian={bukaRincianRekening} onEdit={(a) => setEditRekening(a)} onHapus={hapusRekening}
                onBaru={() => setModal("rekening")} onReset={() => { setQR(""); setFJenis(""); setFStatusR(""); }}
              />
            </section>
          </>
        )}

        {tabUi === "transfer" && (
          <section className="fin-panel fin-ks-panel" aria-label="Transfer antar-rekening">
            <div className="fin-ks-panel-kepala">
              <div className="fin-ks-panel-judul">
                <h2>Transfer antar-rekening</h2>
                <p>Setor tunai ke bank, tarik tunai, pindah antar bank. Bukan pendapatan dan bukan beban — laporan arus kas sengaja tidak menghitungnya sebagai uang masuk/keluar.</p>
              </div>
            </div>
            <ToolbarTransfer
              q={qT} setQ={setQT} dari={fDari} setDari={setFDari} ke={fKe} setKe={setFKe} status={fStatusT} setStatus={setFStatusT}
              opsiDari={unik(transfers.map((t) => t.fromAccount?.name))} opsiKe={unik(transfers.map((t) => t.toAccount?.name))}
              hasil={kalimatTransfer({ tampil: transferTampil.length, termuat: transfers.length })}
              aktif={[qT.trim(), fDari, fKe, fStatusT].filter(Boolean).length} onReset={() => { setQT(""); setFDari(""); setFKe(""); setFStatusT(""); }}
            />
            <DaftarTransfer
              transfers={transfers} tampil={transferTampil} accounts={semuaRekening}
              nominal={(t) => <NominalDenganBiaya d={t} />}
              renderAksi={(t) => <RowActions {...menuTransfer(t)} />}
              onBuka={(t) => setPanelRincian(specTransfer(t))} onBaru={() => setModal("transfer")}
              onReset={() => { setQT(""); setFDari(""); setFKe(""); setFStatusT(""); }}
            />
          </section>
        )}

        {tabUi === "pemasukan" && (
          <section className="fin-panel fin-ks-panel" aria-label="Pemasukan lain">
            <div className="fin-ks-panel-kepala">
              <div className="fin-ks-panel-judul">
                <h2>Pemasukan lain (di luar order)</h2>
                <p>Penjualan aset bekas, bunga bank, klaim asuransi. Pembayaran dari pelanggan tidak dicatat di sini — itu mengalir dari Order dan Pengiriman. Ringkasan dan analisis pemasukan ada di halaman Pemasukan.</p>
              </div>
            </div>
            <ToolbarPemasukanLain
              q={qP} setQ={setQP} akun={fAkun} setAkun={setFAkun} masuk={fMasuk} setMasuk={setFMasuk}
              opsiAkun={unik(incomes.map((i) => i.account?.name))} opsiMasuk={unik(incomes.map((i) => i.cashAccount?.name))}
              hasil={pemasukanTampil.length === incomes.length ? `${incomes.length} pemasukan` : `${pemasukanTampil.length} dari ${incomes.length} pemasukan`}
              aktif={[qP.trim(), fAkun, fMasuk].filter(Boolean).length} onReset={() => { setQP(""); setFAkun(""); setFMasuk(""); }}
            />
            <DaftarPemasukanLain
              incomes={incomes} tampil={pemasukanTampil} accounts={semuaRekening}
              nominal={(i) => <NominalDenganBiaya d={i} />}
              renderAksi={(i) => <RowActions {...menuPemasukan(i)} />}
              onBuka={(i) => setPanelRincian(specPemasukanLain(i))} onBaru={() => setModal("pemasukan")}
              onReset={() => { setQP(""); setFAkun(""); setFMasuk(""); }}
            />
          </section>
        )}
      </div>

      {koreksiUntuk?.jenis === "transfers" && (
        <KoreksiDialog
          jenis="transfers" doc={koreksiUntuk.doc} nomor={koreksiUntuk.doc.transferNumber}
          judulRingkas={`${formatUang(koreksiUntuk.doc.amount)} · ${koreksiUntuk.doc.fromAccount?.name} → ${koreksiUntuk.doc.toAccount?.name}`}
          kolom={[
            { kunci: "date", label: "Tanggal", tipe: "tanggal" },
            { kunci: "amount", label: "Nominal", tipe: "uang", wajib: true },
            { kunci: "feeAmount", label: "Biaya admin", tipe: "uang" },
            { kunci: "fromAccountId", label: "Dari rekening", tipe: "pilih", opsi: semuaRekening, wajib: true },
            { kunci: "toAccountId", label: "Ke rekening", tipe: "pilih", opsi: semuaRekening, wajib: true },
            { kunci: "reference", label: "Referensi", tipe: "teks" },
            { kunci: "notes", label: "Catatan", tipe: "teks" },
          ]}
          awal={{
            date: String(koreksiUntuk.doc.date || "").slice(0, 10), amount: Number(koreksiUntuk.doc.amount) || 0,
            feeAmount: Number(koreksiUntuk.doc.feeAmount) || 0, fromAccountId: koreksiUntuk.doc.fromAccountId || "",
            toAccountId: koreksiUntuk.doc.toAccountId || "", reference: koreksiUntuk.doc.reference || "", notes: koreksiUntuk.doc.notes || "",
          }}
          resolusi={(f, v) => (f === "fromAccountId" || f === "toAccountId" ? semuaRekening.find((r) => r.id === v)?.name : null)}
          onClose={() => setKoreksiUntuk(null)}
          onSaved={() => { setKoreksiUntuk(null); muat({ diam: true }); muatKartu(); }}
        />
      )}
      {koreksiUntuk?.jenis === "other-income" && (
        <KoreksiDialog
          jenis="other-income" doc={koreksiUntuk.doc} nomor={koreksiUntuk.doc.incomeNumber}
          judulRingkas={`${formatUang(koreksiUntuk.doc.amount)} · ${koreksiUntuk.doc.description}`}
          kolom={[
            { kunci: "date", label: "Tanggal", tipe: "tanggal" },
            { kunci: "amount", label: "Nominal", tipe: "uang", wajib: true },
            { kunci: "description", label: "Keterangan", tipe: "teks", wajib: true },
            { kunci: "accountId", label: "Akun pendapatan", tipe: "pilih", opsi: akunPendapatan.map((a) => ({ id: a.id, name: `${a.code} · ${a.name}` })), wajib: true },
            { kunci: "cashAccountId", label: "Masuk ke rekening", tipe: "pilih", opsi: semuaRekening, wajib: true },
            { kunci: "notes", label: "Catatan", tipe: "teks" },
          ]}
          awal={{
            date: String(koreksiUntuk.doc.date || "").slice(0, 10), amount: Number(koreksiUntuk.doc.amount) || 0,
            description: koreksiUntuk.doc.description || "", accountId: koreksiUntuk.doc.accountId || "",
            cashAccountId: koreksiUntuk.doc.cashAccountId || "", notes: koreksiUntuk.doc.notes || "",
          }}
          resolusi={(f, v) => (f === "cashAccountId" ? semuaRekening.find((r) => r.id === v)?.name
            : f === "accountId" ? akunPendapatan.find((a) => a.id === v)?.name : null)}
          onClose={() => setKoreksiUntuk(null)}
          onSaved={() => { setKoreksiUntuk(null); muat({ diam: true }); muatKartu(); }}
        />
      )}
      {versiUntuk && <RiwayatVersiDialog jenis={versiUntuk.jenis} id={versiUntuk.doc.id} nomor={versiUntuk.nomor} onClose={() => setVersiUntuk(null)} />}

      <ModalRekening
        open={modal === "rekening" || Boolean(editRekening)}
        onClose={() => { setModal(null); setEditRekening(null); }}
        initial={editRekening}
        onSubmit={(d) => aksi(() => (
          editRekening ? api.updateFinanceCashAccount(editRekening.id, d) : api.createFinanceCashAccount(d)
        ))}
      />
      <ModalTransfer
        open={modal === "transfer"} onClose={() => setModal(null)}
        rekening={(rekening?.accounts || []).filter((a) => a.active)}
        onSubmit={(d) => aksi(() => api.createFinanceTransfer(d))}
      />
      <ModalPemasukan
        open={modal === "pemasukan"} onClose={() => setModal(null)}
        rekening={(rekening?.accounts || []).filter((a) => a.active)}
        akunPendapatan={akunPendapatan}
        onSubmit={(d) => aksi(() => api.createFinanceOtherIncome(d))}
      />
      <RincianKb spec={panelRincian} onClose={() => setPanelRincian(null)} />
    </HalamanFinance>
  );
}

const REKENING_KOSONG = { name: "", kind: "BANK", bankName: "", accountNumber: "", accountHolder: "", notes: "", active: true };

function ModalRekeningIsi({ open, onClose, initial, onSubmit }) {
  const editMode = Boolean(initial);
  const [f, setF] = useState(REKENING_KOSONG);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  // Isi ulang form setiap kali modal dibuka dengan target BEDA (edit rekening
  // lain) atau dibuka dalam mode tambah baru — bukan cuma sekali saat mount,
  // supaya klik "Edit" di baris kedua tidak menampilkan data baris pertama
  // yang sempat tersimpan di state sebelumnya.
  useEffect(() => {
    if (!open) return;
    setF(initial ? {
      name: initial.name || "", kind: initial.kind || "BANK",
      bankName: initial.bankName || "", accountNumber: initial.accountNumber || "",
      accountHolder: initial.accountHolder || "", notes: initial.notes || "",
      active: initial.active ?? true,
    } : REKENING_KOSONG);
  }, [open, initial]);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title={editMode ? `Edit — ${initial?.name}` : "Rekening baru"}
      description={editMode ? "Jenis rekening tidak bisa diubah setelah dibuat." : "Kas tunai, rekening bank, atau e-wallet."}
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!f.name.trim()}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="fin-ks-form">
        <section className="fin-ks-form-grup" aria-label="Identitas rekening">
          <Field label="Nama rekening" required hint="Yang mudah dikenali tim, mis. “BCA Operasional”">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          {editMode ? (
            <Field label="Jenis">
              <Input value={f.kind === "KAS" ? "Kas tunai" : f.kind === "EWALLET" ? "E-wallet / QRIS" : "Rekening bank"} disabled />
            </Field>
          ) : (
            <Field label="Jenis">
              <Pilihan value={f.kind} onChange={(v) => set("kind", v)}>
                <option value="KAS">Kas tunai</option>
                <option value="BANK">Rekening bank</option>
                <option value="EWALLET">E-wallet / QRIS</option>
              </Pilihan>
            </Field>
          )}
          {editMode && initial?.account && (
            <p className="fin-ks-form-info">Akun COA: {initial.account.code} · {initial.account.name} (dikelola otomatis, tidak diubah dari sini)</p>
          )}
        </section>
        {f.kind !== "KAS" && (
          <section className="fin-ks-form-grup" aria-label="Data bank">
            <div className="fin-ks-form-dua">
              <Field label="Nama bank / penyedia">
                <Input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="BCA" />
              </Field>
              <Field label="Nomor rekening">
                <Input value={f.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
              </Field>
            </div>
            <Field label="Atas nama">
              <Input value={f.accountHolder} onChange={(e) => set("accountHolder", e.target.value)} />
            </Field>
          </section>
        )}
        <section className="fin-ks-form-grup" aria-label="Catatan dan status">
          <Field label="Catatan">
            <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Opsional" />
          </Field>
          {editMode && (
            <Field label="Status" hint="Nonaktifkan kalau rekening ini tidak dipakai lagi tapi riwayat transaksinya harus tetap ada (tidak bisa dihapus permanen).">
              <Pilihan value={f.active ? "1" : "0"} onChange={(v) => set("active", v === "1")}>
                <option value="1">Aktif</option>
                <option value="0">Nonaktif</option>
              </Pilihan>
            </Field>
          )}
        </section>
      </div>
    </Modal>
  );
}

function PilihRekeningKs({ label, value, onChange, rekening, error, required = true }) {
  const dipilih = rekening.find((r) => r.id === value);
  return (
    <div className="fin-ks-pilih-rek">
      <Field label={label} required={required} error={error}>
        <Pilihan value={value} onChange={onChange}>
          <option value="">— pilih —</option>
          {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Pilihan>
      </Field>
      <div className="fin-ks-pilih-info" aria-live="polite">
        {dipilih ? (
          <>
            <LogoBank r={dipilih} />
            <span><span className="fin-ks-label-kecil">Saldo pembukuan saat ini</span><span className="fin-ks-nilai">{tampilUang(dipilih.saldo)}</span></span>
          </>
        ) : <span className="fin-ks-redup">Pilih rekening untuk melihat saldonya</span>}
      </div>
    </div>
  );
}

function ModalTransferIsi({ open, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ date: "", fromAccountId: "", toAccountId: "", amount: "", feeAmount: "", reference: "", notes: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const sama = f.fromAccountId && f.fromAccountId === f.toAccountId;
  const valid = f.fromAccountId && f.toAccountId && f.fromAccountId !== f.toAccountId && Number(f.amount) > 0;
  const nominal = Number(f.amount) || 0;
  const biaya = Number(f.feeAmount) || 0;
  const asal = rekening.find((r) => r.id === f.fromAccountId);
  const tujuan = rekening.find((r) => r.id === f.toAccountId);
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat transfer antar-rekening"
      description="Memindahkan uang antar rekening perusahaan sendiri. Bukan pendapatan dan bukan beban."
      className="w-[640px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="fin-ks-form">
        <section className="fin-ks-form-grup fin-ks-form-pasang" aria-label="Rekening asal dan tujuan">
          <PilihRekeningKs label="Dari rekening" value={f.fromAccountId} onChange={(v) => set("fromAccountId", v)} rekening={rekening} />
          <span className="fin-ks-form-panah" aria-hidden="true">→</span>
          <PilihRekeningKs label="Ke rekening" value={f.toAccountId} onChange={(v) => set("toAccountId", v)} rekening={rekening} error={sama ? "Tidak boleh sama" : undefined} />
        </section>
        <section className="fin-ks-form-grup" aria-label="Nominal dan tanggal">
          <div className="fin-ks-form-dua">
            <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
            <Field label="Tanggal">
              <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} />
            </Field>
          </div>
          <Field
            label="Biaya admin transfer"
            hint="Dicatat TERPISAH, tidak dikurangkan dari nominal — supaya saldo rekening tujuan cocok dengan mutasi bank"
          >
            <InputUang value={f.feeAmount} onChange={(v) => set("feeAmount", v)} />
          </Field>
        </section>
        <section className="fin-ks-form-grup" aria-label="Referensi dan catatan">
          <div className="fin-ks-form-dua">
            <Field label="Referensi"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Nomor transaksi bank" /></Field>
            <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
        </section>
        {valid && (
          <section className="fin-ks-dampak" aria-label="Dampak transfer" data-testid="dampak-transfer">
            <p className="fin-ks-dampak-judul">Dampak pada saldo</p>
            <dl>
              <div><dt>{asal?.name} berkurang</dt><dd className="fin-ks-nilai-keluar">{tampilUang(nominal + biaya)}</dd></div>
              <div><dt>{tujuan?.name} bertambah</dt><dd className="fin-ks-nilai-masuk">{tampilUang(nominal)}</dd></div>
              {biaya > 0 && <div><dt>Biaya admin (dicatat terpisah)</dt><dd>{tampilUang(biaya)}</dd></div>}
            </dl>
            <p className="fin-ks-dampak-ket">Mengikuti aturan yang sama dengan daftar transfer: total keluar = nominal + biaya admin. Saldo akhir dihitung server setelah disimpan.</p>
          </section>
        )}
      </div>
    </Modal>
  );
}

function ModalPemasukanIsi({ open, onClose, rekening, akunPendapatan, onSubmit }) {
  const [f, setF] = useState({ date: "", amount: "", description: "", accountId: "", cashAccountId: "", notes: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.description.trim() && f.accountId && f.cashAccountId && Number(f.amount) > 0;
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat pemasukan lain"
      description="Pemasukan yang BUKAN dari order pelanggan."
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="fin-ks-form">
        <section className="fin-ks-form-grup" aria-label="Pemasukan">
          <Field label="Keterangan" required>
            <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Penjualan mesin jahit bekas" />
          </Field>
          <div className="fin-ks-form-dua">
            <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
            <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          </div>
        </section>
        <section className="fin-ks-form-grup" aria-label="Akun dan rekening">
          <Field label="Akun pendapatan" required>
            <Pilihan value={f.accountId} onChange={(v) => set("accountId", v)}>
              <option value="">— pilih —</option>
              {akunPendapatan.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </Pilihan>
          </Field>
          <Field label="Uang masuk ke" required>
            <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
          <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </section>
      </div>
    </Modal>
  );
}

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalRekening = resetSaatBuka(ModalRekeningIsi);

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalTransfer = resetSaatBuka(ModalTransferIsi);

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalPemasukan = resetSaatBuka(ModalPemasukanIsi);
