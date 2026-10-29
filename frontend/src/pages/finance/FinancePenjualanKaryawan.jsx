import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, UserRound, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { BuktiThumb } from "@/features/finance/BuktiThumb.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek, PemilihBukti,
} from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import TombolExportExcel from "@/features/finance/ExportExcel.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specPenjualanKaryawan } from "@/features/finance/detailSpecs.js";
import { adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { metodeButuhRekening, LABEL_METODE_PJK } from "@/features/finance/penjualanKaryawanLogic.js";
import { resetSaatBuka } from "@/features/finance/resetSaatBuka.jsx";
import { RingkasOrderCrm, ModalOrderCrm, useKatalogPkr } from "@/features/finance/PkrOrderCrm.jsx";
import { ModalKoreksiItem } from "@/features/finance/PkrKoreksiItem.jsx";
import { ModalKoreksiBaris } from "@/features/finance/PkrKoreksiBaris.jsx";
import { ModalKoreksiOrderPkr } from "@/features/finance/KoreksiOrderPkr.jsx";
import { ModalBatalPkr, ModalAlasan } from "@/features/finance/PkrBatalModal.jsx";
import { aksiOrderCrm } from "@/features/finance/pkrOrderCrmLogic.js";
import { penjualanKosong, bodyPenjualanTerpadu, galatItemPenjualan, totalPenjualan, totalUnitItems, adaItemDikirim, punyaUnitPemenuhan } from "@/features/finance/pkrItemLogic.js";
import {
  LANGKAH_PKR, pembeliKosong, galatCustomer, galatAlamat, galatKebutuhan, bodyPembeli, ringkasCustomerPratinjau, belumLengkap,
} from "@/features/finance/pkrPembeliLogic.js";
import { BagianCustomerPenerima, BagianAlamatLokasi, BagianKebutuhan } from "@/features/finance/PkrPembeliForm.jsx";
import { tampilNomor } from "@/utils/nomorTelepon.js";
import { ModalEditCustomerPkr, ModalRiwayatPkr } from "@/features/finance/PkrEditCustomer.jsx";
import { FormItemPenjualan } from "@/features/finance/PkrItemPenjualanForm.jsx";
import { PratinjauOrderPkr } from "@/features/finance/PkrPratinjau.jsx";

// PENJUALAN KARYAWAN — dicatat MANUAL oleh Finance. Karyawan non-Sales menjual ke kerabat. Sejak sinkronisasi Order CRM (Okt 2026), setiap penjualan otomatis melahirkan SATU order operasional
// (unit produksi + pengiriman); order itu TIDAK membawa uang — nominal, piutang, dan jurnal tetap di sini.
// Pendapatan diakui saat dicatat dan tagihannya jadi Piutang Karyawan milik karyawan penjual; pelunasan = tunai/transfer ke rekening atau potong gaji.
// Semua angka (total, terbayar, sisa, status) dihitung SERVER; layar ini hanya menampilkan. Jurnal & alasan: backend services/finance/posting/penjualanKaryawan.js.

const STATUS_TAB = [
  { key: "", label: "Semua" },
  { key: "BELUM_BAYAR", label: "Belum dibayar" },
  { key: "SEBAGIAN", label: "Dibayar sebagian" },
  { key: "LUNAS", label: "Lunas" },
  { key: "DIBATALKAN", label: "Dibatalkan" },
];
const VARIAN = { BELUM_BAYAR: "orange", SEBAGIAN: "orange", LUNAS: "green", DIBATALKAN: "neutral" };

const terpadu = (p) => (p?.items ?? []).some((i) => i.terpadu);
const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const StatusPenjualan = ({ p }) => <Badge variant={VARIAN[p.statusTampil] || "neutral"}>{p.statusLabel}</Badge>;

export default function FinancePenjualanKaryawan() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [fKaryawan, setFKaryawan] = useState("");
  const [periode, setPeriode] = useState(periodeDefault);
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);

  const [modalBaru, setModalBaru] = useState(false);
  const [bayarUntuk, setBayarUntuk] = useState(null);
  const [riwayatId, setRiwayatId] = useState(null);
  const [panelRincian, setPanelRincian] = useState(null);
  const [orderCrmUntuk, setOrderCrmUntuk] = useState(null); // { p, mode: "buat" | "lengkapi" }
  const [koreksiUntuk, setKoreksiUntuk] = useState(null); // penjualan yang item-nya dikoreksi
  const [koreksiOrderUntuk, setKoreksiOrderUntuk] = useState(null); // { p, jenis } — Koreksi Order resmi (perbaikan salah input / tambahan permintaan)
  const [editCustomerUntuk, setEditCustomerUntuk] = useState(null); // penjualan yang data customernya diedit/dilengkapi
  const [riwayatPkrUntuk, setRiwayatPkrUntuk] = useState(null); // penjualan yang riwayat perubahannya dibuka
  const [batalUntuk, setBatalUntuk] = useState(null); // penjualan yang akan dibatalkan (modal: pratinjau server + alasan)
  const [batalBayarUntuk, setBatalBayarUntuk] = useState(null); // { penjualan, pay } pembayaran yang akan dibatalkan (modal alasan)
  const admin = adminSaatIni();

  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try {
      setData(await api.getPenjualanKaryawanFinance({ ...periode, status, q: qTunda.trim(), sellerId: fKaryawan }));
    } catch (e) {
      if (diam) setPesan(e.message || "Gagal menyegarkan daftar");
      else setError(e.message || "Gagal memuat penjualan karyawan");
    } finally {
      if (!diam) setLoading(false);
    }
  }, [periode, status, qTunda, fKaryawan]);

  useEffect(() => { muat({ diam: pernahMuat.current }); pernahMuat.current = true; }, [muat]);

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

  const daftar = data?.penjualan || [];
  const ringkasan = data?.ringkasan;
  const riwayat = daftar.find((p) => p.id === riwayatId) || null;

  function aksiBaris(p) {
    const bisaBayar = p.statusTampil === "BELUM_BAYAR" || p.statusTampil === "SEBAGIAN";
    const ac = aksiOrderCrm(p);
    const items = [
      { label: "Riwayat pembayaran", onClick: () => setRiwayatId(p.id) },
      { label: "Koreksi Order", hint: "Perbaiki data salah input (customer, alamat, spesifikasi, nilai) — dampak ditampilkan dulu", hidden: !p.sinkron?.order || p.statusTampil === "DIBATALKAN", onClick: () => setKoreksiOrderUntuk({ p, jenis: "PERBAIKAN" }) },
      { label: "Tambah Pesanan Customer", hint: "Customer menambah produk/jumlah/layanan — item & unit baru, nilai delta", hidden: !p.sinkron?.order || p.statusTampil === "DIBATALKAN", onClick: () => setKoreksiOrderUntuk({ p, jenis: "TAMBAHAN" }) },
      { label: p.sinkron?.identitas?.legacy ? "Lengkapi Data Customer" : "Edit Data Customer", hint: "Nama, nomor, penerima, alamat, Maps, keluhan, catatan — tanpa jurnal", hidden: !p.sinkron?.order || p.statusTampil === "DIBATALKAN", onClick: () => setEditCustomerUntuk(p) },
      { label: "Riwayat Perubahan", onClick: () => setRiwayatPkrUntuk(p) },
      { label: "Buat/Tautkan Order CRM", hidden: !ac.buat, onClick: () => setOrderCrmUntuk({ p, mode: "buat" }) },
      { label: "Lengkapi spesifikasi order", hint: "Hanya untuk data awal yang masih kosong — koreksi lewat Koreksi Order", hidden: !ac.lengkapi || p.sinkron?.order?.spesifikasi?.lengkap === true, onClick: () => setOrderCrmUntuk({ p, mode: "lengkapi" }) },
      { label: "Koreksi item penjualan", hint: "Jumlah, harga, tambah/hapus item — Finance dan Produksi berubah bersama", hidden: !ac.koreksi || !terpadu(p), onClick: () => setKoreksiUntuk(p) },
      { label: "Koreksi item order", hint: "Tambah/hapus item atau ubah jumlah (sebelum dijadwalkan)", hidden: !ac.koreksi || terpadu(p), onClick: () => setKoreksiUntuk(p) },
      { label: "Batalkan penjualan", destructive: true, hidden: !admin || p.statusTampil === "DIBATALKAN", onClick: () => setBatalUntuk(p) },
    ];
    return { primary: bisaBayar ? { label: "Bayar", variant: "secondary", title: "Catat pembayaran", onClick: () => setBayarUntuk(p) } : null, items };
  }
  // Panel rincian: tombol aksi LENGKET di bawah (footer panel). Mode lihat → tombol edit → dialog → pratinjau → simpan; pembayaran tidak diedit dari sini (alur Bayar/Koreksi resmi).
  const specBaris = (p) => {
    const ac = aksiOrderCrm(p);
    const batal = p.statusTampil === "DIBATALKAN";
    const tutup = (fn) => () => { setPanelRincian(null); fn(); };
    const aksiPanel = (
      <>
        <Button size="sm" variant="secondary" disabled={!p.sinkron?.order || batal} onClick={tutup(() => setKoreksiOrderUntuk({ p, jenis: "PERBAIKAN" }))} data-testid="aksi-koreksi-order" className="max-sm:min-h-11">Koreksi Order</Button>
        <Button size="sm" variant="neutral" disabled={!p.sinkron?.order || batal} onClick={tutup(() => setEditCustomerUntuk(p))} data-testid="aksi-edit-customer" className="max-sm:min-h-11">{p.sinkron?.identitas?.legacy ? "Lengkapi Data Customer" : "Edit Data Customer"}</Button>
        <Button size="sm" variant="neutral" disabled={!p.sinkron?.order || batal} onClick={tutup(() => setKoreksiOrderUntuk({ p, jenis: "TAMBAHAN" }))} data-testid="aksi-tambah-pesanan" className="max-sm:min-h-11">Tambah Pesanan Customer</Button>
        <Button size="sm" variant="neutral" disabled={!ac.koreksi || batal} title={ac.koreksi ? "Jumlah, produk, ukuran per item (harga dan unit berubah bersama)" : "Order lama tanpa daftar item: gunakan Koreksi Order"} onClick={tutup(() => setKoreksiUntuk(p))} data-testid="aksi-koreksi-item" className="max-sm:min-h-11">Koreksi Item &amp; Pemenuhan</Button>
        <Button size="sm" variant="neutral" disabled={!p.sinkron?.order || batal} title="Harga memakai dokumen koreksi: jurnal delta resmi, Payment lama tidak berubah" onClick={tutup(() => setKoreksiOrderUntuk({ p, jenis: "PERBAIKAN" }))} data-testid="aksi-koreksi-nilai" className="max-sm:min-h-11">Koreksi Nilai</Button>
        <Button size="sm" variant="neutral" onClick={tutup(() => setRiwayatPkrUntuk(p))} data-testid="aksi-riwayat" className="max-sm:min-h-11">Riwayat Perubahan</Button>
        {admin && !batal && (
          <Button size="sm" variant="neutral" onClick={tutup(() => batalkanPenjualan(p))} data-testid="aksi-batalkan" className="max-sm:min-h-11 text-red">Batalkan Penjualan</Button>
        )}
      </>
    );
    return specPenjualanKaryawan(p, { badge: <StatusPenjualan p={p} />, aksi: aksiPanel, onRiwayat: () => { setPanelRincian(null); setRiwayatPkrUntuk(p); } });
  };

  return (
    <HalamanFinance
      title="Penjualan Karyawan"
      subtitle="Penjualan karyawan non-Sales ke kerabat, dicatat Finance. Tiap penjualan otomatis punya order CRM untuk Produksi dan Delivery, tanpa uang di order."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={(
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <TombolExportExcel modul="penjualan-karyawan" disabled={loading} onError={setPesan} ambilBody={() => ({ periode, filter: { status, q: qTunda.trim(), sellerId: fKaryawan } })} />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Catat Penjualan</Button>
        </>
      )}
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
        Dipakai untuk penjualan karyawan ke kerabat (pembelinya bukan pelanggan Inbox/CRM). Setiap penjualan otomatis membuat <strong>satu order CRM operasional</strong> berikut unitnya
        untuk Produksi dan Delivery; order itu <strong>tidak membawa uang</strong> — nominal, pembayaran, piutang, dan jurnal tetap di halaman ini. Pendapatan diakui saat dicatat dan masuk
        total pendapatan perusahaan, <strong>terpisah dari omzet Tim Sales</strong>. Tagihannya tercatat sebagai <strong>Piutang Karyawan</strong> milik karyawan penjual
        sampai dibayar (tunai/transfer ke rekening) atau <strong>dipotong dari gaji</strong>. HPP tidak dibukukan di sini. Pembayaran bertanggal sebelum
        tanggal cutoff saldo awal ({data?.cutoff ? tanggalPendek(data.cutoff) : "18 Sep 2026"}) tidak menambah saldo kas/bank karena uangnya sudah tercakup di saldo awal.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Nilai Penjualan" metrik="pkr_nilai_penjualan" value={formatUang(ringkasan?.nilai ?? 0)} sub={`${ringkasan?.jumlah ?? 0} penjualan aktif, sepanjang waktu`} />
        <KartuAngka label="Sudah Dibayar" value={formatUang(ringkasan?.terbayar ?? 0)} sub="tunai, transfer, dan potong gaji" />
        <KartuAngka
          label="Sisa Tagihan ke Karyawan" metrik="pkr_sisa_ditagih" value={formatUang(ringkasan?.sisa ?? 0)} tone={(ringkasan?.sisa ?? 0) > 0 ? "orange" : "default"}
          sub="belum dibayar atau dipotong dari gaji"
          info="Bagian dari saldo akun Piutang Karyawan (1-1350) yang berasal dari penjualan karyawan. Kasbon tercatat terpisah di menu Kasbon pada akun yang sama."
        />
        <KartuAngka label="Karyawan dengan Sisa Tagihan" value={(ringkasan?.karyawan || []).filter((k) => k.sisa > 0).length} sub="orang" />
      </div>

      {(ringkasan?.karyawan || []).length > 0 && (
        <Card className="overflow-hidden">
          <JudulKartu title="Per Karyawan" description="Dihitung dari semua penjualan aktif, tidak berubah mengikuti pencarian di bawah." />
          <TableWrap className="dh-table">
            <Table>
              <THead><TR><TH sticky>Karyawan</TH><TH numeric>Penjualan</TH><TH numeric>Nilai</TH><TH numeric>Dibayar</TH><TH numeric>Sisa</TH><TH /></TR></THead>
              <TBody>
                {ringkasan.karyawan.map((k) => (
                  <TR key={k.sellerId}>
                    <TD sticky className="font-medium">{k.nama}</TD>
                    <TD numeric>{k.jumlah}</TD>
                    <TD numeric><Uang value={k.nilai} /></TD>
                    <TD numeric><Uang value={k.terbayar} nolSebagaiStrip /></TD>
                    <TD numeric><Uang value={k.sisa} className="font-bold" nolSebagaiStrip /></TD>
                    <TD><div className="flex justify-end"><Button size="sm" variant="neutral" onClick={() => setFKaryawan(k.sellerId)}>Lihat</Button></div></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={status === t.key ? "secondary" : "neutral"} onClick={() => setStatus(t.key)}>{t.label}</Button>
        ))}
      </div>

      <FilterBar
        q={q} onQ={setQ}
        placeholder="Cari nomor, karyawan, pembeli, item…"
        filters={[{ key: "kar", label: "Karyawan", value: fKaryawan, onChange: setFKaryawan, options: (ringkasan?.karyawan || []).map((k) => [k.sellerId, k.nama]) }]}
        ringkasan={`${daftar.length} penjualan${data?.terpotong ? " · baru 500 teratas tampil — persempit pencarian atau periode" : ""}`}
        onReset={() => { setQ(""); setFKaryawan(""); }}
      />

      <Card className="overflow-hidden">
        <JudulKartu title="Daftar Penjualan Karyawan" description="Nomor PKR dibuat otomatis. Klik baris untuk melihat rincian item dan pembayaran." />
        {daftar.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={UserRound} title="Belum ada penjualan karyawan"
              description="Belum ada yang cocok dengan filter ini."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Catat Penjualan</Button>}
            />
          </CardContent>
        ) : (
          <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={124}>Nomor</TH><TH width={78}>Tanggal</TH><TH width={140}>Karyawan</TH><TH>Pembeli</TH>
                    <TH numeric width={108} hideBelow="2xl">Total</TH><TH numeric width={108} hideBelow="2xl">Dibayar</TH><TH numeric width={112}>Sisa</TH>
                    <TH width={118}>Status</TH><TH width={210}>Order CRM</TH><TH width={AKSI_COL_WIDTH}>Aksi</TH>
                  </TR>
                </THead>
                <TBody>
                  {daftar.map((p) => {
                    const a = aksiBaris(p);
                    return (
                      <TR key={p.id} {...klikBuka(() => setPanelRincian(specBaris(p)))}>
                        <TD sticky className="font-mono text-[12px]">{p.nomor}</TD>
                        <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(p.date)}</TD>
                        <TD truncate className="font-medium">{p.seller?.name}</TD>
                        <TD truncate>{p.buyerName}</TD>
                        <TD hideBelow="2xl" numeric><Uang value={p.total} /></TD>
                        <TD hideBelow="2xl" numeric><Uang value={p.terbayar} nolSebagaiStrip /></TD>
                        <TD numeric><Uang value={p.sisa} className="font-bold" nolSebagaiStrip /></TD>
                        <TD><StatusPenjualan p={p} /></TD>
                        <TD>
                          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                            <RingkasOrderCrm sinkron={p.sinkron} />
                            {aksiOrderCrm(p).buat && <Button size="sm" variant="neutral" onClick={() => setOrderCrmUntuk({ p, mode: "buat" })}>Buat/Tautkan Order CRM</Button>}
                          </div>
                        </TD>
                        <TD><RowActions primary={a.primary} items={a.items} /></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>

            <CardList className={CARD_VIEW_CLASS}>
              {daftar.map((p) => {
                const a = aksiBaris(p);
                return (
                  <RowCard
                    key={p.id}
                    onClick={() => setPanelRincian(specBaris(p))}
                    title={p.nomor}
                    status={<StatusPenjualan p={p} />}
                    subtitle={`${p.seller?.name} → ${p.buyerName}`}
                    fields={[
                      { label: "Tanggal", value: tanggalPendek(p.date) },
                      { label: "Sisa", value: formatUang(p.sisa) },
                      { label: "Total", value: formatUang(p.total) },
                      { label: "Dibayar", value: formatUang(p.terbayar) },
                      { label: "Order CRM", value: <RingkasOrderCrm sinkron={p.sinkron} /> },
                    ]}
                    actions={<RowActions primary={a.primary} items={a.items} />}
                  />
                );
              })}
            </CardList>
          </>
        )}
      </Card>

      <ModalPenjualanBaru open={modalBaru} onClose={() => setModalBaru(false)} aksi={aksi} cutoff={data?.cutoff} />
      <ModalBayar cutoff={data?.cutoff} target={bayarUntuk} onClose={() => setBayarUntuk(null)} onSubmit={(d) => aksi(() => api.catatPembayaranPenjualanKaryawan(bayarUntuk.id, d))} />
      <ModalRiwayat
        penjualan={riwayat} onClose={() => setRiwayatId(null)} admin={admin}
        onBatal={(pay) => setBatalBayarUntuk({ penjualan: riwayat, pay })}
      />
      {batalBayarUntuk && (
        <ModalAlasan
          judul={`Batalkan pembayaran — ${batalBayarUntuk.penjualan.nomor}`}
          deskripsi="Jurnal pembayaran ini dibalik dan sisa tagihan bertambah kembali. Uang TIDAK dikembalikan otomatis — proses pengembalian dana mengikuti prosedur Finance."
          tombol="Batalkan Pembayaran"
          onClose={() => setBatalBayarUntuk(null)}
          onSubmit={async (alasan) => {
            await api.batalPembayaranPenjualanKaryawan(batalBayarUntuk.penjualan.id, batalBayarUntuk.pay.id, alasan);
            setBatalBayarUntuk(null);
            await muat({ diam: true });
          }}
        />
      )}
      {batalUntuk && (
        <ModalBatalPkr
          penjualan={batalUntuk} onClose={() => setBatalUntuk(null)}
          onBukaRiwayat={(id) => { setBatalUntuk(null); setRiwayatId(id); }}
          onSelesai={async () => { setBatalUntuk(null); setPesan(null); await muat({ diam: true }); }}
        />
      )}
      <ModalOrderCrm
        key={orderCrmUntuk ? `${orderCrmUntuk.p.id}-${orderCrmUntuk.mode}` : "tutup"}
        penjualan={orderCrmUntuk?.p || null} mode={orderCrmUntuk?.mode} onClose={() => setOrderCrmUntuk(null)}
        onSubmit={async (body) => {
          if (orderCrmUntuk.mode === "lengkapi") await api.lengkapiOrderCrmPenjualanKaryawan(orderCrmUntuk.p.id, body);
          else await api.buatOrderCrmPenjualanKaryawan(orderCrmUntuk.p.id, body);
          setOrderCrmUntuk(null);
          await muat({ diam: true });
        }}
      />
      {koreksiOrderUntuk && (
        <ModalKoreksiOrderPkr
          key={`${koreksiOrderUntuk.p.id}-${koreksiOrderUntuk.jenis}-koreksi-order`} penjualan={koreksiOrderUntuk.p} jenisAwal={koreksiOrderUntuk.jenis}
          onClose={() => setKoreksiOrderUntuk(null)}
          onSelesai={async () => { setKoreksiOrderUntuk(null); await muat({ diam: true }); }}
          onBukaKoreksiItem={terpadu(koreksiOrderUntuk.p) ? () => { const p = koreksiOrderUntuk.p; setKoreksiOrderUntuk(null); setKoreksiUntuk(p); } : null}
        />
      )}
      {koreksiUntuk && (terpadu(koreksiUntuk)
        ? (
          <ModalKoreksiBaris
            key={`${koreksiUntuk.id}-koreksi-baris`} penjualan={koreksiUntuk} onClose={() => setKoreksiUntuk(null)}
            onSelesai={async () => { setKoreksiUntuk(null); await muat({ diam: true }); }}
          />
        )
        : (
          <ModalKoreksiItem
            key={`${koreksiUntuk.id}-koreksi`} penjualan={koreksiUntuk} onClose={() => setKoreksiUntuk(null)}
            onSelesai={async () => { setKoreksiUntuk(null); await muat({ diam: true }); }}
          />
        ))}
      {editCustomerUntuk && (
        <ModalEditCustomerPkr
          key={`${editCustomerUntuk.id}-edit-customer`} penjualan={editCustomerUntuk} onClose={() => setEditCustomerUntuk(null)}
          onSelesai={async () => { setEditCustomerUntuk(null); await muat({ diam: true }); }}
        />
      )}
      {riwayatPkrUntuk && <ModalRiwayatPkr penjualan={riwayatPkrUntuk} onClose={() => setRiwayatPkrUntuk(null)} />}
      <PanelDetail spec={panelRincian} onClose={() => setPanelRincian(null)} />
    </HalamanFinance>
  );
}

// Daftar rekening kas/bank aktif + status memuat/galat (dipakai dua modal).
function useRekening(aktif) {
  const [rek, setRek] = useState([]);
  const [st, setSt] = useState({ memuat: false, galat: null });
  const muat = useCallback(() => {
    setSt({ memuat: true, galat: null });
    api.getFinanceCashAccounts()
      .then((r) => { setRek((r.accounts || []).filter((a) => a.active)); setSt({ memuat: false, galat: null }); })
      .catch((e) => setSt({ memuat: false, galat: e.message || "Gagal memuat daftar rekening" }));
  }, []);
  useEffect(() => { if (aktif) muat(); }, [aktif, muat]);
  return { rek, st, muat };
}

function PilihRekening({ value, onChange, rek, st, muat, wajib, cutoff }) {
  return (
    <Field label="Uang masuk ke" required={wajib} hint={wajib ? undefined : `Opsional untuk tanggal sebelum cutoff saldo awal (${cutoff ? tanggalPendek(cutoff) : "18 Sep 2026"}) — hanya keterangan, saldo tidak berubah`}>
      <Pilihan value={value} onChange={onChange}>
        <option value="">{st.memuat ? "memuat rekening…" : "— pilih bank / kas —"}</option>
        {rek.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Pilihan>
      {st.galat && <p className="mt-1 text-[12px] text-red">{st.galat}. <button type="button" className="font-semibold underline" onClick={muat}>Coba lagi</button></p>}
    </Field>
  );
}

const BAYAR_KOSONG = () => ({ method: "TRANSFER", amount: "", date: hariIniISO(), cashAccountId: "", receiptUrl: "", notes: "" });
const bodyBayar = (b) => ({
  method: b.method, amount: Number(b.amount), date: b.date, notes: b.notes?.trim() || undefined,
  ...(metodeButuhRekening(b.method) ? { cashAccountId: b.cashAccountId || undefined, receiptUrl: b.receiptUrl || undefined } : {}),
});

// Rekening wajib untuk uang yang diterima pada/setelah tanggal cutoff (keputusan akhir tetap di server).
const rekeningWajib = (b, cutoff) => metodeButuhRekening(b.method) && (!cutoff || b.date >= cutoff);

function BarisBayar({ b, onChange, rek, st, muat, onHapus, cutoff }) {
  const set = (k, v) => onChange({ ...b, [k]: v });
  const pakaiRek = metodeButuhRekening(b.method);
  return (
    <div className="space-y-3 rounded-lg bg-inset p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Cara bayar">
          <Pilihan value={b.method} onChange={(v) => onChange({ ...b, method: v, ...(v === "POTONG_GAJI" ? { cashAccountId: "", receiptUrl: "" } : {}) })}>
            {Object.entries(LABEL_METODE_PJK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Pilihan>
        </Field>
        <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={b.date} onChange={(v) => set("date", v)} /></Field>
        <Field label="Nominal" required><InputUang value={b.amount} onChange={(v) => set("amount", v)} /></Field>
      </div>
      {pakaiRek && <PilihRekening value={b.cashAccountId} onChange={(v) => set("cashAccountId", v)} rek={rek} st={st} muat={muat} wajib={rekeningWajib(b, cutoff)} cutoff={cutoff} />}
      {pakaiRek && <Field label="Bukti" hint="Opsional"><PemilihBukti url={b.receiptUrl} onChange={(v) => set("receiptUrl", v)} /></Field>}
      {b.method === "POTONG_GAJI" && <p className="text-[12px] text-ink2">Kas tidak tersentuh. Gaji <strong>bersih</strong> tetap dicatat di Pengeluaran; bagian yang dipotong ini otomatis ditambahkan ke beban gaji.</p>}
      <Field label="Catatan"><Input value={b.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      {onHapus && <div className="flex justify-end"><Button size="sm" variant="neutral" onClick={onHapus}><Trash2 size={13} /> Hapus pembayaran ini</Button></div>}
    </div>
  );
}

// WIZARD "CATAT PENJUALAN" — 7 langkah, urutan field SAMA dengan input Order CRM Inbox: Transaksi → Customer & penerima → Alamat & lokasi → Keluhan & kebutuhan → Item →
// Pembayaran awal → Pratinjau. Satu transaksi atomik di server (PKR + jurnal + Customer + Order + Unit + Job + pembayaran, atau tidak sama sekali) dan idempoten.
function ModalPenjualanBaruIsi({ open, onClose, aksi, cutoff }) {
  const kosong = () => ({ date: hariIniISO(), sellerId: "", buyerName: "", notes: "", pembayaran: [], daftar: penjualanKosong(), pembeli: pembeliKosong() });
  const [f, setF] = useState(kosong);
  const [idx, setIdx] = useState(0); // indeks LANGKAH_PKR
  const [pra, setPra] = useState(null);
  const [galatPra, setGalatPra] = useState("");
  const [memuatPra, setMemuatPra] = useState(false);
  const { katalog, memuat: memuatKatalog, galat: galatKatalog } = useKatalogPkr(open);
  const [karyawan, setKaryawan] = useState([]);
  const [galatKar, setGalatKar] = useState(null);
  const { rek, st, muat } = useRekening(open);
  const set = (k, v) => setF((s0) => ({ ...s0, [k]: v }));
  const setP = (k, v) => setF((s0) => ({ ...s0, pembeli: { ...s0.pembeli, [k]: v } }));
  const setDaftar = (k, v) => setF((s0) => ({ ...s0, daftar: { ...s0.daftar, [k]: v } }));

  useEffect(() => {
    if (!open) return;
    setF(kosong());
    setIdx(0); setPra(null); setGalatPra("");
    setGalatKar(null);
    api.getKaryawanPenjualanKaryawan().then((r) => setKaryawan(r.karyawan || [])).catch((e) => setGalatKar(e.message || "Gagal memuat daftar karyawan"));
  }, [open]);

  const total = totalPenjualan(f.daftar.items);
  const bayarTotal = f.pembayaran.reduce((a, b) => a + (Number(b.amount) || 0), 0);
  const bayarValid = f.pembayaran.every((b) => Number(b.amount) > 0 && (!rekeningWajib(b, cutoff) || b.cashAccountId));
  const galatItem = katalog ? galatItemPenjualan(f.daftar.items, katalog) : null;
  const perluAlamat = katalog ? adaItemDikirim(f.daftar.items.filter((i) => punyaUnitPemenuhan(katalog, i.pemenuhan)), katalog) : false;
  const jumlahUnit = katalog ? totalUnitItems(f.daftar.items.filter((i) => punyaUnitPemenuhan(katalog, i.pemenuhan)), katalog) : 0;
  const kode = LANGKAH_PKR[idx].kode;

  // Galat per langkah — tombol "Lanjut" hanya aktif bila langkah ini valid; galat tampil dekat isian.
  const galatLangkah = (k) => {
    if (k === "transaksi") return f.sellerId ? null : "Pilih karyawan penjual";
    if (k === "customer") return galatCustomer(f);
    if (k === "alamat") return galatAlamat(f, { perluAlamat });
    if (k === "kebutuhan") return galatKebutuhan(f);
    if (k === "item") return !katalog ? "Memuat katalog item…" : galatItem;
    if (k === "bayar") return !bayarValid ? "Lengkapi nominal dan rekening setiap pembayaran" : bayarTotal > total ? "Pembayaran melebihi total penjualan" : null;
    return null;
  };
  const semuaValid = LANGKAH_PKR.slice(0, 6).every((l) => !galatLangkah(l.kode));
  const galatSaatIni = galatLangkah(kode);

  const bodyLengkap = () => {
    const tb = bodyPenjualanTerpadu(f.daftar, katalog);
    const bp = bodyPembeli(f);
    return {
      date: f.date, sellerId: f.sellerId, buyerName: f.buyerName.trim(), notes: f.notes.trim() || undefined,
      items: tb.items, orderCrm: { ...tb.orderCrm, ...bp.orderCrmEkstra }, pembeli: bp.pembeli,
      pembayaran: f.pembayaran.map(bodyBayar),
    };
  };

  async function keLangkah(n) {
    setGalatPra("");
    if (LANGKAH_PKR[n].kode === "pratinjau") {
      setMemuatPra(true);
      try {
        const tb = bodyPenjualanTerpadu(f.daftar, katalog);
        setPra(await api.pratinjauOrderCrmPkr({ items: tb.items, orderCrm: { ...tb.orderCrm, ...bodyPembeli(f).orderCrmEkstra } }));
        setIdx(n);
      } catch (e) { setGalatPra(e.message || "Gagal membuat pratinjau"); } finally { setMemuatPra(false); }
      return;
    }
    setIdx(n);
  }

  const cust = ringkasCustomerPratinjau(f);
  const kurang = belumLengkap(f, { perluAlamat });
  const sisa = Math.max(total - bayarTotal, 0);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat Penjualan Karyawan"
      description="Satu alur untuk transaksi, customer, alamat, item, dan pembayaran. Nominal dan piutang dicatat di sini; pekerjaan Produksi/Pickup/Delivery otomatis menjadi satu order CRM tanpa uang."
      className="w-[760px] max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!rounded-none"
      footer={(
        <>
          {(galatPra || galatSaatIni) && <p role="alert" className="mr-auto rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="galat-langkah">{galatPra || galatSaatIni}</p>}
          {idx === 0
            ? <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            : <Button variant="neutral" onClick={() => { setPra(null); setIdx(idx - 1); }} className="max-sm:min-h-11 max-sm:px-4" data-testid="langkah-kembali">Kembali</Button>}
          {kode !== "pratinjau" && kode !== "bayar" && <TombolAksi disabled={!!galatSaatIni || memuatPra} onClick={() => keLangkah(idx + 1)} data-testid="langkah-lanjut">Lanjut</TombolAksi>}
          {kode === "bayar" && <TombolAksi disabled={!!galatSaatIni || memuatPra || !semuaValid} onClick={() => keLangkah(idx + 1)} data-testid="tinjau-order">{memuatPra ? "Menyiapkan pratinjau…" : "Tinjau Penjualan"}</TombolAksi>}
          {kode === "pratinjau" && <TombolAksi disabled={!semuaValid || !pra?.valid} onClick={() => aksi(() => api.createPenjualanKaryawan(bodyLengkap()))} data-testid="catat-penjualan">Catat Penjualan</TombolAksi>}
        </>
      )}
    >
      <nav aria-label="Langkah pencatatan" className="mb-4" data-testid="langkah-pkr">
        <p className="m-0 text-[12px] font-semibold text-ink3">Langkah {idx + 1} dari {LANGKAH_PKR.length}</p>
        <ol className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
          {LANGKAH_PKR.map((l, n) => (
            <li key={l.kode}>
              <button
                type="button" onClick={() => n < idx && setIdx(n)} disabled={n > idx} aria-current={n === idx ? "step" : undefined}
                className={cn("rounded-full px-2.5 py-1 text-[11.5px] font-semibold", n === idx ? "bg-accent text-white" : n < idx ? "bg-accentbg text-accent" : "bg-inset text-ink3")}
              >{n + 1}. {l.label}</button>
            </li>
          ))}
        </ol>
      </nav>

      {kode === "transaksi" && (
        <div className="space-y-4" data-testid="langkah-transaksi">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Tanggal penjualan"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
            <Field label="Karyawan penjual" required hint={galatKar ? undefined : "Akun aktif non-Sales; dialah yang menanggung tagihannya (bukan customer)"}>
              <Pilihan value={f.sellerId} onChange={(v) => set("sellerId", v)} aria-label="Karyawan penjual">
                <option value="">— pilih karyawan —</option>
                {karyawan.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </Pilihan>
              {galatKar && <p className="mt-1 text-[12px] text-red">{galatKar}</p>}
            </Field>
          </div>
          <Field label="Sumber transaksi"><Input value="Penjualan Karyawan" readOnly aria-label="Sumber transaksi" /></Field>
          <Field label="Catatan transaksi" hint="Opsional — catatan Finance (bukan untuk Produksi/Delivery)"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} aria-label="Catatan transaksi" /></Field>
        </div>
      )}

      {kode === "customer" && <BagianCustomerPenerima f={f} setBuyer={(v) => set("buyerName", v)} setP={setP} />}
      {kode === "alamat" && <BagianAlamatLokasi daftar={f.daftar} setDaftar={setDaftar} pembeli={f.pembeli} setP={setP} perluAlamat={perluAlamat} />}
      {kode === "kebutuhan" && <BagianKebutuhan pembeli={f.pembeli} setP={setP} />}

      {kode === "item" && (
        <div className="space-y-2" data-testid="bagian-item-penjualan">
          <p className="text-[13px] font-semibold text-ink">Item Penjualan &amp; Pemenuhan</p>
          <p className="text-[12px] text-ink3">Satu daftar untuk tagihan dan pekerjaan: tiap item memuat harga, jumlah (bisa belasan hingga puluhan unit), ukuran/spesifikasi, cara pemenuhan, dan dikirim atau diambil sendiri. Produksi, Pickup, dan Delivery dibuat dari baris yang sama — tidak ada input ganda.</p>
          <FormItemPenjualan katalog={katalog} nilai={f.daftar} onChange={(v) => set("daftar", v)} memuat={memuatKatalog} galatMuat={galatKatalog} sembunyikanLogistik />
        </div>
      )}

      {kode === "bayar" && (
        <div className="space-y-2" data-testid="langkah-bayar">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">Pembayaran yang sudah diterima <span className="font-normal text-ink3">(opsional)</span></p>
            <Button size="sm" variant="neutral" onClick={() => set("pembayaran", [...f.pembayaran, BAYAR_KOSONG()])}><Plus size={13} /> Tambah pembayaran</Button>
          </div>
          {f.pembayaran.length === 0 && <p className="text-[12.5px] text-ink3">Belum ada pembayaran awal. Pembayaran berikutnya dicatat dari daftar (tombol Bayar).</p>}
          {f.pembayaran.map((b, i) => (
            <BarisBayar
              key={i} b={b} rek={rek} st={st} muat={muat} cutoff={cutoff}
              onChange={(nb) => set("pembayaran", f.pembayaran.map((x, n) => (n === i ? nb : x)))}
              onHapus={() => set("pembayaran", f.pembayaran.filter((_, n) => n !== i))}
            />
          ))}
          <p className={cn("text-[12.5px]", bayarTotal > total ? "text-red" : "text-ink2")}>
            Total {formatUang(total)} · dibayar {formatUang(bayarTotal)} · sisa tagihan {formatUang(sisa)}{bayarTotal > total ? " — melebihi total penjualan" : ""}
          </p>
        </div>
      )}

      {kode === "pratinjau" && (
        <div className="space-y-3" data-testid="langkah-tinjau">
          <section className="space-y-1.5 rounded-lg bg-inset px-3 py-2.5 text-[12.5px] text-ink2" data-testid="pratinjau-customer">
            <p className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-ink3">Customer &amp; penerima</p>
            <p className="m-0"><strong className="text-ink">{cust.nama}</strong>{cust.telepon ? ` · ${tampilNomor(cust.telepon)}` : cust.pembeliAdalahKaryawan ? " · pembeli adalah karyawan penjual" : ""}</p>
            <p className="m-0">Sumber: {cust.sumber} · dijual oleh <strong className="text-ink">{karyawan.find((k) => k.id === f.sellerId)?.name || "—"}</strong></p>
            <p className="m-0">Penerima: {cust.penerima.samaDenganPembeli ? "sama dengan pembeli" : `${cust.penerima.nama}${cust.penerima.telepon ? ` · ${cust.penerima.telepon}` : ""}`}</p>
            {(cust.alamat || cust.kota) && <p className="m-0">Alamat: {[cust.alamat, cust.kota].filter(Boolean).join(", ")}{cust.patokan ? ` (${cust.patokan})` : ""}</p>}
            {cust.lokasiUrl && <p className="m-0 break-all">Maps: {cust.lokasiUrl}</p>}
          </section>
          <div className="rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="pratinjau-ringkas">
            <strong className="text-ink">{formatUang(total)}</strong> · {f.daftar.items.length} item · {jumlahUnit} unit produksi · dibayar {formatUang(bayarTotal)} · sisa {formatUang(sisa)}
          </div>
          <PratinjauOrderPkr data={pra} />
          {kurang.length > 0 && (
            <p className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="pratinjau-belum-lengkap">Belum lengkap (boleh dilengkapi nanti lewat Edit Data Customer): {kurang.join(", ")}.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function ModalBayar({ target, onClose, onSubmit, cutoff }) {
  const [b, setB] = useState(BAYAR_KOSONG);
  const { rek, st, muat } = useRekening(!!target);
  useEffect(() => { if (target) setB({ ...BAYAR_KOSONG(), amount: target.sisa }); }, [target]);
  if (!target) return null;
  const valid = Number(b.amount) > 0 && Number(b.amount) <= target.sisa && (!rekeningWajib(b, cutoff) || b.cashAccountId);
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Catat pembayaran ${target.nomor}`}
      description={`${target.seller?.name} → ${target.buyerName} · sisa tagihan ${formatUang(target.sisa)}`}
      className="w-[560px]"
      footer={(
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(bodyBayar(b))} disabled={!valid}>Simpan Pembayaran</TombolAksi>
        </>
      )}
    >
      <BarisBayar b={b} onChange={setB} rek={rek} st={st} muat={muat} cutoff={cutoff} />
      {Number(b.amount) > target.sisa && <p className="mt-2 text-[12px] text-red">Nominal melebihi sisa tagihan.</p>}
    </Modal>
  );
}

function ModalRiwayat({ penjualan, onClose, onBatal, admin }) {
  if (!penjualan) return null;
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Pembayaran ${penjualan.nomor}`}
      description={`${penjualan.seller?.name} · total ${formatUang(penjualan.total)} · sisa ${formatUang(penjualan.sisa)}`}
      className="w-[520px]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      <div className="space-y-2">
        {penjualan.payments.length === 0 && <p className="text-[13px] text-ink3">Belum ada pembayaran.</p>}
        {penjualan.payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
            <div className="min-w-0 text-[13px]">
              <p className="font-medium text-ink">
                <Uang value={p.amount} /> · {LABEL_METODE_PJK[p.method] || p.method}
                {p.cancelledAt && <Badge variant="neutral" className="ml-2">Dibatalkan</Badge>}
              </p>
              <p className="text-[12px] text-ink3">
                {tanggalPendek(p.date)}{p.cashAccount ? ` · ke ${p.cashAccount.name}` : ""}{p.notes ? ` · ${p.notes}` : ""}{p.cancelReason ? ` · batal: ${p.cancelReason}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <BuktiThumb url={p.receiptUrl} label="Lihat bukti pembayaran" />
              {admin && !p.cancelledAt && <Button size="sm" variant="neutral" onClick={() => onBatal(p)}>Batalkan</Button>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalPenjualanBaru = resetSaatBuka(ModalPenjualanBaruIsi);
