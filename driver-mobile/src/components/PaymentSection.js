// Catat pembayaran COD/pelunasan — port dari PaymentSection di web
// DriverJobs.jsx (D-011). HANYA untuk job DELIVERY yang sudah COMPLETED.
// Customer kadang bayar cash langsung ke driver saat kasur diantar; ini
// satu-satunya jejak audit kas yang ada — dibuat semudah mungkin: jumlah +
// metode, foto WAJIB kalau tunai (bukti serah terima uang), opsional utk
// transfer/QRIS. Gap yang dilaporkan owner (10 Sep 2026): fitur ini sudah
// ada di backend+web sejak lama, tapi belum pernah ada di app RN.
import React, { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet } from "react-native";
import { Wallet, BadgeCheck, Loader2 } from "lucide-react-native";
import PhotoCapture from "./PhotoCapture";
import { api } from "../api";
import { formatRupiah } from "../lib/jobHelpers";

const INK = "#F5F5F7";
const INK2 = "rgba(245,245,247,0.62)";
const INK3 = "rgba(245,245,247,0.40)";
const ACCENT = "#4C8DFF";
const GREEN = "#30D158";
const RED = "#FF453A";

const PAYMENT_METHODS = [
  { value: "CASH", label: "Tunai" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "QRIS", label: "QRIS" },
];

export default function PaymentSection({ job, onChanged }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function simpan() {
    const amountInt = parseInt(amount, 10);
    if (!amountInt || amountInt <= 0) { setErr("Jumlah wajib diisi"); return; }
    if (method === "CASH" && photos.length === 0) { setErr("Foto bukti wajib untuk pembayaran tunai"); return; }
    setBusy(true);
    setErr("");
    try {
      let proofPhotoUrl = null;
      if (photos.length > 0) {
        const { urls } = await api.uploadJobPhotos(job.id, [photos[0]]);
        proofPhotoUrl = urls[0] || null;
      }
      await api.recordJobPayment(job.id, { amount: amountInt, method, proofPhotoUrl });
      setOpen(false);
      setAmount("");
      setMethod("CASH");
      setPhotos([]);
      onChanged();
    } catch (e) {
      setErr(e.message || "Gagal menyimpan pembayaran");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {job.payments?.length > 0 && (
        <View style={{ gap: 6, marginBottom: open ? 10 : 0 }}>
          {job.payments.map((p) => (
            <View key={p.id} style={styles.row}>
              <Text style={styles.amount}>{formatRupiah(p.amount)}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.method}>{PAYMENT_METHODS.find((m) => m.value === p.method)?.label || p.method}</Text>
                {p.verifications?.length > 0 && (
                  <View style={styles.verifiedBadge}>
                    <BadgeCheck size={11} color={GREEN} />
                    <Text style={styles.verifiedText}>Terverifikasi</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {!open && (
        <Pressable style={styles.openBtn} onPress={() => setOpen(true)}>
          <Wallet size={14} color={ACCENT} />
          <Text style={styles.openBtnText}>Catat Pembayaran</Text>
        </Pressable>
      )}

      {open && (
        <View style={{ gap: 8 }}>
          <TextInput
            style={styles.input}
            placeholder="Jumlah diterima (Rp)"
            placeholderTextColor={INK3}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            editable={!busy}
          />
          <View style={styles.methodRow}>
            {PAYMENT_METHODS.map((m) => (
              <Pressable
                key={m.value}
                style={[styles.methodChip, method === m.value && styles.methodChipActive]}
                onPress={() => setMethod(m.value)}
              >
                <Text style={[styles.methodChipText, method === m.value && styles.methodChipTextActive]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          <PhotoCapture
            photos={photos}
            onChange={setPhotos}
            label={method === "CASH" ? "Foto bukti (wajib untuk tunai)" : "Foto bukti (opsional)"}
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <View style={styles.btnRow}>
            <Pressable
              style={[styles.secondaryBtn, { flex: 1 }]}
              disabled={busy}
              onPress={() => { setOpen(false); setErr(""); }}
            >
              <Text style={styles.secondaryBtnText}>Batal</Text>
            </Pressable>
            <Pressable style={[styles.primaryBtn, { flex: 1.4 }, busy && styles.disabled]} disabled={busy} onPress={simpan}>
              {busy ? <Loader2 size={14} color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Simpan</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  amount: { color: INK, fontWeight: "700", fontSize: 12.5 },
  method: { color: INK2, fontSize: 11 },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  verifiedText: { color: GREEN, fontSize: 10.5, fontWeight: "600" },
  openBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    height: 40, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  openBtnText: { color: ACCENT, fontWeight: "600", fontSize: 12.5 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: INK, fontSize: 14,
  },
  methodRow: { flexDirection: "row", gap: 6 },
  methodChip: {
    flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  methodChipActive: { borderColor: ACCENT, backgroundColor: "rgba(76,141,255,0.12)" },
  methodChipText: { color: INK2, fontSize: 11.5, fontWeight: "600" },
  methodChipTextActive: { color: ACCENT },
  err: { color: RED, fontSize: 11.5 },
  btnRow: { flexDirection: "row", gap: 8 },
  secondaryBtn: {
    alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  secondaryBtnText: { color: INK2, fontWeight: "600", fontSize: 12.5 },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: 10, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12.5 },
  disabled: { opacity: 0.5 },
});
