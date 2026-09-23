import React, { useEffect } from "react";
import { Field } from "@/components/ui/field.jsx";
import { InputUang, Pilihan, formatUang } from "@/features/finance/shared.jsx";
import {
  JENIS_BIAYA_TRANSFER, adalahRekeningBank, nilaiAwalBiaya, presetRekening, pratinjauBiaya,
} from "@/features/finance/biayaTransfer.js";

/**
 * Pilihan Cara Bayar + metode transfer untuk form yang mengeluarkan uang.
 * Hanya tampil untuk rekening bank/e-wallet; kas tunai otomatis "Tunai".
 * `value` = {paymentMethod, transferFeeType, transferFeeAmount}; `onChange`
 * menerima objek nilai BARU penuh. Angka di sini pratinjau — server menghitung ulang.
 */
export default function CaraBayarTransfer({ rekening, nominal, value, onChange }) {
  const id = rekening?.id;
  // Ganti rekening -> nilai awal mengikuti jenis rekening (kas = Tunai, bank = Transfer).
  useEffect(() => { onChange(nilaiAwalBiaya(rekening)); /* eslint-disable-next-line */ }, [id]);
  // Form yang di-reset dari luar (mis. modal dibuka ulang) mengosongkan nilai — isi lagi dari rekening yang sudah terpilih.
  useEffect(() => {
    if (rekening && !value.paymentMethod) onChange(nilaiAwalBiaya(rekening));
    /* eslint-disable-next-line */
  }, [rekening, value.paymentMethod]);

  if (!rekening || !adalahRekeningBank(rekening)) return null;

  const preset = presetRekening(rekening);
  const p = pratinjauBiaya(rekening, value, nominal);
  const set = (patch) => onChange({ ...value, ...patch });
  const transfer = value.paymentMethod === "TRANSFER";

  return (
    <div className="space-y-3 rounded-lg bg-inset p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Cara bayar" required>
          <Pilihan value={value.paymentMethod} onChange={(v) => onChange({ ...nilaiAwalBiaya(rekening), paymentMethod: v })}>
            <option value="TRANSFER">Transfer</option>
            <option value="TUNAI">Tunai / tanpa biaya transfer</option>
          </Pilihan>
        </Field>
        {transfer && (
          <Field label="Metode transfer" required hint="Mengisi biaya admin otomatis">
            <Pilihan value={value.transferFeeType} onChange={(v) => set({ transferFeeType: v, transferFeeAmount: "" })}>
              <option value="">— pilih —</option>
              {JENIS_BIAYA_TRANSFER.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.label}{j.code !== "LAINNYA" ? ` (${formatUang(preset[j.code])})` : ""}
                </option>
              ))}
            </Pilihan>
          </Field>
        )}
      </div>

      {transfer && value.transferFeeType === "LAINNYA" && (
        <Field label="Biaya admin (custom)" required>
          <InputUang value={value.transferFeeAmount} onChange={(v) => set({ transferFeeAmount: v })} />
        </Field>
      )}

      {transfer && (
        <dl className="space-y-1 text-[13px]">
          <div className="flex justify-between gap-3"><dt className="text-ink2">Nominal diterima</dt><dd className="tabular-nums text-ink">{formatUang(p.nominalDiterima)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink2">Biaya admin</dt><dd className="tabular-nums text-ink">{formatUang(p.biayaAdmin)}</dd></div>
          <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold"><dt className="text-ink">Total keluar rekening</dt><dd className="tabular-nums text-ink">{formatUang(p.totalKeluarRekening)}</dd></div>
          <p className="pt-1 text-xs text-ink3">Biaya admin dicatat sebagai baris beban terpisah pada transaksi yang sama. Angka final dihitung server.</p>
        </dl>
      )}
    </div>
  );
}
