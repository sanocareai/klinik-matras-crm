// "Catat Pembayaran" dari foto di chat (2 Okt 2026) — paritas web: frontend/src/features/inbox/components/ChatWindow/CatatPembayaranDariChat.jsx.
// Sales menekan foto bukti transfer → pilih order → foto itu otomatis jadi Bukti Pembayaran pada draf klaim → sheet klaim biasa terbuka untuk
// VERIFIKASI (nominal, tanggal, rekening, catatan) → Sales mengajukan → Finance memverifikasi. Aturan klaim tetap di server
// (backend/src/services/finance/klaimDariChat.js); di sini hanya pemilih order + penyambung.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { BadgeCheck, X } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { formatRupiah } from "../utils/format";
import { KlaimLunasSheet } from "./order/OrderKlaimLunas";

const LABEL_KATEGORI = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Kasur Baru" };

function kunciUnik() {
  return `dari-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function CatatPembayaranDariChat({ message, customerName, onClose }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [tahap, setTahap] = useState("memuat"); // memuat | pilih | menyiapkan | sheet | galat
  const [daftar, setDaftar] = useState([]);
  const [galat, setGalat] = useState("");
  const [orderTerpilih, setOrderTerpilih] = useState(null);
  const sudahOtomatis = useRef(false);

  async function lampirkan(order) {
    setTahap("menyiapkan"); setGalat("");
    try {
      await api.lampirkanBuktiDariPesan(order.id, message.id, kunciUnik());
      setOrderTerpilih(order);
      setTahap("sheet");
    } catch (e) {
      setGalat(e.message || "Gagal menyiapkan klaim dari foto ini");
      setTahap("galat");
    }
  }

  useEffect(() => {
    let batal = false;
    api.getKandidatOrderDariPesan(message.id).then((r) => {
      if (batal) return;
      const order = r.order || [];
      setDaftar(order);
      const bisa = order.filter((o) => o.bolehDiklaim || o.klaimAktifId);
      // Hanya satu order milik pelanggan ini dan bisa diklaim → langsung lanjut tanpa langkah memilih.
      if (bisa.length === 1 && order.length === 1 && !sudahOtomatis.current) { sudahOtomatis.current = true; lampirkan(bisa[0]); } else setTahap("pilih");
    }).catch((e) => { if (!batal) { setGalat(e.message || "Gagal memuat order pelanggan"); setTahap("galat"); } });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  if (tahap === "sheet" && orderTerpilih) {
    return <KlaimLunasSheet order={{ id: orderTerpilih.id, orderNumber: orderTerpilih.orderNumber, dpTarget: null }} onClose={onClose} onChanged={() => {}} />;
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => tahap !== "menyiapkan" && onClose()}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Catat Pembayaran dari Foto</Text>
              {customerName ? <Text style={styles.sub} numberOfLines={1}>Pelanggan: {customerName}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} disabled={tahap === "menyiapkan"} accessibilityLabel="Tutup"><X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} /></TouchableOpacity>
          </View>

          {(tahap === "memuat" || tahap === "menyiapkan") && (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.color.accent} />
              <Text style={styles.muted}>{tahap === "memuat" ? "Memuat order pelanggan…" : "Melampirkan foto sebagai bukti…"}</Text>
            </View>
          )}

          {tahap === "galat" && (
            <View style={{ gap: 12 }}>
              <Text style={styles.error}>{galat}</Text>
              <TouchableOpacity style={styles.ghost} onPress={onClose}><Text style={styles.ghostText}>Tutup</Text></TouchableOpacity>
            </View>
          )}

          {tahap === "pilih" && (
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.muted}>
                Foto ini akan dilampirkan sebagai Bukti Pembayaran. Di langkah berikutnya Anda mencocokkan nominal & tanggal dengan mutasi rekening sebelum mengajukan DP / Lunas ke Finance.
              </Text>
              {daftar.length === 0 && <Text style={[styles.muted, { textAlign: "center", marginTop: 20 }]}>Pelanggan ini belum punya order yang bisa dicatat pembayarannya.</Text>}
              {daftar.map((o) => {
                const aktif = o.bolehDiklaim || !!o.klaimAktifId;
                return (
                  <TouchableOpacity key={o.id} style={[styles.row, !aktif && { opacity: 0.5 }]} disabled={!aktif} onPress={() => lampirkan(o)}>
                    <BadgeCheck size={18} color={tokens.color.accent} strokeWidth={2} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{o.orderNumber || "Order tanpa nomor"} · {LABEL_KATEGORI[o.category] || o.category}</Text>
                      <Text style={styles.rowSub}>Tagihan {formatRupiah(o.tagihan)} · Sisa {formatRupiah(o.sisa)}</Text>
                      {o.klaimAktifId ? <Text style={[styles.rowSub, { color: tokens.color.accent }]}>Ada klaim berjalan — foto ditambahkan ke klaim itu</Text> : null}
                      {!aktif && o.alasanTidakBisa ? <Text style={styles.rowSub}>{o.alasanTidakBisa}</Text> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(t) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: { backgroundColor: t.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 24 },
    header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
    title: { fontWeight: "700", fontSize: 15, color: t.color.textPrimary },
    sub: { fontSize: 12, color: t.color.textMuted, marginTop: 2 },
    center: { alignItems: "center", paddingVertical: 28, gap: 10 },
    muted: { fontSize: 12, lineHeight: 17, color: t.color.textSecondary, marginBottom: 8 },
    error: { fontSize: 13, color: t.color.danger || "#DC2626" },
    ghost: { height: 44, borderRadius: 12, backgroundColor: t.color.subtle, alignItems: "center", justifyContent: "center" },
    ghostText: { fontSize: 14, fontWeight: "600", color: t.color.textSecondary },
    row: {
      flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, paddingHorizontal: 12, marginTop: 8,
      borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.color.border, backgroundColor: t.color.subtle,
    },
    rowTitle: { fontSize: 14, fontWeight: "600", color: t.color.textPrimary },
    rowSub: { fontSize: 12, color: t.color.textMuted, marginTop: 2 },
  });
}
