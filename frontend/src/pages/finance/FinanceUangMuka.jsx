import React, { useCallback, useEffect, useState } from "react";
import { Plus, PiggyBank, Undo2, ReceiptText, History, Ban, Pencil } from "lucide-react";
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
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { BIAYA_KOSONG, denganBiaya, biayaTransferLengkap } from "@/features/finance/biayaTransfer.js";
import { BuktiThumb } from "@/features/finance/BuktiThumb.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek, PemilihBukti, LABEL_DIVISI,
} from "@/features/finance/shared.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import { RiwayatVersiDialog } from "@/features/finance/KoreksiAman.jsx";
import { aksiUangMuka as matriksUangMuka } from "@/features/finance/matriksAksi.js";
import { bentukItemMenu, adminSaatIni } from "@/features/finance/aksiMenu.jsx";

// UANG MUKA OPERASIONAL — kas yang DIBERIKAN ke pemegang (driver/PIC) untuk biaya operasional.
//
// Di buku besar ia ASET (1-1360), bukan beban, sampai dipertanggungjawabkan:
//   Berikan        Dr Uang Muka Operasional / Cr Kas atau Bank (kas/bank berkurang SEKALI, di sini)
//   Pertanggungjawaban  Dr Beban / Cr Uang Muka Operasional — TANPA /pay, TANPA mutasi kas kedua
//   Pengembalian   Dr Kas atau Bank / Cr Uang Muka Operasional
// Pengeluaran melebihi saldo: saldo dipakai habis dulu, selisihnya jadi utang reimbursement ke pemegang.
// Semua angka saldo dihitung SERVER. Aturan & jurnal: backend services/finance/operationalAdvance.js.

const TAB = [
  { key: "SALDO", label: "Saldo Aktif" },
  { key: "PERTANGGUNGJAWABAN", label: "Pertanggungjawaban" },
  { key: "PENGEMBALIAN", label: "Pengembalian" },
  { key: "RIWAYAT", label: "Riwayat" },
];

const LABEL_JENIS = { DIBERIKAN: "Diberikan", PERTANGGUNGJAWABAN: "Pertanggungjawaban", PENGEMBALIAN: "Pengembalian" };

function hariIniISO(tambahHari = 0) {
  return new Date(Date.now() + 7 * 3600 * 1000 + tambahHari * 86400000).toISOString().slice(0, 10);
}

// Uang muka SUDAH berjurnal sejak diberikan: yang boleh diedit langsung hanya keterangan operasional (tujuan, tenggat,
// catatan, bukti, divisi). Nominal/pemegang/rekening/tanggal TIDAK bisa dikoreksi — Batalkan lalu catat ulang.
function aksiUangMuka(u, { setPakaiUntuk, setKembaliUntuk, setEditUntuk, setVersiUntuk, aksi }) {
  const bisaDipakai = ["AKTIF", "SEBAGIAN"].includes(u.status);
  const items = bentukItemMenu(matriksUangMuka(u, { admin: adminSaatIni() }), {
    edit: () => setEditUntuk(u),
    versi: () => setVersiUntuk(u),
    kembali: () => setKembaliUntuk(u),
    batalkan: () => {
      const alasan = window.prompt(`Alasan membatalkan ${u.advanceNumber}? Jurnal pemberiannya akan dibalik (reversal), riwayat tetap tersimpan. Untuk mengubah nominal/rekening, catat ulang setelah ini:`);
      if (alasan?.trim()) return aksi(() => api.batalkanUangMuka(u.id, alasan.trim()));
    },
  });
  if (bisaDipakai && u.saldo > 0) {
    return { primary: { label: "Pertanggungjawabkan", variant: "secondary", onClick: () => setPakaiUntuk(u) }, items };
  }
  return { primary: null, items };
}

export default function FinanceUangMuka() {
  const [tab, setTab] = useState("SALDO");
  const [data, setData] = useState(null);
  const [riwayat, setRiwayat] = useState([]);
  const [pengeluaran, setPengeluaran] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [kategori, setKategori] = useState([]);
  const [karyawan, setKaryawan] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);

  const [modalBerikan, setModalBerikan] = useState(false);
  const [pakaiUntuk, setPakaiUntuk] = useState(null);
  const [kembaliUntuk, setKembaliUntuk] = useState(null);
  const [editUntuk, setEditUntuk] = useState(null);
  const [versiUntuk, setVersiUntuk] = useState(null);

  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try {
      const [d, r, cash, kat, exp, kar] = await Promise.all([
        api.getUangMuka(),
        api.getUangMukaRiwayat(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
        api.getFinanceExpenseCategories().catch(() => ({ categories: [] })),
        api.getFinanceExpenses({ mode: "UANG_MUKA", from: "2020-01-01", to: "2099-12-31" }).catch(() => ({ expenses: [] })),
        api.getFinanceKasbonNama().catch(() => ({ karyawan: [] })),
      ]);
      setData(d);
      setRiwayat(r.items || []);
      setRekening((cash.accounts || []).filter((a) => a.active));
      setKategori(kat.categories || []);
      setPengeluaran(exp.expenses || []);
      setKaryawan(kar.karyawan || []);
    } catch (e) {
      if (diam) setPesan(e.message || "Gagal menyegarkan data");
      else setError(e.message || "Gagal memuat uang muka operasional");
    } finally {
      if (!diam) setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalBerikan(false); setPakaiUntuk(null); setKembaliUntuk(null);
      await muat({ diam: true });
    } catch (e) {
      setPesan(e.message);
    }
  }

  const items = data?.items || [];
  const ringkasan = data?.ringkasan || { jumlahAktif: 0, totalSaldoAktif: 0, jumlahLewatTempo: 0, perPemegang: [] };
  const aktif = items.filter((u) => ["AKTIF", "SEBAGIAN"].includes(u.status));
  const pengembalian = riwayat.filter((r) => r.jenis === "PENGEMBALIAN");
  const menungguSetuju = pengeluaran.filter((e) => ["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status));

  return (
    <HalamanFinance
      title="Uang Muka Operasional"
      subtitle="Kas yang dipegang driver/PIC untuk biaya operasional: siapa memegang berapa, dan sudah dipertanggungjawabkan atau belum."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<Button size="sm" onClick={() => setModalBerikan(true)}><Plus size={14} /> Berikan Uang Muka</Button>}
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
        Uang muka operasional adalah uang perusahaan yang <strong>sudah dipegang</strong> driver/PIC, jadi di neraca ia <strong>aset</strong> (bukan beban).
        Kas atau bank berkurang <strong>sekali</strong>, saat uang muka diberikan. Saat biaya dipertanggungjawabkan, bebannya diakui dan saldo uang muka berkurang
        — <strong>tanpa uang keluar lagi</strong>. Kalau biayanya melebihi saldo, saldo dipakai habis dulu dan selisihnya menjadi utang reimbursement ke pemegang.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka
          label="Saldo Uang Muka Aktif" value={formatUang(ringkasan.totalSaldoAktif)}
          tone={ringkasan.totalSaldoAktif > 0 ? "orange" : "default"} sub="uang yang masih dipegang dan belum dipertanggungjawabkan"
          info="Sama dengan saldo akun 1-1360 Uang Muka Operasional di neraca. Dihitung server dari seluruh uang muka aktif."
        />
        <KartuAngka label="Uang Muka Aktif" value={ringkasan.jumlahAktif} sub="pemberian yang belum selesai" />
        <KartuAngka label="Lewat Tenggat" value={ringkasan.jumlahLewatTempo} tone={ringkasan.jumlahLewatTempo > 0 ? "red" : "default"} sub="belum dipertanggungjawabkan sampai tenggat" />
        <KartuAngka label="Pemegang" value={ringkasan.perPemegang.length} sub="orang yang sedang memegang uang muka" />
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)}>{t.label}</Button>
        ))}
      </div>

      {tab === "SALDO" && (
        <>
          {ringkasan.perPemegang.length > 0 && (
            <Card className="overflow-hidden">
              <JudulKartu title="Saldo per Pemegang" description="Total saldo uang muka aktif tiap orang." />
              <TableWrap className="dh-table">
                <Table>
                  <THead><TR><TH sticky>Pemegang</TH><TH numeric>Uang Muka Aktif</TH><TH numeric>Lewat Tenggat</TH><TH numeric>Saldo</TH></TR></THead>
                  <TBody>
                    {ringkasan.perPemegang.map((p) => (
                      <TR key={p.holderId}>
                        <TD sticky className="font-medium">{p.nama}</TD>
                        <TD numeric>{p.jumlah}</TD>
                        <TD numeric>{p.lewatTempo || <span className="text-ink3">—</span>}</TD>
                        <TD numeric><Uang value={p.saldo} className="font-bold" /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </Card>
          )}

          <Card className="overflow-hidden">
            <JudulKartu
              title="Daftar Uang Muka"
              description="Nomor UMO dibuat otomatis. Status: Aktif, Sebagian, Selesai, atau Dibatalkan."
              info="Saldo = nominal − pertanggungjawaban − pengembalian. Uang muka yang dibatalkan dibalik lewat jurnal resmi; riwayatnya tetap ada."
            />
            {items.length === 0 ? (
              <CardContent>
                <EmptyState icon={PiggyBank} title="Belum ada uang muka" description="Berikan uang muka ke driver atau PIC untuk biaya operasional."
                  action={<Button size="sm" onClick={() => setModalBerikan(true)}>Berikan Uang Muka</Button>} />
              </CardContent>
            ) : (
              <>
                <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
                  <Table fixed>
                    <THead>
                      <TR>
                        <TH sticky width={124}>Nomor</TH><TH width={140}>Pemegang</TH><TH>Tujuan</TH>
                        <TH width={92} hideBelow="2xl">Divisi</TH><TH width={78} hideBelow="2xl">Diberikan</TH>
                        <TH width={92}>Tenggat</TH>
                        <TH numeric width={104} hideBelow="2xl">Nominal</TH>
                        <TH numeric width={112} hideBelow="2xl">Dipertanggungjawabkan</TH>
                        <TH numeric width={104} hideBelow="2xl">Dikembalikan</TH>
                        <TH numeric width={112}>Saldo</TH>
                        <TH width={92}>Status</TH>
                        <TH width={56}>Bukti</TH>
                        <TH width={AKSI_COL_WIDTH}>Aksi</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {items.map((u) => {
                        const a = aksiUangMuka(u, { setPakaiUntuk, setKembaliUntuk, setEditUntuk, setVersiUntuk, aksi });
                        return (
                          <TR key={u.id}>
                            <TD sticky className="font-mono text-[12px]">{u.advanceNumber}</TD>
                            <TD truncate className="font-medium">{u.holder?.name}</TD>
                            <TD truncate>{u.purpose}</TD>
                            <TD hideBelow="2xl" className="text-[12px]">{LABEL_DIVISI[u.division] || u.division}</TD>
                            <TD hideBelow="2xl" className="whitespace-nowrap text-[12px]">{tanggalPendek(u.date)}</TD>
                            <TD className="whitespace-nowrap text-[12px]">
                              {tanggalPendek(u.dueDate)}
                              {u.lewatTempo && <Badge variant="red" className="ml-1">Lewat</Badge>}
                            </TD>
                            <TD hideBelow="2xl" numeric><Uang value={u.amount} /></TD>
                            <TD hideBelow="2xl" numeric><Uang value={u.dipertanggungjawabkan} nolSebagaiStrip /></TD>
                            <TD hideBelow="2xl" numeric><Uang value={u.dikembalikan} nolSebagaiStrip /></TD>
                            <TD numeric><Uang value={u.saldo} className="font-bold" nolSebagaiStrip /></TD>
                            <TD><StatusBadge status={u.status} /></TD>
                            <TD><BuktiThumb url={u.receiptUrl} label="Lihat bukti pemberian" /></TD>
                            <TD><RowActions primary={a.primary} items={a.items} /></TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </TableWrap>

                <CardList className={CARD_VIEW_CLASS}>
                  {items.map((u) => {
                    const a = aksiUangMuka(u, { setPakaiUntuk, setKembaliUntuk, setEditUntuk, setVersiUntuk, aksi });
                    return (
                      <RowCard
                        key={u.id}
                        title={u.advanceNumber}
                        status={<StatusBadge status={u.status} />}
                        subtitle={`${u.holder?.name || "—"} · ${u.purpose}`}
                        fields={[
                          { label: "Saldo", value: formatUang(u.saldo) },
                          { label: "Nominal", value: formatUang(u.amount) },
                          { label: "Dipertanggungjawabkan", value: formatUang(u.dipertanggungjawabkan) },
                          { label: "Dikembalikan", value: formatUang(u.dikembalikan) },
                          { label: "Diberikan", value: tanggalPendek(u.date) },
                          { label: "Tenggat", value: <>{tanggalPendek(u.dueDate)}{u.lewatTempo && <Badge variant="red" className="ml-1">Lewat</Badge>}</> },
                          { label: "Divisi", value: LABEL_DIVISI[u.division] || u.division },
                          { label: "Bukti", value: <BuktiThumb url={u.receiptUrl} label="Lihat bukti pemberian" /> },
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

      {tab === "PERTANGGUNGJAWABAN" && (
        <Card className="overflow-hidden">
          <JudulKartu
            title="Pertanggungjawaban Biaya"
            description="Pengeluaran yang dibayar dari uang muka. Saldo baru berkurang saat pengeluaran DISETUJUI."
            info="Tidak ada langkah Bayar: uangnya sudah keluar saat uang muka diberikan. Bila melebihi saldo, selisihnya menjadi utang reimbursement dan dibayar lewat menu Pengeluaran."
          />
          {pengeluaran.length === 0 ? (
            <CardContent>
              <EmptyState icon={ReceiptText} title="Belum ada pertanggungjawaban" description="Pilih uang muka di tab Saldo Aktif, lalu tekan Pertanggungjawabkan, atau ajukan lewat Pengajuan Biaya dengan sumber Uang muka operasional." />
            </CardContent>
          ) : (
            <TableWrap className="dh-table">
              <Table>
                <THead>
                  <TR><TH sticky>Nomor</TH><TH>Tanggal</TH><TH>Uang Muka</TH><TH>Keterangan</TH><TH numeric>Nominal</TH><TH numeric>Dari Uang Muka</TH><TH numeric>Selisih (Utang)</TH><TH>Status</TH></TR>
                </THead>
                <TBody>
                  {pengeluaran.map((e) => {
                    const dipakai = Number(e.advanceAppliedAmount) || 0;
                    const menunggu = ["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status);
                    return (
                      <TR key={e.id}>
                        <TD sticky className="font-mono text-[12px]">{e.expenseNumber}</TD>
                        <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(e.date)}</TD>
                        <TD className="font-mono text-[12px]">{e.advance?.advanceNumber || "—"}</TD>
                        <TD>{e.description}</TD>
                        <TD numeric><Uang value={e.amount} /></TD>
                        <TD numeric>{menunggu ? <span className="text-ink3">menunggu</span> : <Uang value={dipakai} nolSebagaiStrip />}</TD>
                        <TD numeric>{menunggu ? <span className="text-ink3">—</span> : <Uang value={e.amount - dipakai} nolSebagaiStrip />}</TD>
                        <TD><StatusBadge status={e.status} /></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
          {menungguSetuju.length > 0 && (
            <CardContent className="pt-0">
              <p className="text-[12.5px] text-ink2">{menungguSetuju.length} pertanggungjawaban menunggu persetujuan di menu Pengeluaran.</p>
            </CardContent>
          )}
        </Card>
      )}

      {tab === "PENGEMBALIAN" && (
        <Card className="overflow-hidden">
          <JudulKartu
            title="Pengembalian Sisa"
            description="Sisa uang muka yang dikembalikan pemegang ke kas atau bank."
            info="Jurnal: Dr Kas/Bank / Cr Uang Muka Operasional. Pembatalan dilakukan lewat reversal resmi dan saldo uang muka pulih."
          />
          {pengembalian.length === 0 ? (
            <CardContent>
              <EmptyState icon={Undo2} title="Belum ada pengembalian" description="Kembalikan sisa dari daftar Saldo Aktif lewat menu titik-tiga." />
            </CardContent>
          ) : (
            <TableWrap className="dh-table">
              <Table>
                <THead><TR><TH sticky>Uang Muka</TH><TH>Tanggal</TH><TH>Pemegang</TH><TH>Keterangan</TH><TH numeric>Nominal</TH><TH>Status</TH><TH /></TR></THead>
                <TBody>
                  {pengembalian.map((r) => (
                    <TR key={r.settlementId}>
                      <TD sticky className="font-mono text-[12px]">{r.advanceNumber}</TD>
                      <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(r.tanggal)}</TD>
                      <TD>{r.pemegang}</TD>
                      <TD>{r.keterangan}{r.alasan && <span className="block text-[11px] text-ink3">Dibatalkan: {r.alasan}</span>}</TD>
                      <TD numeric><Uang value={r.nominal} /></TD>
                      <TD><StatusBadge status={r.status} /></TD>
                      <TD>
                        {r.status === "AKTIF" && (
                          <Button size="sm" variant="neutral" onClick={() => {
                            const alasan = window.prompt("Alasan membatalkan pengembalian ini? Jurnalnya akan dibalik dan saldo uang muka pulih:");
                            if (alasan?.trim()) aksi(() => api.batalkanPengembalianUangMuka(r.advanceId, r.settlementId, alasan.trim()));
                          }}>Batalkan</Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === "RIWAYAT" && (
        <Card className="overflow-hidden">
          <JudulKartu title="Riwayat" description="Semua pemberian, pertanggungjawaban, dan pengembalian, terbaru di atas." />
          {riwayat.length === 0 ? (
            <CardContent><EmptyState icon={History} title="Belum ada riwayat" description="Riwayat muncul setelah uang muka pertama diberikan." /></CardContent>
          ) : (
            <TableWrap className="dh-table">
              <Table>
                <THead><TR><TH sticky>Uang Muka</TH><TH>Tanggal</TH><TH>Jenis</TH><TH>Pemegang</TH><TH>Keterangan</TH><TH numeric>Nominal</TH><TH>Status</TH></TR></THead>
                <TBody>
                  {riwayat.map((r, i) => (
                    <TR key={`${r.advanceId}-${r.settlementId || "awal"}-${i}`}>
                      <TD sticky className="font-mono text-[12px]">{r.advanceNumber}</TD>
                      <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(r.tanggal)}</TD>
                      <TD>{LABEL_JENIS[r.jenis] || r.jenis}</TD>
                      <TD>{r.pemegang}</TD>
                      <TD>{r.keterangan}{r.alasan && <span className="block text-[11px] text-ink3">Dibatalkan: {r.alasan}</span>}</TD>
                      <TD numeric><Uang value={r.nominal} /></TD>
                      <TD><StatusBadge status={r.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      <ModalBerikan open={modalBerikan} onClose={() => setModalBerikan(false)} rekening={rekening} karyawan={karyawan} onSubmit={(d) => aksi(() => api.berikanUangMuka(d))} />
      <ModalPertanggungjawaban uangMuka={pakaiUntuk} kategori={kategori} onClose={() => setPakaiUntuk(null)} onSubmit={(d) => aksi(() => api.pertanggungjawabanUangMuka(pakaiUntuk.id, d))} />
      {editUntuk && (
        <ModalEditUangMuka
          uangMuka={editUntuk} onClose={() => setEditUntuk(null)}
          onSubmit={(d) => aksi(async () => { await api.editUangMuka(editUntuk.id, d); setEditUntuk(null); })}
        />
      )}
      {versiUntuk && <RiwayatVersiDialog jenis="uang-muka" id={versiUntuk.id} nomor={versiUntuk.advanceNumber} onClose={() => setVersiUntuk(null)} />}
      <ModalKembalikan uangMuka={kembaliUntuk} rekening={rekening} onClose={() => setKembaliUntuk(null)} onSubmit={(d) => aksi(() => api.kembalikanUangMuka(kembaliUntuk.id, d))} />
    </HalamanFinance>
  );
}

function ModalBerikan({ open, onClose, rekening, karyawan, onSubmit }) {
  const awal = () => ({
    holderId: "", division: "DELIVERY", purpose: "", date: hariIniISO(), dueDate: hariIniISO(7), amount: "",
    cashAccountId: "", receiptUrl: "", notes: "", ...BIAYA_KOSONG,
  });
  const [f, setF] = useState(awal);
  useEffect(() => { if (open) setF(awal()); }, [open]);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const valid = f.holderId && f.purpose.trim() && Number(f.amount) > 0 && f.cashAccountId && f.dueDate && biayaTransferLengkap(rek, f);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Berikan Uang Muka"
      description="Kas atau bank berkurang saat ini. Uangnya tercatat sebagai aset sampai dipertanggungjawabkan."
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(denganBiaya(f))} disabled={!valid}>Berikan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Pemegang" required hint="Driver/PIC yang memegang uangnya">
            <Pilihan value={f.holderId} onChange={(v) => set("holderId", v)}>
              <option value="">— pilih —</option>
              {karyawan.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Pilihan>
          </Field>
          <Field label="Divisi">
            <Pilihan value={f.division} onChange={(v) => set("division", v)}>
              {Object.entries(LABEL_DIVISI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Pilihan>
          </Field>
        </div>
        <Field label="Tujuan" required><Input value={f.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="mis. Uang jalan pengiriman Bandung" /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal pemberian"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Tenggat pertanggungjawaban" required><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.dueDate} onChange={(v) => set("dueDate", v)} /></Field>
        </div>
        <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <CaraBayarTransfer rekening={rek} nominal={f.amount} value={f} onChange={(b) => setF((s) => ({ ...s, ...b }))} />
        <Field label="Bukti pemberian" hint="Opsional — foto bukti transfer/serah terima"><PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalPertanggungjawaban({ uangMuka, kategori, onClose, onSubmit }) {
  const [f, setF] = useState({ date: hariIniISO(), amount: "", description: "", categoryId: "", payeeName: "", receiptUrl: "", notes: "" });
  useEffect(() => { if (uangMuka) setF({ date: hariIniISO(), amount: "", description: "", categoryId: "", payeeName: "", receiptUrl: "", notes: "" }); }, [uangMuka]);
  if (!uangMuka) return null;
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const lebih = Number(f.amount) > uangMuka.saldo;
  const valid = f.description.trim() && f.categoryId && Number(f.amount) > 0 && f.receiptUrl;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Pertanggungjawabkan ${uangMuka.advanceNumber}`}
      description={`${uangMuka.holder?.name || "Pemegang"} · saldo ${formatUang(uangMuka.saldo)}`}
      className="w-[540px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Ajukan Pertanggungjawaban</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Penjelasan>Pengeluaran ini menunggu persetujuan. Saldo uang muka baru berkurang saat disetujui — tanpa Bayar dan tanpa uang keluar lagi.</Penjelasan>
        <Field label="Keterangan" required><Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="mis. BBM dan tol Bandung" /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        {lebih && (
          <p className="rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2">
            Melebihi saldo. Saldo {formatUang(uangMuka.saldo)} dipakai habis, selisih <strong>{formatUang(Number(f.amount) - uangMuka.saldo)}</strong> menjadi utang reimbursement ke {uangMuka.holder?.name || "pemegang"}.
          </p>
        )}
        <Field label="Kategori biaya" required hint="Menentukan akun beban di buku besar">
          <Pilihan value={f.categoryId} onChange={(v) => set("categoryId", v)}>
            <option value="">— pilih —</option>
            {kategori.map((k) => <option key={k.id} value={k.id}>{k.name}{k.account ? ` → ${k.account.code} ${k.account.name}` : ""}</option>)}
          </Pilihan>
        </Field>
        <Field label="Dibayarkan kepada"><Input value={f.payeeName} onChange={(e) => set("payeeName", e.target.value)} placeholder="Nama toko/pihak — opsional" /></Field>
        <Field label="Foto nota / bukti" required hint="Wajib — pertanggungjawaban selalu bernota"><PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalKembalikan({ uangMuka, rekening, onClose, onSubmit }) {
  const [f, setF] = useState({ amount: "", cashAccountId: "", date: hariIniISO(), note: "" });
  useEffect(() => { if (uangMuka) setF({ amount: String(uangMuka.saldo || ""), cashAccountId: "", date: hariIniISO(), note: "" }); }, [uangMuka]);
  if (!uangMuka) return null;
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = Number(f.amount) > 0 && Number(f.amount) <= uangMuka.saldo && f.cashAccountId;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Kembalikan Sisa ${uangMuka.advanceNumber}`}
      description={`${uangMuka.holder?.name || "Pemegang"} · saldo ${formatUang(uangMuka.saldo)}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Catat Pengembalian</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nominal dikembalikan" required hint={`Maksimal ${formatUang(uangMuka.saldo)} (sisa saldo)`}><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        <Field label="Uang masuk ke" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
        <Field label="Catatan"><Input value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalEditUangMuka({ uangMuka, onClose, onSubmit }) {
  const asli = {
    purpose: uangMuka.purpose || "", dueDate: String(uangMuka.dueDate || "").slice(0, 10), notes: uangMuka.notes || "",
    receiptUrl: uangMuka.receiptUrl || "", division: uangMuka.division || "",
  };
  const [f, setF] = useState(asli);
  const [alasan, setAlasan] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const beda = {};
  for (const k of Object.keys(asli)) if ((f[k] || "") !== (asli[k] || "")) beda[k] = f[k];
  const valid = Object.keys(beda).length > 0 && alasan.trim() && f.purpose.trim() && f.dueDate;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Edit ${uangMuka.advanceNumber}`}
      description={`${formatUang(uangMuka.amount)} · ${uangMuka.holder?.name || ""}`}
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit({ ...beda, reason: alasan.trim() })} disabled={!valid}>Simpan Perubahan</TombolAksi></>}
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Uang muka ini sudah masuk buku besar. Yang bisa diubah di sini hanya keterangan operasional — buku besar dan saldo rekening tidak berubah.
          Nominal, pemegang, rekening, dan tanggal tidak bisa dikoreksi: <strong>Batalkan lalu catat ulang</strong>.
        </p>
        <Field label="Tujuan" required><Input value={f.purpose} onChange={(e) => set("purpose", e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tenggat pertanggungjawaban" required><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.dueDate} onChange={(v) => set("dueDate", v)} /></Field>
          <Field label="Divisi">
            <Pilihan value={f.division} onChange={(v) => set("division", v)}>
              {Object.entries(LABEL_DIVISI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Pilihan>
          </Field>
        </div>
        <Field label="Bukti pemberian"><PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Field label="Alasan perubahan" required hint="Wajib — tercatat di riwayat audit">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. tujuan kurang jelas" />
        </Field>
      </div>
    </Modal>
  );
}
