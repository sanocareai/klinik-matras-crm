import React, { useCallback, useEffect, useState } from "react";
import { CalendarClock, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  Pilihan, tanggalPendek,
} from "@/features/finance/shared.jsx";

// INVOICE & JATUH TEMPO — sisi FINANCE dari invoice yang sudah ada.
//
// ⚠️ HALAMAN INI TIDAK MEMBUAT INVOICE. Invoice lahir OTOMATIS sebagai
// draft begitu order dibuat (sales tidak perlu langkah tambahan), dan
// isinya — item, harga, alamat, pengiriman ke customer lewat WA/PDF —
// tetap dikelola dari Rincian Pesanan di CRM. Yang dikerjakan di sini
// hanya pekerjaan yang memang milik finance: memastikan tagihan punya
// JATUH TEMPO, dan menindaklanjuti yang sudah lewat.
//
// Nominalnya DITURUNKAN dari sumber yang sama dengan invoice yang dikirim
// ke customer (services/invoice.js#hitungNominal) — bukan dihitung ulang.

const STATUS_INVOICE = {
  DRAFT: { label: "Draft", variant: "neutral" },
  SENT: { label: "Terkirim", variant: "accent" },
  VIEWED: { label: "Dilihat", variant: "accent" },
  PARTIALLY_PAID: { label: "Dibayar Sebagian", variant: "orange" },
  PAID: { label: "Lunas", variant: "green" },
  OVERDUE: { label: "Lewat Tempo", variant: "red" },
  CANCELLED: { label: "Dibatalkan", variant: "neutral" },
};

const FILTER = [
  { key: "", label: "Semua" },
  { key: "lewat", label: "Lewat Jatuh Tempo" },
  { key: "belum_diatur", label: "Belum Ada Jatuh Tempo" },
];

export default function FinanceInvoices() {
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [aturTempo, setAturTempo] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getFinanceInvoices({ jatuhTempo, search }));
    } catch (e) {
      setError(e.message || "Gagal memuat invoice");
    } finally {
      setLoading(false);
    }
  }, [jatuhTempo, search]);

  useEffect(() => { muat(); }, [muat]);

  async function simpanTempo(orderId, dueDate) {
    try {
      // Endpoint LAMA yang sudah dipakai CRM — tidak ada jalur tulis kedua
      // untuk kolom yang sama.
      await api.updateOrderInvoice(orderId, { dueDate: dueDate || null });
      setAturTempo(null);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const invoices = data?.invoices || [];
  const r = data?.ringkasan;

  return (
    <HalamanFinance
      title="Invoice & Jatuh Tempo"
      subtitle="Tagihan ke pelanggan, umur tagihannya, dan yang belum punya tanggal jatuh tempo."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <Input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nomor invoice/order atau pelanggan…" className="max-w-[280px]"
        />
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

      <Penjelasan>
        Invoice <strong>dibuat otomatis</strong> saat order lahir dan isinya dikelola dari Rincian Pesanan di
        CRM — halaman ini tidak membuat atau mengirim invoice. Nominalnya diturunkan dari sumber yang sama
        dengan invoice yang dikirim ke customer, jadi angkanya mustahil berbeda dari dokumen yang sudah
        mereka terima.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka
          label="Invoice Ditampilkan" value={r?.total ?? 0} sub="Sesuai filter"
          info="Jumlah baris yang tampil di tabel bawah sesuai filter yang aktif — invoice gabungan dihitung satu, bukan per order anggotanya."
        />
        <KartuAngka
          label="Nilai Belum Lunas" value={formatUang(r?.nilaiBelumLunas ?? 0)}
          sub="Seluruh invoice, bukan cuma yang tampil"
          info="Total sisa tagihan dari SEMUA invoice yang belum lunas, termasuk yang sedang tersembunyi karena filter — supaya angkanya tetap bisa dipercaya walau sedang menyaring tampilan."
        />
        <KartuAngka
          label="Lewat Jatuh Tempo" value={r?.lewatTempo ?? 0}
          tone={(r?.lewatTempo ?? 0) > 0 ? "red" : "default"}
          onClick={() => setJatuhTempo(jatuhTempo === "lewat" ? "" : "lewat")}
          info="Invoice yang tanggal jatuh temponya sudah lewat tapi masih ada sisa tagihan. Klik kartu ini untuk langsung menyaring daftar di bawah."
        />
        <KartuAngka
          label="Belum Ada Jatuh Tempo" value={r?.tanpaJatuhTempo ?? 0}
          tone={(r?.tanpaJatuhTempo ?? 0) > 0 ? "orange" : "default"}
          sub="Umur tagihannya dihitung dari tanggal order"
          onClick={() => setJatuhTempo(jatuhTempo === "belum_diatur" ? "" : "belum_diatur")}
          info="Invoice yang belum pernah diatur tanggal jatuh temponya. Selama belum diatur, 'umur' tagihan dihitung dari tanggal order dibuat — atur tanggal jatuh tempo yang sebenarnya lewat ikon kalender di baris tabel."
        />
      </div>

      {r?.dariStatusManual > 0 && (
        <Card className="bg-orangebg">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange" />
            <div>
              <p className="text-[13px] font-bold text-ink">
                {r.dariStatusManual} invoice angkanya dari status bayar manual, bukan dari ledger pembayaran
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink2">
                Order-order itu tidak punya satu pun entri pembayaran tercatat — statusnya diklik manual di
                dropdown CRM. Angka “sudah dibayar”-nya mengikuti status itu apa adanya dan TIDAK punya
                rincian siapa menerima, kapan, lewat apa. Kolom “Sumber” di tabel menandainya per baris.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTER.map((f) => (
          <Button
            key={f.key || "semua"} size="sm"
            variant={jatuhTempo === f.key ? "secondary" : "neutral"}
            onClick={() => setJatuhTempo(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-ink3">
        Fokus ke tagihan yang paling butuh tindakan — yang sudah lewat tempo atau belum punya tanggal tempo sama sekali.
      </p>

      <Card className="overflow-hidden">
        <JudulKartu
          title={`${invoices.length} invoice`}
          description="Invoice gabungan tampil sebagai SATU baris (dokumen yang benar-benar dikirim ke customer adalah
            invoice utamanya) — anggotanya tidak dihitung dua kali."
          info="Kolom Sumber membedakan invoice yang nilai 'sudah dibayar'-nya berasal dari ledger pembayaran sungguhan (hijau, bisa dipercaya rinciannya) dari yang cuma mengikuti status manual lama di CRM (oranye, tidak ada rincian siapa/kapan/berapa)."
        />
        {invoices.length === 0 ? (
          <CardContent>
            <EmptyState icon={FileText} title="Tidak ada invoice" description="Belum ada invoice yang cocok dengan filter ini." />
          </CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR>
                  <TH sticky>Invoice</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Sales</TH>
                  <TH numeric>Tagihan</TH><TH numeric>Dibayar</TH><TH numeric>Sisa</TH>
                  <TH>Sumber</TH><TH>Jatuh Tempo</TH><TH>Status</TH><TH />
                </TR>
              </THead>
              <TBody>
                {invoices.map((inv) => {
                  const st = STATUS_INVOICE[inv.status] || { label: inv.status, variant: "neutral" };
                  return (
                    <TR key={inv.id}>
                      <TD sticky className="font-mono text-[12px]">
                        {inv.invoiceNumber}
                        {inv.jumlahOrder > 1 && (
                          <Badge variant="accent" className="ml-1.5">{inv.jumlahOrder} order</Badge>
                        )}
                      </TD>
                      <TD className="font-medium">{inv.orderNumber || "—"}</TD>
                      <TD className="max-w-[170px] truncate">{inv.customerName || "—"}</TD>
                      <TD className="text-[12px] text-ink2">{inv.salesName || "—"}</TD>
                      <TD numeric><Uang value={inv.totalTagihan} /></TD>
                      <TD numeric>
                        <Uang value={inv.dibayar} nolSebagaiStrip />
                        {inv.dibayarTidakRinci && (
                          <span className="block text-[11px] text-orange">nominal tidak tercatat</span>
                        )}
                      </TD>
                      <TD numeric><Uang value={inv.sisa} className="font-bold" nolSebagaiStrip /></TD>
                      <TD>
                        <Badge variant={inv.sumber === "ledger" ? "green" : "orange"}>
                          {inv.sumber === "ledger" ? "Ledger" : "Status manual"}
                        </Badge>
                      </TD>
                      <TD>
                        {inv.dueDate ? (
                          <>
                            <span className="block whitespace-nowrap">{tanggalPendek(inv.dueDate)}</span>
                            {inv.hariLewat > 0 && !inv.lunas && (
                              <span className="text-[11px] text-red">lewat {inv.hariLewat} hari</span>
                            )}
                          </>
                        ) : (
                          <span className="text-ink3">belum diatur</span>
                        )}
                      </TD>
                      <TD><Badge variant={st.variant}>{st.label}</Badge></TD>
                      <TD>
                        <Button
                          size="sm" variant="tertiary"
                          onClick={() => setAturTempo(inv)}
                          title="Atur jatuh tempo"
                        >
                          <CalendarClock size={14} />
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <ModalJatuhTempo
        invoice={aturTempo}
        onClose={() => setAturTempo(null)}
        onSubmit={simpanTempo}
      />
    </HalamanFinance>
  );
}

function ModalJatuhTempo({ invoice, onClose, onSubmit }) {
  const [tanggal, setTanggal] = useState("");

  useEffect(() => {
    setTanggal(invoice?.dueDate ? String(invoice.dueDate).slice(0, 10) : "");
  }, [invoice]);

  if (!invoice) return null;

  // Pintasan yang mewakili cara tim menyepakati tempo di lapangan
  // ("14 hari dari sekarang"), bukan memaksa menghitung tanggal di kepala.
  function dalamHari(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    setTanggal(d.toISOString().slice(0, 10));
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Jatuh Tempo ${invoice.invoiceNumber}`}
      description={`${invoice.customerName || "—"} · sisa ${formatUang(invoice.sisa)}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(invoice.orderId, tanggal)}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Tanggal jatuh tempo"
          hint="Kosongkan untuk melepas tempo — umur tagihan lalu dihitung dari tanggal order, dan laporan menyebutkan acuannya apa adanya."
        >
          <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={tanggal} onChange={setTanggal} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {[7, 14, 30].map((n) => (
            <Button key={n} size="sm" variant="neutral" onClick={() => dalamHari(n)}>
              {n} hari dari sekarang
            </Button>
          ))}
          <Button size="sm" variant="neutral" onClick={() => setTanggal("")}>Kosongkan</Button>
        </div>
      </div>
    </Modal>
  );
}
