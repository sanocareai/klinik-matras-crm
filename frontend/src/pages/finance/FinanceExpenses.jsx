import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePeriodeFinance } from "@/lib/periodeBersama.js";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { api } from "@/api.js";
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { BIAYA_KOSONG, denganBiaya, biayaTransferLengkap } from "@/features/finance/biayaTransfer.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, formatUang, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, LABEL_DIVISI, PemilihBukti,
} from "@/features/finance/shared.jsx";
import { useKontrak } from "@/features/finance/kontrakData.jsx";
import { StripBiaya, KpiStatis, ToolbarBiaya, DaftarBiaya } from "@/features/finance/PengeluaranPanels.jsx";
import { Cakupan } from "@/features/finance/RingkasanKecil.jsx";
import { IkKasBank } from "@/components/financeIcons.jsx";
import { IkJam, IkDokumen } from "@/components/financeIconsBiaya.jsx";
import { STATUS_TAB, kpiPengeluaran, kalimatBatas, jumlahFilterAktif } from "@/features/finance/pengeluaranTampilan.js";
import EditDokumen, { STATUS_BISA_DIEDIT } from "@/features/finance/EditDokumen.jsx";
import { RiwayatVersiDialog } from "@/features/finance/KoreksiAman.jsx";
import { aksiDokumenBiaya } from "@/features/finance/matriksAksi.js";
import { bentukItemMenu, adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { useTertunda } from "@/features/finance/FilterBar.jsx";
import PilihPenalang from "@/features/finance/PilihPenalang.jsx";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specPengeluaran } from "@/features/finance/detailSpecs.js";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { resetSaatBuka } from "@/features/finance/resetSaatBuka.jsx";

// Aksi PALING RELEVAN per status jadi tombol utama; sisanya masuk menu
// titik-tiga — perilaku & permission SAMA PERSIS dengan sebelumnya (tidak
// ada aksi yang dihapus), cuma tata letaknya yang berubah supaya tidak
// bertumpuk di kolom Aksi yang lebarnya tetap.
function aksiPengeluaran(e, { aksi, setEditUntuk, setBayarUntuk, setVersiUntuk }) {
  const menungguKeputusan = ["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status);
  const notaBelumAda = !!e.notaWajib && !e.receiptUrl;

  // Isi menu datang dari matriks aksi (features/finance/matriksAksi.js): Edit (belum berjurnal) / Koreksi (sudah berjurnal);
  // tindakan yang tidak tersedia TETAP tampil dengan alasannya.
  const items = bentukItemMenu(aksiDokumenBiaya(e, { admin: adminSaatIni(), nama: "pengeluaran" }), {
    edit: () => setEditUntuk(e),
    versi: () => setVersiUntuk(e),
    tolak: () => {
      const alasan = window.prompt("Alasan penolakan:");
      if (alasan?.trim()) return aksi(() => api.rejectFinanceExpense(e.id, alasan.trim()));
    },
    batalkan: () => {
      const alasan = window.prompt("Alasan membatalkan pengeluaran ini (salah input total)? Jurnalnya akan dibalik, riwayat tetap tersimpan:");
      if (alasan?.trim()) return aksi(() => api.cancelFinanceExpense(e.id, alasan.trim()));
    },
  });

  if (menungguKeputusan) {
    return {
      primary: {
        label: "Setujui", variant: "secondary",
        disabled: notaBelumAda,
        title: notaBelumAda ? "Nota wajib: unggah foto nota di kolom Bukti dulu, baru bisa disetujui." : undefined,
        confirmText: `Setujui ${e.expenseNumber} sebesar ${formatUang(e.amount)}? Beban akan langsung masuk buku besar.`,
        onClick: () => aksi(() => api.approveFinanceExpense(e.id)),
      },
      items,
    };
  }
  if (e.status === "DISETUJUI") {
    return { primary: { label: "Bayar", variant: "secondary", onClick: () => setBayarUntuk(e) }, items };
  }
  return { primary: null, items };
}

// PENGELUARAN & REIMBURSEMENT.
//
// ⚠️ YANG TIDAK DICATAT DI SINI, dan ini disengaja:
//   - Biaya kendaraan (BBM/tol/parkir/servis) → tetap di Delivery > Biaya.
//   - Belanja iklan bulanan → tetap di Pengaturan CRM.
//   - Bahan baku → nilainya mengalir sendiri dari ledger stok Gudang; yang
//     dibeli manual/tunai (plus aset & uang muka) → tab Pembelian.
// Semuanya sudah punya tempat input yang benar dan orang yang paling tahu
// angkanya. Modul Finance MEMBACA dan membukukannya, bukan meminta
// diketik ulang — menyalinnya ke sini akan menghasilkan dua angka untuk
// pengeluaran yang sama, dan yang kedua pasti tertinggal.


export default function FinanceExpenses() {
  const [periode, setPeriode] = usePeriodeFinance();
  // Default "Semua" (bukan "Menunggu Persetujuan") — histori impor Notion
  // (D-181, 18 Sep 2026) masuk sebagai DIBAYAR langsung (transaksi lama,
  // sudah lunas), jadi default lama membuat halaman ini tampak kosong
  // padahal datanya ada ribuan baris.
  const [status, setStatus] = useState("");
  // Pencarian & filter — dikirim ke SERVER (bukan disaring di browser) supaya
  // hasilnya mencakup seluruh periode, bukan cuma 300 baris yang termuat.
  const [q, setQ] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fDivisi, setFDivisi] = useState("");
  const [fMode, setFMode] = useState("");
  const [fRekening, setFRekening] = useState("");
  const [fBukti, setFBukti] = useState("");
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);
  const [data, setData] = useState(null);
  const [kategori, setKategori] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [panelRincian, setPanelRincian] = useState(null); // panel detail samping (klik baris)
  const [bayarUntuk, setBayarUntuk] = useState(null);
  const [editUntuk, setEditUntuk] = useState(null);
  const [versiUntuk, setVersiUntuk] = useState(null);
  // Respons permintaan LAMA yang terlambat tidak boleh menimpa periode/filter yang baru dipilih: hanya permintaan terakhir yang mengisi layar.
  const urutan = useRef(0);

  // { diam: true } = muat ulang di latar belakang: layar TIDAK berubah jadi
  // "memuat" dan posisi scroll tetap (dipakai setelah upload foto/aksi baris).
  // Argumen selain { diam: true } (mis. event klik dari onRetry) diabaikan.
  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    const saya = ++urutan.current;
    if (!diam) setLoading(true);
    setError(null);
    try {
      const [e, k, r] = await Promise.all([
        api.getFinanceExpenses({
          ...periode, status, q: qTunda.trim(),
          categoryId: fKategori, division: fDivisi, mode: fMode, cashAccountId: fRekening, bukti: fBukti,
        }),
        api.getFinanceExpenseCategories(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
      ]);
      if (saya !== urutan.current) return;
      setData(e);
      setKategori(k.categories);
      setRekening((r.accounts || []).filter((a) => a.active));
    } catch (er) {
      if (saya !== urutan.current) return;
      if (diam) setPesan(er.message || "Gagal menyegarkan daftar");
      else setError(er.message || "Gagal memuat pengeluaran");
    } finally {
      if (!diam && saya === urutan.current) setLoading(false);
    }
  }, [periode, status, qTunda, fKategori, fDivisi, fMode, fRekening, fBukti]);

  // Pemuatan pertama menampilkan layar "memuat"; setelah itu (ganti filter,
  // ketik pencarian) daftar disegarkan diam-diam supaya kolom cari tidak
  // ikut hilang dan kursor tidak lepas.
  useEffect(() => {
    muat({ diam: pernahMuat.current });
    pernahMuat.current = true;
  }, [muat]);

  function aturUlangFilter() {
    setQ(""); setFKategori(""); setFDivisi(""); setFMode(""); setFRekening(""); setFBukti("");
  }

  async function aksi(fn) {
    try {
      await fn();
      setModalBaru(false);
      setBayarUntuk(null);
      await muat({ diam: true });
    } catch (e) {
      setPesan(e.message);
    }
  }

  const expenses = data?.expenses || [];
  const peta = useMemo(() => new Map(rekening.map((r) => [r.id, r])), [rekening]);
  const kpi = kpiPengeluaran({ data, status, expenses });
  const hasil = kalimatBatas({ termuat: expenses.length, total: data?.ringkasan?.jumlahSemua, terpotong: !!data?.terpotong });
  const kontrak = useKontrak();
  const basis = kontrak?.peta.get("pengeluaran_aktif")?.basisLabel;
  const kosongAwal = !status && jumlahFilterAktif({ fKategori, fDivisi, fMode, fRekening, fBukti, q }) === 0;
  const filter = {
    kategori: { nilai: fKategori, ubah: setFKategori }, divisi: { nilai: fDivisi, ubah: setFDivisi }, mode: { nilai: fMode, ubah: setFMode },
    rekening: { nilai: fRekening, ubah: setFRekening }, bukti: { nilai: fBukti, ubah: setFBukti },
  };
  const renderAksi = (e) => {
    const a = aksiPengeluaran(e, { aksi, setEditUntuk, setBayarUntuk, setVersiUntuk });
    return <RowActions primary={a.primary} items={a.items} />;
  };

  return (
    <HalamanFinance
      className="fin-halaman"
      title="Pengeluaran"
      subtitle="Biaya operasional dan penggantian uang karyawan."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          {/* Export Excel: kirim filter/periode/pencarian yang SEDANG aktif — server menjalankan query yang sama dengan layar. */}
          <TombolExportExcel
            modul="pengeluaran"
            disabled={data?.hanyaMilikSendiri}
            ambilBody={() => ({
              periode: { from: periode.from, to: periode.to },
              filter: { status, q: qTunda.trim(), categoryId: fKategori, division: fDivisi, mode: fMode, cashAccountId: fRekening, bukti: fBukti },
              filterLabel: labelFilterAktif([
                ["Status", STATUS_TAB.find((t) => t.key === status)?.label],
                ["Kategori", kategori.find((k) => k.id === fKategori)?.name],
                ["Divisi", LABEL_DIVISI[fDivisi]],
                ["Cara bayar", { LANGSUNG: "Bayar langsung", REIMBURSEMENT: "Reimbursement", UTANG: "Utang" }[fMode]],
                ["Rekening", rekening.find((r) => r.id === fRekening)?.name],
                ["Bukti", { ada: "Ada nota", tanpa: "Tanpa nota", terverifikasi: "Terverifikasi", belum: "Belum diverifikasi" }[fBukti]],
                ["Pencarian", qTunda.trim()],
              ]),
            })}
          />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Pengeluaran baru</Button>
        </>
      }
    >
      <div className="fin-ring fin-by">
        {pesan && (
          <div className="fin-by-pesan" role="alert">
            <p>{pesan}</p>
            <button type="button" className="fin-tombol" onClick={() => setPesan(null)}><span>Tutup</span></button>
          </div>
        )}

        <StripBiaya milikSendiri={data?.hanyaMilikSendiri} periode={periode} />

        <section aria-label="Angka utama" className="fin-kpi-grid fin-kpi-grid-3">
          <KpiStatis
            nada="biru" Ikon={IkKasBank} label={kpi.labelTotal} metrik={kpi.adaKontrakTotal ? "pengeluaran_aktif" : undefined}
            nilai={formatUang(kpi.nilai)}
            ket={`${kpi.jumlah.toLocaleString("id-ID")} pengeluaran${kpi.tidakDihitung ? ` · ${kpi.tidakDihitung.jumlah.toLocaleString("id-ID")} dibatalkan/ditolak tidak dihitung` : ""}`}
            info={`Dihitung dari SEMUA pengeluaran sesuai filter periode & lainnya, bukan hanya baris yang tampil di daftar (daftar memuat maksimal 300 baris). Tanpa memilih tahap, pengeluaran yang dibatalkan atau ditolak tidak ikut dijumlahkan${kpi.tidakDihitung ? ` (${formatUang(kpi.tidakDihitung.nominal)} tidak dihitung)` : ""}; pilih tahap Ditolak untuk melihat totalnya. Ini nilai biaya yang diajukan/disetujui — belum tentu sudah dibayar.`}
          />
          <KpiStatis
            nada="lavender" Ikon={IkJam} label="Menunggu persetujuan" nilai={kpi.menunggu.toLocaleString("id-ID")}
            ket="Pengajuan yang perlu diputuskan"
            info="Pengajuan yang belum ada keputusan — belum masuk buku besar sama sekali. Perlu Setujui atau Tolak."
          />
          <KpiStatis
            nada="muda" Ikon={IkDokumen} label="Disetujui, belum dibayar" metrik="komitmen_belum_dibayar" nilai={kpi.disetujui.toLocaleString("id-ID")}
            ket="Reimbursement dan utang"
            info="Bebannya SUDAH tercatat di laba rugi, tapi uangnya belum benar-benar keluar — menunggu diganti ke karyawan atau dibayar ke pihak ketiga."
          />
        </section>
        {basis && <p className="fin-by-basis"><Cakupan nada="biru">Periode terpilih</Cakupan> Mengikuti {basis.charAt(0).toLowerCase() + basis.slice(1)}</p>}

        <section className="fin-panel fin-by-panel" aria-label="Daftar pengeluaran" data-testid="panel-daftar-pengeluaran">
          <ToolbarBiaya
            status={status} setStatus={setStatus} q={q} setQ={setQ} f={filter} kategori={kategori} rekening={rekening}
            onReset={aturUlangFilter} hasil={hasil} perStatus={status ? undefined : data?.ringkasan?.perStatus}
          />
          <DaftarBiaya
            expenses={expenses} peta={peta} aksi={aksi} renderAksi={renderAksi} kosongAwal={kosongAwal}
            onBuka={(e) => setPanelRincian(specPengeluaran(e, { badge: <StatusBadge status={e.status} /> }))}
            onBaru={() => setModalBaru(true)} onReset={() => { aturUlangFilter(); setStatus(""); }}
          />
        </section>
      </div>

      <ModalPengeluaran
        open={modalBaru} onClose={() => setModalBaru(false)}
        kategori={kategori} rekening={rekening}
        onSubmit={(d) => aksi(() => api.createFinanceExpense(d))}
      />

      <ModalBayar
        expense={bayarUntuk} onClose={() => setBayarUntuk(null)}
        rekening={rekening}
        onSubmit={(d) => aksi(() => api.payFinanceExpense(bayarUntuk.id, d))}
      />
      <EditDokumen
        doc={editUntuk} jenis="expenses" kategori={kategori} rekening={rekening}
        onClose={() => setEditUntuk(null)}
        onSaved={() => { setEditUntuk(null); muat({ diam: true }); }}
      />
      {versiUntuk && <RiwayatVersiDialog jenis="expenses" id={versiUntuk.id} nomor={versiUntuk.expenseNumber} onClose={() => setVersiUntuk(null)} />}
      <PanelDetail spec={panelRincian} onClose={() => setPanelRincian(null)} />
    </HalamanFinance>
  );
}

function ModalPengeluaranIsi({ open, onClose, kategori, rekening, onSubmit }) {
  const [f, setF] = useState({
    date: "", amount: "", description: "", categoryId: "", division: "",
    mode: "LANGSUNG", cashAccountId: "", reimburseToId: "", payeeName: "", orderId: "", notes: "", receiptUrl: "", ...BIAYA_KOSONG,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const valid = f.description.trim() && f.categoryId && Number(f.amount) > 0 &&
    (f.mode !== "LANGSUNG" || (f.cashAccountId && biayaTransferLengkap(rek, f)));

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Pengeluaran Baru"
      description="Pengajuan lahir berstatus Menunggu Persetujuan dan belum menyentuh buku besar."
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(denganBiaya(f, f.mode === "LANGSUNG"))} disabled={!valid}>Ajukan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Upah harian tukang minggu ke-3" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <Field label="Kategori biaya" required hint="Menentukan akun beban di buku besar">
          <Pilihan value={f.categoryId} onChange={(v) => {
            set("categoryId", v);
            const k = kategori.find((x) => x.id === v);
            if (k && !f.division) set("division", k.division);
          }}>
            <option value="">— pilih —</option>
            {kategori.map((k) => (
              <option key={k.id} value={k.id}>{k.name} → {k.account?.code} {k.account?.name}</option>
            ))}
          </Pilihan>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Dibebankan ke divisi">
            <Pilihan value={f.division} onChange={(v) => set("division", v)}>
              <option value="">— ikut kategori —</option>
              {Object.entries(LABEL_DIVISI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Pilihan>
          </Field>
          <Field label="Cara bayar">
            <Pilihan value={f.mode} onChange={(v) => set("mode", v)}>
              <option value="LANGSUNG">Bayar langsung dari kas/bank</option>
              <option value="REIMBURSEMENT">Ditalangi karyawan (reimbursement)</option>
              <option value="UTANG">Belum dibayar (jadi utang)</option>
            </Pilihan>
          </Field>
        </div>
        {f.mode === "LANGSUNG" && (
          <Field label="Uang keluar dari" required>
            <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
        )}
        {f.mode === "LANGSUNG" && <CaraBayarTransfer rekening={rek} nominal={f.amount} value={f} onChange={(b) => setF((s) => ({ ...s, ...b }))} />}
        {f.mode === "REIMBURSEMENT" && <PilihPenalang value={f.reimburseToId} onChange={(v) => set("reimburseToId", v)} />}
        <Field label={f.mode === "REIMBURSEMENT" ? "Toko / pihak yang dibayar" : "Dibayarkan kepada"} hint={f.mode === "REIMBURSEMENT" ? "Opsional — bukan penalang (penalang dipilih di atas)" : "Nama toko/tukang — opsional"}>
          <Input value={f.payeeName} onChange={(e) => set("payeeName", e.target.value)} />
        </Field>
        <Field label="Order terkait" hint="Opsional — untuk membebankan biaya ke order tertentu">
          <OrderPicker value={f.orderId} onChange={(id) => set("orderId", id)} placeholder="Cari order…" />
        </Field>
        <Field label="Foto nota / bukti" hint="Wajib sebelum disetujui untuk reimbursement, pembelian, dan nominal besar — foto nota dari bawahan di sini">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalBayar({ expense, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ cashAccountId: "", paidAt: "", ...BIAYA_KOSONG });
  useEffect(() => { setF({ cashAccountId: expense?.cashAccountId || "", paidAt: "", ...BIAYA_KOSONG }); }, [expense]);
  if (!expense) return null;
  const rek = rekening.find((r) => r.id === f.cashAccountId);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Bayar ${expense.expenseNumber}`}
      description={`${formatUang(expense.amount)} · ${expense.description}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(denganBiaya(f))} disabled={!f.cashAccountId || !biayaTransferLengkap(rek, f)}>Catat Pembayaran</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink2">
          Bebannya sudah diakui saat pengeluaran ini disetujui. Langkah ini mencatat <strong>keluarnya uang</strong>
          {" "}dan melunasi {expense.mode === "REIMBURSEMENT" ? "utang reimbursement ke karyawan" : "utang ke pihak ketiga"}.
        </p>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => setF((s) => ({ ...s, cashAccountId: v }))}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <CaraBayarTransfer rekening={rek} nominal={expense.amount} value={f} onChange={(b) => setF((s) => ({ ...s, ...b }))} />
        <Field label="Tanggal bayar">
          <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.paidAt} onChange={(v) => setF((s) => ({ ...s, paidAt: v }))} />
        </Field>
      </div>
    </Modal>
  );
}

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalPengeluaran = resetSaatBuka(ModalPengeluaranIsi);
