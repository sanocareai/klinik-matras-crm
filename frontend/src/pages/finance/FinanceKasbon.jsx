import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, HandCoins, Pencil, History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, tanggalPendek, PemilihBukti,
} from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";

// KASBON — uang muka gaji karyawan.
//
// Manfaat perusahaan: karyawan boleh mencairkan gaji lebih awal, dengan batas
// dan harus ada urgensinya. Di buku besar ia PIUTANG KARYAWAN (aset), bukan
// beban: uang keluar dulu, lalu kembali lewat potongan gaji atau setoran tunai.
// Jurnal & alasannya: backend services/finance/posting/kasbon.js.

const STATUS_TAB = [
  { key: "AKTIF", label: "Aktif (belum lunas)" },
  { key: "LUNAS", label: "Lunas" },
  { key: "DIBATALKAN", label: "Dibatalkan" },
  { key: "", label: "Semua" },
];

const CARA = [
  ["POTONG_GAJI", "Potong dari gaji"],
  ["TUNAI", "Dikembalikan tunai / transfer"],
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
      subtitle="Uang muka gaji: sisa per karyawan, pelunasan lewat potong gaji atau tunai."
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
        Kasbon <strong>bukan beban</strong> — uangnya keluar dulu, lalu kembali. Di neraca ia tercatat sebagai
        <strong> Piutang Karyawan</strong>. Saat gajian, catat gaji <strong>bersih</strong> yang dibayarkan di
        Pengeluaran (Gaji &amp; Tunjangan), lalu catat bagian yang dipotong di sini lewat <strong>Potong dari gaji</strong> —
        sistem otomatis menambahkannya ke beban gaji sehingga totalnya menjadi gaji kotor.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka
          label="Sisa Kasbon Aktif" value={formatUang(data?.totalSisa ?? 0)}
          tone={(data?.totalSisa ?? 0) > 0 ? "orange" : "default"} sub="Piutang Karyawan"
          info="Total uang yang sudah dikeluarkan ke karyawan tapi belum kembali — sama dengan saldo akun Piutang Karyawan (1-1350) di neraca."
        />
        <KartuAngka label="Karyawan Berutang" value={perKaryawan.length} sub="masih punya kasbon aktif" />
        <KartuAngka label="Diberikan Bulan Ini" value={formatUang(data?.bulanIni?.diberikan ?? 0)} sub="kasbon baru bulan berjalan" />
        <KartuAngka label="Terpotong Bulan Ini" value={formatUang(data?.bulanIni?.terpotong ?? 0)} sub="pelunasan bulan berjalan" />
      </div>

      {perKaryawan.length > 0 && (
        <Card className="overflow-hidden">
          <JudulKartu
            title="Sisa per Karyawan"
            description="Siapa berutang berapa. Tekan Potong saat gajian — dialokasikan ke kasbon yang paling lama dulu."
            info="Angka di sini selalu dihitung dari SEMUA kasbon aktif, tidak berubah mengikuti pencarian di bawah."
          />
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR><TH sticky>Karyawan</TH><TH numeric>Jumlah Kasbon</TH><TH>Terlama</TH><TH numeric>Sisa</TH><TH /></TR>
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
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR>
                  <TH sticky>Nomor</TH><TH>Tanggal</TH><TH>Karyawan</TH><TH>Urgensi</TH>
                  <TH numeric>Nominal</TH><TH numeric>Terlunasi</TH><TH numeric>Sisa</TH><TH>Status</TH><TH />
                </TR>
              </THead>
              <TBody>
                {kasbon.map((k) => (
                  <TR key={k.id}>
                    <TD sticky className="font-mono text-[12px]">{k.kasbonNumber}</TD>
                    <TD className="whitespace-nowrap">{tanggalPendek(k.date)}</TD>
                    <TD className="font-medium">{k.employeeName}</TD>
                    <TD className="max-w-[220px]">
                      <span className="block truncate">{k.urgency || "—"}</span>
                      {k.cashAccount && <span className="text-[11px] text-ink3">dari {k.cashAccount.name}</span>}
                      {k.receiptUrl && (
                        <a href={k.receiptUrl} target="_blank" rel="noreferrer" className="ml-1 text-[11px] text-accent hover:underline">bukti</a>
                      )}
                    </TD>
                    <TD numeric><Uang value={k.amount} /></TD>
                    <TD numeric><Uang value={k.terlunasi} nolSebagaiStrip /></TD>
                    <TD numeric><Uang value={k.sisa} className="font-bold" nolSebagaiStrip /></TD>
                    <TD>
                      <StatusBadge status={k.status} />
                      {k.historis && <span className="ml-1 text-[11px] text-ink3">impor</span>}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {k.status === "AKTIF" && (
                          <Button size="sm" variant="secondary" onClick={() => setLunasiUntuk({ kasbon: k })}>Lunasi</Button>
                        )}
                        {k.repayments.length > 0 && (
                          <Button size="sm" variant="neutral" onClick={() => setRiwayatId(k.id)} title="Riwayat pelunasan">
                            <History size={13} /> {k.repayments.filter((r) => !r.cancelledAt).length}
                          </Button>
                        )}
                        {k.status !== "DIBATALKAN" && (
                          <Button size="sm" variant="neutral" onClick={() => setEditUntuk(k)} title="Edit data kasbon"><Pencil size={13} /></Button>
                        )}
                        {k.status !== "DIBATALKAN" && (
                          <TombolAksi
                            size="sm" variant="neutral"
                            onClick={() => {
                              const alasan = window.prompt(`Alasan membatalkan ${k.kasbonNumber} (salah input)? Jurnalnya akan dibalik:`);
                              if (alasan?.trim()) return aksi(() => api.batalKasbon(k.id, alasan.trim()));
                            }}
                          >
                            Batalkan
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
        target={lunasiUntuk} onClose={() => setLunasiUntuk(null)} rekening={rekening}
        onSubmit={(d) => aksi(() => (lunasiUntuk.kasbon
          ? api.catatPelunasanKasbon(lunasiUntuk.kasbon.id, d)
          : api.potongKasbonKaryawan({ ...d, employeeName: lunasiUntuk.karyawan })))}
      />

      <ModalRiwayat
        kasbon={riwayat} onClose={() => setRiwayatId(null)}
        onBatal={(rep) => {
          const alasan = window.prompt("Alasan membatalkan pelunasan ini? Jurnalnya akan dibalik:");
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
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (open) {
      setF({ employeeName: "", date: hariIniISO(), amount: "", urgency: "", cashAccountId: "", notes: "", receiptUrl: "" });
      api.getFinanceKasbonNama().then((r) => setNama(r.nama || [])).catch(() => {});
    }
  }, [open]);

  const sudah = perKaryawan.find((p) => p.nama.toLowerCase() === f.employeeName.trim().toLowerCase());
  const setelah = (sudah?.sisa || 0) + (Number(f.amount) || 0);
  const valid = f.employeeName.trim() && f.urgency.trim().length >= 3 && Number(f.amount) > 0 && f.cashAccountId;

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Kasbon Baru"
      description="Uang keluar dari kas/bank, tercatat sebagai piutang karyawan — bukan beban."
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => aksi(() => onSubmit(f))} disabled={!valid}>Catat Kasbon</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Karyawan" required>
          <Input list="daftar-karyawan-kasbon" value={f.employeeName} onChange={(e) => set("employeeName", e.target.value)} placeholder="Nama karyawan" autoComplete="off" />
          <datalist id="daftar-karyawan-kasbon">{nama.map((n) => <option key={n} value={n} />)}</datalist>
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
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Bukti transfer" hint="Opsional">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalLunasi({ target, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ method: "POTONG_GAJI", date: "", amount: "", cashAccountId: "", notes: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const sisa = target?.kasbon ? target.kasbon.sisa : target?.sisa || 0;

  useEffect(() => {
    if (target) setF({ method: "POTONG_GAJI", date: hariIniISO(), amount: sisa, cashAccountId: "", notes: "" });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null;

  const valid = Number(f.amount) > 0 && Number(f.amount) <= sisa && (f.method !== "TUNAI" || f.cashAccountId);
  const nama = target.kasbon ? target.kasbon.employeeName : target.karyawan;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={target.kasbon ? `Lunasi ${target.kasbon.kasbonNumber}` : `Potong kasbon ${nama}`}
      description={`Sisa ${formatUang(sisa)}${target.kasbon ? "" : " — dialokasikan ke kasbon paling lama dulu"}`}
      className="w-[480px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit({ ...f, amount: Number(f.amount) })} disabled={!valid}>Catat Pelunasan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Cara pelunasan">
          <Pilihan value={f.method} onChange={(v) => set("method", v)}>
            {CARA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Pilihan>
        </Field>
        <p className="rounded-lg bg-inset px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          {f.method === "POTONG_GAJI"
            ? "Kas tidak tersentuh. Pastikan gaji BERSIH yang dibayarkan sudah dicatat di Pengeluaran — bagian yang dipotong ini otomatis ditambahkan ke beban gaji (gaji kotor = bersih + potongan)."
            : "Uang masuk ke rekening yang dipilih dan piutang karyawan berkurang."}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required hint={Number(f.amount) > sisa ? "Melebihi sisa" : undefined}><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        {f.method === "TUNAI" && (
          <Field label="Masuk ke rekening" required>
            <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
        )}
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
      title={`Riwayat pelunasan ${kasbon.kasbonNumber}`}
      description={`${kasbon.employeeName} · ${formatUang(kasbon.amount)} · sisa ${formatUang(kasbon.sisa)}`}
      className="w-[520px]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      <div className="space-y-2">
        {kasbon.repayments.length === 0 && <p className="text-[13px] text-ink3">Belum ada pelunasan.</p>}
        {kasbon.repayments.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
            <div className="min-w-0 text-[13px]">
              <p className="font-medium text-ink">
                <Uang value={r.amount} /> · {r.method === "TUNAI" ? "Tunai/transfer" : "Potong gaji"}
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
