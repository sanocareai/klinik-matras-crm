// Pembayaran pada job pengiriman — DRIVER TIDAK LAGI MENCATAT PEMBAYARAN
// (keputusan Owner 7 Okt 2026). Sebelumnya (D-011, 10 Sep 2026) driver boleh
// mencatat uang tunai dari customer; kasus nyata 6 Okt: driver mengetik "1"
// untuk order Rp1.200.000 dan langsung masuk Uang Kas. Pembayaran/DP sekarang
// dicatat Sales (atau Finance). Komponen ini HANYA MENAMPILKAN pembayaran
// yang sudah tercatat pada job ini + pengingat — port 1:1 dari
// frontend/src/pages/DriverJobs.jsx#PaymentSection (web), supaya app dan web
// konsisten. Server juga menolak (POST /armada/jobs/:id/payment → 403
// PEMBAYARAN_BUKAN_UNTUK_DRIVER, lihat backend/routes/armada.js), jadi APK
// lama yang belum menerima OTA ini pun tidak bisa mencatat apa pun lagi.
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Wallet } from "lucide-react-native";
import { formatRupiah } from "../lib/jobHelpers";
import { useTheme } from "../hooks/useTheme";

const PAYMENT_METHODS = [
  { value: "CASH", label: "Tunai" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "QRIS", label: "QRIS" },
];

export default function PaymentSection({ job }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.wrap}>
      {job.payments?.length > 0 && (
        <View style={{ gap: 6, marginBottom: 10 }}>
          {job.payments.map((p) => (
            <View key={p.id} style={styles.row}>
              <Text style={styles.amount}>{formatRupiah(p.amount)}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.method}>{PAYMENT_METHODS.find((m) => m.value === p.method)?.label || p.method}</Text>
                {p.verifications?.length > 0 && (
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedText}>Terverifikasi</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
      <View style={styles.reminder} testID="driver-tanpa-catat-bayar">
        <Wallet size={14} color={theme.INK2} style={{ marginTop: 1 }} />
        <Text style={styles.reminderText}>
          Pembayaran dicatat oleh Sales. Bila customer membayar tunai kepadamu, segera laporkan ke Sales order ini — jangan dicatat sendiri di aplikasi.
        </Text>
      </View>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    wrap: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.BORDER },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      backgroundColor: t.FIELD_BG, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    },
    amount: { color: t.INK, fontWeight: "700", fontSize: 12.5 },
    method: { color: t.INK2, fontSize: 11 },
    verifiedBadge: { backgroundColor: t.GREEN + "26", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
    verifiedText: { color: t.GREEN, fontSize: 10.5, fontWeight: "600" },
    reminder: {
      flexDirection: "row", alignItems: "flex-start", gap: 7,
      backgroundColor: t.FIELD_BG, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9,
    },
    reminderText: { flex: 1, color: t.INK2, fontSize: 11.5, lineHeight: 16 },
  });
}
