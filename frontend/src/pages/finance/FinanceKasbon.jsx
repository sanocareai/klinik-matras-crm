import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, HandCoins, Pencil, History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { LinkBukti } from "@/features/finance/receiptMedia.jsx";
import { BuktiThumb } from "@/features/finance/BuktiThumb.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, tanggalPendek, PemilihBukti,
} from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";

// Aksi PALING RELEVAN jadi tombol utama; sisanya masuk menu titik-tiga —
// sama seperti FinanceExpenses.jsx (lihat komentar di sana).
function aksiKasbon(k, { setLunasiUntuk, setRiwayatId, setEditUntuk, aksi }) {
  const bisaUbah = k.status !== "DIBATALKAN";
  const jumlahRiwayat = k.repayments.filter((r) => !r.cancelledAt).length;

  const items = [
    k.repayments.length > 0 && { key: "riwayat", label: `Riwayat pemotongan (${jumlahRiwayat})`, icon: History, onClick: () => setRiwayatId(k.id) },
    bisaUbah && { key: "edit", label: "Edit data kasbon", icon: Pencil, onClick: () => setEditUntuk(k) },
    bisaUbah && {
      key: "batalkan", label: "Batalkan", destructive: true,
      onClick: () => {
        const alasan = window.prompt(`Alasan membatalkan ${k.kasbonNumber} (salah input)? Jurnalnya akan dibalik:`);
        if (alasan?.trim()) return aksi(() => api.batalKasbon(k.id, alasan.trim()));
      },
    },
  ].filter(Boolean);

  if (k.status === "AKTIF") {
    return { primary: { label: "Potong", variant: "secondary", title: "Potong dari gaji", onClick: () => setLunasiUntuk({ kasbon: k }) }, items };
  }
  return { primary: null, items };
}

// KASBON — uang muka gaji karyawan.
//
// Manfaat perusahaan: karyawan boleh mencairkan gaji lebih awal, dengan batas
// dan harus ada urgensinya. Di buku besar ia PIUTANG KARYAWAN (aset), bukan
// beban: uang keluar dulu, lalu berkurang lewat potongan gaji saat gajian.
// Kasbon = pencairan gaji lebih awal, jadi TIDAK dikembalikan — hanya dipotong
// dari gaji. Pinjaman karyawan adalah hal lain dan tidak dicatat di sini.
// Jurnal & alasannya: backend services/finance/posting/kasbon.js.

const STATUS_TAB = [
  { key: "AKTIF", label: "Aktif (belum lunas)" },
  { key: "LUNAS", label: "Lunas" },
  { key: "DIBATALKAN", label: "Dibatalkan" },
  { key: "", label: "Semua" },
];

function hariIniISO() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function FinanceKasbon() {
  const [status, setStatus] = useState("AKTIF");
  const [q, setQ] = useState("");
  const [fKaryawan, setFKaryawan] = useState("");
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);

  const [data, setData] = useState(null);
  const [rekening, setRekening] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);

  const [modalBaru, setModalBaru] = useState(false);
  const [lunasiUntuk, setLunasiUntuk] = useState(null); // { kasbon } | { karyawan, sisa }
  const [riwayatId, setRiwayatId] = useState(null);
  const [editUntuk, setEditUntuk] = useState(null);

  // { diam: true } = muat ulang di latar belakang (layar & scroll tetap).
  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try {
      const [d, r] = await Promise.all([
        api.getFinanceKasbon({ status, q: qTunda.trim(), karyawan: fKaryawan }),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
      ]);
      setData(d);
      setRekening((r.accounts || []).filter((a) => a.active));
    } catch (e) {
      if (diam) setPesan(e.message || "Gagal menyegarkan daftar");
      else setError(e.message || "Gagal memuat kasbon");
    } finally {
      if (!diam) setLoading(false);
    }
  }, [status, qTunda, fKaryawan]);

  useEffect(() => {
    muat({ diam: pernahMuat.current });
    pernahMuat.current = true;
  }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalBaru(false);
      setLunasiUntuk(null);
      setEditUntuk(null);
      await muat({ diam: true });
    } catch (e) {
      setPesan(e.message);
    }
  }

  const kasbon = data?.kasbon || [];
  const perKaryawan = data?.perKaryawan || [];
  const riwayat = kasbon.find((k) => k.id === riwayatId) || null;

  return (
    <HalamanFinance
      title="Kasbon Karyawan"
      subtitle="Pencairan gaji lebih awal: siapa yang kasbonnya belum dipotong dari gaji, dan berapa."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Kasbon Baru</Button>}
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
        Kasbon adalah gaji yang dicairkan lebih awal, jadi <strong>bukan beban</strong> — nanti dipotong dari gaji.
        Selama belum dipotong, di neraca ia tercatat sebagai <strong>Piutang Karyawan</strong>. Saat gajian, catat gaji <strong>bersih</strong> yang dibayarkan di
        Pengeluaran (Gaji &amp; Tunjangan), lalu catat bagian yang dipotong di sini lewat <strong>Potong dari gaji</strong> —
        sistem otomatis menambahkannya ke beban gaji sehingga totalnya menjadi gaji kotor.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka
          label="Belum Dipotong dari Gaji" value={formatUang(data?.totalSisa ?? 0)}
          tone={(data?.totalSisa ?? 0) > 0 ? "orange" : "default"} sub="total kasbon yang masih menunggu dipotong"
          info="Gaji yang sudah dicairkan lebih awal (kasbon) tapi belum dipotong dari gaji karyawan. Angka ini sama dengan saldo akun Piutang Karyawan di neraca."
        />
        <KartuAngka label="Karyawan yang Masih Punya Kasbon" value={perKaryawan.length} sub="orang, kasbonnya belum lunas" />
        <KartuAngka label="Diberikan Bulan Ini" value={formatUang(data?.bulanIni?.diberikan ?? 0)} sub="kasbon baru yang diberikan bulan ini" />
        <KartuAngka label="Sudah Dipotong Bulan Ini" value={formatUang(data?.bulanIni?.terpotong ?? 0)} sub="kasbon yang dipotong dari gaji bulan ini" />
      </div>

      {perKaryawan.length > 0 && (
        <Card className="overflow-hidden">
          <JudulKartu
            title="Kasbon yang Belum Dipotong, per Karyawan"
            description="Siapa yang kasbonnya belum dipotong dari gaji dan berapa. Saat gajian, tekan Potong — otomatis mengurangi kasbon yang paling lama dulu."
            info="Angka di sini dihitung dari SEMUA kasbon yang belum lunas, jadi tidak berubah walau Anda sedang mencari atau memfilter daftar di bawah."
          />
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR><TH sticky>Karyawan</TH><TH numeric>Berapa Kali Kasbon</TH><TH>Kasbon Tertua</TH><TH numeric>Belum Dipotong</TH><TH /></TR>
              </THead>
              <TBody>
                {perKaryawan.map((p) => (
                  <TR key={p.nama}>
                    <TD sticky className="font-medium">{p.nama}</TD>
                    <TD numeric>{p.jumlah}</TD>
                    <TD className="whitespace-nowrap">{tanggalPendek(p.terlama)}</TD>
                    <TD numeric><Uang value={p.sisa} className="font-bold" /></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="neutral" onClick={() => { setFKaryawan(p.nama); setStatus("AKTIF"); }}>Lihat</Button>
                        <Button size="sm" variant="secondary" onClick={() => setLunasiUntuk({ karyawan: p.nama, sisa: p.sisa })}>Potong</Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={status === t.key ? "secondary" : "neutral"} onClick={() => setStatus(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      <FilterBar
        q={q} onQ={setQ}
        placeholder="Cari nomor, karyawan, urgensi, nominal…"
        filters={[
          { key: "kar", label: "Karyawan", value: fKaryawan, onChange: setFKaryawan, options: perKaryawan.map((p) => [p.nama, p.nama]) },
        ]}
        ringkasan={`${kasbon.length} kasbon${data?.terpotong ? " · baru 500 teratas tampil — persempit pencarian" : ""}`}
        onReset={() => { setQ(""); setFKaryawan(""); }}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title="Daftar Kasbon"
          description="Nomor KSB dibuat otomatis. Kasbon lama hasil impor Notion (sebelum Sep 2026) tercatat sebagai lunas."
          info="Kasbon hasil impor histori sebelum September 2026 ditandai lunas dan tidak punya jurnal sendiri — kas bank-nya sudah dinetralkan oleh penyesuaian saldo 18 Sep 2026."
        />
        {kasbon.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={HandCoins} title="Tidak ada kasbon"
              description="Belum ada kasbon yang cocok dengan filter ini."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Catat Kasbon</Button>}
            />
          </CardContent>
        ) : (
          <>
          <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={124}>Nomor</TH><TH width={78}>Tanggal</TH><TH width={140}>Karyawan</TH>
                  <TH hideBelow="2xl">Urgensi</TH>
                  <TH width={128} hideBelow="2xl">Sumber Dana</TH>
                  <TH numeric width={100} hideBelow="2xl">Kasbon</TH>
                  <TH numeric width={112} hideBelow="2xl">Sudah Dipotong</TH>
                  <TH numeric width={112}>Belum Dipotong</TH>
                  <TH width={100}>Status</TH>
                  <TH width={56}>Bukti</TH>
                  <TH width={AKSI_COL_WIDTH}>Aksi</TH>
                </TR>
              </THead>
              <TBody>
                {kasbon.map((k) => {
                  const a = aksiKasbon(k, { setLunasiUntuk, setRiwayatId, setEditUntuk, aksi });
                  return (
                  <TR key={k.id}>
                    <TD sticky className="font-mono text-[12px]">{k.kasbonNumber}</TD>
                    <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(k.date)}</TD>
                    <TD truncate className="font-medium">{k.employeeName}</TD>
                    <TD hideBelow="2xl" truncate>{k.urgency || <span className="text-ink3">—</span>}</TD>
                    <TD hideBelow="2xl" truncate className="text-[12px]">{k.cashAccount ? k.cashAccount.name : <span className="text-ink3">—</span>}</TD>
                    <TD hideBelow="2xl" numeric><Uang value={k.amount} /></TD>
                    <TD hideBelow="2xl" numeric><Uang value={k.terlunasi} nolSebagaiStrip /></TD>
                    <TD numeric><Uang value={k.sisa} className="font-bold" nolSebagaiStrip /></TD>
                    <TD>
                      <StatusBadge status={k.status} />
                      {k.historis && <span className="ml-1 text-[11px] text-ink3">impor</span>}
                    </TD>
                    <TD><BuktiThumb url={k.receiptUrl} label="Lihat bukti kasbon" /></TD>
                    <TD>
                      <RowActions primary={a.primary} items={a.items} />
                    </TD>
                  </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>

          <CardList>
            {kasbon.map((k) => {
              const a = aksiKasbon(k, { setLunasiUntuk, setRiwayatId, setEditUntuk, aksi });
              return (
                <RowCard
                  key={k.id}
                  title={k.kasbonNumber}
                  status={<StatusBadge status={k.status} />}
                  subtitle={k.employeeName}
                  fields={[
                    { label: "Tanggal", value: tanggalPendek(k.date) },
                    { label: "Belum Dipotong", value: formatUang(k.sisa) },
                    { label: "Kasbon", value: formatUang(k.amount) },
                    { label: "Sudah Dipotong", value: formatUang(k.terlunasi) },
                    { label: "Urgensi", value: k.urgency, span: true },
                    { label: "Sumber Dana", value: k.cashAccount?.name },
                    { label: "Bukti", value: <BuktiThumb url={k.receiptUrl} label="Lihat bukti kasbon" /> },
                  ]}
                  actions={<RowActions primary={a.primary} items={a.items} />}
                />
              );
            })}
          </CardList>
          </>
        )}
      </Card>

      <ModalKasbonBaru
        open={modalBaru} onClose={() => setModalBaru(false)} rekening={rekening} perKaryawan={perKaryawan} batas={data?.batas || 0}
        onSubmit={async (d) => {
          try {
            await api.createFinanceKasbon(d);
          } catch (e) {
            if (/melewati batas/i.test(e.message) && window.confirm(`${e.message}\n\nTetap catat kasbon ini? (khusus admin)`)) {
              await api.createFinanceKasbon({ ...d, lewatBatas: true });
            } else {
              throw e;
            }
          }
        }}
        aksi={aksi}
      />

      <ModalLunasi
        target={lunasiUntuk} onClose={() => setLunasiUntuk(null)}
        onSubmit={(d) => aksi(() => (lunasiUntuk.kasbon
          ? api.catatPelunasanKasbon(lunasiUntuk.kasbon.id, d)
          : api.potongKasbonKaryawan({ ...d, employeeName: lunasiUntuk.karyawan })))}
      />

      <ModalRiwayat
        kasbon={riwayat} onClose={() => setRiwayatId(null)}
        onBatal={(rep) => {
          const alasan = window.prompt("Alasan membatalkan pemotongan ini? Catatannya akan dibalik:");
          if (alasan?.trim()) return aksi(() => api.batalPelunasanKasbon(riwayat.id, rep.id, alasan.trim()));
        }}
      />

      <ModalEdit kasbon={editUntuk} onClose={() => setEditUntuk(null)} onSubmit={(d) => aksi(() => api.editKasbon(editUntuk.id, d))} />
    </HalamanFinance>
  );
}

function ModalKasbonBaru({ open, onClose, rekening, perKaryawan, batas, onSubmit, aksi }) {
  const [f, setF] = useState({ employeeName: "", date: "", amount: "", urgency: "", cashAccountId: "", notes: "", receiptUrl: "" });
  const [nama, setNama] = useState([]);
  const [namaGalat, setNamaGalat] = useState(null);
  const [namaMemuat, setNamaMemuat] = useState(false);
  const [rek, setRek] = useState(rekening);
  const [rekState, setRekState] = useState({ memuat: false, galat: null });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  // Rekening dimuat di sini (bukan hanya dari layar induk yang menelan galat jadi daftar kosong): kalau gagal, pengguna melihat
  // pesan + tombol coba lagi, bukan pilihan kosong yang membuat kasbon tak bisa dicatat tanpa penjelasan.
  const muatRekening = useCallback(() => {
    setRekState({ memuat: true, galat: null });
    api.getFinanceCashAccounts()
      .then((r) => { setRek((r.accounts || []).filter((a) => a.active)); setRekState({ memuat: false, galat: null }); })
      .catch((e) => setRekState({ memuat: false, galat: e.message || "Gagal memuat daftar rekening" }));
  }, []);

  const muatNama = useCallback(() => {
    setNamaGalat(null); setNamaMemuat(true);
    // Daftar resmi karyawan Sano (akun aktif; tanpa akun owner bersama, kurir eksternal, dan akun nonaktif).
    api.getFinanceKasbonNama()
      .then((r) => { setNama(r.nama || []); setNamaMemuat(false); })
      .catch((e) => { setNamaGalat(e.message || "Gagal memuat daftar karyawan"); setNamaMemuat(false); });
  }, []);

  useEffect(() => {
    if (open) {
      setF({ employeeName: "", date: hariIniISO(), amount: "", urgency: "", cashAccountId: "", notes: "", receiptUrl: "" });
      muatNama();
      muatRekening();
    }
  }, [open, muatNama, muatRekening]);

  const sudah = perKaryawan.find((p) => p.nama.toLowerCase() === f.employeeName.trim().toLowerCase());
  const setelah = (sudah?.sisa || 0) + (Number(f.amount) || 0);
  const valid = f.employeeName.trim() && f.urgency.trim().length >= 3 && Number(f.amount) > 0 && f.cashAccountId;

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Kasbon Baru"
      description="Gaji dicairkan lebih awal dari kas/bank, nanti dipotong dari gaji — bukan beban."
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => aksi(() => onSubmit(f))} disabled={!valid}>Catat Kasbon</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Karyawan" required hint={namaGalat ? undefined : "Hanya karyawan Sano yang akunnya aktif"}>
          <Pilihan value={f.employeeName} onChange={(v) => set("employeeName", v)}>
            <option value="">{namaMemuat ? "memuat karyawan…" : "— pilih karyawan —"}</option>
            {nama.map((n) => <option key={n} value={n}>{n}</option>)}
          </Pilihan>
          {namaGalat && (
            <p className="mt-1 text-[12px] text-red">
              {namaGalat}.{" "}
              <button type="button" className="font-semibold underline" onClick={muatNama}>Coba lagi</button>
            </p>
          )}
        </Field>
        {sudah && (
          <p className="rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2">
            {sudah.nama} masih punya {sudah.jumlah} kasbon aktif (sisa <strong>{formatUang(sudah.sisa)}</strong>).
            {Number(f.amount) > 0 && <> Setelah kasbon ini: <strong>{formatUang(setelah)}</strong>{batas > 0 && setelah > batas ? <span className="text-red"> — melewati batas {formatUang(batas)}</span> : null}.</>}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <Field label="Urgensi / alasan" required hint="Kasbon hanya untuk keperluan mendesak — tercatat di riwayat">
          <Input value={f.urgency} onChange={(e) => set("urgency", e.target.value)} placeholder="mis. biaya berobat anak" />
        </Field>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">{rekState.memuat ? "memuat rekening…" : "— pilih bank / kas —"}</option>
            {rek.map((r) => <option key={r.id} value={r.id}>{r.name} · saldo {formatUang(r.saldo)}</option>)}
          </Pilihan>
          {rekState.galat && (
            <p className="mt-1 text-[12px] text-red">
              {rekState.galat}.{" "}
              <button type="button" className="font-semibold underline" onClick={muatRekening}>Coba lagi</button>
            </p>
          )}
          {!rekState.memuat && !rekState.galat && rek.length === 0 && (
            <p className="mt-1 text-[12px] text-red">Belum ada rekening kas/bank yang aktif. Tambahkan dulu di menu Kas &amp; Bank.</p>
          )}
        </Field>
        <Field label="Bukti transfer" hint="Opsional">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalLunasi({ target, onClose, onSubmit }) {
  const [f, setF] = useState({ date: "", amount: "", notes: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const sisa = target?.kasbon ? target.kasbon.sisa : target?.sisa || 0;

  useEffect(() => {
    if (target) setF({ date: hariIniISO(), amount: sisa, notes: "" });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null;

  const valid = Number(f.amount) > 0 && Number(f.amount) <= sisa;
  const nama = target.kasbon ? target.kasbon.employeeName : target.karyawan;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={target.kasbon ? `Potong gaji untuk ${target.kasbon.kasbonNumber}` : `Potong kasbon ${nama}`}
      description={`Belum dipotong: ${formatUang(sisa)}${target.kasbon ? "" : " — otomatis mengurangi kasbon yang paling lama dulu"}`}
      className="w-[480px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit({ ...f, method: "POTONG_GAJI", amount: Number(f.amount) })} disabled={!valid}>Simpan Potongan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-inset px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Kas tidak tersentuh. Pastikan gaji <strong>bersih</strong> yang dibayarkan sudah dicatat di Pengeluaran — bagian
          yang dipotong ini otomatis ditambahkan ke beban gaji (gaji kotor = bersih + potongan).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required hint={Number(f.amount) > sisa ? "Melebihi kasbon yang belum dipotong" : undefined}><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="mis. gaji September" /></Field>
      </div>
    </Modal>
  );
}

function ModalRiwayat({ kasbon, onClose, onBatal }) {
  if (!kasbon) return null;
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Riwayat pemotongan ${kasbon.kasbonNumber}`}
      description={`${kasbon.employeeName} · kasbon ${formatUang(kasbon.amount)} · belum dipotong ${formatUang(kasbon.sisa)}`}
      className="w-[520px]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      <div className="space-y-2">
        {kasbon.repayments.length === 0 && <p className="text-[13px] text-ink3">Belum ada pemotongan.</p>}
        {kasbon.repayments.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
            <div className="min-w-0 text-[13px]">
              <p className="font-medium text-ink">
                <Uang value={r.amount} /> · dipotong dari gaji
                {r.cancelledAt && <Badge variant="neutral" className="ml-2">Dibatalkan</Badge>}
              </p>
              <p className="text-[12px] text-ink3">
                {tanggalPendek(r.date)}{r.cashAccount ? ` · ke ${r.cashAccount.name}` : ""}{r.notes ? ` · ${r.notes}` : ""}
                {r.cancelReason ? ` · batal: ${r.cancelReason}` : ""}
              </p>
            </div>
            {!r.cancelledAt && <Button size="sm" variant="neutral" onClick={() => onBatal(r)}>Batalkan</Button>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ModalEdit({ kasbon, onClose, onSubmit }) {
  const [f, setF] = useState({ employeeName: "", urgency: "", notes: "", receiptUrl: "" });
  const [alasan, setAlasan] = useState("");
  useEffect(() => {
    if (kasbon) {
      setF({ employeeName: kasbon.employeeName || "", urgency: kasbon.urgency || "", notes: kasbon.notes || "", receiptUrl: kasbon.receiptUrl || "" });
      setAlasan("");
    }
  }, [kasbon]);
  if (!kasbon) return null;
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const beda = Object.fromEntries(Object.entries(f).filter(([k, v]) => (v || "") !== (kasbon[k] || "")));
  const valid = Object.keys(beda).length > 0 && alasan.trim() && f.employeeName.trim();

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Edit ${kasbon.kasbonNumber}`}
      description="Nominal, tanggal, dan rekening tidak diubah di sini — kalau salah, Batalkan lalu catat ulang."
      className="w-[480px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit({ ...beda, reason: alasan.trim() })} disabled={!valid}>Simpan Perubahan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Karyawan" required><Input value={f.employeeName} onChange={(e) => set("employeeName", e.target.value)} /></Field>
        <Field label="Urgensi / alasan"><Input value={f.urgency} onChange={(e) => set("urgency", e.target.value)} /></Field>
        <Field label="Bukti transfer"><PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Field label="Alasan perubahan" required hint="Wajib — tercatat di riwayat audit">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah ketik nama" />
        </Field>
      </div>
    </Modal>
  );
}
