import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Undo2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek, LABEL_STATUS,
} from "@/features/finance/shared.jsx";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";

// Nominal bisa dicari sebagai "150000" maupun "150.000".
function teksNominal(x) {
  const n = Math.round(Number(x));
  if (!Number.isFinite(n)) return "";
  return `${n} ${n.toLocaleString("id-ID")}`;
}

function bucketUmur(hari) {
  if (!(hari > 0)) return "belum";
  if (hari <= 30) return "1_30";
  if (hari <= 60) return "31_60";
  return "60_plus";
}

// PIUTANG — siapa berutang ke kita, berapa, dan sudah lewat berapa lama.
//
// ⚠️ ANGKA DI SINI BUKAN "nilai order dikurangi pembayaran". Piutang
// dihitung dari SALDO AKUN Piutang Usaha per order di buku besar, dan itu
// berarti order yang BELUM DISERAHKAN tidak muncul sama sekali — uang yang
// sudah dibayar untuk order yang belum jadi adalah UANG MUKA (kewajiban
// kita), bukan tagihan ke customer. Perbedaan ini yang membuat total
// piutang di halaman ini bisa lebih kecil dari "sisa tagihan" versi CRM,
// dan angka di sinilah yang benar secara akuntansi.

export default function FinanceReceivables() {
  const [data, setData] = useState(null);
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [filterEmber, setFilterEmber] = useState("");
  const [modalRefund, setModalRefund] = useState(false);
  const [rekening, setRekening] = useState([]);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ar, rf, rk] = await Promise.all([
        api.getFinanceReceivables(),
        api.getFinanceRefunds(),
        api.getFinanceCashAccounts(),
      ]);
      setData(ar);
      setRefunds(rf.refunds);
      setRekening(rk.accounts.filter((a) => a.active));
    } catch (e) {
      setError(e.message || "Gagal memuat piutang");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalRefund(false);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const navigate = useNavigate();
  const barisEmber = (data?.baris || []).filter((b) => !filterEmber || b.ember === filterEmber);
  const refundMenunggu = refunds.filter((r) => r.status === "MENUNGGU_APPROVAL");

  const [q, setQ] = useState("");
  const [fSales, setFSales] = useState("");
  const [fUmur, setFUmur] = useState("");
  const [fAcuan, setFAcuan] = useState("");
  const [qRefund, setQRefund] = useState("");
  const [fStatusRefund, setFStatusRefund] = useState("");

  const daftarSales = useMemo(
    () => [...new Set((data?.baris || []).map((b) => b.salesName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id")),
    [data],
  );
  const baris = useMemo(() => barisEmber.filter((b) =>
    (!fSales || b.salesName === fSales)
    && (!fUmur || bucketUmur(b.hariLewat) === fUmur)
    && (!fAcuan || (b.sumberJatuhTempo === "invoice" ? "invoice" : "order") === fAcuan)
    && cocok(q, b.orderNumber, b.invoiceNumber, b.customerName, b.salesName, teksNominal(b.sisaTagihan), teksNominal(b.nilaiOrder), b.dueDate ? tanggalPendek(b.dueDate) : "", b.dueDate),
  ), [barisEmber, q, fSales, fUmur, fAcuan]);

  const statusRefund = useMemo(() => [...new Set(refunds.map((r) => r.status).filter(Boolean))], [refunds]);
  const refundTampil = useMemo(() => refunds.filter((r) =>
    (!fStatusRefund || r.status === fStatusRefund)
    && cocok(qRefund, r.refundNumber, r.order?.orderNumber, r.order?.customer?.name, r.reason, teksNominal(r.amount)),
  ), [refunds, qRefund, fStatusRefund]);

  return (
    <HalamanFinance
      title="Piutang Pelanggan"
      subtitle="Tagihan atas order yang sudah diserahkan tapi belum lunas, dikelompokkan menurut umurnya."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <Button size="sm" onClick={() => setModalRefund(true)}>
          <Undo2 size={14} /> Ajukan Refund
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

      {(data?.menungguVerifikasi?.jumlah ?? 0) > 0 && (
        <Card className="bg-accentbg">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="text-[13px] leading-relaxed text-ink">
              <strong>{data.menungguVerifikasi.jumlah} order ({formatUang(data.menungguVerifikasi.total)})</strong> sudah
              ditandai <strong>Lunas</strong> oleh sales dan <strong>tidak dihitung sebagai piutang</strong> di bawah — tinggal
              diverifikasi finance (rekening + bukti). Angka ini masih tercatat di Piutang Usaha pada neraca sampai diverifikasi.
            </p>
            <Button size="sm" onClick={() => navigate("/finance/payments")}>Buka antrean verifikasi</Button>
          </CardContent>
        </Card>
      )}

      <Penjelasan>
        Piutang dihitung dari saldo akun <strong>Piutang Usaha</strong> per order di buku besar — bukan dari
        “nilai order dikurangi pembayaran”. Akibatnya order yang <strong>belum diserahkan</strong> tidak muncul
        di sini sama sekali: uang yang sudah dibayar untuk order itu masih berstatus <strong>uang muka</strong>
        {" "}(kewajiban kita ke customer), belum jadi tagihan.
      </Penjelasan>

      {/* Ember umur — dipakai juga sebagai filter, jadi angka & daftarnya tidak terpisah. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KartuAngka
          label="Total Piutang" value={formatUang(data?.total ?? 0)}
          sub={`${data?.baris?.length ?? 0} order`}
          onClick={() => setFilterEmber("")}
          info="Total tagihan yang belum lunas dari order yang SUDAH diserahkan ke pelanggan. Klik untuk menghapus filter umur di bawah."
        />
        {(data?.ember || []).map((e) => {
          const nilai = data.ringkasan?.[e.key] ?? 0;
          return (
            <KartuAngka
              key={e.key}
              label={e.label}
              value={formatUang(nilai)}
              tone={e.key === "90_plus" && nilai > 0 ? "red" : e.key === "61_90" && nilai > 0 ? "orange" : "default"}
              sub={filterEmber === e.key ? "sedang difilter" : undefined}
              onClick={() => setFilterEmber(filterEmber === e.key ? "" : e.key)}
              info="Piutang dikelompokkan menurut sudah berapa lama lewat jatuh tempo. Semakin ke kanan (90+ hari), semakin berisiko tidak tertagih — klik untuk menyaring daftar di bawah."
            />
          );
        })}
      </div>

      <FilterBar
        q={q} onQ={setQ}
        placeholder="Cari order, invoice, pelanggan, nominal…"
        filters={[
          { key: "sales", label: "Sales", value: fSales, onChange: setFSales, options: daftarSales.map((s) => [s, s]) },
          { key: "umur", label: "Umur", value: fUmur, onChange: setFUmur, options: [["belum", "Belum jatuh tempo"], ["1_30", "1–30 hari"], ["31_60", "31–60 hari"], ["60_plus", "> 60 hari"]] },
          { key: "acuan", label: "Acuan", value: fAcuan, onChange: setFAcuan, options: [["invoice", "Invoice"], ["order", "Tanggal order"]] },
        ]}
        ringkasan={`${baris.length} piutang${baris.length !== barisEmber.length ? ` dari ${barisEmber.length}` : ""}`}
        onReset={() => { setQ(""); setFSales(""); setFUmur(""); setFAcuan(""); }}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title={<>
            {baris.length} order belum lunas
            {filterEmber && <Button size="sm" variant="tertiary" className="ml-2" onClick={() => setFilterEmber("")}>hapus filter</Button>}
          </>}
          description="Umur dihitung dari jatuh tempo invoice kalau ada; kalau tidak, dari tanggal order —
            dan kolom “Acuan” menyebutkan yang mana, bukan menyamarkannya."
          info="Order dengan umur piutang lebih dari 60 hari (badge oranye/merah) sebaiknya segera ditindaklanjuti — semakin lama menunggak, semakin kecil peluang tertagih penuh."
        />
        {baris.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">{barisEmber.length > 0 ? "Tidak ada piutang yang cocok dengan pencarian/filter." : "Tidak ada piutang terbuka."}</p></CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={132}>Order</TH>
                  <TH width={120} hideBelow="wide">Invoice</TH>
                  <TH>Pelanggan</TH>
                  <TH width={110} hideBelow="wide">Sales</TH>
                  <TH numeric width={116} hideBelow="wide">Nilai Order</TH>
                  <TH numeric width={124}>Sisa Tagihan</TH>
                  <TH width={100}>Jatuh Tempo</TH>
                  <TH width={100} hideBelow="wide">Acuan</TH>
                  <TH numeric width={92}>Umur</TH>
                </TR>
              </THead>
              <TBody>
                {baris.map((b) => (
                  <TR key={b.orderId}>
                    <TD sticky className="font-medium">{b.orderNumber || "—"}</TD>
                    <TD hideBelow="wide" className="font-mono text-[12px]">{b.invoiceNumber || "—"}</TD>
                    <TD truncate>{b.customerName}</TD>
                    <TD hideBelow="wide" truncate className="text-[12px] text-ink2">{b.salesName || "—"}</TD>
                    <TD hideBelow="wide" numeric><Uang value={b.nilaiOrder} /></TD>
                    <TD numeric><Uang value={b.sisaTagihan} className="font-bold" /></TD>
                    <TD className="whitespace-nowrap">{tanggalPendek(b.dueDate)}</TD>
                    <TD hideBelow="wide" className="text-[12px] text-ink3">
                      {b.sumberJatuhTempo === "invoice" ? "invoice" : "tanggal order"}
                    </TD>
                    <TD numeric>
                      {b.hariLewat > 0
                        ? <Badge variant={b.hariLewat > 60 ? "red" : b.hariLewat > 30 ? "orange" : "neutral"}>{b.hariLewat} hari</Badge>
                        : <span className="text-ink3">belum</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* ── Refund ── */}
      <FilterBar
        q={qRefund} onQ={setQRefund}
        placeholder="Cari nomor, order, pelanggan…"
        filters={[
          { key: "status", label: "Status", value: fStatusRefund, onChange: setFStatusRefund, options: statusRefund.map((s) => [s, LABEL_STATUS[s] || s]) },
        ]}
        ringkasan={`${refundTampil.length} refund${refundTampil.length !== refunds.length ? ` dari ${refunds.length}` : ""}`}
        onReset={() => { setQRefund(""); setFStatusRefund(""); }}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title="Refund ke Pelanggan"
          description={<>
            Pengembalian uang yang BENAR-BENAR pernah diterima. Berbeda dari membatalkan entri pembayaran
            (itu untuk salah input — uangnya tidak pernah masuk).
            {refundMenunggu.length > 0 && ` ${refundMenunggu.length} menunggu persetujuan.`}
          </>}
          info="Sistem otomatis menolak refund yang nilainya melebihi uang yang pernah benar-benar diterima untuk order itu — jadi tidak mungkin 'mengeluarkan' uang yang sebenarnya belum pernah masuk."
        />
        {refundTampil.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">{refunds.length > 0 ? "Tidak ada refund yang cocok dengan pencarian/filter." : "Belum ada refund."}</p></CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={124}>Nomor</TH><TH width={78}>Tanggal</TH>
                  <TH width={128} hideBelow="wide">Order</TH><TH width={140}>Pelanggan</TH><TH>Alasan</TH>
                  <TH numeric width={108}>Nominal</TH><TH width={100}>Status</TH><TH width={172} />
                </TR>
              </THead>
              <TBody>
                {refundTampil.map((r) => (
                  <TR key={r.id}>
                    <TD sticky className="font-mono text-[12px]">{r.refundNumber}</TD>
                    <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(r.date)}</TD>
                    <TD hideBelow="wide" truncate className="font-medium">{r.order?.orderNumber || "—"}</TD>
                    <TD truncate>{r.order?.customer?.name || "—"}</TD>
                    <TD truncate>{r.reason}</TD>
                    <TD numeric><Uang value={r.amount} /></TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD>
                      {r.status === "MENUNGGU_APPROVAL" && (
                        <div className="flex justify-end gap-1">
                          <TombolAksi
                            size="sm" variant="secondary"
                            confirmText={`Setujui refund ${formatUang(r.amount)} untuk order ${r.order?.orderNumber}? Uang akan keluar dari ${r.cashAccount?.name}.`}
                            onClick={() => aksi(() => api.approveFinanceRefund(r.id))}
                          >
                            Setujui
                          </TombolAksi>
                          <TombolAksi
                            size="sm" variant="neutral"
                            onClick={() => {
                              const alasan = window.prompt("Alasan penolakan refund:");
                              if (alasan?.trim()) return aksi(() => api.rejectFinanceRefund(r.id, alasan.trim()));
                            }}
                          >
                            Tolak
                          </TombolAksi>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <ModalRefund
        open={modalRefund}
        onClose={() => setModalRefund(false)}
        rekening={rekening}
        piutang={data?.baris || []}
        onSubmit={(d) => aksi(() => api.createFinanceRefund(d))}
      />
    </HalamanFinance>
  );
}

function ModalRefund({ open, onClose, rekening, piutang, onSubmit }) {
  const [f, setF] = useState({ orderId: "", date: "", amount: "", reason: "", cashAccountId: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.orderId && f.reason.trim() && f.cashAccountId && Number(f.amount) > 0;

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Ajukan Refund"
      description="Pengembalian uang ke pelanggan. Butuh persetujuan sebelum uang benar-benar keluar."
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Ajukan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Order" required
          hint="Cari nomor order atau nama pelanggan. Order dengan piutang terbuka muncul duluan."
        >
          <OrderPicker
            value={f.orderId}
            onChange={(id) => set("orderId", id)}
            // Piutang terbuka ditawarkan sebagai saran tanpa perlu mengetik —
            // itu kasus refund yang paling sering. Bentuknya disamakan dengan
            // item hasil pencarian order supaya OrderPicker tidak perlu tahu
            // dua bentuk data yang berbeda.
            saran={piutang.slice(0, 8).map((b) => ({
              id: b.orderId,
              orderNumber: b.orderNumber,
              customerName: b.customerName,
              value: b.nilaiOrder,
              paymentStatus: b.orderStatus === "CANCELLED" ? null : "DP",
            }))}
            saranLabel="Piutang terbuka"
          />
        </Field>
        <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
        <Field
          label="Nominal" required
          hint="Tidak boleh melebihi uang yang pernah benar-benar diterima untuk order itu"
        >
          <InputUang value={f.amount} onChange={(v) => set("amount", v)} />
        </Field>
        <Field label="Alasan" required>
          <Input value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Order dibatalkan customer" />
        </Field>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
      </div>
    </Modal>
  );
}
