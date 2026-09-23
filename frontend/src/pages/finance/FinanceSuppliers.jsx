import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Building2, FileText, Banknote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { BIAYA_KOSONG, denganBiaya, biayaTransferLengkap } from "@/features/finance/biayaTransfer.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek,
} from "@/features/finance/shared.jsx";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";

function aksiTagihan(b, { aksi }) {
  if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(b.status)) return { primary: null, items: [] };
  return {
    primary: {
      label: "Setujui", variant: "secondary",
      confirmText: `Setujui tagihan ${b.billNumber} sebesar ${formatUang(b.amount)}? Utang akan masuk buku besar.`,
      onClick: () => aksi(() => api.approveFinanceBill(b.id)),
    },
    items: [
      {
        key: "tolak", label: "Tolak", destructive: true,
        onClick: () => {
          const alasan = window.prompt("Alasan penolakan tagihan:");
          if (alasan?.trim()) return aksi(() => api.rejectFinanceBill(b.id, alasan.trim()));
        },
      },
    ],
  };
}

// Nominal dicari sebagai angka polos maupun berformat titik ("1500000" / "1.500.000").
const angka = (x) => `${Math.round(Number(x) || 0)} ${(Number(x) || 0).toLocaleString("id-ID")}`;
const unik = (arr) => [...new Set(arr.filter(Boolean))].sort().map((v) => [v, v]);

// Lewat jatuh tempo hanya berarti kalau tagihannya masih punya sisa.
function statusTempo(b, awalHariIni) {
  if (!b.dueDate) return "tanpa";
  return Number(b.sisa) > 0 && new Date(b.dueDate) < awalHariIni ? "lewat" : "belum";
}

// SUPPLIER & UTANG USAHA — master supplier, tagihan masuk, dan pembayaran.
//
// ⚠️ TAGIHAN YANG MENAUT PENERIMAAN BARANG TIDAK MENYENTUH STOK SAMA
// SEKALI. Kuantitas sudah tercatat gudang saat putaway; yang dikerjakan di
// sini murni sisi rupiahnya: menutup akun "Utang Barang Belum Ditagih" dan
// melahirkan Utang Usaha yang sebenarnya. Selisih antara nilai tagihan
// supplier dan nilai penerimaan masuk akun Selisih Harga Pembelian — nilai
// persediaan yang SUDAH tercatat tidak pernah diubah surut.

const TAB = [
  { key: "tagihan", label: "Tagihan (Utang)", Icon: FileText, penjelasan: "Tagihan yang datang dari supplier — begitu disetujui, jadi utang resmi di buku besar." },
  { key: "pembayaran", label: "Pembayaran", Icon: Banknote, penjelasan: "Riwayat uang yang sudah dikeluarkan untuk melunasi tagihan supplier." },
  { key: "supplier", label: "Master Supplier", Icon: Building2, penjelasan: "Data lengkap para supplier — kontak, termin pembayaran, dan rekening tujuan transfer." },
];

export default function FinanceSuppliers() {
  const [tab, setTab] = useState("tagihan");
  const [suppliers, setSuppliers] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [aging, setAging] = useState(null);
  const [unbilled, setUnbilled] = useState([]);
  const [kategori, setKategori] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modal, setModal] = useState(null);
  // Pencarian & filter per tab (sisi-klien) — state tiap tab terpisah.
  const [qB, setQB] = useState("");
  const [fSupB, setFSupB] = useState("");
  const [fStatusB, setFStatusB] = useState("");
  const [fTempo, setFTempo] = useState("");
  const [qP, setQP] = useState("");
  const [fSupP, setFSupP] = useState("");
  const [fRek, setFRek] = useState("");
  const [fStatusP, setFStatusP] = useState("");
  const [qS, setQS] = useState("");
  const [fStatusS, setFStatusS] = useState("");
  const [fUtang, setFUtang] = useState("");

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, b, p, ag, ub, k, r] = await Promise.all([
        api.getFinanceSuppliers(),
        api.getFinanceBills(),
        api.getFinanceSupplierPayments(),
        api.getFinancePayables(),
        api.getFinanceUnbilledReceipts().catch(() => ({ receipts: [] })),
        api.getFinanceExpenseCategories(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
      ]);
      setSuppliers(s.suppliers);
      setBills(b.bills);
      setPayments(p.payments);
      setAging(ag);
      setUnbilled(ub.receipts);
      setKategori(k.categories);
      setRekening((r.accounts || []).filter((a) => a.active));
    } catch (e) {
      setError(e.message || "Gagal memuat data supplier");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModal(null);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const menunggu = bills.filter((b) => b.status === "MENUNGGU_APPROVAL");
  const lewatTempo = (aging?.baris || []).filter((b) => b.hariLewat > 0);

  const billsTampil = useMemo(() => {
    const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
    return bills.filter((b) =>
      (!fSupB || b.supplier?.name === fSupB) &&
      (!fStatusB || b.status === fStatusB) &&
      (!fTempo || statusTempo(b, hariIni) === fTempo) &&
      cocok(qB, b.billNumber, b.supplierRef, b.supplier?.name, b.description, b.goodsReceipt?.receiptNumber, b.billDate, tanggalPendek(b.billDate), b.dueDate, b.dueDate ? tanggalPendek(b.dueDate) : "", angka(b.amount), angka(b.terbayar), angka(b.sisa), b.status)
    );
  }, [bills, qB, fSupB, fStatusB, fTempo]);
  const paymentsTampil = useMemo(() => payments.filter((p) =>
    (!fSupP || p.supplier?.name === fSupP) &&
    (!fRek || p.cashAccount?.name === fRek) &&
    (!fStatusP || (fStatusP === "batal") === !!p.cancelledAt) &&
    cocok(qP, p.paymentNumber, p.date, tanggalPendek(p.date), p.supplier?.name, p.cashAccount?.name, (p.allocations || []).map((a) => a.bill?.billNumber).join(" "), angka(p.amount), p.cancelledAt ? "dibatalkan" : "terposting")
  ), [payments, qP, fSupP, fRek, fStatusP]);
  const suppliersTampil = useMemo(() => suppliers.filter((s) =>
    (!fStatusS || (fStatusS === "aktif") === !!s.active) &&
    (!fUtang || (fUtang === "ada") === (Number(s.sisaUtang) > 0)) &&
    cocok(qS, s.code, s.name, s.phone, s.email, s.paymentTermDays, s.bankName, s.bankAccount, angka(s.sisaUtang), s.active ? "aktif" : "nonaktif")
  ), [suppliers, qS, fStatusS, fUtang]);

  return (
    <HalamanFinance
      title="Supplier & Utang"
      subtitle="Tagihan masuk dari supplier, pembayarannya, dan sisa utang per supplier."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <Button size="sm" onClick={() => setModal(tab === "supplier" ? "supplier" : tab === "pembayaran" ? "bayar" : "tagihan")}>
          <Plus size={14} />
          {tab === "supplier" ? "Supplier Baru" : tab === "pembayaran" ? "Catat Pembayaran" : "Tagihan Baru"}
        </Button>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka
          label="Total Utang Usaha" value={formatUang(aging?.total ?? 0)} sub={`${aging?.baris?.length ?? 0} tagihan terbuka`}
          info="Total tagihan yang sudah disetujui tapi belum lunas dibayar ke supplier."
        />
        <KartuAngka
          label="Lewat Jatuh Tempo" value={formatUang(lewatTempo.reduce((s, b) => s + b.sisa, 0))}
          tone={lewatTempo.length > 0 ? "red" : "default"} sub={`${lewatTempo.length} tagihan`}
          info="Tagihan yang sudah lewat batas waktu pembayaran menurut termin supplier — sebaiknya diprioritaskan supaya hubungan dengan supplier tetap baik."
        />
        <KartuAngka
          label="Menunggu Persetujuan" value={menunggu.length} tone={menunggu.length > 0 ? "orange" : "default"}
          info="Tagihan yang sudah diinput tapi belum disetujui — belum tercatat sebagai utang sampai disetujui."
        />
        <KartuAngka
          label="Penerimaan Belum Ditagih" value={unbilled.length}
          sub="Barang sudah masuk, tagihan belum datang"
          info="Barang sudah diterima & tercatat di gudang, tapi supplier belum mengirim tagihan resminya — nilainya sudah masuk Persediaan lewat akun sementara 'Utang Barang Belum Ditagih', menunggu tagihan aslinya diinput di sini."
        />
      </div>

      <Penjelasan>
        Tagihan yang menaut dokumen penerimaan barang <strong>tidak menyentuh stok sama sekali</strong> —
        kuantitasnya sudah dicatat Gudang saat putaway. Yang dikerjakan di sini murni sisi rupiah: menutup
        “Utang Barang Belum Ditagih” dan melahirkan Utang Usaha. Selisih antara tagihan supplier dan nilai
        penerimaan masuk akun Selisih Harga Pembelian, bukan mengubah nilai persediaan yang sudah tercatat.
      </Penjelasan>

      <div className="flex flex-wrap gap-2">
        {TAB.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)}>
            <t.Icon size={14} /> {t.label}
          </Button>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-ink3">
        {TAB.find((t) => t.key === tab)?.penjelasan}
      </p>

      {tab === "tagihan" && (
        <>
        <FilterBar
          q={qB} onQ={setQB}
          placeholder="Cari nomor, supplier, nominal…"
          filters={[
            { key: "sup", label: "Supplier", value: fSupB, onChange: setFSupB, options: unik(bills.map((b) => b.supplier?.name)) },
            { key: "status", label: "Status", value: fStatusB, onChange: setFStatusB, options: unik(bills.map((b) => b.status)) },
            { key: "tempo", label: "Jatuh tempo", value: fTempo, onChange: setFTempo, options: [["lewat", "Lewat jatuh tempo"], ["belum", "Belum jatuh tempo"], ["tanpa", "Tanpa tanggal"]] },
          ]}
          ringkasan={billsTampil.length === bills.length ? `${bills.length} tagihan` : `${billsTampil.length} dari ${bills.length} tagihan`}
          onReset={() => { setQB(""); setFSupB(""); setFStatusB(""); setFTempo(""); }}
        />
        <Card className="overflow-hidden">
          <JudulKartu
            title="Tagihan Supplier"
            description="Utang lahir di buku besar saat tagihan DISETUJUI, bukan saat diinput."
            info="Tagihan yang menaut penerimaan barang tidak bisa disetujui kalau harga satuan barangnya belum lengkap di Gudang — sistem menahannya dulu supaya nilai persediaan tidak tercatat salah."
          />
          {bills.length === 0 ? (
            <CardContent>
              <EmptyState icon={FileText} title="Belum ada tagihan" description="Catat tagihan yang datang dari supplier di sini." />
            </CardContent>
          ) : billsTampil.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada tagihan yang cocok dengan pencarian ini.</p></CardContent>
          ) : (
            <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={124}>Nomor</TH>
                    <TH width={104} hideBelow="2xl">Ref Supplier</TH>
                    <TH width={150}>Supplier</TH><TH>Keterangan</TH>
                    <TH width={92} hideBelow="2xl">Tanggal</TH><TH width={96}>Jatuh Tempo</TH>
                    <TH numeric width={108} hideBelow="2xl">Nilai</TH>
                    <TH numeric width={108} hideBelow="2xl">Terbayar</TH>
                    <TH numeric width={112}>Sisa</TH>
                    <TH width={100}>Status</TH>
                    <TH width={AKSI_COL_WIDTH}>Aksi</TH>
                  </TR>
                </THead>
                <TBody>
                  {billsTampil.map((b) => {
                    const a = aksiTagihan(b, { aksi });
                    return (
                    <TR key={b.id}>
                      <TD sticky className="font-mono text-[12px]">{b.billNumber}</TD>
                      <TD hideBelow="2xl" truncate className="text-[12px] text-ink2">{b.supplierRef || "—"}</TD>
                      <TD truncate>{b.supplier?.name}</TD>
                      <TD className="min-w-0">
                        <span className="block truncate" title={b.description}>{b.description}</span>
                        {b.goodsReceipt && (
                          <span className="block truncate text-[11px] text-ink3" title={`dari penerimaan ${b.goodsReceipt.receiptNumber}`}>dari penerimaan {b.goodsReceipt.receiptNumber}</span>
                        )}
                      </TD>
                      <TD hideBelow="2xl" className="whitespace-nowrap text-[12px]">{tanggalPendek(b.billDate)}</TD>
                      <TD className="whitespace-nowrap text-[12px]">{b.dueDate ? tanggalPendek(b.dueDate) : <span className="text-ink3">—</span>}</TD>
                      <TD hideBelow="2xl" numeric><Uang value={b.amount} /></TD>
                      <TD hideBelow="2xl" numeric><Uang value={b.terbayar} nolSebagaiStrip /></TD>
                      <TD numeric><Uang value={b.sisa} className="font-bold" /></TD>
                      <TD><StatusBadge status={b.status} /></TD>
                      <TD>
                        <RowActions primary={a.primary} items={a.items} />
                      </TD>
                    </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>

            <CardList className={CARD_VIEW_CLASS}>
              {billsTampil.map((b) => {
                const a = aksiTagihan(b, { aksi });
                return (
                  <RowCard
                    key={b.id}
                    title={b.billNumber}
                    status={<StatusBadge status={b.status} />}
                    subtitle={b.supplier?.name}
                    fields={[
                      { label: "Sisa", value: formatUang(b.sisa) },
                      { label: "Nilai", value: formatUang(b.amount) },
                      { label: "Terbayar", value: formatUang(b.terbayar) },
                      { label: "Jatuh Tempo", value: b.dueDate ? tanggalPendek(b.dueDate) : "—" },
                      { label: "Tanggal", value: tanggalPendek(b.billDate) },
                      { label: "Ref Supplier", value: b.supplierRef },
                      { label: "Keterangan", value: b.description, span: true },
                    ]}
                    actions={<RowActions primary={a.primary} items={a.items} />}
                  />
                );
              })}
            </CardList>
            </>
          )}
        </Card>
        </>
      )}

      {tab === "pembayaran" && (
        <>
        <FilterBar
          q={qP} onQ={setQP}
          placeholder="Cari nomor, supplier, tagihan, nominal…"
          filters={[
            { key: "sup", label: "Supplier", value: fSupP, onChange: setFSupP, options: unik(payments.map((p) => p.supplier?.name)) },
            { key: "rek", label: "Dari rekening", value: fRek, onChange: setFRek, options: unik(payments.map((p) => p.cashAccount?.name)) },
            { key: "status", label: "Status", value: fStatusP, onChange: setFStatusP, options: [["posting", "Terposting"], ["batal", "Dibatalkan"]] },
          ]}
          ringkasan={paymentsTampil.length === payments.length ? `${payments.length} pembayaran` : `${paymentsTampil.length} dari ${payments.length} pembayaran`}
          onReset={() => { setQP(""); setFSupP(""); setFRek(""); setFStatusP(""); }}
        />
        <Card className="overflow-hidden">
          <JudulKartu
            title="Pembayaran ke Supplier"
            description="Satu pembayaran bisa melunasi beberapa tagihan sekaligus."
            info="Cocok untuk transfer gabungan akhir bulan — satu kali transfer ke supplier, dialokasikan ke beberapa tagihan yang jatuh tempo bersamaan."
          />
          {paymentsTampil.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">{payments.length === 0 ? "Belum ada pembayaran." : "Tidak ada pembayaran yang cocok dengan pencarian ini."}</p></CardContent>
          ) : (
            <TableWrap className="dh-table">
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={124}>Nomor</TH>
                    <TH width={92} className="whitespace-nowrap">Tanggal</TH>
                    <TH width={160}>Supplier</TH>
                    <TH width={150}>Dari Rekening</TH>
                    <TH>Tagihan</TH>
                    <TH numeric width={128}>Nominal</TH>
                    <TH width={116}>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {paymentsTampil.map((p) => (
                    <TR key={p.id}>
                      <TD sticky className="font-mono text-[12px]">{p.paymentNumber}</TD>
                      <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(p.date)}</TD>
                      <TD truncate>{p.supplier?.name}</TD>
                      <TD truncate>{p.cashAccount?.name}</TD>
                      <TD truncate className="text-[12px]" title={p.allocations.map((a) => a.bill?.billNumber).join(", ") || "—"}>
                        {p.allocations.map((a) => a.bill?.billNumber).join(", ") || "—"}
                      </TD>
                      <TD numeric><Uang value={p.amount} /></TD>
                      <TD>{p.cancelledAt ? <Badge variant="red">Dibatalkan</Badge> : <Badge variant="green">Terposting</Badge>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
        </>
      )}

      {tab === "supplier" && (
        <>
        <FilterBar
          q={qS} onQ={setQS}
          placeholder="Cari kode, nama, kontak, bank…"
          filters={[
            { key: "status", label: "Status", value: fStatusS, onChange: setFStatusS, options: [["aktif", "Aktif"], ["nonaktif", "Nonaktif"]] },
            { key: "utang", label: "Utang", value: fUtang, onChange: setFUtang, options: [["ada", "Ada sisa utang"], ["lunas", "Lunas"]] },
          ]}
          ringkasan={suppliersTampil.length === suppliers.length ? `${suppliers.length} supplier` : `${suppliersTampil.length} dari ${suppliers.length} supplier`}
          onReset={() => { setQS(""); setFStatusS(""); setFUtang(""); }}
        />
        <Card className="overflow-hidden">
          <JudulKartu
            title="Master Supplier"
            description="Entitas supplier baru ada sejak modul Finance. Kolom supplier di dokumen Gudang tetap teks bebas
              seperti sebelumnya — penautannya dilakukan per tagihan, bukan dengan memigrasikan riwayat lama."
            info="Daftarkan supplier di sini dulu sebelum mencatat tagihannya — data kontak & termin pembayaran yang tersimpan di sini yang dipakai menghitung jatuh tempo otomatis."
          />
          {suppliers.length === 0 ? (
            <CardContent>
              <EmptyState icon={Building2} title="Belum ada supplier" description="Daftarkan supplier yang tagihannya perlu dilacak." />
            </CardContent>
          ) : suppliersTampil.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada supplier yang cocok dengan pencarian ini.</p></CardContent>
          ) : (
            <TableWrap className="dh-table">
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={100}>Kode</TH>
                    <TH width={180}>Nama</TH>
                    <TH width={150}>Kontak</TH>
                    <TH width={100}>Termin</TH>
                    <TH>Rekening</TH>
                    <TH numeric width={140}>Sisa Utang</TH>
                    <TH width={100}>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {suppliersTampil.map((s) => (
                    <TR key={s.id}>
                      <TD sticky className="font-mono text-[12px]">{s.code}</TD>
                      <TD truncate className="font-medium">{s.name}</TD>
                      <TD truncate className="text-[12px] text-ink2">{s.phone || s.email || "—"}</TD>
                      <TD className="whitespace-nowrap text-[12px]">{s.paymentTermDays ? `${s.paymentTermDays} hari` : "—"}</TD>
                      <TD truncate className="text-[12px] text-ink2">
                        {s.bankAccount ? `${s.bankName || ""} ${s.bankAccount}`.trim() : "—"}
                      </TD>
                      <TD numeric><Uang value={s.sisaUtang} nolSebagaiStrip /></TD>
                      <TD>{s.active ? <Badge variant="green">Aktif</Badge> : <Badge variant="neutral">Nonaktif</Badge>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
        </>
      )}

      <ModalSupplier open={modal === "supplier"} onClose={() => setModal(null)} onSubmit={(d) => aksi(() => api.createFinanceSupplier(d))} />
      <ModalTagihan
        open={modal === "tagihan"} onClose={() => setModal(null)}
        suppliers={suppliers} unbilled={unbilled} kategori={kategori}
        onSubmit={(d) => aksi(() => api.createFinanceBill(d))}
      />
      <ModalBayarSupplier
        open={modal === "bayar"} onClose={() => setModal(null)}
        suppliers={suppliers} bills={bills} rekening={rekening}
        onSubmit={(d) => aksi(() => api.createFinanceSupplierPayment(d))}
      />
    </HalamanFinance>
  );
}

function ModalSupplier({ open, onClose, onSubmit }) {
  const [f, setF] = useState({ code: "", name: "", phone: "", email: "", address: "", paymentTermDays: "", bankName: "", bankAccount: "", bankHolder: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Supplier Baru"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit(f)} disabled={!f.name.trim()}>Simpan</TombolAksi></>}
    >
      <div className="space-y-3">
        <Field label="Nama supplier" required><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Kode" hint="Kosongkan untuk dibuatkan otomatis"><Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="SUP-004" /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Telepon"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><Input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        </div>
        <Field label="Alamat"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Termin pembayaran (hari)" hint="Dipakai menghitung jatuh tempo tagihan otomatis">
          <Input type="number" value={f.paymentTermDays} onChange={(e) => set("paymentTermDays", e.target.value)} placeholder="30" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Bank"><Input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} /></Field>
          <Field label="No. rekening"><Input value={f.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
        </div>
        <Field label="Atas nama"><Input value={f.bankHolder} onChange={(e) => set("bankHolder", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalTagihan({ open, onClose, suppliers, unbilled, kategori, onSubmit }) {
  const [f, setF] = useState({
    supplierId: "", supplierRef: "", billDate: "", dueDate: "", amount: "",
    description: "", goodsReceiptId: "", expenseCategoryId: "",
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const grDipilih = unbilled.find((r) => r.id === f.goodsReceiptId);
  const valid = f.supplierId && f.description.trim() && Number(f.amount) > 0 &&
    (f.goodsReceiptId || f.expenseCategoryId);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Tagihan Supplier Baru"
      description="Nominalnya diinput dari dokumen tagihan fisik/PDF supplier — ini satu-satunya sumbernya."
      className="w-[560px]"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Simpan</TombolAksi></>}
    >
      <div className="space-y-3">
        <Field label="Supplier" required>
          <Pilihan value={f.supplierId} onChange={(v) => set("supplierId", v)}>
            <option value="">— pilih —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Busa rebonded 10 lembar" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nomor faktur supplier"><Input value={f.supplierRef} onChange={(e) => set("supplierRef", e.target.value)} /></Field>
          <Field label="Nominal tagihan" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal tagihan"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.billDate} onChange={(v) => set("billDate", v)} /></Field>
          <Field label="Jatuh tempo" hint="Kosongkan untuk ikut termin supplier">
            <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.dueDate} onChange={(v) => set("dueDate", v)} />
          </Field>
        </div>

        <Field
          label="Menagih penerimaan barang"
          hint="Pilih kalau tagihan ini untuk barang yang sudah masuk gudang — nilai persediaannya sudah tercatat di sana"
        >
          <Pilihan value={f.goodsReceiptId} onChange={(v) => { set("goodsReceiptId", v); if (v) set("expenseCategoryId", ""); }}>
            <option value="">— bukan pembelian barang —</option>
            {unbilled.map((r) => (
              <option key={r.id} value={r.id}>
                {r.receiptNumber} · {r.supplier || "tanpa supplier"} · nilai terima {formatUang(r.nilaiTerima)}
              </option>
            ))}
          </Pilihan>
        </Field>

        {grDipilih && (
          <div className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2">
            Nilai penerimaan menurut ledger stok: <strong>{formatUang(grDipilih.nilaiTerima)}</strong>
            {grDipilih.barisTanpaHarga > 0 && (
              <span className="mt-1 block text-orange">
                {grDipilih.barisTanpaHarga} dari {grDipilih.jumlahBaris} baris belum punya harga satuan —
                selisihnya akan masuk akun Selisih Harga Pembelian.
              </span>
            )}
            {Number(f.amount) > 0 && Math.abs(Number(f.amount) - grDipilih.nilaiTerima) > 0.005 && (
              <span className="mt-1 block">
                Selisih tagihan vs penerimaan: <strong>{formatUang(Number(f.amount) - grDipilih.nilaiTerima)}</strong>
              </span>
            )}
          </div>
        )}

        {!f.goodsReceiptId && (
          <Field label="Kategori biaya" required hint="Untuk tagihan jasa/sewa/maklon — menentukan akun bebannya">
            <Pilihan value={f.expenseCategoryId} onChange={(v) => set("expenseCategoryId", v)}>
              <option value="">— pilih —</option>
              {kategori.map((k) => <option key={k.id} value={k.id}>{k.name} → {k.account?.code}</option>)}
            </Pilihan>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function ModalBayarSupplier({ open, onClose, suppliers, bills, rekening, onSubmit }) {
  const [f, setF] = useState({ supplierId: "", date: "", cashAccountId: "", reference: "", notes: "", ...BIAYA_KOSONG });
  const [alokasi, setAlokasi] = useState({});
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const tagihanTerbuka = useMemo(
    () => bills.filter((b) => b.supplierId === f.supplierId && ["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(b.status) && b.sisa > 0),
    [bills, f.supplierId]
  );

  const total = Object.values(alokasi).reduce((s, v) => s + (Number(v) || 0), 0);
  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const valid = f.supplierId && f.cashAccountId && total > 0 && biayaTransferLengkap(rek, f);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat Pembayaran ke Supplier"
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            disabled={!valid}
            onClick={() => onSubmit({
              ...denganBiaya(f),
              allocations: Object.entries(alokasi)
                .filter(([, v]) => Number(v) > 0)
                .map(([billId, amount]) => ({ billId, amount: Number(amount) })),
            })}
          >
            Simpan
          </TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Supplier" required>
          <Pilihan value={f.supplierId} onChange={(v) => { set("supplierId", v); setAlokasi({}); }}>
            <option value="">— pilih —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · sisa {formatUang(s.sisaUtang)}</option>)}
          </Pilihan>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Dibayar dari" required>
            <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
        </div>
        <CaraBayarTransfer rekening={rek} nominal={total} value={f} onChange={(b) => setF((s) => ({ ...s, ...b }))} />

        {f.supplierId && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink">Tagihan yang dibayar</p>
            {tagihanTerbuka.length === 0 ? (
              <p className="text-[13px] text-ink3">Tidak ada tagihan terbuka untuk supplier ini.</p>
            ) : (
              <div className="space-y-2">
                {tagihanTerbuka.map((b) => (
                  <div key={b.id} className="grid grid-cols-[1fr_140px] items-center gap-2">
                    <div className="min-w-0 text-[13px]">
                      <span className="block truncate font-medium">{b.billNumber} · {b.description}</span>
                      <span className="text-[11px] text-ink3">
                        sisa {formatUang(b.sisa)}{b.dueDate ? ` · jatuh tempo ${tanggalPendek(b.dueDate)}` : ""}
                      </span>
                    </div>
                    <InputUang
                      value={alokasi[b.id] ?? ""}
                      onChange={(v) => setAlokasi((s) => ({ ...s, [b.id]: v }))}
                      max={b.sisa}
                    />
                  </div>
                ))}
                <div className="rounded-lg bg-inset px-3 py-2 text-[13px]">
                  Total dibayar: <strong>{formatUang(total)}</strong>
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="Referensi transfer"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
