import React, { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { Pilihan, InputUang, TombolAksi, formatUang, tanggalPendek, tanggalJam } from "@/features/finance/shared.jsx";

// EDIT & KOREKSI TRANSAKSI AMAN — potongan bersama.
//
// Aturan (ditegakkan backend; UI hanya menampilkan):
//  • Belum berjurnal  -> "Edit": ubah bebas, tidak ada jurnal yang disentuh.
//  • Sudah berjurnal  -> "Koreksi": jurnal lama DIBALIK (bukan diubah/dihapus) + jurnal pengganti, satu transaksi DB.
//    Sebelum menyimpan, pengguna melihat PRATINJAU dari server (nilai lama vs baru, jurnal yang dibalik,
//    jurnal pengganti, dampak saldo rekening). Menyimpan butuh PIN Finance (step-up, berlaku 5 menit).

// ─── Token step-up (hanya di memori halaman, tidak pernah ditulis ke penyimpanan peramban) ────────
let tokenStepUp = null;
export const tokenTersimpan = () => (tokenStepUp && tokenStepUp.sampai > Date.now() + 5000 ? tokenStepUp.token : null);
export const lupakanStepUp = () => { tokenStepUp = null; };
const simpanToken = (t) => { tokenStepUp = { token: t.token, sampai: Date.now() + (t.berlakuDetik || 300) * 1000 }; };

const KODE_PERLU_PIN = ["STEPUP_DIPERLUKAN", "STEPUP_PIN_BELUM_DIATUR"];
export const perluPin = (e) => KODE_PERLU_PIN.includes(e?.code);

// ─── Kartu PIN untuk Pengaturan Finance ───────────────────────────────────────
export function KartuPinFinance() {
  const [status, setStatus] = useState(null);
  const [ubah, setUbah] = useState(false);
  const [pesan, setPesan] = useState("");
  const muat = useCallback(async () => { try { setStatus(await api.getFinancePinStatus()); } catch (e) { setPesan(e.message); } }, []);
  useEffect(() => { muat(); }, [muat]);

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-ink2">
        PIN Finance diminta saat Anda <strong>mengoreksi transaksi yang sudah masuk buku besar</strong>. Ini lapis pengaman
        tambahan: sesi login yang tertinggal terbuka tidak cukup untuk mengubah angka keuangan.
      </p>
      {status && (
        <p className="text-[13px] text-ink2">
          Status: {status.sudahDiatur
            ? <>PIN sudah diatur{status.diaturPada ? <> ({tanggalJam(status.diaturPada)})</> : null}.</>
            : <strong>PIN belum diatur.</strong>}
          {status.terkunciSampai && <> Terkunci sampai {tanggalJam(status.terkunciSampai)} karena salah PIN berulang.</>}
        </p>
      )}
      {pesan && <p className="text-[13px] text-red">{pesan}</p>}
      {ubah ? (
        <FormAturPinLengkap onSelesai={() => { setUbah(false); muat(); }} onBatal={() => setUbah(false)} />
      ) : (
        <Button size="sm" variant="outline" onClick={() => setUbah(true)}>{status?.sudahDiatur ? "Ganti PIN" : "Atur PIN"}</Button>
      )}
    </div>
  );
}

function FormAturPinLengkap({ onSelesai, onBatal }) {
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [ulang, setUlang] = useState("");
  const [galat, setGalat] = useState("");
  const valid = password && /^\d{6}$/.test(pin) && pin === ulang;
  async function simpan() {
    setGalat("");
    try { await api.setFinancePin(password, pin); onSelesai(); } catch (e) { setGalat(e.message); }
  }
  return (
    <div className="max-w-md space-y-3">
      <Field label="Password login Anda" required><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="PIN baru (6 angka)" required><Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Ulangi PIN" required><Input type="password" inputMode="numeric" maxLength={6} value={ulang} onChange={(e) => setUlang(e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      {pin && ulang && pin !== ulang && <p className="text-[12px] text-red">PIN dan ulangannya belum sama.</p>}
      {galat && <p className="text-[13px] text-red">{galat}</p>}
      <div className="flex gap-2">
        <Button variant="neutral" size="sm" onClick={onBatal}>Batal</Button>
        <TombolAksi onClick={simpan} disabled={!valid}>Simpan PIN</TombolAksi>
      </div>
    </div>
  );
}

// ─── Dialog PIN step-up ──────────────────────────────────────────────────────
function DialogPin({ onSelesai }) {
  const [status, setStatus] = useState(null);
  const [pin, setPin] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  // Pengaturan PIN pertama kali: password + PIN baru, lalu langsung diverifikasi.
  const [password, setPassword] = useState("");
  const [pinBaru, setPinBaru] = useState("");
  const [ulang, setUlang] = useState("");

  useEffect(() => {
    api.getFinancePinStatus().then(setStatus).catch((e) => setGalat(e.message));
  }, []);

  async function verifikasi(nilaiPin) {
    setSibuk(true); setGalat("");
    try {
      const t = await api.verifyFinancePin(nilaiPin);
      simpanToken(t);
      onSelesai(t.token);
    } catch (e) {
      setGalat(e.message);
      setPin("");
    } finally {
      setSibuk(false);
    }
  }

  async function aturLaluVerifikasi() {
    setSibuk(true); setGalat("");
    try {
      await api.setFinancePin(password, pinBaru);
    } catch (e) {
      setGalat(e.message); setSibuk(false); return;
    }
    setSibuk(false);
    await verifikasi(pinBaru);
  }

  const belumAtur = status && !status.sudahDiatur;
  const validBaru = password && /^\d{6}$/.test(pinBaru) && pinBaru === ulang;

  return (
    <Modal
      open onOpenChange={(v) => !v && onSelesai(null)}
      title="Konfirmasi PIN Finance"
      description={belumAtur ? "Atur PIN Finance dulu — hanya sekali." : "Koreksi transaksi yang sudah masuk buku besar butuh PIN Anda."}
      className="w-[420px]"
      footer={
        <>
          <Button variant="neutral" onClick={() => onSelesai(null)} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          {belumAtur
            ? <Button onClick={aturLaluVerifikasi} disabled={!validBaru || sibuk} className="max-sm:min-h-11 max-sm:px-4">Atur PIN & Lanjut</Button>
            : <Button onClick={() => verifikasi(pin)} disabled={!/^\d{6}$/.test(pin) || sibuk || Boolean(status?.terkunciSampai)} className="max-sm:min-h-11 max-sm:px-4">Konfirmasi</Button>}
        </>
      }
    >
      <div className="space-y-3">
        {!status && !galat && <p className="text-[13px] text-ink3">Memeriksa status PIN…</p>}
        {status?.terkunciSampai && <p className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">PIN terkunci sampai {tanggalJam(status.terkunciSampai)} karena salah berulang kali.</p>}
        {belumAtur && (
          <>
            <Field label="Password login Anda" required><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="PIN baru (6 angka)" required><Input type="password" inputMode="numeric" maxLength={6} value={pinBaru} onChange={(e) => setPinBaru(e.target.value.replace(/\D/g, ""))} /></Field>
              <Field label="Ulangi PIN" required><Input type="password" inputMode="numeric" maxLength={6} value={ulang} onChange={(e) => setUlang(e.target.value.replace(/\D/g, ""))} /></Field>
            </div>
          </>
        )}
        {status?.sudahDiatur && (
          <Field label="PIN Finance (6 angka)" required>
            <Input
              type="password" inputMode="numeric" maxLength={6} autoFocus autoComplete="off" value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && /^\d{6}$/.test(pin) && !sibuk) verifikasi(pin); }}
            />
          </Field>
        )}
        {galat && <p className="text-[13px] text-red">{galat}</p>}
      </div>
    </Modal>
  );
}

/** Hook: `const { minta, dialogPin } = usePinStepUp()` — `await minta()` mengembalikan token atau null (dibatalkan). */
export function usePinStepUp() {
  const [terbuka, setTerbuka] = useState(false);
  const resolver = useRef(null);
  const minta = useCallback(() => {
    const t = tokenTersimpan();
    if (t) return Promise.resolve(t);
    return new Promise((res) => { resolver.current = res; setTerbuka(true); });
  }, []);
  const selesai = useCallback((token) => {
    setTerbuka(false);
    resolver.current?.(token || null);
    resolver.current = null;
  }, []);
  return { minta, dialogPin: terbuka ? <DialogPin onSelesai={selesai} /> : null };
}

/**
 * Kirim koreksi dengan PIN: minta token, panggil, dan kalau server bilang token kedaluwarsa/belum sah, minta ulang SEKALI.
 * Mengembalikan hasil API, atau `null` kalau pengguna membatalkan dialog PIN.
 */
export async function kirimKoreksi({ minta, jenis, id, body }) {
  for (let percobaan = 0; percobaan < 2; percobaan++) {
    const token = await minta();
    if (!token) return null;
    try {
      return await api.koreksiFinanceDoc(jenis, id, body, token);
    } catch (e) {
      if (perluPin(e) && percobaan === 0) { lupakanStepUp(); continue; }
      throw e;
    }
  }
  return null;
}

// ─── Pratinjau ───────────────────────────────────────────────────────────────
export const LABEL_FIELD = {
  date: "Tanggal", amount: "Nominal", description: "Keterangan", categoryId: "Kategori", division: "Divisi",
  cashAccountId: "Rekening", payeeName: "Penerima", reimburseToId: "Penalang", paymentMethod: "Cara bayar",
  transferFeeType: "Metode transfer", transferFeeAmount: "Biaya transfer", fromAccountId: "Dari rekening",
  toAccountId: "Ke rekening", feeAmount: "Biaya admin", reference: "Referensi", notes: "Catatan",
  accountId: "Akun pendapatan", attachmentUrl: "Lampiran", receiptUrl: "Bukti", supplierId: "Supplier", mode: "Cara bayar",
};
const FIELD_UANG = new Set(["amount", "feeAmount", "transferFeeAmount"]);
const FIELD_TANGGAL = new Set(["date"]);

/** Tampilkan nilai; `resolusi(field, nilai)` (opsional) menerjemahkan id -> nama. */
export function tampilNilai(field, v, resolusi) {
  if (v === null || v === undefined || v === "") return "—";
  const r = resolusi?.(field, v);
  if (r) return r;
  if (FIELD_UANG.has(field)) return formatUang(Number(v));
  if (FIELD_TANGGAL.has(field)) return tanggalPendek(v);
  if (/Url$/.test(field)) return "(lampiran)";
  return String(v);
}

function TabelJurnal({ judul, jurnal, tone }) {
  if (!jurnal?.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">{judul}</div>
      {jurnal.map((j) => (
        <div key={j.id} className="overflow-x-auto rounded-lg bg-inset px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
            <span className="font-mono">{j.nomor}</span>
            <Badge variant={tone}>{tone === "red" ? "Dibalik" : "Baru"}</Badge>
          </div>
          <table className="w-full min-w-[300px] text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink3">
                <th className="py-0.5 pr-2 font-medium">Akun</th>
                <th className="w-24 py-0.5 text-right font-medium">Debit</th>
                <th className="w-24 py-0.5 text-right font-medium">Kredit</th>
              </tr>
            </thead>
            <tbody>
              {j.baris.map((b, i) => (
                <tr key={i}>
                  <td className="py-0.5 pr-2">{b.akun}{b.rekening ? <span className="text-ink3"> · {b.rekening}</span> : null}</td>
                  <td className="w-24 py-0.5 text-right tabular-nums">{b.debit ? formatUang(b.debit) : ""}</td>
                  <td className="w-24 py-0.5 text-right tabular-nums">{b.kredit ? formatUang(b.kredit) : ""}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-medium">
                <td className="py-0.5 pr-2">Total</td>
                <td className="py-0.5 text-right tabular-nums">{formatUang(j.totalDebit)}</td>
                <td className="py-0.5 text-right tabular-nums">{formatUang(j.totalKredit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function PratinjauKoreksi({ pratinjau, resolusi }) {
  if (!pratinjau) return null;
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Yang berubah</div>
        <div className="space-y-1">
          {pratinjau.perubahan.map((p) => (
            <div key={p.field} className="grid grid-cols-1 gap-x-3 rounded-lg bg-inset px-3 py-2 text-[12.5px] sm:grid-cols-[130px_1fr]">
              <div className="text-ink3">{LABEL_FIELD[p.field] || p.field}</div>
              <div className="flex flex-wrap items-center gap-x-2 break-words">
                <span className="text-ink3 line-through">{tampilNilai(p.field, p.lama, resolusi)}</span>
                <ArrowRight size={12} className="shrink-0 text-ink3" />
                <span className="font-medium">{tampilNilai(p.field, p.baru, resolusi)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {pratinjau.menyentuhJurnal ? (
        <>
          <TabelJurnal judul="Jurnal yang dibalik (tetap tersimpan sebagai riwayat)" jurnal={pratinjau.jurnalDibalik} tone="red" />
          <TabelJurnal judul="Jurnal pengganti" jurnal={pratinjau.jurnalPengganti} tone="green" />
          {pratinjau.dampakSaldo.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Dampak saldo rekening</div>
              <div className="space-y-1">
                {pratinjau.dampakSaldo.map((d) => (
                  <div key={d.rekeningId} className="flex flex-wrap items-center justify-between gap-x-3 rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                    <span>{d.rekening}</span>
                    <span className="tabular-nums">{formatUang(d.sebelum)} <ArrowRight size={11} className="inline" /> <strong>{formatUang(d.sesudah)}</strong>
                      <span className={d.selisih < 0 ? "ml-2 text-red" : "ml-2 text-green"}>({d.selisih > 0 ? "+" : ""}{formatUang(d.selisih)})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className={`text-[12px] ${pratinjau.seimbang ? "text-green" : "text-red"}`}>
            {pratinjau.seimbang ? "Jurnal pengganti seimbang (debit = kredit)." : "Jurnal pengganti TIDAK seimbang — jangan lanjutkan."}
          </p>
        </>
      ) : (
        <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] text-ink2">Perubahan ini tidak menyentuh buku besar: tidak ada jurnal dibalik dan saldo rekening tidak berubah.</p>
      )}
    </div>
  );
}

// ─── Riwayat versi ───────────────────────────────────────────────────────────
export function RiwayatVersiDialog({ jenis, id, nomor, onClose, resolusi }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  useEffect(() => {
    api.getFinanceRiwayatVersi(jenis, id).then(setData).catch((e) => setGalat(e.message));
  }, [jenis, id]);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Riwayat perubahan ${nomor || ""}`.trim()}
      description="Siapa mengubah apa, kapan, dan mengapa — beserta rantai jurnalnya."
      className="w-[640px]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
    >
      {galat && <p className="text-[13px] text-red">{galat}</p>}
      {!data && !galat && <p className="text-[13px] text-ink3">Memuat…</p>}
      {data && (
        <div className="space-y-4">
          <div className="space-y-2">
            {data.versi.length === 0 && <p className="text-[13px] text-ink3">Belum ada riwayat.</p>}
            {data.versi.map((v, i) => (
              <div key={i} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  <span className="font-medium">{v.aksi}{v.otomatis ? " (otomatis)" : ""}</span>
                  <span className="text-ink3">{tanggalJam(v.waktu)} · {v.aktor}</span>
                </div>
                {v.alasan && <p className="mt-0.5 text-ink2">Alasan: {v.alasan}</p>}
                {v.perubahan?.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {v.perubahan.map((p) => (
                      <li key={p.field} className="break-words">
                        <span className="text-ink3">{LABEL_FIELD[p.field] || p.field}:</span>{" "}
                        <span className="line-through text-ink3">{tampilNilai(p.field, p.lama, resolusi)}</span> → <strong>{tampilNilai(p.field, p.baru, resolusi)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {data.jurnal.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Rantai jurnal</div>
              <div className="space-y-1">
                {data.jurnal.map((j) => (
                  <div key={j.id} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono">{j.nomor}</span>
                      <Badge variant={j.status === "REVERSED" ? "red" : "green"}>{j.status === "REVERSED" ? "Dibalik" : "Aktif"}</Badge>
                    </div>
                    <div className="text-ink3">{tanggalPendek(j.tanggal)} · {j.deskripsi}</div>
                    {j.membalikJurnal && <div className="text-ink2">Membalik {j.membalikJurnal}</div>}
                    {j.dibalikOleh && <div className="text-ink2">Dibalik oleh {j.dibalikOleh}{j.alasanBalik ? ` — ${j.alasanBalik}` : ""}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Dialog Koreksi generik (transfer, pemasukan lain) ───────────────────────
// `kolom`: [{ kunci, label, tipe: "teks"|"uang"|"tanggal"|"pilih", opsi?: [{id,name}], wajib? }]
// `awal`: nilai awal per kunci. Hanya kolom yang BERUBAH yang dikirim.
export function KoreksiDialog({ jenis, doc, nomor, judulRingkas, kolom, awal, onClose, onSaved, resolusi }) {
  const [f, setF] = useState(awal);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [pratinjau, setPratinjau] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const { minta, dialogPin } = usePinStepUp();

  const beda = {};
  for (const k of kolom) {
    const a = awal[k.kunci], b = f[k.kunci];
    const sama = k.tipe === "uang" ? Number(a) === Number(b) : (a || "") === (b || "");
    if (!sama) beda[k.kunci] = k.tipe === "uang" ? Number(b) : b;
  }
  const adaPerubahan = Object.keys(beda).length > 0;
  const wajibTerisi = kolom.every((k) => !k.wajib || (k.tipe === "uang" ? Number(f[k.kunci]) > 0 : f[k.kunci]));
  const valid = adaPerubahan && wajibTerisi && alasan.trim();

  async function tinjau() {
    setGalat(""); setSibuk(true);
    try {
      const r = await api.koreksiFinanceDoc(jenis, doc.id, { ...beda, reason: alasan.trim(), preview: true });
      setPratinjau(r.pratinjau);
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  async function simpan() {
    setGalat(""); setSibuk(true);
    try {
      const r = await kirimKoreksi({ minta, jenis, id: doc.id, body: { ...beda, reason: alasan.trim() } });
      if (r) onSaved();
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); setPratinjau(null); };

  return (
    <>
      <Modal
        open onOpenChange={(v) => !v && onClose()}
        title={`Koreksi ${nomor}`}
        description={judulRingkas}
        className="w-[600px]"
        footer={
          <>
            <Button variant="neutral" onClick={pratinjau ? () => setPratinjau(null) : onClose} className="max-sm:min-h-11 max-sm:px-4">{pratinjau ? "Kembali" : "Batal"}</Button>
            {pratinjau
              ? <Button onClick={simpan} disabled={sibuk || !pratinjau.seimbang} className="max-sm:min-h-11 max-sm:px-4"><ShieldCheck size={14} />Konfirmasi Koreksi</Button>
              : <Button onClick={tinjau} disabled={!valid || sibuk} className="max-sm:min-h-11 max-sm:px-4">Lihat Pratinjau</Button>}
          </>
        }
      >
        <div className="space-y-3">
          {pratinjau ? (
            <>
              <p className="text-[12.5px] text-ink2"><strong>Alasan:</strong> {alasan}</p>
              <PratinjauKoreksi pratinjau={pratinjau} resolusi={resolusi} />
              <p className="text-[12px] text-ink3">Menyimpan akan meminta PIN Finance Anda.</p>
            </>
          ) : (
            <>
              <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
                Transaksi ini sudah masuk buku besar. Koreksi akan MEMBALIK jurnal lama dan memposting jurnal pengganti — jurnal lama tetap tersimpan sebagai riwayat, tidak dihapus.
              </p>
              {kolom.map((k) => (
                <Field key={k.kunci} label={k.label} required={k.wajib}>
                  {k.tipe === "uang" ? <InputUang value={f[k.kunci]} onChange={(v) => set(k.kunci, v)} />
                    : k.tipe === "tanggal" ? <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f[k.kunci]} onChange={(v) => set(k.kunci, v)} />
                    : k.tipe === "pilih" ? (
                      <Pilihan value={f[k.kunci]} onChange={(v) => set(k.kunci, v)}>
                        <option value="">— pilih —</option>
                        {k.opsi.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </Pilihan>
                    ) : <Input value={f[k.kunci] || ""} onChange={(e) => set(k.kunci, e.target.value)} />}
                </Field>
              ))}
              <Field label="Alasan koreksi" required hint="Wajib — tercatat di riwayat audit">
                <Input value={alasan} onChange={(e) => { setAlasan(e.target.value); setPratinjau(null); }} placeholder="mis. salah ketik nominal / salah pilih rekening" />
              </Field>
              {!adaPerubahan && <p className="text-[12px] text-ink3">Ubah minimal satu kolom untuk melanjutkan.</p>}
            </>
          )}
          {galat && <p className="text-[13px] text-red">{galat}</p>}
        </div>
      </Modal>
      {dialogPin}
    </>
  );
}
