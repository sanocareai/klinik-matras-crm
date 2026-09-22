import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ShoppingCart, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, ExpandToggle, DetailRow, TABLE_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { useBreakpointTier } from "@/hooks/useBreakpointTier.js";
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

// Aksi PALING RELEVAN per status jadi tombol utama; sisanya masuk menu
// titik-tiga — sama persis dengan pola FinanceExpenses.jsx (lihat komentar
// di sana untuk alasannya).
function aksiPembelian(p, { aksi, setEditUntuk, setBayarUntuk }) {
  const bisaEdit = STATUS_BISA_DIEDIT.includes(p.status);
  const bisaBatal = ["DISETUJUI", "DIBAYAR"].includes(p.status);
  const menungguKeputusan = ["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status);
  const notaBelumAda = !!p.notaWajib && !p.receiptUrl;

  const items = [
    bisaEdit && { key: "edit", label: "Edit / koreksi", icon: Pencil, onClick: () => setEditUntuk(p) },
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
// ⚠️ UANG MUKA (DP) tidak selesai sendiri: jenis "Uang Muka Pembelian"
// mencatat DP sebagai ASET (akun 1-1500), bukan beban. Saat barang/jasanya
// akhirnya diterima, saldo itu dipindahkan ke akun tujuan sebenarnya lewat
// Jurnal Umum manual — sengaja tidak diotomasi, lihat catatan di
// services/finance/posting/purchase.js.

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
  const tier = useBreakpointTier();
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
      await muat({ diam: true });
    } catch (e) {
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
          <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={140}>Nomor</TH>
                    <TH width={64}>Tanggal</TH>
                    <TH>Keterangan</TH>
                    {tier === "uw" && (
                      <>
                        <TH width={132}>Jenis</TH>
                        <TH width={104}>Divisi</TH>
                        <TH width={116}>Mode</TH>
                        <TH width={132}>Sumber Dana</TH>
                      </>
                    )}
                    {tier === "mid" && (
                      <>
                        <TH width={130}>Klasifikasi</TH>
                        <TH width={118}>Pembayaran</TH>
                      </>
                    )}
                    <TH numeric width={104}>Nominal</TH>
                    <TH width={92}>Status</TH>
                    <TH width={72}>Bukti</TH>
                    {tier === "compact" && <TH width={36} />}
                    <TH width={AKSI_COL_WIDTH}>Aksi</TH>
                  </TR>
                </THead>
                <TBody>
                  {purchases.map((p) => {
                    const a = aksiPembelian(p, { aksi, setEditUntuk, setBayarUntuk });
                    return (
                      <React.Fragment key={p.id}>
                        <TR>
                          <TD sticky className="font-mono text-[12px]">{p.purchaseNumber}</TD>
                          <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(p.date)}</TD>
                          <TD className="max-w-0 w-full">
                            <span className="line-clamp-2 break-words" title={p.description}>{p.description}</span>
                            {/* Penalang (reimburseTo) & penjual (payeeName) adalah dua hal berbeda — tampilkan keduanya. */}
                            {p.reimburseTo && <span className="block truncate text-[11px] text-ink3" title={`ditalangi ${p.reimburseTo.name}`}>ditalangi {p.reimburseTo.name}</span>}
                            {p.supplier && <span className="block truncate text-[11px] text-ink3" title={`dari ${p.supplier.name}`}>dari {p.supplier.name}</span>}
                            {!p.supplier && p.payeeName && p.payeeName.trim().toLowerCase() !== (p.reimburseTo?.name || "").trim().toLowerCase() && <span className="block truncate text-[11px] text-ink3" title={`dari ${p.payeeName}`}>dari {p.payeeName}</span>}
                          </TD>
                          {tier === "uw" && (
                            <>
                              <TD truncate className="text-[12px]">{p.category?.name}</TD>
                              <TD><Badge variant="neutral">{LABEL_DIVISI[p.division] || p.division}</Badge></TD>
                              <TD truncate className="text-[12px] text-ink2">{teksModePembelian(p.mode)}</TD>
                              <TD truncate className="text-[12px]">{teksSumberDanaPembelian(p)}</TD>
                            </>
                          )}
                          {tier === "mid" && (
                            <>
                              <TD className="min-w-0">
                                <span className="block truncate text-[12px]" title={p.category?.name}>{p.category?.name}</span>
                                <span className="block truncate text-[11px] text-ink3">{LABEL_DIVISI[p.division] || p.division}</span>
                              </TD>
                              <TD className="min-w-0">
                                <span className="block truncate text-[12px] text-ink2">{teksModePembelian(p.mode)}</span>
                                <span className="block truncate text-[11px] text-ink3" title={teksSumberDanaPembelian(p)}>{teksSumberDanaPembelian(p)}</span>
                              </TD>
                            </>
                          )}
                          <TD numeric><Uang value={p.amount} /></TD>
                          <TD><StatusBadge status={p.status} /></TD>
                          <TD>
                            <SelBukti doc={p} jenis="purchases" aksi={aksi} compact />
                            {p.notaWajib && !p.receiptUrl && ["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status) && (
                              <span className="mt-1 block text-[11px] font-semibold text-red">Nota wajib</span>
                            )}
                          </TD>
                          {tier === "compact" && (
                            <TD>
                              <ExpandToggle open={terbuka.has(p.id)} onClick={() => balikTerbuka(p.id)} label="Rincian" />
                            </TD>
                          )}
                          <TD>
                            <RowActions primary={a.primary} items={a.items} />
                          </TD>
                        </TR>
                        {tier === "compact" && (
                          <DetailRow
                            open={terbuka.has(p.id)}
                            colSpan={8}
                            fields={[
                              { label: "Jenis", value: p.category?.name },
                              { label: "Divisi", value: <Badge variant="neutral">{LABEL_DIVISI[p.division] || p.division}</Badge> },
                              { label: "Mode", value: teksModePembelian(p.mode) },
                              { label: "Sumber Dana", value: teksSumberDanaPembelian(p) },
                            ]}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>

            <CardList>
              {purchases.map((p) => {
                const a = aksiPembelian(p, { aksi, setEditUntuk, setBayarUntuk });
                return (
                  <RowCard
                    key={p.id}
                    title={p.purchaseNumber}
                    status={<StatusBadge status={p.status} />}
                    subtitle={p.description}
                    fields={[
                      { label: "Tanggal", value: tanggalPendek(p.date) },
                      { label: "Nominal", value: formatUang(p.amount) },
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
          </>
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
            Uang muka dicatat sebagai <strong>aset</strong> (Uang Muka Pembelian), bukan beban. Saat barang/jasanya
            diterima, pindahkan saldonya ke akun tujuan sebenarnya lewat <strong>Jurnal Umum</strong> — langkah itu
            tidak otomatis.
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

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Bayar ${purchase.purchaseNumber}`}
      description={`${formatUang(purchase.amount)} · ${purchase.description}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!f.cashAccountId}>Catat Pembayaran</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink2">
          Barang/asetnya sudah tercatat di buku besar saat pembelian ini disetujui. Langkah ini mencatat{" "}
          <strong>keluarnya uang</strong> dan melunasi{" "}
          {purchase.mode === "REIMBURSEMENT" ? "utang reimbursement ke karyawan" : "utang ke pihak ketiga"}.
        </p>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => setF((s) => ({ ...s, cashAccountId: v }))}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Tanggal bayar">
          <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.paidAt} onChange={(v) => setF((s) => ({ ...s, paidAt: v }))} />
        </Field>
      </div>
    </Modal>
  );
}
