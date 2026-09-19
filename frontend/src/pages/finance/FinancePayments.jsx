import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Image as ImageIcon, Split } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  PeriodePicker, periodeDefault, tanggalJam, InputUang,
} from "@/features/finance/shared.jsx";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";
import LunasBelumDicatat from "@/features/finance/LunasBelumDicatat.jsx";

// PEMBAYARAN PELANGGAN & VERIFIKASI.
//
// Halaman ini TIDAK mencatat pembayaran baru — itu tetap dikerjakan sales
// (saat konfirmasi order) dan driver (di stop pengiriman), di tempat mereka
// masing-masing. Di sini finance MENCOCOKKAN uang yang tercatat dengan
// setoran yang benar-benar diterima, dan kalau perlu memecah satu
// pembayaran ke beberapa order.
//
// Verifikasi memakai endpoint LAMA (POST /armada/payments/:id/verify) yang
// sudah dipakai sejak D-011 — tidak dibuatkan jalur kedua, supaya tidak ada
// dua cara memverifikasi hal yang sama.

const TAB = [
  { key: "lunas_crm", label: "Lunas di CRM (perlu diverifikasi)" },
  { key: "belum_verifikasi", label: "Belum Diverifikasi" },
  { key: "terverifikasi", label: "Terverifikasi" },
  { key: "dibatalkan", label: "Dibatalkan" },
  { key: "", label: "Semua" },
];

export default function FinancePayments() {
  const [tab, setTab] = useState("lunas_crm");
  const [periode, setPeriode] = useState(periodeDefault);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [alokasiUntuk, setAlokasiUntuk] = useState(null);
  const [fotoBukti, setFotoBukti] = useState(null);
  const [q, setQ] = useState("");
  const [fMetode, setFMetode] = useState("");
  const [fVerif, setFVerif] = useState("");
  const [fAlokasi, setFAlokasi] = useState("");
  const [fBukti, setFBukti] = useState("");

  const muat = useCallback(async () => {
    // Tab "Lunas di CRM" memuat datanya sendiri (LunasBelumDicatat).
    if (tab === "lunas_crm") {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await api.getFinanceCustomerPayments({ ...periode, status: tab }));
    } catch (e) {
      setError(e.message || "Gagal memuat pembayaran");
    } finally {
      setLoading(false);
    }
  }, [periode, tab]);

  useEffect(() => { muat(); }, [muat]);

  async function verifikasi(p) {
    try {
      await api.verifyPayment(p.id);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const payments = data?.payments || [];
  const total = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const belum = payments.filter((p) => !p.terverifikasi && !p.cancelledAt).length;

  const opsiMetode = useMemo(
    () => [...new Set(payments.map((p) => p.method).filter(Boolean))].sort().map((m) => [m, m]),
    [payments]
  );
  const tampil = useMemo(() => {
    // "150.000" harus cocok dengan nominal 150000: titik pemisah ribuan dibuang
    // dari kata yang murni angka.
    const qNorm = String(q || "").split(/\s+/).map((k) => (/^[\d.]+$/.test(k) ? k.replace(/\./g, "") : k)).join(" ");
    return payments.filter((p) => {
      if (fMetode && p.method !== fMetode) return false;
      if (fVerif === "terverifikasi" && !(p.terverifikasi && !p.cancelledAt)) return false;
      if (fVerif === "belum" && (p.terverifikasi || p.cancelledAt)) return false;
      if (fVerif === "dibatalkan" && !p.cancelledAt) return false;
      const adaAlokasi = (p.finAllocations || []).length > 0;
      if (fAlokasi === "ada" && !adaAlokasi) return false;
      if (fAlokasi === "tanpa" && adaAlokasi) return false;
      if (fBukti === "ada" && !p.proofPhotoUrl) return false;
      if (fBukti === "tanpa" && p.proofPhotoUrl) return false;
      return cocok(
        qNorm, p.order?.orderNumber, p.order?.customer?.name, p.recordedBy?.name,
        p.method, p.amount, p.notes
      );
    });
  }, [payments, q, fMetode, fVerif, fAlokasi, fBukti]);
  const disaring = !!q || !!fMetode || !!fVerif || !!fAlokasi || !!fBukti;

  function aturUlangFilter() {
    setQ(""); setFMetode(""); setFVerif(""); setFAlokasi(""); setFBukti("");
  }

  return (
    <HalamanFinance
      title="Pembayaran & Verifikasi"
      subtitle="Cocokkan uang yang tercatat diterima sales/driver dengan setoran yang benar-benar masuk."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
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
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <ShieldCheck size={14} className="text-accent" />
          {data?.gate?.enabled
            ? "Gerbang verifikasi AKTIF"
            : "Gerbang verifikasi TIDAK aktif"}
        </span>
        <p className="mt-1">
          {data?.gate?.enabled
            ? "Status bayar order di CRM HANYA bergerak setelah pembayaran diverifikasi di sini. Pembayaran yang " +
              "tercatat sebelum gerbang dinyalakan tetap dihitung apa adanya — riwayat tidak pernah berubah surut."
            : "Verifikasi di sini adalah audit “uangnya benar sampai ke kas”, BUKAN gerbang “apakah customer sudah " +
              "bayar”. Status bayar order di CRM tetap mengikuti seluruh pembayaran yang tercatat. Gerbangnya bisa " +
              "dinyalakan admin di Pengaturan Finance kalau tim sudah siap."}
        </p>
      </Penjelasan>

      <div className={tab === "lunas_crm" ? "hidden" : "grid grid-cols-1 gap-4 sm:grid-cols-3"}>
        <KartuAngka
          label="Total Pembayaran Periode" value={formatUang(total)} sub={`${payments.length} entri`}
          info="Jumlah seluruh pembayaran yang tercatat di periode yang dipilih, terverifikasi atau belum."
        />
        <KartuAngka
          label="Belum Diverifikasi" value={belum} tone={belum > 0 ? "orange" : "default"} sub="Menunggu dicocokkan"
          info="Uang yang tercatat diterima sales/driver tapi belum ada yang mengonfirmasi kalau setorannya memang benar-benar sampai ke rekening/kas perusahaan."
        />
        <KartuAngka
          label="Sudah Diverifikasi"
          value={payments.filter((p) => p.terverifikasi).length}
          tone="green"
          sub="Cocok dengan setoran"
          info="Sudah dicek dan cocok dengan setoran nyata — bukan berarti pelanggannya sudah lunas, itu urusan status bayar order di CRM."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={tab === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-ink3">
        {tab === "lunas_crm"
          ? "Order yang sudah ditandai lunas oleh sales tapi uang masuknya belum tercatat — verifikasi di sini."
          : "Pembayaran yang sudah punya catatan (sales/driver) tinggal dicocokkan dengan setoran yang masuk."}
      </p>

      {tab === "lunas_crm" && <LunasBelumDicatat />}

      <FilterBar
        className={tab === "lunas_crm" ? "hidden" : undefined}
        q={q} onQ={setQ}
        placeholder="Cari order, pelanggan, nominal…"
        filters={[
          { key: "metode", label: "Metode", value: fMetode, onChange: setFMetode, options: opsiMetode },
          { key: "verif", label: "Verifikasi", value: fVerif, onChange: setFVerif, options: [["terverifikasi", "Terverifikasi"], ["belum", "Belum diverifikasi"], ["dibatalkan", "Dibatalkan"]] },
          { key: "alokasi", label: "Alokasi", value: fAlokasi, onChange: setFAlokasi, options: [["ada", "Ada alokasi"], ["tanpa", "Tanpa alokasi"]] },
          { key: "bukti", label: "Bukti", value: fBukti, onChange: setFBukti, options: [["ada", "Ada bukti"], ["tanpa", "Tanpa bukti"]] },
        ]}
        ringkasan={disaring ? `${tampil.length} pembayaran dari ${payments.length}` : `${payments.length} pembayaran`}
        onReset={aturUlangFilter}
      />

      <Card className={tab === "lunas_crm" ? "hidden" : "overflow-hidden"}>
        <JudulKartu
          title="Daftar Pembayaran"
          description="Entri pembayaran bersifat append-only: koreksi salah input dilakukan lewat pembatalan di halaman
            Order, bukan dengan menghapus baris."
          info="'Append-only' artinya baris pembayaran tidak pernah diedit atau dihapus diam-diam — kalau ada yang salah, dibatalkan lewat halaman Order (bukan di sini) supaya tetap ada jejak siapa membatalkan dan kenapa."
        />
        {tampil.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada pembayaran di filter ini.</p></CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR>
                  <TH sticky>Waktu</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Dicatat oleh</TH>
                  <TH>Metode</TH><TH>Rekening</TH><TH numeric>Nominal</TH><TH>Alokasi</TH><TH>Status</TH><TH />
                </TR>
              </THead>
              <TBody>
                {tampil.map((p) => (
                  <TR key={p.id}>
                    <TD sticky className="whitespace-nowrap">{tanggalJam(p.createdAt)}</TD>
                    <TD className="font-medium">{p.order?.orderNumber || "—"}</TD>
                    <TD className="max-w-[160px] truncate">{p.order?.customer?.name || "—"}</TD>
                    <TD>{p.recordedBy?.name || "—"}</TD>
                    <TD><Badge variant="neutral">{p.method}</Badge></TD>
                    <TD className="text-[12px]">{p.cashAccount?.name || <span className="text-ink3">ikut pemetaan metode</span>}</TD>
                    <TD numeric><Uang value={p.amount} /></TD>
                    <TD className="text-[12px] text-ink2">
                      {p.finAllocations.length === 0
                        ? <span className="text-ink3">penuh ke order ini</span>
                        : p.finAllocations.map((a) => (
                            <span key={a.id} className="block">
                              {a.order?.orderNumber || "—"}: {formatUang(a.amount)}
                            </span>
                          ))}
                    </TD>
                    <TD>
                      {p.cancelledAt
                        ? <Badge variant="red">Dibatalkan</Badge>
                        : p.terverifikasi
                          ? <Badge variant="green">Terverifikasi</Badge>
                          : <Badge variant="orange">Belum</Badge>}
                      {p.terverifikasi && (
                        <span className="mt-0.5 block text-[11px] text-ink3">
                          oleh {p.verifications[0]?.verifiedBy?.name || "—"}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        {p.proofPhotoUrl && (
                          <Button size="sm" variant="tertiary" onClick={() => setFotoBukti(p.proofPhotoUrl)} title="Lihat bukti">
                            <ImageIcon size={14} />
                          </Button>
                        )}
                        {!p.cancelledAt && (
                          <Button size="sm" variant="tertiary" onClick={() => setAlokasiUntuk(p)} title="Atur alokasi">
                            <Split size={14} />
                          </Button>
                        )}
                        {!p.cancelledAt && !p.terverifikasi && (
                          <TombolAksi size="sm" variant="secondary" onClick={() => verifikasi(p)}>
                            Verifikasi
                          </TombolAksi>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <ModalAlokasi
        payment={alokasiUntuk}
        onClose={() => setAlokasiUntuk(null)}
        onSaved={async () => { setAlokasiUntuk(null); await muat(); }}
        onError={setPesan}
      />

      <Modal open={Boolean(fotoBukti)} onOpenChange={(v) => !v && setFotoBukti(null)} title="Bukti Pembayaran" className="w-[560px]">
        {fotoBukti && <img src={fotoBukti} alt="Bukti pembayaran" className="max-h-[70vh] w-full rounded-lg object-contain" />}
      </Modal>
    </HalamanFinance>
  );
}

/**
 * Alokasi satu pembayaran ke beberapa order.
 *
 * Aturannya tegas dan ditegakkan backend juga: TOTAL alokasi wajib PERSIS
 * sama dengan nominal pembayaran. Menerima kurang berarti ada uang yang
 * hilang dari pembukuan; menerima lebih berarti mengarang uang. Sisa yang
 * belum teralokasi ditampilkan hidup di bawah supaya tidak perlu menghitung
 * di kepala.
 */
function ModalAlokasi({ payment, onClose, onSaved, onError }) {
  const [baris, setBaris] = useState([]);

  useEffect(() => {
    if (!payment) return;
    setBaris(
      payment.finAllocations.length > 0
        ? payment.finAllocations.map((a) => ({ orderNumber: a.order?.orderNumber || "", orderId: a.orderId, amount: String(a.amount) }))
        : [{ orderNumber: payment.order?.orderNumber || "", orderId: payment.orderId, amount: String(payment.amount) }]
    );
  }, [payment]);

  if (!payment) return null;

  const total = baris.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const sisa = (payment.amount || 0) - total;
  const valid = Math.abs(sisa) < 0.005 && baris.every((b) => b.orderId && Number(b.amount) > 0);

  function ubah(i, k, v) {
    setBaris((s) => s.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)));
  }

  async function simpan() {
    try {
      await api.setFinancePaymentAllocations(
        payment.id,
        baris.map((b) => ({ orderId: b.orderId, amount: Number(b.amount) }))
      );
      await onSaved();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Alokasi Pembayaran"
      description={`${formatUang(payment.amount)} · ${payment.method} · ${tanggalJam(payment.createdAt)}`}
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={simpan} disabled={!valid}>Simpan Alokasi</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-ink2">
          Satu pembayaran bisa dipecah ke beberapa order — misalnya customer mentransfer sekali untuk dua
          order sekaligus. Jurnal penerimaannya otomatis dibalik & dibukukan ulang dengan pembagian yang baru.
        </p>

        {baris.map((b, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_32px] items-end gap-2">
            <Field label={i === 0 ? "Order tujuan" : undefined}>
              <OrderPicker
                value={b.orderId}
                onChange={(id, order) => {
                  ubah(i, "orderId", id);
                  ubah(i, "orderNumber", order?.orderNumber || "");
                }}
                // Order asal pembayaran ini ditawarkan lebih dulu: memecah
                // pembayaran hampir selalu berarti "sebagian tetap di order
                // ini, sisanya pindah".
                saran={payment.order ? [{
                  id: payment.orderId,
                  orderNumber: payment.order.orderNumber,
                  customerName: payment.order.customer?.name,
                  value: payment.order.value,
                  paymentStatus: payment.order.paymentStatus,
                }] : []}
                saranLabel="Order pembayaran ini"
                placeholder="Cari order tujuan…"
              />
            </Field>
            <Field label={i === 0 ? "Nominal" : undefined}>
              <InputUang value={b.amount} onChange={(v) => ubah(i, "amount", v)} />
            </Field>
            <Button
              variant="neutral" size="icon"
              disabled={baris.length <= 1}
              onClick={() => setBaris((s) => s.filter((_, idx) => idx !== i))}
              aria-label="Hapus baris"
            >
              ×
            </Button>
          </div>
        ))}

        <Button
          size="sm" variant="tertiary" className="px-0"
          onClick={() => setBaris((s) => [...s, { orderId: "", orderNumber: "", amount: "" }])}
        >
          + Tambah order
        </Button>

        <div className={`rounded-lg px-3 py-2 text-[13px] ${Math.abs(sisa) < 0.005 ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`}>
          Total dialokasikan {formatUang(total)} dari {formatUang(payment.amount)}
          {Math.abs(sisa) >= 0.005 && ` — ${sisa > 0 ? "kurang" : "lebih"} ${formatUang(Math.abs(sisa))}`}
        </div>
      </div>
    </Modal>
  );
}
