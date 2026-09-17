import React, { useCallback, useEffect, useState } from "react";
import { Undo2, Plus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek,
} from "@/features/finance/shared.jsx";

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

  const baris = (data?.baris || []).filter((b) => !filterEmber || b.ember === filterEmber);
  const refundMenunggu = refunds.filter((r) => r.status === "MENUNGGU_APPROVAL");

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
            />
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>
            {baris.length} order belum lunas
            {filterEmber && <Button size="sm" variant="tertiary" className="ml-2" onClick={() => setFilterEmber("")}>hapus filter</Button>}
          </CardTitle>
          <CardDescription>
            Umur dihitung dari jatuh tempo invoice kalau ada; kalau tidak, dari tanggal order —
            dan kolom “Acuan” menyebutkan yang mana, bukan menyamarkannya.
          </CardDescription>
        </CardHeader>
        {baris.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada piutang terbuka.</p></CardContent>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH><TH>Invoice</TH><TH>Pelanggan</TH><TH>Sales</TH>
                  <TH numeric>Nilai Order</TH><TH numeric>Sisa Tagihan</TH>
                  <TH>Jatuh Tempo</TH><TH>Acuan</TH><TH numeric>Umur</TH>
                </TR>
              </THead>
              <TBody>
                {baris.map((b) => (
                  <TR key={b.orderId}>
                    <TD className="font-medium">{b.orderNumber || "—"}</TD>
                    <TD className="font-mono text-[12px]">{b.invoiceNumber || "—"}</TD>
                    <TD className="max-w-[180px] truncate">{b.customerName}</TD>
                    <TD className="text-[12px] text-ink2">{b.salesName || "—"}</TD>
                    <TD numeric><Uang value={b.nilaiOrder} /></TD>
                    <TD numeric><Uang value={b.sisaTagihan} className="font-bold" /></TD>
                    <TD>{tanggalPendek(b.dueDate)}</TD>
                    <TD className="text-[12px] text-ink3">
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
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Refund ke Pelanggan</CardTitle>
          <CardDescription>
            Pengembalian uang yang BENAR-BENAR pernah diterima. Berbeda dari membatalkan entri pembayaran
            (itu untuk salah input — uangnya tidak pernah masuk).
            {refundMenunggu.length > 0 && ` ${refundMenunggu.length} menunggu persetujuan.`}
          </CardDescription>
        </CardHeader>
        {refunds.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">Belum ada refund.</p></CardContent>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR><TH>Nomor</TH><TH>Tanggal</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Alasan</TH><TH numeric>Nominal</TH><TH>Status</TH><TH /></TR>
              </THead>
              <TBody>
                {refunds.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-[12px]">{r.refundNumber}</TD>
                    <TD>{tanggalPendek(r.date)}</TD>
                    <TD className="font-medium">{r.order?.orderNumber || "—"}</TD>
                    <TD className="max-w-[160px] truncate">{r.order?.customer?.name || "—"}</TD>
                    <TD className="max-w-[220px] truncate">{r.reason}</TD>
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
          <Button variant="neutral" onClick={onClose}>Batal</Button>
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
        <Field label="Tanggal"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
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
