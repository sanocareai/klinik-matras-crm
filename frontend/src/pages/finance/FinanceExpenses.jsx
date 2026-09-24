import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Receipt, Pencil, History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, ExpandToggle, DetailRow, ColGroup,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { useContainerTier } from "@/hooks/useContainerTier.js";
import { api } from "@/api.js";
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { BIAYA_KOSONG, denganBiaya, biayaTransferLengkap } from "@/features/finance/biayaTransfer.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek,
  LABEL_DIVISI, PemilihBukti, SelBukti,
} from "@/features/finance/shared.jsx";
import EditDokumen, { STATUS_BISA_DIEDIT } from "@/features/finance/EditDokumen.jsx";
import { RiwayatVersiDialog } from "@/features/finance/KoreksiAman.jsx";
import { aksiDokumenBiaya } from "@/features/finance/matriksAksi.js";
import { bentukItemMenu, adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import PilihPenalang from "@/features/finance/PilihPenalang.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";

function teksMode(mode) {
  return mode === "LANGSUNG" ? "Bayar langsung" : mode === "REIMBURSEMENT" ? "Reimbursement" : "Utang";
}

function teksSumberDana(e) {
  if (e.cashAccount) return e.cashAccount.name;
  const belumDibayar = ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI"].includes(e.status) && e.mode !== "LANGSUNG";
  return belumDibayar ? "belum dibayar" : "—";
}

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

const STATUS_TAB = [
  { key: "MENUNGGU_APPROVAL", label: "Menunggu Persetujuan" },
  { key: "DISETUJUI", label: "Disetujui (belum dibayar)" },
  { key: "DIBAYAR", label: "Dibayar" },
  { key: "DITOLAK", label: "Ditolak" },
  { key: "", label: "Semua" },
];

export default function FinanceExpenses() {
  const [periode, setPeriode] = useState(periodeDefault);
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
  const [bayarUntuk, setBayarUntuk] = useState(null);
  const [editUntuk, setEditUntuk] = useState(null);
  const [versiUntuk, setVersiUntuk] = useState(null);
  // Tier lebar CONTAINER (bukan viewport) untuk kolom Klasifikasi (Kategori+
  // Divisi) / Pembayaran (Mode+Sumber Dana) — SELALU digabung, tidak pernah
  // terpisah 4 kolom lagi (polish 22 Sep 2026). ≥1250: semua kolom. 900–1249:
  // Pembayaran+Bukti pindah ke detail. 768–899: cuma Nomor/Keterangan/
  // Nominal/Status/Aksi. <768: Card List. Lihat src/hooks/useContainerTier.js.
  const [tableRef, tier] = useContainerTier();
  // Baris detail terbuka (768–1279px) — lihat ExpandToggle/DetailRow di table.jsx.
  const [terbuka, setTerbuka] = useState(() => new Set());
  const balikTerbuka = (id) => setTerbuka((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // { diam: true } = muat ulang di latar belakang: layar TIDAK berubah jadi
  // "memuat" dan posisi scroll tetap (dipakai setelah upload foto/aksi baris).
  // Argumen selain { diam: true } (mis. event klik dari onRetry) diabaikan.
  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
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
      setData(e);
      setKategori(k.categories);
      setRekening((r.accounts || []).filter((a) => a.active));
    } catch (er) {
      if (diam) setPesan(er.message || "Gagal menyegarkan daftar");
      else setError(er.message || "Gagal memuat pengeluaran");
    } finally {
      if (!diam) setLoading(false);
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

  return (
    <HalamanFinance
      title="Pengeluaran & Reimbursement"
      subtitle="Biaya operasional, upah produksi, dan uang yang ditalangi karyawan."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Pengeluaran Baru</Button>
        </>
      }
    >
      {pesan && (
        <Card className="bg-redbg">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-[13px] text-ink">{pesan}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}

      {data?.hanyaMilikSendiri && (
        <Penjelasan>
          Anda melihat pengajuan milik sendiri saja. Persetujuan & pembayaran dikerjakan tim Finance.
        </Penjelasan>
      )}

      <Penjelasan>
        Beban diakui di buku besar saat pengeluaran <strong>DISETUJUI</strong>, bukan saat dibuat — pengajuan
        yang belum tentu disetujui bukan beban. Untuk reimbursement & utang, pengakuan beban dan keluarnya
        uang adalah dua kejadian terpisah: beban tetap masuk bulan ini walau uangnya baru diganti bulan depan.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka
          label="Total di Filter Ini"
          value={formatUang(data?.total ?? 0)}
          sub={`${expenses.length} pengeluaran`}
          info="Jumlah nominal seluruh baris yang tampil di tabel bawah, sesuai filter periode & status yang sedang aktif — bukan total pengeluaran sepanjang masa."
        />
        <KartuAngka
          label="Menunggu Persetujuan"
          value={expenses.filter((e) => e.status === "MENUNGGU_APPROVAL").length}
          tone={expenses.some((e) => e.status === "MENUNGGU_APPROVAL") ? "orange" : "default"}
          info="Pengajuan yang belum ada keputusan — belum masuk buku besar sama sekali. Perlu Setujui atau Tolak."
        />
        <KartuAngka
          label="Disetujui, Belum Dibayar"
          value={expenses.filter((e) => e.status === "DISETUJUI").length}
          sub="Reimbursement & utang"
          info="Bebannya SUDAH tercatat di laba rugi, tapi uangnya belum benar-benar keluar — menunggu diganti ke karyawan atau dibayar ke pihak ketiga."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={status === t.key ? "secondary" : "neutral"} onClick={() => setStatus(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-ink3">
        Saring daftar di bawah berdasarkan tahap prosesnya — dari pengajuan sampai uangnya benar-benar keluar.
      </p>

      <FilterBar
        q={q} onQ={setQ}
        placeholder="Cari nomor, keterangan, penerima, nominal…"
        filters={[
          { key: "kat", label: "Kategori", value: fKategori, onChange: setFKategori, options: kategori.map((k) => [k.id, k.name]) },
          { key: "div", label: "Divisi", value: fDivisi, onChange: setFDivisi, options: Object.entries(LABEL_DIVISI) },
          { key: "mode", label: "Cara bayar", value: fMode, onChange: setFMode, options: [["LANGSUNG", "Bayar langsung"], ["REIMBURSEMENT", "Reimbursement"], ["UTANG", "Utang"]] },
          { key: "rekening", label: "Rekening / bank", value: fRekening, onChange: setFRekening, options: rekening.map((r) => [r.id, r.name]) },
          { key: "bukti", label: "Bukti", value: fBukti, onChange: setFBukti, options: [["ada", "Ada nota"], ["tanpa", "Tanpa nota"], ["terverifikasi", "Terverifikasi"], ["belum", "Belum diverifikasi"]] },
        ]}
        ringkasan={`${expenses.length} pengeluaran${data?.terpotong ? " · baru 300 teratas tampil — persempit pencarian atau periode" : ""}`}
        onReset={aturUlangFilter}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title="Daftar Pengeluaran"
          description="Nomor EXP dibuat otomatis per bulan."
          info="Nomor dokumen (EXP-tanggal-urutan) dibuat sistem sendiri, tidak bisa diketik manual — supaya tidak ada dua pengeluaran berbeda yang kebetulan pakai nomor yang sama."
        />
        {expenses.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={Receipt}
              title="Tidak ada pengeluaran"
              description="Belum ada pengeluaran yang cocok dengan filter ini."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Catat Pengeluaran</Button>}
            />
          </CardContent>
        ) : (
          <div ref={tableRef} data-tier={tier}>
            {tier === "card" ? (
              <CardList>
                {expenses.map((e) => {
                  const a = aksiPengeluaran(e, { aksi, setEditUntuk, setBayarUntuk, setVersiUntuk });
                  return (
                    <RowCard
                      key={e.id}
                      title={e.expenseNumber}
                      status={<StatusBadge status={e.status} />}
                      subtitle={e.description}
                      fields={[
                        { label: "Tanggal", value: tanggalPendek(e.date) },
                        { label: "Nominal", value: formatUang(e.amount) },
                        { label: "Kategori", value: e.category?.name },
                        { label: "Divisi", value: LABEL_DIVISI[e.division] || e.division },
                        { label: "Mode", value: teksMode(e.mode) },
                        { label: "Sumber Dana", value: teksSumberDana(e) },
                        { label: "Bukti", span: true, value: <SelBukti doc={e} jenis="expenses" aksi={aksi} /> },
                      ]}
                      actions={<RowActions primary={a.primary} items={a.items} />}
                    />
                  );
                })}
              </CardList>
            ) : (
              <TableWrap className="dh-table">
                <Table fixed>
                  {/* Susunan desktop PERMANEN (polish 22 Sep 2026): Klasifikasi
                      (Kategori+Divisi) & Pembayaran (Mode+Sumber Dana) SELALU
                      digabung — tidak ada lagi mode "4 kolom terpisah" di lebar
                      manapun. colgroup eksplisit per tier, bukan cuma width per TH. */}
                  {tier === "full" && <ColGroup widths={[140, 104, null, 180, 160, 112, 110, 72, AKSI_COL_WIDTH]} />}
                  {tier === "reduced" && <ColGroup widths={[140, 104, null, 140, 112, 110, 36, AKSI_COL_WIDTH]} />}
                  {tier === "minimal" && <ColGroup widths={[140, null, 104, 100, 36, AKSI_COL_WIDTH]} />}
                  <THead>
                    <TR>
                      <TH sticky width={140}>Nomor</TH>
                      {tier !== "minimal" && <TH width={104} className="whitespace-nowrap">Tanggal</TH>}
                      <TH className="pl-4">Keterangan</TH>
                      {tier === "full" && <TH width={180}>Klasifikasi</TH>}
                      {tier === "reduced" && <TH width={140}>Klasifikasi</TH>}
                      {tier === "full" && <TH width={160}>Pembayaran</TH>}
                      <TH numeric width={tier === "minimal" ? 104 : 112}>Nominal</TH>
                      <TH width={tier === "minimal" ? 100 : 110}>Status</TH>
                      {tier === "full" && <TH width={72}>Bukti</TH>}
                      {tier !== "full" && <TH width={36} />}
                      <TH width={AKSI_COL_WIDTH}>Aksi</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {expenses.map((e) => {
                      const a = aksiPengeluaran(e, { aksi, setEditUntuk, setBayarUntuk, setVersiUntuk });
                      const klasifikasi = (
                        <>
                          <span className="block truncate text-[12px]" title={e.category?.name}>{e.category?.name}</span>
                          <span className="block truncate text-[11px] text-ink3">{LABEL_DIVISI[e.division] || e.division}</span>
                        </>
                      );
                      const pembayaran = (
                        <>
                          <span className="block truncate text-[12px] text-ink2">{teksMode(e.mode)}</span>
                          <span className="block truncate text-[11px] text-ink3" title={teksSumberDana(e)}>{teksSumberDana(e)}</span>
                        </>
                      );
                      const bukti = (
                        <>
                          <SelBukti doc={e} jenis="expenses" aksi={aksi} compact />
                          {e.notaWajib && !e.receiptUrl && ["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status) && (
                            <span className="mt-1 block text-[11px] font-semibold text-red">Nota wajib</span>
                          )}
                        </>
                      );
                      return (
                        <React.Fragment key={e.id}>
                          <TR>
                            <TD sticky className="font-mono text-[12px]">{e.expenseNumber}</TD>
                            {tier !== "minimal" && <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(e.date)}</TD>}
                            <TD className="max-w-0 w-full pl-4">
                              {/* line-clamp-2 di SPAN dalam, bukan di <td> — lihat catatan clamp2 di table.jsx. */}
                              <span className="line-clamp-2 break-words" title={e.description}>{e.description}</span>
                              {e.reimburseTo && <span className="block truncate text-[11px] text-ink3" title={`ditalangi ${e.reimburseTo.name}`}>ditalangi {e.reimburseTo.name}</span>}
                              {e.supplier && <span className="block truncate text-[11px] text-ink3" title={`ke ${e.supplier.name}`}>ke {e.supplier.name}</span>}
                              {!e.supplier && e.payeeName && e.payeeName.trim().toLowerCase() !== (e.reimburseTo?.name || "").trim().toLowerCase() && <span className="block truncate text-[11px] text-ink3" title={`ke ${e.payeeName}`}>ke {e.payeeName}</span>}
                            </TD>
                            {(tier === "full" || tier === "reduced") && <TD className="min-w-0">{klasifikasi}</TD>}
                            {tier === "full" && <TD className="min-w-0">{pembayaran}</TD>}
                            <TD numeric><Uang value={e.amount} /></TD>
                            <TD><StatusBadge status={e.status} /></TD>
                            {tier === "full" && <TD>{bukti}</TD>}
                            {tier !== "full" && (
                              <TD>
                                <ExpandToggle open={terbuka.has(e.id)} onClick={() => balikTerbuka(e.id)} label="Rincian" />
                              </TD>
                            )}
                            <TD>
                              <RowActions primary={a.primary} items={a.items} />
                            </TD>
                          </TR>
                          {tier === "reduced" && (
                            <DetailRow
                              open={terbuka.has(e.id)}
                              colSpan={8}
                              fields={[
                                { label: "Mode", value: teksMode(e.mode) },
                                { label: "Sumber Dana", value: teksSumberDana(e) },
                                { label: "Bukti", value: bukti },
                              ]}
                            />
                          )}
                          {tier === "minimal" && (
                            <DetailRow
                              open={terbuka.has(e.id)}
                              colSpan={6}
                              fields={[
                                { label: "Tanggal", value: tanggalPendek(e.date) },
                                { label: "Kategori", value: e.category?.name },
                                { label: "Divisi", value: <Badge variant="neutral">{LABEL_DIVISI[e.division] || e.division}</Badge> },
                                { label: "Mode", value: teksMode(e.mode) },
                                { label: "Sumber Dana", value: teksSumberDana(e) },
                                { label: "Bukti", value: bukti },
                              ]}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </div>
        )}
      </Card>

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
    </HalamanFinance>
  );
}

function ModalPengeluaran({ open, onClose, kategori, rekening, onSubmit }) {
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
