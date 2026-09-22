import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ShoppingCart, Pencil, Wallet, History, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, ExpandToggle, DetailRow, ColGroup } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { useContainerTier } from "@/hooks/useContainerTier.js";
import { api } from "@/api.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek,
  LABEL_DIVISI, PemilihBukti, SelBukti,
} from "@/features/finance/shared.jsx";
import EditDokumen, { STATUS_BISA_DIEDIT } from "@/features/finance/EditDokumen.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import PilihPenalang from "@/features/finance/PilihPenalang.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";

function teksModePembelian(mode) {
  return mode === "LANGSUNG" ? "Bayar langsung" : mode === "REIMBURSEMENT" ? "Reimbursement" : "Utang";
}
function teksSumberDanaPembelian(p) {
  if (p.cashAccount) return p.cashAccount.name;
  const belumDibayar = ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI"].includes(p.status) && p.mode !== "LANGSUNG";
  return belumDibayar ? "belum dibayar" : "—";
}
// Indikator ringkas "DP Rp…/Sisa Rp…" (target) atau "Terpakai/Tersedia"
// (sumber DP) — dp*/sisaUtang HANYA ada di respons list untuk baris yang
// relevan (lihat GET /purchases di financeTransactions.js), jadi baris lain
// tidak dapat badge apa pun (tabel tidak makin sesak). Detail lengkap +
// histori ada di aksi "Riwayat Uang Muka".
function teksDpBadge(p) {
  if (p.dpDiterapkan != null) return `DP ${formatUang(p.dpDiterapkan)} · Sisa ${formatUang(p.sisaUtang)}`;
  if (p.dpDigunakan != null) return `Terpakai ${formatUang(p.dpDigunakan)} · Tersedia ${formatUang(p.dpTersedia)}`;
  return null;
}

// Aksi PALING RELEVAN per status jadi tombol utama; sisanya masuk menu
// titik-tiga — sama persis dengan pola FinanceExpenses.jsx (lihat komentar
// di sana untuk alasannya).
function aksiPembelian(p, { aksi, setEditUntuk, setBayarUntuk, setTerapkanUntuk, setRiwayatUntuk }) {
  const bisaEdit = STATUS_BISA_DIEDIT.includes(p.status);
  const bisaBatal = ["DISETUJUI", "DIBAYAR"].includes(p.status);
  const menungguKeputusan = ["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status);
  const notaBelumAda = !!p.notaWajib && !p.receiptUrl;

  // "Terapkan Uang Muka" HANYA untuk pembelian mode Utang yang sudah
  // Disetujui (Utang Usaha-nya sudah lahir, belum dibayar) dan BUKAN DP itu
  // sendiri — pola eligibilitas persis yang ditegakkan ulang di server
  // (routes/purchases/advance-applications), jadi tombol ini murni
  // shortcut; server tetap sumber kebenaran terakhir.
  const bisaTerapkanDp = p.mode === "UTANG" && p.status === "DISETUJUI" && p.category?.code !== "UANG_MUKA_PEMBELIAN";
  // Riwayat DP relevan untuk kedua sisi: pembelian mode Utang (mungkin
  // menerima DP) dan pembelian kategori Uang Muka (mungkin sudah dipakai).
  const punyaRiwayatDp = ["DISETUJUI", "DIBAYAR", "DIBATALKAN"].includes(p.status)
    && (p.mode === "UTANG" || p.category?.code === "UANG_MUKA_PEMBELIAN");

  const items = [
    bisaEdit && { key: "edit", label: "Edit / koreksi", icon: Pencil, onClick: () => setEditUntuk(p) },
    bisaTerapkanDp && { key: "terapkan-dp", label: "Terapkan Uang Muka", icon: Wallet, onClick: () => setTerapkanUntuk(p) },
    punyaRiwayatDp && { key: "riwayat-dp", label: "Riwayat Uang Muka", icon: History, onClick: () => setRiwayatUntuk(p) },
    menungguKeputusan && {
      key: "tolak", label: "Tolak", destructive: true,
      onClick: () => {
        const alasan = window.prompt("Alasan penolakan:");
        if (alasan?.trim()) return aksi(() => api.rejectFinancePurchase(p.id, alasan.trim()));
      },
    },
    bisaBatal && {
      key: "batalkan", label: "Batalkan", destructive: true,
      onClick: () => {
        const alasan = window.prompt("Alasan membatalkan pembelian ini (salah input total)? Jurnalnya akan dibalik, riwayat tetap tersimpan:");
        if (alasan?.trim()) return aksi(() => api.cancelFinancePurchase(p.id, alasan.trim()));
      },
    },
  ].filter(Boolean);

  if (menungguKeputusan) {
    return {
      primary: {
        label: "Setujui", variant: "secondary",
        disabled: notaBelumAda,
        title: notaBelumAda ? "Nota wajib: unggah foto nota di kolom Bukti dulu, baru bisa disetujui." : undefined,
        confirmText: `Setujui ${p.purchaseNumber} sebesar ${formatUang(p.amount)}? Nilainya akan langsung masuk buku besar.`,
        onClick: () => aksi(() => api.approveFinancePurchase(p.id)),
      },
      items,
    };
  }
  if (p.status === "DISETUJUI") {
    return { primary: { label: "Bayar", variant: "secondary", onClick: () => setBayarUntuk(p) }, items };
  }
  return { primary: null, items };
}

// PEMBELIAN — barang/aset yang DIBELI dari luar, tanpa tagihan resmi supplier:
// bahan baku (manual, sebelum Gudang dipakai penuh), aset tetap (kendaraan,
// peralatan & mesin), aset tak berwujud (paten/HAKI/domain), dan uang muka/DP.
//
// ⚠️ BEDA DENGAN DUA TAB TETANGGA, dan ini disengaja:
//   - Pengeluaran & Reimbursement → BIAYA operasional yang habis terpakai
//     (bensin, tol, gaji, listrik, sewa). Bukan barang/aset.
//   - Supplier & Utang > Tagihan → pembelian BERTAGIHAN resmi (ada invoice
//     supplier, termin pembayaran, opsional menaut penerimaan barang Gudang).
// Tab ini untuk pembelian yang TIDAK lewat proses tagihan formal itu —
// dibayar tunai/transfer langsung, atau ditalangi dulu oleh karyawan.
//
// ⚠️ UANG MUKA (DP): jenis "Uang Muka Pembelian" mencatat DP sebagai ASET
// (akun 1-1500), bukan beban. Begitu pembelian mode Utang dari supplier yang
// SAMA sudah Disetujui, saldo DP itu bisa DITERAPKAN lewat aksi "Terapkan
// Uang Muka" (menu titik-tiga baris pembelian mode Utang) — mengotomasi
// langkah yang sebelumnya harus manual lewat Jurnal Umum. Lihat
// services/finance/posting/purchaseAdvance.js untuk jurnalnya.

const STATUS_TAB = [
  { key: "MENUNGGU_APPROVAL", label: "Menunggu Persetujuan" },
  { key: "DISETUJUI", label: "Disetujui (belum dibayar)" },
  { key: "DIBAYAR", label: "Dibayar" },
  { key: "DITOLAK", label: "Ditolak" },
  { key: "", label: "Semua" },
];

export default function FinancePurchases() {
  const [periode, setPeriode] = useState(periodeDefault);
  // Default "Semua" — lihat catatan yang sama di FinanceExpenses.jsx
  // (histori impor Notion masuk sebagai DIBAYAR langsung, jadi default
  // "Menunggu Persetujuan" membuat halaman ini tampak kosong).
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
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [bayarUntuk, setBayarUntuk] = useState(null);
  const [editUntuk, setEditUntuk] = useState(null);
  const [terapkanUntuk, setTerapkanUntuk] = useState(null);
  const [riwayatUntuk, setRiwayatUntuk] = useState(null);
  const [tableRef, tier] = useContainerTier();
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
      const [p, k, r, s] = await Promise.all([
        api.getFinancePurchases({
          ...periode, status, q: qTunda.trim(),
          categoryId: fKategori, division: fDivisi, mode: fMode, cashAccountId: fRekening, bukti: fBukti,
        }),
        api.getFinancePurchaseCategories(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
        api.getFinanceSuppliers().catch(() => ({ suppliers: [] })),
      ]);
      setData(p);
      setKategori(k.categories);
      setRekening((r.accounts || []).filter((a) => a.active));
      setSuppliers((s.suppliers || []).filter((x) => x.active));
    } catch (er) {
      if (diam) setPesan(er.message || "Gagal menyegarkan daftar");
      else setError(er.message || "Gagal memuat pembelian");
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
      setTerapkanUntuk(null);
      await muat({ diam: true });
    } catch (e) {
      // 409 = data sudah berubah di server sejak layar ini terakhir dimuat
      // (mis. DP/pembelian sudah dipakai/dibatalkan orang lain barusan) —
      // muat ulang supaya layar tidak menampilkan pilihan yang sudah basi,
      // BUKAN cuma menunjukkan error di atas data lama.
      if (e.status === 409) await muat({ diam: true });
      setPesan(e.message);
    }
  }

  const purchases = data?.purchases || [];

  return (
    <HalamanFinance
      title="Pembelian"
      subtitle="Bahan baku, aset tetap, aset tak berwujud, dan uang muka (DP) ke supplier."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Pembelian Baru</Button>
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
          Anda melihat pengajuan milik sendiri saja. Persetujuan &amp; pembayaran dikerjakan tim Finance.
        </Penjelasan>
      )}

      <Penjelasan>
        Tab ini untuk <strong>barang/aset yang dibeli tanpa tagihan resmi supplier</strong> — dibayar tunai/transfer
        langsung atau ditalangi karyawan. Pembelian yang ada invoice &amp; terminnya dicatat di{" "}
        <strong>Supplier &amp; Utang → Tagihan</strong>, sementara biaya operasional yang habis terpakai (bensin, tol,
        gaji, listrik) tetap di <strong>Pengeluaran &amp; Reimbursement</strong>. Untuk jenis <strong>Uang Muka
        Pembelian</strong>, nominalnya dicatat sebagai aset dulu (bukan beban) sampai barangnya diterima.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka
          label="Total di Filter Ini"
          value={formatUang(data?.total ?? 0)}
          sub={`${purchases.length} pembelian`}
          info="Jumlah nominal seluruh baris yang tampil di tabel bawah, sesuai filter periode & status yang sedang aktif — bukan total pembelian sepanjang masa."
        />
        <KartuAngka
          label="Menunggu Persetujuan"
          value={purchases.filter((p) => p.status === "MENUNGGU_APPROVAL").length}
          tone={purchases.some((p) => p.status === "MENUNGGU_APPROVAL") ? "orange" : "default"}
          info="Pengajuan yang belum ada keputusan — belum masuk buku besar sama sekali. Perlu Setujui atau Tolak."
        />
        <KartuAngka
          label="Disetujui, Belum Dibayar"
          value={purchases.filter((p) => p.status === "DISETUJUI").length}
          sub="Reimbursement & utang"
          info="Barang/asetnya SUDAH tercatat di buku besar, tapi uangnya belum benar-benar keluar — menunggu diganti ke karyawan atau dibayar ke pihak ketiga."
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
          { key: "kat", label: "Jenis", value: fKategori, onChange: setFKategori, options: kategori.map((k) => [k.id, k.name]) },
          { key: "div", label: "Divisi", value: fDivisi, onChange: setFDivisi, options: Object.entries(LABEL_DIVISI) },
          { key: "mode", label: "Cara bayar", value: fMode, onChange: setFMode, options: [["LANGSUNG", "Bayar langsung"], ["REIMBURSEMENT", "Reimbursement"], ["UTANG", "Utang"]] },
          { key: "rekening", label: "Rekening / bank", value: fRekening, onChange: setFRekening, options: rekening.map((r) => [r.id, r.name]) },
          { key: "bukti", label: "Bukti", value: fBukti, onChange: setFBukti, options: [["ada", "Ada nota"], ["tanpa", "Tanpa nota"], ["terverifikasi", "Terverifikasi"], ["belum", "Belum diverifikasi"]] },
        ]}
        ringkasan={`${purchases.length} pembelian${data?.terpotong ? " · baru 300 teratas tampil — persempit pencarian atau periode" : ""}`}
        onReset={aturUlangFilter}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title="Daftar Pembelian"
          description="Nomor PUR dibuat otomatis per bulan."
          info="Nomor dokumen (PUR-tanggal-urutan) dibuat sistem sendiri, tidak bisa diketik manual — supaya tidak ada dua pembelian berbeda yang kebetulan pakai nomor yang sama."
        />
        {purchases.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={ShoppingCart}
              title="Tidak ada pembelian"
              description="Belum ada pembelian yang cocok dengan filter ini."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Catat Pembelian</Button>}
            />
          </CardContent>
        ) : (
          <div ref={tableRef} data-tier={tier}>
            {tier === "card" ? (
              <CardList>
                {purchases.map((p) => {
                  const a = aksiPembelian(p, { aksi, setEditUntuk, setBayarUntuk, setTerapkanUntuk, setRiwayatUntuk });
                  return (
                    <RowCard
                      key={p.id}
                      title={p.purchaseNumber}
                      status={<StatusBadge status={p.status} />}
                      subtitle={p.description}
                      fields={[
                        { label: "Tanggal", value: tanggalPendek(p.date) },
                        { label: "Nominal", value: formatUang(p.amount) },
                        ...(teksDpBadge(p) ? [{ label: "Uang Muka", value: teksDpBadge(p) }] : []),
                        { label: "Jenis", value: p.category?.name },
                        { label: "Divisi", value: LABEL_DIVISI[p.division] || p.division },
                        { label: "Mode", value: teksModePembelian(p.mode) },
                        { label: "Sumber Dana", value: teksSumberDanaPembelian(p) },
                        { label: "Bukti", span: true, value: <SelBukti doc={p} jenis="purchases" aksi={aksi} /> },
                      ]}
                      actions={<RowActions primary={a.primary} items={a.items} />}
                    />
                  );
                })}
              </CardList>
            ) : (
              <TableWrap className="dh-table">
                <Table fixed>
                  {/* Susunan desktop PERMANEN: Klasifikasi (Jenis+Divisi) &
                      Pembayaran (Mode+Sumber Dana) SELALU digabung. */}
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
                    {purchases.map((p) => {
                      const a = aksiPembelian(p, { aksi, setEditUntuk, setBayarUntuk, setTerapkanUntuk, setRiwayatUntuk });
                      const klasifikasi = (
                        <>
                          <span className="block truncate text-[12px]" title={p.category?.name}>{p.category?.name}</span>
                          <span className="block truncate text-[11px] text-ink3">{LABEL_DIVISI[p.division] || p.division}</span>
                        </>
                      );
                      const pembayaran = (
                        <>
                          <span className="block truncate text-[12px] text-ink2">{teksModePembelian(p.mode)}</span>
                          <span className="block truncate text-[11px] text-ink3" title={teksSumberDanaPembelian(p)}>{teksSumberDanaPembelian(p)}</span>
                        </>
                      );
                      const bukti = (
                        <>
                          <SelBukti doc={p} jenis="purchases" aksi={aksi} compact />
                          {p.notaWajib && !p.receiptUrl && ["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status) && (
                            <span className="mt-1 block text-[11px] font-semibold text-red">Nota wajib</span>
                          )}
                        </>
                      );
                      return (
                        <React.Fragment key={p.id}>
                          <TR>
                            <TD sticky className="font-mono text-[12px]">{p.purchaseNumber}</TD>
                            {tier !== "minimal" && <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(p.date)}</TD>}
                            <TD className="max-w-0 w-full pl-4">
                              <span className="line-clamp-2 break-words" title={p.description}>{p.description}</span>
                              {p.reimburseTo && <span className="block truncate text-[11px] text-ink3" title={`ditalangi ${p.reimburseTo.name}`}>ditalangi {p.reimburseTo.name}</span>}
                              {p.supplier && <span className="block truncate text-[11px] text-ink3" title={`dari ${p.supplier.name}`}>dari {p.supplier.name}</span>}
                              {!p.supplier && p.payeeName && p.payeeName.trim().toLowerCase() !== (p.reimburseTo?.name || "").trim().toLowerCase() && <span className="block truncate text-[11px] text-ink3" title={`dari ${p.payeeName}`}>dari {p.payeeName}</span>}
                            </TD>
                            {(tier === "full" || tier === "reduced") && <TD className="min-w-0">{klasifikasi}</TD>}
                            {tier === "full" && <TD className="min-w-0">{pembayaran}</TD>}
                            <TD numeric>
                              <Uang value={p.amount} />
                              {teksDpBadge(p) && <span className="block truncate text-[11px] text-ink3" title={teksDpBadge(p)}>{teksDpBadge(p)}</span>}
                            </TD>
                            <TD><StatusBadge status={p.status} /></TD>
                            {tier === "full" && <TD>{bukti}</TD>}
                            {tier !== "full" && (
                              <TD>
                                <ExpandToggle open={terbuka.has(p.id)} onClick={() => balikTerbuka(p.id)} label="Rincian" />
                              </TD>
                            )}
                            <TD>
                              <RowActions primary={a.primary} items={a.items} />
                            </TD>
                          </TR>
                          {tier === "reduced" && (
                            <DetailRow
                              open={terbuka.has(p.id)}
                              colSpan={8}
                              fields={[
                                { label: "Mode", value: teksModePembelian(p.mode) },
                                { label: "Sumber Dana", value: teksSumberDanaPembelian(p) },
                                ...(teksDpBadge(p) ? [{ label: "Uang Muka", value: teksDpBadge(p) }] : []),
                                { label: "Bukti", value: bukti },
                              ]}
                            />
                          )}
                          {tier === "minimal" && (
                            <DetailRow
                              open={terbuka.has(p.id)}
                              colSpan={6}
                              fields={[
                                { label: "Tanggal", value: tanggalPendek(p.date) },
                                { label: "Jenis", value: p.category?.name },
                                { label: "Divisi", value: <Badge variant="neutral">{LABEL_DIVISI[p.division] || p.division}</Badge> },
                                { label: "Mode", value: teksModePembelian(p.mode) },
                                { label: "Sumber Dana", value: teksSumberDanaPembelian(p) },
                                ...(teksDpBadge(p) ? [{ label: "Uang Muka", value: teksDpBadge(p) }] : []),
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

      <ModalPembelian
        open={modalBaru} onClose={() => setModalBaru(false)}
        kategori={kategori} rekening={rekening} suppliers={suppliers}
        onSubmit={(d) => aksi(() => api.createFinancePurchase(d))}
      />

      <ModalBayar
        purchase={bayarUntuk} onClose={() => setBayarUntuk(null)}
        rekening={rekening}
        onSubmit={(d) => aksi(() => api.payFinancePurchase(bayarUntuk.id, d))}
      />
      <EditDokumen
        doc={editUntuk} jenis="purchases" kategori={kategori} rekening={rekening}
        onClose={() => setEditUntuk(null)}
        onSaved={() => { setEditUntuk(null); muat({ diam: true }); }}
      />
      <ModalTerapkanDp
        purchase={terapkanUntuk} onClose={() => setTerapkanUntuk(null)}
        onSubmit={(d, idemKey) => aksi(() => api.applyPurchaseAdvance(d, idemKey))}
      />
      <ModalRiwayatDp
        purchase={riwayatUntuk} onClose={() => setRiwayatUntuk(null)}
        onChanged={() => muat({ diam: true })}
      />
    </HalamanFinance>
  );
}

function ModalPembelian({ open, onClose, kategori, rekening, suppliers, onSubmit }) {
  const [f, setF] = useState({
    date: "", amount: "", description: "", categoryId: "", division: "",
    mode: "LANGSUNG", cashAccountId: "", supplierId: "", reimburseToId: "", payeeName: "", notes: "", receiptUrl: "",
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.description.trim() && f.categoryId && Number(f.amount) > 0 &&
    (f.mode !== "LANGSUNG" || f.cashAccountId);

  const kategoriDipilih = kategori.find((k) => k.id === f.categoryId);
  const isUangMuka = kategoriDipilih?.code === "UANG_MUKA_PEMBELIAN";

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Pembelian Baru"
      description="Pengajuan lahir berstatus Menunggu Persetujuan dan belum menyentuh buku besar."
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Ajukan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Busa rebonded 160x200x4, 10 lembar" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <Field label="Jenis pembelian" required hint="Menentukan akun tujuan di buku besar">
          <Pilihan value={f.categoryId} onChange={(v) => set("categoryId", v)}>
            <option value="">— pilih —</option>
            {kategori.map((k) => (
              <option key={k.id} value={k.id}>{k.name} → {k.account?.code} {k.account?.name}</option>
            ))}
          </Pilihan>
        </Field>
        {isUangMuka && (
          <Penjelasan>
            Uang muka dicatat sebagai <strong>aset</strong> (Uang Muka Pembelian), bukan beban. Begitu pembelian
            finalnya (mode Utang, supplier yang sama) sudah Disetujui, terapkan saldo DP ini lewat aksi{" "}
            <strong>Terapkan Uang Muka</strong> di baris pembelian tersebut — tidak perlu lagi lewat Jurnal Umum manual.
          </Penjelasan>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Dibebankan ke divisi">
            <Pilihan value={f.division} onChange={(v) => set("division", v)}>
              <option value="">— Umum —</option>
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
        {f.mode === "REIMBURSEMENT" && <PilihPenalang value={f.reimburseToId} onChange={(v) => set("reimburseToId", v)} />}
        <Field label="Supplier" hint="Opsional — pilih kalau pemasoknya sudah terdaftar">
          <Pilihan value={f.supplierId} onChange={(v) => set("supplierId", v)}>
            <option value="">— tidak dipilih —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Dibeli dari" hint="Nama toko/orang kalau belum jadi supplier terdaftar — opsional">
          <Input value={f.payeeName} onChange={(e) => set("payeeName", e.target.value)} />
        </Field>
        <Field label="Foto nota / bukti" hint="Wajib sebelum disetujui untuk reimbursement, pembelian, dan nominal besar — foto nota dari bawahan di sini">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalBayar({ purchase, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ cashAccountId: "", paidAt: "" });
  useEffect(() => { setF({ cashAccountId: purchase?.cashAccountId || "", paidAt: "" }); }, [purchase]);
  if (!purchase) return null;

  // `sisaUtang` datang dari GET /purchases (dihitung server, lihat
  // financeTransactions.js) untuk baris mode Utang yang sudah menerima
  // penerapan DP — kalau DP sudah menutupi SELURUH utangnya, tidak ada uang
  // tunai yang keluar lagi, jadi rekening kas TIDAK wajib diisi (server pun
  // sudah menerapkan aturan yang sama, lihat postPurchasePaid).
  const sisaTunai = purchase.sisaUtang != null ? purchase.sisaUtang : purchase.amount;
  const lunasViaDp = sisaTunai <= 0;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Bayar ${purchase.purchaseNumber}`}
      description={`${formatUang(purchase.amount)} · ${purchase.description}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!lunasViaDp && !f.cashAccountId}>
            {lunasViaDp ? "Tandai Lunas" : "Catat Pembayaran"}
          </TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        {purchase.dpDiterapkan > 0 && (
          <Penjelasan>
            Uang Muka {formatUang(purchase.dpDiterapkan)} sudah diterapkan ke pembelian ini
            {lunasViaDp
              ? " — seluruh utangnya sudah lunas dari DP, tidak ada uang tunai yang keluar lagi."
              : `, sisa yang dibayar tunai ${formatUang(sisaTunai)}.`}
          </Penjelasan>
        )}
        <p className="text-[13px] text-ink2">
          Barang/asetnya sudah tercatat di buku besar saat pembelian ini disetujui. Langkah ini mencatat{" "}
          <strong>keluarnya uang</strong> dan melunasi{" "}
          {purchase.mode === "REIMBURSEMENT" ? "utang reimbursement ke karyawan" : "utang ke pihak ketiga"}.
        </p>
        {!lunasViaDp && (
          <Field label="Uang keluar dari" required>
            <Pilihan value={f.cashAccountId} onChange={(v) => setF((s) => ({ ...s, cashAccountId: v }))}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
        )}
        <Field label="Tanggal bayar">
          <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.paidAt} onChange={(v) => setF((s) => ({ ...s, paidAt: v }))} />
        </Field>
      </div>
    </Modal>
  );
}

// Kunci per PERCOBAAN penerapan (dibangkitkan sekali saat modal dibuka,
// dipakai ulang kalau user klik "Terapkan" lagi setelah error — BUKAN
// dibangkitkan ulang tiap klik, supaya retry logis tetap idempoten alih-alih
// jadi percobaan baru yang tidak lagi dikenali server sebagai hal yang sama).
function idemKeyBaru() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ModalTerapkanDp({ purchase, onClose, onSubmit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dpId, setDpId] = useState("");
  const [amount, setAmount] = useState("");
  const idemKeyRef = useRef(null);

  useEffect(() => {
    if (!purchase) { setData(null); setDpId(""); setAmount(""); idemKeyRef.current = null; return; }
    idemKeyRef.current = idemKeyBaru();
    setLoading(true); setError(null);
    api.getPurchaseAdvanceEligible(purchase.id)
      .then((r) => setData(r))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [purchase]);

  if (!purchase) return null;

  const dpTerpilih = data?.eligible?.find((k) => k.id === dpId);
  const sisaUtang = data?.sisaUtang ?? 0;
  const nominal = Number(amount) || 0;
  const batasNominal = dpTerpilih ? Math.min(dpTerpilih.saldoTersedia, sisaUtang) : 0;
  const valid = !!dpTerpilih && nominal > 0 && nominal <= batasNominal;
  const sisaSetelah = Math.max(0, sisaUtang - nominal);

  function pilihDp(id) {
    setDpId(id);
    const k = data.eligible.find((x) => x.id === id);
    if (k) setAmount(String(Math.min(k.saldoTersedia, sisaUtang)));
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Terapkan Uang Muka — ${purchase.purchaseNumber}`}
      description={purchase.description}
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            disabled={!valid}
            confirmText={dpTerpilih ? `Terapkan ${formatUang(nominal)} dari ${dpTerpilih.purchaseNumber} ke ${purchase.purchaseNumber}?` : undefined}
            onClick={() => onSubmit(
              { advancePurchaseId: dpId, targetPurchaseId: purchase.id, amount: nominal },
              idemKeyRef.current
            )}
          >
            Terapkan
          </TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        {loading && <p className="text-[13px] text-ink3">Memuat daftar uang muka…</p>}
        {error && <p className="text-[13px] text-red">{error}</p>}
        {data && !data.bisaMenerapkan && (
          <Penjelasan>
            {(data.alasan || []).map((a, i) => <span key={i} className="block">{a}</span>)}
          </Penjelasan>
        )}
        {data?.bisaMenerapkan && data.eligible.length === 0 && (
          <p className="text-[13px] text-ink3">Tidak ada uang muka (DP) dari supplier yang sama dengan saldo tersedia.</p>
        )}
        {data?.bisaMenerapkan && data.eligible.length > 0 && (
          <>
            <Field label="Pilih uang muka (DP)" required>
              <div className="space-y-1.5">
                {data.eligible.map((k) => (
                  <label
                    key={k.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px]",
                      dpId === k.id ? "border-accent bg-accentbg" : "border-line"
                    )}
                  >
                    <input type="radio" name="dp-terapkan" checked={dpId === k.id} onChange={() => pilihDp(k.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{k.purchaseNumber} · {tanggalPendek(k.date)}</span>
                      <span className="block truncate text-[11px] text-ink3">Tersedia {formatUang(k.saldoTersedia)} dari {formatUang(k.nilaiAwal)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <Field
              label="Nominal diterapkan" required
              hint={dpTerpilih ? `Maksimal ${formatUang(batasNominal)}` : "Pilih uang muka dulu"}
            >
              <InputUang value={amount} onChange={setAmount} />
            </Field>
            <div className="space-y-1 rounded-md bg-inset px-3 py-2 text-[13px]">
              <p className="flex justify-between"><span className="text-ink3">Total Pembelian</span><span className="font-medium">{formatUang(purchase.amount)}</span></p>
              <p className="flex justify-between"><span className="text-ink3">Uang Muka Diterapkan</span><span className="font-medium">{formatUang(nominal)}</span></p>
              <p className="flex justify-between"><span className="text-ink3">Sisa Pembayaran</span><span className="font-medium">{formatUang(sisaSetelah)}</span></p>
              <p className="flex justify-between"><span className="text-ink3">Rekening Pembayaran Sisa</span><span className="font-medium">{purchase.cashAccount?.name || "belum dipilih — diminta saat membayar sisa"}</span></p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ModalRiwayatDp({ purchase, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);

  const muat = useCallback(async () => {
    if (!purchase) return;
    setLoading(true); setError(null);
    try {
      const r = await api.getPurchaseAdvanceSummary(purchase.id);
      setData(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [purchase]);

  useEffect(() => { muat(); }, [muat]);

  if (!purchase) return null;

  async function batalkan(app) {
    const alasan = window.prompt(
      `Batalkan penerapan DP ${formatUang(app.amount)}? Saldo DP akan tersedia lagi, dan Utang Usaha pembelian tujuan akan naik kembali.`
    );
    if (!alasan?.trim()) return;
    try {
      await api.cancelPurchaseAdvanceApplication(app.id, alasan.trim());
      await muat();
      onChanged?.();
    } catch (e) {
      if (e.status === 409) await muat();
      setPesan(e.message);
    }
  }

  const sumber = data?.sebagaiSumberUangMuka;
  const tujuan = data?.sebagaiTujuanPembelian;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Riwayat Uang Muka — ${purchase.purchaseNumber}`}
      description={purchase.description}
      className="w-[560px]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      <div className="space-y-4">
        {pesan && <p className="text-[13px] text-red">{pesan}</p>}
        {loading && <p className="text-[13px] text-ink3">Memuat…</p>}
        {error && <p className="text-[13px] text-red">{error}</p>}

        {data?.kategoriUangMuka && sumber && (
          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink3">Sebagai Sumber Uang Muka</p>
            <div className="grid grid-cols-3 gap-2 text-[13px]">
              <div><p className="text-ink3">Nilai Awal</p><p className="font-semibold">{formatUang(sumber.nilaiAwal)}</p></div>
              <div><p className="text-ink3">Sudah Digunakan</p><p className="font-semibold">{formatUang(sumber.sudahDigunakan)}</p></div>
              <div><p className="text-ink3">Saldo Tersedia</p><p className="font-semibold">{formatUang(sumber.saldoTersedia)}</p></div>
            </div>
            <RiwayatDpList items={sumber.histori} arah="ke" onBatalkan={batalkan} />
          </div>
        )}

        {tujuan && purchase.mode === "UTANG" && (
          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink3">Sebagai Penerima Uang Muka</p>
            <div className="grid grid-cols-3 gap-2 text-[13px]">
              <div><p className="text-ink3">Total Pembelian</p><p className="font-semibold">{formatUang(tujuan.totalPembelian)}</p></div>
              <div><p className="text-ink3">DP Diterapkan</p><p className="font-semibold">{formatUang(tujuan.dpDiterapkan)}</p></div>
              <div><p className="text-ink3">Sisa Utang</p><p className="font-semibold">{formatUang(tujuan.sisaUtang)}</p></div>
            </div>
            <RiwayatDpList items={tujuan.histori} arah="dari" onBatalkan={batalkan} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function RiwayatDpList({ items, arah, onBatalkan }) {
  if (!items || items.length === 0) return <p className="text-[13px] text-ink3">Belum ada penerapan.</p>;
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const lain = arah === "ke" ? it.targetPurchase : it.advancePurchase;
        return (
          <div key={it.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{formatUang(it.amount)} {arah} {lain?.purchaseNumber || "—"}</p>
              <p className="truncate text-[11px] text-ink3">
                {tanggalPendek(it.createdAt)} · {it.createdBy || "—"} · jurnal {it.journal?.entryNumber || "—"}
              </p>
              {it.status === "REVERSED" && (
                <p className="truncate text-[11px] text-red">
                  Dibatalkan {tanggalPendek(it.reversedAt)} oleh {it.reversedBy || "—"} — {it.reverseReason}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={it.status === "ACTIVE" ? "accent" : "neutral"}>
                {it.status === "ACTIVE" ? "Aktif" : "Dibatalkan"}
              </Badge>
              {it.status === "ACTIVE" && (
                <Button size="sm" variant="neutral" onClick={() => onBatalkan(it)} title="Batalkan penerapan ini">
                  <Ban size={14} />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
