import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import PilihPenalang from "@/features/finance/PilihPenalang.jsx";
import {
  Pilihan, InputUang, TombolAksi, PemilihBukti, LABEL_DIVISI, formatUang,
} from "@/features/finance/shared.jsx";

// EDIT / KOREKSI Pengeluaran & Pembelian — SATU modal untuk keduanya.
//
// Aturan yang ditegakkan backend (UI hanya mengikuti):
//  • ALASAN selalu wajib, dicatat di riwayat audit.
//  • Belum disetujui (Draft/Menunggu)  → edit langsung (PATCH), belum ada jurnal.
//  • Sudah diposting (Disetujui/Dibayar) → Koreksi: kalau yang berubah
//    nominal/tanggal/kategori/rekening/dst, jurnal lama DIBALIK & jurnal baru
//    diposting (riwayat tetap ada). Kalau cuma foto/catatan, buku besar tidak disentuh.
//  • Verifikasi bukti gugur otomatis kalau nominal/tanggal/foto berubah.
//  • Cara bayar (mode) tidak bisa diubah — kalau salah, Batalkan lalu buat baru.

export const STATUS_BISA_DIEDIT = ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR"];
const STATUS_SUDAH_POSTING = ["DISETUJUI", "DIBAYAR"];
const FIELD_JURNAL = ["date", "amount", "description", "categoryId", "division", "cashAccountId", "payeeName", "reimburseToId"];

function awal(doc) {
  return {
    date: String(doc.date || "").slice(0, 10),
    amount: Number(doc.amount) || 0,
    description: doc.description || "",
    categoryId: doc.categoryId || "",
    division: doc.division || "UMUM",
    cashAccountId: doc.cashAccountId || "",
    payeeName: doc.payeeName || "",
    reimburseToId: doc.reimburseToId || "",
    notes: doc.notes || "",
    receiptUrl: doc.receiptUrl || "",
  };
}

export default function EditDokumen({ doc, jenis, kategori, rekening, onClose, onSaved }) {
  const asli = useMemo(() => (doc ? awal(doc) : null), [doc]);
  const [f, setF] = useState(asli);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");

  useEffect(() => { setF(asli); setAlasan(""); setGalat(""); }, [asli]);
  if (!doc || !f) return null;

  const nomor = doc.expenseNumber || doc.purchaseNumber;
  const sudahPosting = STATUS_SUDAH_POSTING.includes(doc.status);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const beda = {};
  for (const k of Object.keys(asli)) {
    const sama = k === "amount" ? Number(f[k]) === Number(asli[k]) : (f[k] || "") === (asli[k] || "");
    if (!sama) beda[k] = k === "amount" ? Number(f[k]) : f[k];
  }
  const adaPerubahan = Object.keys(beda).length > 0;
  const menyentuhJurnal = Object.keys(beda).some((k) => FIELD_JURNAL.includes(k));
  const valid = adaPerubahan && alasan.trim() && f.description.trim() && Number(f.amount) > 0 &&
    f.categoryId && (doc.mode !== "LANGSUNG" || f.cashAccountId);

  async function simpan() {
    setGalat("");
    try {
      const body = { ...beda, reason: alasan.trim() };
      await (sudahPosting
        ? api.koreksiFinanceDoc(jenis, doc.id, body)
        : api.editFinanceDoc(jenis, doc.id, body));
      onSaved();
    } catch (e) {
      setGalat(e.message);
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`${sudahPosting ? "Koreksi" : "Edit"} ${nomor}`}
      description={`${formatUang(doc.amount)} · ${doc.description}`}
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={simpan} disabled={!valid}>{sudahPosting ? "Simpan Koreksi" : "Simpan Perubahan"}</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        {sudahPosting && (
          <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
            Dokumen ini sudah masuk buku besar. {menyentuhJurnal
              ? "Perubahan yang Anda buat akan MEMBALIK jurnal lama dan memposting jurnal baru — jurnal lama tetap tersimpan sebagai riwayat, tidak dihapus."
              : "Kalau yang diubah cuma foto atau catatan, buku besar tidak disentuh sama sekali."}
          </p>
        )}

        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <Field label={jenis === "purchases" ? "Jenis pembelian" : "Kategori biaya"} required>
          <Pilihan value={f.categoryId} onChange={(v) => set("categoryId", v)}>
            <option value="">— pilih —</option>
            {kategori.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Pilihan>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Dibebankan ke divisi">
            <Pilihan value={f.division} onChange={(v) => set("division", v)}>
              {Object.entries(LABEL_DIVISI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Pilihan>
          </Field>
          {doc.mode === "LANGSUNG" && (
            <Field label="Uang keluar dari" required>
              <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
                <option value="">— pilih —</option>
                {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Pilihan>
            </Field>
          )}
        </div>
        {doc.mode === "REIMBURSEMENT" && (
          <PilihPenalang
            value={f.reimburseToId} onChange={(v) => set("reimburseToId", v)}
            saatIni={doc.reimburseTo ? { id: doc.reimburseTo.id || doc.reimburseToId, name: doc.reimburseTo.name } : null}
            kosongLabel="— pilih —"
          />
        )}
        <Field label={doc.mode === "REIMBURSEMENT" ? "Toko / pihak yang dibayar" : "Dibayarkan kepada"} hint={doc.mode === "REIMBURSEMENT" ? "Opsional — bukan penalang" : undefined}><Input value={f.payeeName} onChange={(e) => set("payeeName", e.target.value)} /></Field>
        <Field label="Foto nota / bukti" hint="Salah foto? Ganti di sini — verifikasi lama gugur, perlu diperiksa ulang">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>

        <Field label="Alasan perubahan" required hint="Wajib — tercatat di riwayat audit">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah ketik nominal / foto nota tertukar" />
        </Field>
        {!adaPerubahan && <p className="text-[12px] text-ink3">Ubah minimal satu kolom di atas untuk bisa menyimpan.</p>}
        {galat && <p className="text-[13px] text-red">{galat}</p>}
      </div>
    </Modal>
  );
}
