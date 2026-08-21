// "Rincian Pesanan" — paritas mobile (D-030, 21 Agustus 2026) dari
// frontend/src/features/orders/OrderTimelineDrawer.jsx (web). Dibuka lewat
// navigateToOrderTimeline() (lib/navigationRef.js) dari tombol "Rincian" di
// OrderCard.js, dipakai baik dari tab Order (lintas pelanggan) maupun dari
// profil 1 pelanggan — makanya screen ini SENGAJA fetch ulang datanya
// sendiri lewat orderId (bukan menerima seluruh object order lewat route
// params), supaya selalu dapat bentuk data yang sama persis dari kedua
// pemanggil.
//
// Scope v1 — BEDA dari web: upload bukti bayar (foto) dan "kirim
// dokumentasi ke customer" (checkbox + WAHA) BELUM ada di sini. Screen ini
// baru LIHAT riwayat status, LIHAT foto dokumentasi (buka via browser
// eksternal, bukan viewer in-app), dan CATAT pembayaran (teks doang, tanpa
// foto bukti). Kalau nanti dibutuhkan, itu scope terpisah — jangan
// dianggap "lupa".
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Linking, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeft, Clock, Camera, Wallet, Timer, ImageOff, PackageCheck, Wrench, Truck,
  CheckCircle2, Hash, Send, MapPin, Link2, Bed, Weight, HeartPulse, Banknote,
  CalendarClock, Tag, MessageSquareText,
} from "lucide-react-native";
import { api, mediaUrl } from "../api";
import { useTokens } from "../constants/theme";
import {
  formatRupiah, shortDate, shortDateWithYear, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
  HEALTH_LABELS, HEALTH_COMPLAINT_LABELS, parseOrderNotes, promoLabel,
} from "../utils/format";

const PAYMENT_METHOD_LABEL = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS" };
const TABS = [
  { key: "status", label: "Status", Icon: Clock },
  { key: "dokumentasi", label: "Dokumentasi", Icon: Camera },
  { key: "pembayaran", label: "Pembayaran", Icon: Wallet },
];
// Warna khas per kategori dokumentasi — sama pola dengan web (KATEGORI_TONE
// di OrderTimelineDrawer.jsx).
const KATEGORI = [
  { key: "PENJEMPUTAN", label: "Penjemputan", Icon: PackageCheck, hex: "#C2660A" },
  { key: "PRODUKSI",    label: "Proses Produksi", Icon: Wrench,   hex: "#2563EB" },
  { key: "PENGIRIMAN",  label: "Pengiriman", Icon: Truck,         hex: "#16A34A" },
];

// D-030 paritas penuh (22 Agustus 2026) — awalnya cuma Alamat + Link Lokasi
// yang ditambahkan (permintaan pertama), lalu diperluas ke SEMUA field yang
// sudah ada di DetailPesananSection web (OrderTimelineDrawer.jsx): Kasur &
// Layanan, Keluhan, Berat Badan, Kondisi Kesehatan, Ongkir, Jadwal Pick
// Up/Kirim, Promo. Semua field ini SUDAH ikut terbawa di GET /orders (tidak
// ada endpoint baru) — mobile cuma belum pernah merendernya.
const DETAIL_TONE = {
  address:  { Icon: MapPin,            hex: "#ea580c" },
  link:     { Icon: Link2,             hex: "#0891b2" },
  bed:      { Icon: Bed,               hex: "#7c3aed" },
  weight:   { Icon: Weight,            hex: "#2563eb" },
  note:     { Icon: MessageSquareText, hex: "#4b5563" },
  health:   { Icon: HeartPulse,        hex: "#dc2626" },
  money:    { Icon: Banknote,          hex: "#16a34a" },
  pickup:   { Icon: CalendarClock,     hex: "#0891b2" },
  delivery: { Icon: Truck,             hex: "#16a34a" },
  promo:    { Icon: Tag,               hex: "#db2777" },
};

function DetailRow({ tone, label, children, styles, tokens }) {
  const { Icon, hex } = DETAIL_TONE[tone];
  return (
    <View style={styles.detailRow}>
      <View style={[styles.detailIconWrap, { backgroundColor: hex + "1f" }]}>
        <Icon size={12} color={hex} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <View style={{ marginTop: 2 }}>{children}</View>
      </View>
    </View>
  );
}

function DetailPesananSection({ order, tokens, styles }) {
  const info = parseOrderNotes(order.notes);
  const berat = (order.weightEntries || []).map((w) => `${w.label}: ${w.beratKg} kg`).join(" · ");
  const layanan = (order.items || []).map((it) => it.layananName).filter(Boolean).join(", ");
  const kasur = [info.merkKasur, info.ukuranKasur].filter(Boolean).join(" · ");
  const punyaAlamat = order.deliveryAddress || order.deliveryCity;

  // Tidak ada satu pun field detail terisi (order sangat lama/kosong) —
  // jangan tampilkan kotak kosong sama sekali, sama seperti perilaku
  // addressBox sebelumnya.
  const adaSatuPun = punyaAlamat || order.locationUrl || kasur || layanan
    || info.keluhanCustomer || berat || order.healthStatus
    || order.ongkir || order.ongkirKlaimGaransi
    || order.pickupEstimate || order.pickupConfirmedDate
    || order.deliveryEstimate || order.deliveryConfirmedDate
    || order.promo;
  if (!adaSatuPun) return null;

  return (
    <View style={styles.detailBox}>
      <DetailRow tone="address" label="Alamat Pengiriman" styles={styles} tokens={tokens}>
        {punyaAlamat ? (
          <Text style={styles.detailText}>
            {order.deliveryAddress || ""}
            {order.deliveryCity ? <Text style={{ fontWeight: "700" }}> · {order.deliveryCity}</Text> : null}
          </Text>
        ) : (
          <Text style={styles.detailMuted}>—</Text>
        )}
      </DetailRow>

      {order.locationUrl && (
        <DetailRow tone="link" label="Link Lokasi" styles={styles} tokens={tokens}>
          <TouchableOpacity
            onPress={() => Linking.openURL(order.locationUrl).catch(() =>
              Alert.alert("Gagal buka link", "Link lokasi ini sepertinya tidak valid.")
            )}
          >
            <Text style={[styles.detailText, { color: tokens.color.accent, fontWeight: "600" }]}>Buka lokasi ↗</Text>
          </TouchableOpacity>
        </DetailRow>
      )}

      {(kasur || layanan) && (
        <DetailRow tone="bed" label="Kasur & Layanan" styles={styles} tokens={tokens}>
          {!!kasur && <Text style={styles.detailText}>{kasur}</Text>}
          {!!layanan && <Text style={[styles.detailText, kasur && { marginTop: 2, color: tokens.color.textSecondary }]}>{layanan}</Text>}
        </DetailRow>
      )}

      {!!info.keluhanCustomer && (
        <DetailRow tone="note" label="Keluhan Kasur" styles={styles} tokens={tokens}>
          <Text style={styles.detailText}>{info.keluhanCustomer}</Text>
        </DetailRow>
      )}

      {!!berat && (
        <DetailRow tone="weight" label="Berat Badan" styles={styles} tokens={tokens}>
          <Text style={styles.detailText}>{berat}</Text>
        </DetailRow>
      )}

      {!!order.healthStatus && (
        <DetailRow tone="health" label="Kondisi Kesehatan" styles={styles} tokens={tokens}>
          <Text style={styles.detailText}>
            <Text style={{ fontWeight: "700", color: order.healthStatus === "SAKIT" ? tokens.color.danger : tokens.color.success }}>
              {HEALTH_LABELS[order.healthStatus] || order.healthStatus}
            </Text>
            {(order.complaintCategory || []).length > 0 && (
              <Text style={{ color: tokens.color.textSecondary }}>
                {" — "}{order.complaintCategory.map((c) => HEALTH_COMPLAINT_LABELS[c] || c).join(", ")}
              </Text>
            )}
          </Text>
        </DetailRow>
      )}

      {(order.ongkir || order.ongkirKlaimGaransi) && (
        <DetailRow tone="money" label="Ongkir" styles={styles} tokens={tokens}>
          <Text style={styles.detailText}>
            {order.ongkir ? formatRupiah(order.ongkir) : "Rp0"}
            {order.ongkirKlaimGaransi ? ` · Klaim Garansi: ${formatRupiah(order.ongkirKlaimGaransi)}` : ""}
          </Text>
        </DetailRow>
      )}

      {(order.pickupEstimate || order.pickupConfirmedDate) && (
        <DetailRow tone="pickup" label="Jadwal Pick Up" styles={styles} tokens={tokens}>
          {!!order.pickupEstimate && <Text style={styles.detailText}>{order.pickupEstimate}</Text>}
          {!!order.pickupConfirmedDate && (
            <Text style={[styles.detailText, order.pickupEstimate && { marginTop: 2, color: tokens.color.textSecondary }]}>
              Pasti: {shortDateWithYear(order.pickupConfirmedDate)}
            </Text>
          )}
        </DetailRow>
      )}

      {(order.deliveryEstimate || order.deliveryConfirmedDate) && (
        <DetailRow tone="delivery" label="Jadwal Kirim" styles={styles} tokens={tokens}>
          {!!order.deliveryEstimate && <Text style={styles.detailText}>{order.deliveryEstimate}</Text>}
          {!!order.deliveryConfirmedDate && (
            <Text style={[styles.detailText, order.deliveryEstimate && { marginTop: 2, color: tokens.color.textSecondary }]}>
              Pasti: {shortDateWithYear(order.deliveryConfirmedDate)}
            </Text>
          )}
        </DetailRow>
      )}

      {!!order.promo && (
        <DetailRow tone="promo" label="Promo" styles={styles} tokens={tokens}>
          <Text style={styles.detailText}>{promoLabel(order.promo)}</Text>
        </DetailRow>
      )}
    </View>
  );
}

function StatusTab({ orderId, tokens, styles }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sendingWa, setSendingWa] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api.getOrderTimeline(orderId)
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orderId]);

  async function handleSendWaGroup() {
    setSendingWa(true);
    try {
      await api.sendOrderWaSummary(orderId);
      Alert.alert("Terkirim", "Ringkasan order sudah dikirim ke grup WA.");
    } catch (err) {
      Alert.alert("Gagal kirim", err.message);
    } finally {
      setSendingWa(false);
    }
  }

  if (loading) return <ActivityIndicator color={tokens.color.accent} style={{ marginTop: 24 }} />;
  if (error) return <Text style={styles.errorText}>{error}</Text>;

  const sendWaButton = (
    <TouchableOpacity style={styles.sendWaBtn} onPress={handleSendWaGroup} disabled={sendingWa}>
      <Send size={13} color={tokens.color.accent} strokeWidth={2.2} />
      <Text style={styles.sendWaBtnText}>{sendingWa ? "Mengirim…" : "Kirim ke Grup WA"}</Text>
    </TouchableOpacity>
  );

  if (data?.riwayatKosong) {
    return (
      <View>
        {sendWaButton}
        <View style={styles.emptyWrap}>
          <Timer size={28} color={tokens.color.textMuted} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>Belum ada riwayat</Text>
          <Text style={styles.emptyText}>
            Sistem baru mulai merekam perpindahan status order — riwayat akan terisi begitu status order ini diubah berikutnya.
          </Text>
        </View>
      </View>
    );
  }

  const timeline = data?.timeline || [];
  return (
    <View style={{ paddingTop: 4 }}>
      {sendWaButton}
      <View style={styles.timelineRow}>
        <View style={styles.timelineDotWrap}>
          <View style={[styles.timelineDot, { backgroundColor: tokens.color.textMuted }]} />
          <View style={styles.timelineLine} />
        </View>
        <View style={{ paddingBottom: 16, flex: 1 }}>
          <Text style={styles.timelineTitle}>Order dibuat</Text>
          <Text style={styles.timelineMeta}>{shortDate(data?.dibuatPada)}</Text>
        </View>
      </View>
      {timeline.map((t, i) => (
        <View key={i} style={styles.timelineRow}>
          <View style={styles.timelineDotWrap}>
            <View style={[styles.timelineDot, { backgroundColor: tokens.color.accent }]} />
            {i < timeline.length - 1 && <View style={styles.timelineLine} />}
          </View>
          <View style={{ paddingBottom: 16, flex: 1 }}>
            <Text style={styles.timelineTitle}>
              {ORDER_STATUS_LABELS[t.fromStatus] || t.fromStatus} → {ORDER_STATUS_LABELS[t.toStatus] || t.toStatus}
            </Text>
            <Text style={styles.timelineMeta}>
              {shortDate(t.createdAt)}{t.changedBy ? ` · oleh ${t.changedBy}` : ""}
            </Text>
            <Text style={styles.timelineNote}>
              {t.berjalan ? "Berjalan " : "Bertahan "}
              <Text style={{ fontWeight: "700" }}>{t.hariDiStatus} hari</Text> di {ORDER_STATUS_LABELS[t.toStatus] || t.toStatus}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function DokumentasiTab({ orderId, tokens, styles }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api.getOrderDocumentation(orderId)
      .then((r) => { if (alive) setDoc(r); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orderId]);

  if (loading) return <ActivityIndicator color={tokens.color.accent} style={{ marginTop: 24 }} />;
  if (error) return <Text style={styles.errorText}>{error}</Text>;
  if (!doc || doc.entries.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <ImageOff size={28} color={tokens.color.textMuted} strokeWidth={1.6} />
        <Text style={styles.emptyTitle}>Belum ada dokumentasi</Text>
        <Text style={styles.emptyText}>
          Foto muncul di sini begitu driver mendokumentasikan penjemputan, kepala produksi mencatat tahap wajib foto, atau driver menyelesaikan pengiriman.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: 4 }}>
      <Text style={styles.docCount}>{doc.totalPhotos} foto sepanjang perjalanan order ini. Ketuk foto untuk buka ukuran penuh.</Text>
      {KATEGORI.map(({ key, label, Icon, hex }) => {
        const items = doc.entries.filter((e) => e.kategori === key);
        if (items.length === 0) return null;
        return (
          <View key={key} style={{ marginBottom: 16 }}>
            <View style={styles.docHeadRow}>
              <View style={[styles.docHeadIcon, { backgroundColor: hex + "26" }]}>
                <Icon size={13} color={hex} strokeWidth={2.2} />
              </View>
              <Text style={styles.docHeadLabel}>{label}</Text>
            </View>
            {items.map((entry, i) => (
              <View key={i} style={styles.docEntry}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={styles.docStageLabel}>
                    {entry.unitCode ? `${entry.unitCode} · ` : ""}{entry.stageLabel}
                  </Text>
                  <Text style={styles.docStageDate}>{shortDate(entry.recordedAt)}</Text>
                </View>
                {entry.note ? <Text style={styles.docNote}>{entry.note}</Text> : null}
                <View style={styles.docPhotoRow}>
                  {(entry.photoUrls || []).map((url) => (
                    <TouchableOpacity key={url} onPress={() => Linking.openURL(mediaUrl(url))}>
                      <Image source={{ uri: mediaUrl(url) }} style={styles.docPhoto} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        );
      })}

      {doc.tandaTangan && (
        <View style={styles.signatureBox}>
          <View style={styles.docHeadRow}>
            <View style={[styles.docHeadIcon, { backgroundColor: tokens.color.success + "26" }]}>
              <CheckCircle2 size={13} color={tokens.color.success} strokeWidth={2.2} />
            </View>
            <Text style={styles.docHeadLabel}>Tanda Tangan Penerima</Text>
          </View>
          <Image source={{ uri: mediaUrl(doc.tandaTangan.url) }} style={styles.signatureImg} resizeMode="contain" />
          <Text style={styles.docStageDate}>
            {shortDate(doc.tandaTangan.waktu)}{doc.tandaTangan.driver ? ` · diterima oleh driver ${doc.tandaTangan.driver}` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

function PembayaranTab({ order, tokens, styles }) {
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("TRANSFER");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    api.getOrderPayments(order.id).then(setPayments).catch((e) => setError(e.message));
  }, [order.id]);
  useEffect(() => { setPayments(null); load(); }, [load]);

  async function save() {
    const amountInt = parseInt(amount, 10);
    if (!amountInt || amountInt <= 0) { Alert.alert("Jumlah wajib diisi"); return; }
    setBusy(true);
    try {
      await api.recordOrderPayment(order.id, { amount: amountInt, method });
      setForm(false); setAmount(""); setMethod("TRANSFER");
      load();
    } catch (err) {
      Alert.alert("Gagal catat pembayaran", err.message);
    } finally {
      setBusy(false);
    }
  }

  const paid = (payments || []).reduce((n, p) => n + p.amount, 0);
  const outstanding = Math.max((order.value || 0) - paid, 0);

  return (
    <View style={{ paddingTop: 4 }}>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <View style={styles.miniCard}>
          <Text style={styles.miniCardLabel}>Sudah Dibayar</Text>
          <Text style={[styles.miniCardValue, { color: tokens.color.success }]}>{formatRupiah(paid)}</Text>
        </View>
        <View style={styles.miniCard}>
          <Text style={styles.miniCardLabel}>Sisa Tagihan</Text>
          <Text style={[styles.miniCardValue, { color: outstanding > 0 ? tokens.color.danger : tokens.color.textPrimary }]}>
            {formatRupiah(outstanding)}
          </Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!payments && !error && <ActivityIndicator color={tokens.color.accent} />}
      {payments?.length === 0 && <Text style={styles.emptyText}>Belum ada pembayaran tercatat.</Text>}
      {payments?.map((p) => (
        <View key={p.id} style={styles.paymentRow}>
          <View>
            <Text style={styles.paymentAmount}>{formatRupiah(p.amount)}</Text>
            <Text style={styles.paymentMeta}>
              {PAYMENT_METHOD_LABEL[p.method] || p.method} · {p.recordedBy?.name || "—"} · {shortDate(p.createdAt)}
            </Text>
          </View>
          {p.verifications?.length > 0 && <CheckCircle2 size={16} color={tokens.color.success} />}
        </View>
      ))}

      {!form ? (
        <TouchableOpacity style={styles.recordBtn} onPress={() => setForm(true)}>
          <Wallet size={14} color={tokens.color.accent} strokeWidth={2.2} />
          <Text style={styles.recordBtnText}>Catat Pembayaran</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.paymentForm}>
          <TextInput
            style={styles.input}
            placeholder="Jumlah diterima (Rp)"
            placeholderTextColor={tokens.color.textMuted}
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />
          <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => {
              const active = method === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.methodChip, active && { borderColor: tokens.color.accent, backgroundColor: tokens.color.accentSoft }]}
                  onPress={() => setMethod(value)}
                >
                  <Text style={[styles.methodChipText, active && { color: tokens.color.accent }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setForm(false); setAmount(""); }} disabled={busy}>
              <Text style={styles.cancelBtnText}>Batal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={busy}>
              <Text style={styles.saveBtnText}>{busy ? "Menyimpan…" : "Simpan"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

export default function OrderTimelineScreen({ route, navigation }) {
  const { orderId, orderNumber, customerName } = route.params || {};
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [tab, setTab] = useState("status");
  // Ringkasan order (status/pembayaran/nilai) — dipakai kartu atas DAN
  // PembayaranTab (butuh order.value untuk hitung sisa tagihan). Diambil
  // dari GET /orders?search=<orderNumber> (bentuk data SAMA dengan yang
  // dipakai OrdersScreen.js, termasuk daysInStatus yang tidak ada di
  // endpoint /timeline) — pola sama dengan bukaTimeline() web
  // (OrderSection.jsx) yang punya masalah serupa.
  const [order, setOrder] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!orderNumber) { setOrder({ id: orderId, value: 0 }); return; }
    api.getOrders({ search: orderNumber }).then((res) => {
      if (!alive) return;
      const found = (res?.items || []).find((o) => o.id === orderId);
      setOrder(found || { id: orderId, value: 0 });
    }).catch(() => { if (alive) setOrder({ id: orderId, value: 0 }); });
    return () => { alive = false; };
  }, [orderId, orderNumber]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={22} color={tokens.color.textPrimary} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{customerName || "Rincian Pesanan"}</Text>
          <View style={styles.orderNumberChip}>
            <Hash size={10} color={tokens.color.success} strokeWidth={2.4} />
            <Text style={styles.orderNumberText}>{orderNumber || "—"}</Text>
          </View>
        </View>
      </View>

      {order && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Status</Text>
            <Text style={styles.summaryValue}>{ORDER_STATUS_LABELS[order.status] || order.status || "—"}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Pembayaran</Text>
            <Text style={styles.summaryValue}>{PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus || "—"}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Nilai</Text>
            <Text style={styles.summaryValue}>{formatRupiah(order.value || 0)}</Text>
          </View>
        </View>
      )}

      {/* Detail Pesanan — paritas penuh dengan DetailPesananSection di web
          (OrderTimelineDrawer.jsx). Semua field ini SUDAH ikut terbawa di
          GET /orders (bukan field baru di endpoint, cuma belum pernah
          dirender di layar mobile ini) — jadi tidak perlu fetch tambahan. */}
      {order && <DetailPesananSection order={order} tokens={tokens} styles={styles} />}

      <View style={styles.tabBar}>
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <TouchableOpacity key={key} style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={() => setTab(key)}>
              <Icon size={13} color={active ? tokens.color.textPrimary : tokens.color.textMuted} strokeWidth={2.2} />
              <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {tab === "status" && <StatusTab orderId={orderId} tokens={tokens} styles={styles} />}
        {tab === "dokumentasi" && <DokumentasiTab orderId={orderId} tokens={tokens} styles={styles} />}
        {tab === "pembayaran" && order && <PembayaranTab order={order} tokens={tokens} styles={styles} />}
      </ScrollView>
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.color.bg },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 8 },
    backBtn: { padding: 6 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
    orderNumberChip: {
      flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start",
      backgroundColor: tokens.color.success + "1f", borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, marginTop: 3,
    },
    orderNumberText: { fontSize: 11, fontWeight: "700", color: tokens.color.success, fontFamily: "monospace" },
    summaryRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 10 },
    summaryCard: { flex: 1, backgroundColor: tokens.color.card, borderRadius: 12, padding: 10 },
    summaryLabel: { fontSize: 9.5, fontWeight: "600", color: tokens.color.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
    summaryValue: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary, marginTop: 2 },
    detailBox: {
      backgroundColor: tokens.color.card, borderRadius: 12, padding: 12,
      marginHorizontal: 16, marginBottom: 10, gap: 10,
    },
    detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    detailIconWrap: {
      width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center",
      marginTop: 1,
    },
    detailLabel: { fontSize: 9.5, fontWeight: "600", color: tokens.color.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
    detailText: { fontSize: 12.5, color: tokens.color.textPrimary, lineHeight: 18 },
    detailMuted: { fontSize: 12.5, color: tokens.color.textMuted },
    tabBar: { flexDirection: "row", marginHorizontal: 16, backgroundColor: tokens.color.subtle, borderRadius: 12, padding: 3, marginBottom: 4 },
    tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 9 },
    tabBtnActive: { backgroundColor: tokens.color.card },
    tabBtnText: { fontSize: 12, fontWeight: "600", color: tokens.color.textMuted },
    tabBtnTextActive: { color: tokens.color.textPrimary },

    errorText: { fontSize: 12.5, color: tokens.color.danger, marginTop: 12 },
    emptyWrap: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 20, gap: 6 },
    emptyTitle: { fontSize: 13, fontWeight: "700", color: tokens.color.textSecondary },
    emptyText: { fontSize: 12, color: tokens.color.textMuted, textAlign: "center", lineHeight: 17 },

    sendWaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: tokens.color.accentSoft, borderRadius: 12, paddingVertical: 11, marginBottom: 14 },
    sendWaBtnText: { fontSize: 13, fontWeight: "700", color: tokens.color.accent },
    timelineRow: { flexDirection: "row", gap: 10 },
    timelineDotWrap: { alignItems: "center", width: 12 },
    timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
    timelineLine: { width: 1, flex: 1, backgroundColor: tokens.color.border, marginTop: 3 },
    timelineTitle: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary },
    timelineMeta: { fontSize: 11, color: tokens.color.textMuted, marginTop: 1 },
    timelineNote: { fontSize: 11, color: tokens.color.textSecondary, marginTop: 2 },

    docCount: { fontSize: 11.5, color: tokens.color.textMuted, marginBottom: 12 },
    docHeadRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border, paddingBottom: 6 },
    docHeadIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    docHeadLabel: { fontSize: 12.5, fontWeight: "700", color: tokens.color.textPrimary },
    docEntry: { backgroundColor: tokens.color.card, borderRadius: 12, padding: 10, marginBottom: 8 },
    docStageLabel: { fontSize: 12, fontWeight: "600", color: tokens.color.textPrimary, flexShrink: 1 },
    docStageDate: { fontSize: 10, color: tokens.color.textMuted },
    docNote: { fontSize: 11, color: tokens.color.textSecondary, marginTop: 2 },
    docPhotoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    docPhoto: { width: 64, height: 64, borderRadius: 8, backgroundColor: tokens.color.subtle },
    signatureBox: { backgroundColor: tokens.color.success + "14", borderRadius: 12, padding: 10, marginTop: 4 },
    signatureImg: { width: "100%", height: 100, backgroundColor: "#fff", borderRadius: 8, marginBottom: 6 },

    miniCard: { flex: 1, backgroundColor: tokens.color.card, borderRadius: 12, padding: 10 },
    miniCardLabel: { fontSize: 9.5, fontWeight: "600", color: tokens.color.textMuted, textTransform: "uppercase" },
    miniCardValue: { fontSize: 14, fontWeight: "700", marginTop: 2 },
    paymentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: tokens.color.card, borderRadius: 12, padding: 10, marginBottom: 8 },
    paymentAmount: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary },
    paymentMeta: { fontSize: 11, color: tokens.color.textMuted, marginTop: 2 },
    recordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: tokens.color.accentSoft, borderRadius: 12, paddingVertical: 11, marginTop: 4 },
    recordBtnText: { fontSize: 13, fontWeight: "700", color: tokens.color.accent },
    paymentForm: { backgroundColor: tokens.color.card, borderRadius: 12, padding: 12, marginTop: 4 },
    input: { backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: tokens.color.textPrimary },
    methodChip: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 9, borderWidth: 1.5, borderColor: tokens.color.border },
    methodChipText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
    cancelBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
    cancelBtnText: { fontSize: 12.5, fontWeight: "600", color: tokens.color.textSecondary },
    saveBtn: { flex: 1, alignItems: "center", paddingVertical: 10, backgroundColor: tokens.color.accent, borderRadius: 10 },
    saveBtnText: { fontSize: 12.5, fontWeight: "700", color: "#fff" },
  });
}
