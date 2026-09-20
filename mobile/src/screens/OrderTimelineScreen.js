// "Rincian Pesanan" — paritas mobile (D-030, 21 Agustus 2026) dari
// frontend/src/features/orders/OrderTimelineDrawer.jsx (web). Dibuka lewat
// navigateToOrderTimeline() (lib/navigationRef.js) dari tombol "Rincian" di
// OrderCard.js, dipakai baik dari tab Order (lintas pelanggan) maupun dari
// profil 1 pelanggan — makanya screen ini SENGAJA fetch ulang datanya
// sendiri lewat orderId (bukan menerima seluruh object order lewat route
// params), supaya selalu dapat bentuk data yang sama persis dari kedua
// pemanggil.
//
// Scope: upload bukti bayar (foto) BELUM ada di sini. Kirim dokumentasi ke
// customer (checkbox + WAHA), simpan ke galeri, dan bagikan SUDAH ada
// (19 Sep 2026). Foto dibuka lewat viewer eksternal.
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import GlassBackdrop from "../components/GlassBackdrop";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Linking, Image, Pressable, useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeft, Clock, Camera, Wallet, Timer, ImageOff, PackageCheck, Wrench, Truck,
  CheckCircle2, Hash, Send, MapPin, Link2, Bed, Weight, HeartPulse, Banknote,
  CalendarClock, Tag, MessageSquareText, Download, Share2, Square, CheckSquare, FileText, ShieldCheck, AlertTriangle, Landmark, Check,
} from "lucide-react-native";
import { api, mediaUrl } from "../api";
import * as ImagePicker from "expo-image-picker";
import { saveToGallery, shareOne } from "../lib/docPhotos";
import MediaViewerModal from "../components/MediaViewerModal";
import OrderInvoiceTab from "../components/order/OrderInvoiceTab";
import OrderWarrantyTab from "../components/order/OrderWarrantyTab";
import OrderComplaintTab from "../components/order/OrderComplaintTab";
import { useTokens } from "../constants/theme";
import {
  METHODS, METHOD_LABEL, METHOD_USES_ACCOUNT, normalizeAccounts, initialDraft, draftReducer, selectedAccountId, buildPaymentPayload,
} from "../lib/paymentDraft";
import {
  formatRupiah, shortDate, shortDateWithYear, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
  HEALTH_LABELS, HEALTH_COMPLAINT_LABELS, parseOrderNotes, promoLabel,
} from "../utils/format";

const PAYMENT_METHOD_LABEL = METHOD_LABEL;
const TABS = [
  { key: "status", label: "Status", Icon: Clock },
  { key: "dokumentasi", label: "Dokumentasi", Icon: Camera },
  { key: "pembayaran", label: "Pembayaran", Icon: Wallet },
  { key: "invoice", label: "Invoice", Icon: FileText },
  { key: "garansi", label: "Garansi", Icon: ShieldCheck },
  { key: "komplain", label: "Komplain", Icon: AlertTriangle },
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

function DokumentasiTab({ orderId, conversationId, customerNameLabel, tokens, styles }) {
  const [doc, setDoc] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
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

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const selectedEntries = () => [...selected].map((i) => doc.entries[i]);
  const selectedUrls = () => selectedEntries().flatMap((e) => e.photoUrls || []);

  function handleSend() {
    if (!conversationId || selected.size === 0) return;
    const jumlahFoto = selectedUrls().length;
    Alert.alert(
      "Kirim ke customer?",
      `${jumlahFoto} foto dari ${selected.size} tahap akan dikirim ke chat WhatsApp ${customerNameLabel || "customer"}.`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Kirim",
          onPress: async () => {
            setSending(true);
            try {
              const r = await api.sendDocumentation(conversationId, orderId, selectedEntries());
              Alert.alert("Terkirim", `${r.sent}/${r.total} foto terkirim ke customer.`);
              setSelected(new Set());
            } catch (e) {
              Alert.alert("Gagal kirim", e.message);
            } finally {
              setSending(false);
            }
          },
        },
      ],
    );
  }

  async function handleSave() {
    setWorking(true);
    try {
      const n = await saveToGallery(selectedUrls());
      Alert.alert("Tersimpan", `${n} foto disimpan ke galeri.`);
    } catch (e) {
      Alert.alert("Gagal simpan", e.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleShare() {
    const urls = selectedUrls();
    if (urls.length !== 1) {
      Alert.alert("Bagikan", "Bagikan lewat aplikasi lain hanya bisa satu foto sekali. Pilih satu tahap yang berisi satu foto, atau gunakan Simpan ke galeri.");
      return;
    }
    setWorking(true);
    try { await shareOne(urls[0]); }
    catch (e) { Alert.alert("Gagal bagikan", e.message); }
    finally { setWorking(false); }
  }

  // Semua foto order ini (urut tampil) + tanda tangan, untuk viewer geser/zoom di dalam app.
  const viewerItems = doc
    ? [...doc.entries.flatMap((e) => e.photoUrls || []), ...(doc.tandaTangan ? [doc.tandaTangan.url] : [])]
        .map((u) => ({ id: u, type: "image", url: mediaUrl(u) }))
    : [];

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
      <Text style={styles.docCount}>{doc.totalPhotos} foto sepanjang perjalanan order ini. Centang tahap lalu kirim ke customer, simpan ke galeri, atau bagikan. Ketuk foto untuk memperbesar.</Text>
      {KATEGORI.map(({ key, label, Icon, hex }) => {
        const items = doc.entries.map((e, idx) => ({ ...e, _idx: idx })).filter((e) => e.kategori === key);
        if (items.length === 0) return null;
        return (
          <View key={key} style={{ marginBottom: 16 }}>
            <View style={styles.docHeadRow}>
              <View style={[styles.docHeadIcon, { backgroundColor: hex + "26" }]}>
                <Icon size={13} color={hex} strokeWidth={2.2} />
              </View>
              <Text style={styles.docHeadLabel}>{label}</Text>
            </View>
            {items.map((entry) => (
              <View key={entry._idx} style={[styles.docEntry, selected.has(entry._idx) && styles.docEntrySelected]}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => toggle(entry._idx)}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    {selected.has(entry._idx)
                      ? <CheckSquare size={18} color={tokens.color.accent} strokeWidth={2.2} />
                      : <Square size={18} color={tokens.color.textMuted} strokeWidth={2} />}
                    <Text style={[styles.docStageLabel, { flexShrink: 1 }]}>
                      {entry.unitCode ? `${entry.unitCode} · ` : ""}{entry.stageLabel}
                    </Text>
                  </View>
                  <Text style={styles.docStageDate}>{shortDate(entry.recordedAt)}</Text>
                </TouchableOpacity>
                {entry.note ? <Text style={styles.docNote}>{entry.note}</Text> : null}
                <View style={styles.docPhotoRow}>
                  {(entry.photoUrls || []).map((url) => (
                    <TouchableOpacity key={url} onPress={() => setViewerIndex(Math.max(0, viewerItems.findIndex((it) => it.id === url)))}>
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
          <TouchableOpacity onPress={() => setViewerIndex(viewerItems.length - 1)}>
            <Image source={{ uri: mediaUrl(doc.tandaTangan.url) }} style={styles.signatureImg} resizeMode="contain" />
          </TouchableOpacity>
          <Text style={styles.docStageDate}>
            {shortDate(doc.tandaTangan.waktu)}{doc.tandaTangan.driver ? ` · diterima oleh driver ${doc.tandaTangan.driver}` : ""}
          </Text>
        </View>
      )}

      <MediaViewerModal
        visible={viewerIndex !== null}
        items={viewerItems}
        initialIndex={viewerIndex || 0}
        onClose={() => setViewerIndex(null)}
      />

      <View style={styles.sendBar}>
        {!conversationId ? (
          <Text style={styles.docCount}>Belum ada percakapan WhatsApp untuk pelanggan ini — tidak bisa kirim langsung.</Text>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, (selected.size === 0 || sending) && { opacity: 0.4 }]}
            disabled={selected.size === 0 || sending}
            onPress={handleSend}
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Send size={16} color="#fff" strokeWidth={2.2} />}
            <Text style={styles.sendBtnText}>
              {sending ? "Mengirim…" : selected.size > 0 ? `Kirim ${selected.size} dokumentasi ke customer` : "Pilih dokumentasi untuk dikirim"}
            </Text>
          </TouchableOpacity>
        )}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TouchableOpacity
            style={[styles.secBtn, (selected.size === 0 || working) && { opacity: 0.4 }]}
            disabled={selected.size === 0 || working}
            onPress={handleSave}
          >
            <Download size={15} color={tokens.color.textPrimary} strokeWidth={2.2} />
            <Text style={styles.secBtnText}>Simpan ke galeri</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secBtn, (selected.size === 0 || working) && { opacity: 0.4 }]}
            disabled={selected.size === 0 || working}
            onPress={handleShare}
          >
            <Share2 size={15} color={tokens.color.textPrimary} strokeWidth={2.2} />
            <Text style={styles.secBtnText}>Bagikan</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// Kartu rekening tujuan: SELURUH kartu bisa ditekan (Pressable), lebar penuh, tinggi mengikuti isi/font.
function AccountCard({ account, selected, onPress, tokens, styles }) {
  const detail = [account.bankName, account.holder ? `a.n. ${account.holder}` : null].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${account.name}${detail ? `, ${detail}` : ""}${account.masked ? `, nomor ${account.masked}` : ""}${selected ? ", terpilih" : ""}`}
      android_ripple={{ color: tokens.color.accentSoft }}
      style={({ pressed }) => [
        styles.accountCard,
        selected && { borderColor: tokens.color.accent, backgroundColor: tokens.color.accentSoft },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.accountIcon, selected && { backgroundColor: tokens.color.accent }]}>
        <Landmark size={18} color={selected ? "#fff" : tokens.color.textSecondary} strokeWidth={2.1} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.accountName}>{account.name}</Text>
        {detail ? <Text style={styles.accountMeta}>{detail}</Text> : null}
        <Text style={[styles.accountMeta, styles.accountNumber]}>
          {account.masked ? `No. rek ${account.masked}` : "Nomor rekening belum diisi"}
        </Text>
      </View>
      <View style={[styles.radio, selected && { borderColor: tokens.color.accent, backgroundColor: tokens.color.accent }]}>
        {selected ? <Check size={13} color="#fff" strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

// Pilihan rekening: loading / error (bisa coba lagi) / kosong / 1 / 2+ — tidak pernah menampilkan kotak kosong.
function AccountPicker({ state, selectedId, onPick, onRetry, methodLabel, tokens, styles }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.fieldLabel}>Rekening tujuan {methodLabel}</Text>
      {state.status === "loading" && (
        <View style={styles.accountState}><ActivityIndicator color={tokens.color.accent} /><Text style={styles.stateText}>Memuat rekening…</Text></View>
      )}
      {state.status === "error" && (
        <View style={styles.accountState}>
          <Text style={[styles.stateText, { color: tokens.color.danger }]}>Rekening gagal dimuat. {state.error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry} accessibilityRole="button">
            <Text style={styles.retryBtnText}>Coba lagi</Text>
          </TouchableOpacity>
        </View>
      )}
      {state.status === "ready" && state.items.length === 0 && (
        <View style={styles.accountState}>
          <Text style={styles.emptyTitle}>Belum ada rekening tujuan aktif</Text>
          <Text style={styles.stateText}>Pembayaran tetap bisa dicatat; tim Finance akan mencocokkan rekeningnya saat verifikasi.</Text>
        </View>
      )}
      {state.status === "ready" && state.items.length > 0 && (
        <View accessibilityRole="radiogroup" style={{ gap: 8, marginTop: 6 }}>
          {state.items.map((a) => (
            <AccountCard key={a.id} account={a} selected={selectedId === a.id} onPress={() => onPick(a.id)} tokens={tokens} styles={styles} />
          ))}
          {!selectedId && <Text style={styles.hintText}>Belum memilih rekening — dibukukan ke rekening bawaan metode ini.</Text>}
        </View>
      )}
    </View>
  );
}

// Lebar minimum kartu angka mengikuti skala font sistem: di font besar / layar 360dp kartu turun baris (bahkan satu per baris)
// alih-alih memotong kata di tengah ("Diprose/s", "Rp3.50/0.000").
function useCardSizes() {
  const { fontScale } = useWindowDimensions();
  const k = Math.max(1, fontScale || 1);
  const summary = Math.round(112 * k);
  const mini = Math.round(142 * k);
  return {
    summaryCardSize: { minWidth: summary, flexBasis: summary },
    miniCardSize: { minWidth: mini, flexBasis: mini },
  };
}

function PembayaranTab({ order, draft, dispatch, accounts, reloadAccounts, tokens, styles }) {
  const { miniCardSize } = useCardSizes();
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toFile(asset) {
    return { uri: asset.uri, name: asset.fileName || "bukti-bayar.jpg", type: asset.mimeType || "image/jpeg" };
  }

  async function pickProof() {
    Alert.alert("Foto bukti bayar", "Ambil dari mana?", [
      {
        text: "Kamera",
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { Alert.alert("Kamera", "Izin kamera diperlukan untuk ambil foto"); return; }
          const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
          if (!r.canceled && r.assets?.length) dispatch({ type: "photo", value: toFile(r.assets[0]) });
        },
      },
      {
        text: "Galeri",
        onPress: async () => {
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
          if (!r.canceled && r.assets?.length) dispatch({ type: "photo", value: toFile(r.assets[0]) });
        },
      },
      { text: "Batal", style: "cancel" },
    ]);
  }

  const load = useCallback(() => {
    setError("");
    api.getOrderPayments(order.id).then(setPayments).catch((e) => setError(e.message));
  }, [order.id]);
  useEffect(() => { setPayments(null); load(); }, [load]);

  async function save() {
    const payload = buildPaymentPayload(draft, accounts.items, null);
    if (!payload.amount || payload.amount <= 0) { Alert.alert("Jumlah wajib diisi", "Isi jumlah pembayaran yang valid (angka, lebih dari 0)."); return; }
    setBusy(true);
    try {
      // Foto diunggah dulu; kalau upload gagal, pencatatan dibatalkan (bukan
      // dicatat tanpa bukti diam-diam) supaya sales bisa coba lagi.
      let proofPhotoUrl;
      if (draft.photo) ({ url: proofPhotoUrl } = await api.uploadPaymentProof(order.id, draft.photo));
      await api.recordOrderPayment(order.id, buildPaymentPayload(draft, accounts.items, proofPhotoUrl));
      dispatch({ type: "reset" });
      load();
    } catch (err) {
      Alert.alert("Gagal catat pembayaran", err.message);
    } finally {
      setBusy(false);
    }
  }

  const paid = (payments || []).filter((p) => !p.cancelledAt).reduce((n, p) => n + p.amount, 0);
  const outstanding = Math.max((order.value || 0) - paid, 0);
  const usesAccount = METHOD_USES_ACCOUNT[draft.method];

  return (
    <View style={{ paddingTop: 4 }}>
      <View style={styles.miniRow}>
        <View style={[styles.miniCard, miniCardSize]}>
          <Text style={styles.miniCardLabel}>Sudah Dibayar</Text>
          <Text style={[styles.miniCardValue, { color: tokens.color.success }]}>{formatRupiah(paid)}</Text>
        </View>
        <View style={[styles.miniCard, miniCardSize]}>
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
        <View key={p.id} style={[styles.paymentRow, p.cancelledAt && { opacity: 0.55 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.paymentAmount}>{formatRupiah(p.amount)}{p.cancelledAt ? " · dibatalkan" : ""}</Text>
            <Text style={styles.paymentMeta}>
              {PAYMENT_METHOD_LABEL[p.method] || p.method}{p.cashAccount?.name ? ` → ${p.cashAccount.name}` : ""} · {p.recordedBy?.name || "—"} · {shortDate(p.createdAt)}
            </Text>
          </View>
          {p.verifications?.length > 0 && <CheckCircle2 size={16} color={tokens.color.success} />}
        </View>
      ))}

      {!draft.open ? (
        <TouchableOpacity style={styles.recordBtn} onPress={() => dispatch({ type: "open" })}>
          <Wallet size={14} color={tokens.color.accent} strokeWidth={2.2} />
          <Text style={styles.recordBtnText}>Catat Pembayaran</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.paymentForm}>
          <Text style={styles.fieldLabel}>Jumlah diterima</Text>
          <TextInput
            style={styles.input}
            placeholder="Rp 0"
            placeholderTextColor={tokens.color.textMuted}
            keyboardType="numeric"
            value={draft.amount}
            onChangeText={(v) => dispatch({ type: "amount", value: v })}
            maxFontSizeMultiplier={1.5}
          />

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Metode</Text>
          <View style={styles.methodGrid} accessibilityRole="radiogroup">
            {METHODS.map((value) => {
              const active = draft.method === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.methodChip, active && { borderColor: tokens.color.accent, backgroundColor: tokens.color.accentSoft }]}
                  onPress={() => dispatch({ type: "method", value })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, checked: active }}
                >
                  <Text style={[styles.methodChipText, active && { color: tokens.color.accent }]}>{METHOD_LABEL[value]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {usesAccount && (
            <AccountPicker
              state={accounts}
              selectedId={selectedAccountId(draft, accounts.items)}
              onPick={(id) => dispatch({ type: "pickAccount", id })}
              onRetry={reloadAccounts}
              methodLabel={METHOD_LABEL[draft.method]}
              tokens={tokens}
              styles={styles}
            />
          )}
          {!usesAccount && <Text style={styles.hintText}>Pembayaran tunai tidak memilih rekening.</Text>}

          <TouchableOpacity style={styles.proofBtn} onPress={pickProof} disabled={busy}>
            <Camera size={15} color={draft.photo ? tokens.color.success : tokens.color.textSecondary} strokeWidth={2.2} />
            <Text style={[styles.methodChipText, { flexShrink: 1 }, draft.photo && { color: tokens.color.success }]}>
              {draft.photo ? "Foto bukti siap (ketuk untuk ganti)" : "Foto bukti bayar (opsional)"}
            </Text>
          </TouchableOpacity>
          {draft.photo ? <Image source={{ uri: draft.photo.uri }} style={styles.proofPreview} /> : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => dispatch({ type: "reset" })} disabled={busy}>
              <Text style={styles.cancelBtnText}>Batal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
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
  const { summaryCardSize } = useCardSizes();
  const [tab, setTab] = useState("status");
  // Ringkasan order (status/pembayaran/nilai) — dipakai kartu atas DAN
  // PembayaranTab (butuh order.value untuk hitung sisa tagihan). Diambil
  // dari GET /orders?search=<orderNumber> (bentuk data SAMA dengan yang
  // dipakai OrdersScreen.js, termasuk daysInStatus yang tidak ada di
  // endpoint /timeline) — pola sama dengan bukaTimeline() web
  // (OrderSection.jsx) yang punya masalah serupa.
  const [order, setOrder] = useState(null);

  // Draft "Catat Pembayaran" DIANGKAT ke layar (bukan di dalam tab): tab di-unmount saat berpindah, jadi state di dalam
  // tab hilang. Di sini jumlah, metode, rekening per-metode, dan foto bertahan selama form belum disimpan/dibatalkan.
  const [draft, dispatch] = useReducer(draftReducer, undefined, initialDraft);
  const [accounts, setAccounts] = useState({ status: "idle", items: [], error: "" });
  const loadAccounts = useCallback(() => {
    setAccounts((s) => ({ ...s, status: "loading", error: "" }));
    api.getPaymentAccounts()
      .then((raw) => setAccounts({ status: "ready", items: normalizeAccounts(raw), error: "" }))
      .catch((e) => {
        const msg = String(e?.message || "");
        // Pesan teknis (fetch/IOException) tidak ramah untuk sales — ganti dengan petunjuk yang bisa ditindaklanjuti.
        const teknis = /fetch|network|IOException|timeout|abort|failed/i.test(msg);
        setAccounts({ status: "error", items: [], error: teknis || !msg ? "Periksa koneksi internet lalu coba lagi." : msg });
      });
  }, []);
  // Rekening dimuat sekali, saat form pembayaran pertama kali dibuka (bukan tiap pindah tab).
  useEffect(() => { if (draft.open && accounts.status === "idle") loadAccounts(); }, [draft.open, accounts.status, loadAccounts]);

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

  // Tab bar horizontal: geser otomatis supaya tab aktif selalu terlihat penuh (tab terakhir tidak terpotong).
  const tabScrollRef = useRef(null);
  const tabLayouts = useRef({});
  const [tabBarWidth, setTabBarWidth] = useState(0);
  function selectTab(key) {
    setTab(key);
    const l = tabLayouts.current[key];
    if (l && tabScrollRef.current) tabScrollRef.current.scrollTo({ x: Math.max(0, l.x - (tabBarWidth - l.width) / 2), animated: true });
  }

  const bottomPad = Math.max(insets.bottom, 12) + 32; // ruang di atas navigation bar/gesture bar

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GlassBackdrop />
      {/* SATU ScrollView vertikal untuk seluruh halaman: header, ringkasan, kartu alamat & info order ikut naik saat
          di-scroll. Hanya bilah tab (child ke-4) yang menempel di atas setelah mencapai puncak. Tidak ada tinggi tetap /
          flex:1 pada isi tab, jadi isi mengikuti tinggi alaminya dan bisa digulir sampai paling bawah. */}
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        stickyHeaderIndices={[3]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator
      >
        {/* 0 — header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Kembali" hitSlop={8}>
            <ChevronLeft size={24} color={tokens.color.textPrimary} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.headerTitle} maxFontSizeMultiplier={1.5}>{customerName || "Rincian Pesanan"}</Text>
            <View style={styles.orderNumberChip}>
              <Hash size={10} color={tokens.color.success} strokeWidth={2.4} />
              <Text style={styles.orderNumberText}>{orderNumber || "—"}</Text>
            </View>
          </View>
        </View>

        {/* 1 — ringkasan (wrapper selalu ada agar indeks sticky stabil) */}
        <View>
          {order && (
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, summaryCardSize]}>
                <Text style={styles.summaryLabel}>Status</Text>
                <Text style={styles.summaryValue}>{ORDER_STATUS_LABELS[order.status] || order.status || "—"}</Text>
              </View>
              <View style={[styles.summaryCard, summaryCardSize]}>
                <Text style={styles.summaryLabel}>Pembayaran</Text>
                <Text style={styles.summaryValue}>{PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus || "—"}</Text>
              </View>
              <View style={[styles.summaryCard, summaryCardSize]}>
                <Text style={styles.summaryLabel}>Nilai</Text>
                <Text style={styles.summaryValue}>{formatRupiah(order.value || 0)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* 2 — Detail Pesanan (alamat & info order): paritas penuh dengan DetailPesananSection di web
            (OrderTimelineDrawer.jsx). Semua field SUDAH ikut di GET /orders — tidak ada fetch tambahan. */}
        <View>{order && <DetailPesananSection order={order} tokens={tokens} styles={styles} />}</View>

        {/* 3 — bilah tab (sticky). Latar solid = warna dasar gradien agar isi yang lewat di bawahnya tidak tembus. */}
        <View style={styles.tabBarSticky} onLayout={(e) => setTabBarWidth(e.nativeEvent.layout.width)}>
          <ScrollView
            ref={tabScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBarContent}
            accessibilityRole="tablist"
          >
            {TABS.map(({ key, label, Icon }) => {
              const active = tab === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                  onPress={() => selectTab(key)}
                  onLayout={(e) => { tabLayouts.current[key] = e.nativeEvent.layout; }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={label}
                >
                  <Icon size={16} color={active ? tokens.color.accent : tokens.color.textMuted} strokeWidth={2.2} />
                  <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]} maxFontSizeMultiplier={1.5}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* 4 — isi tab: tinggi natural, tanpa ScrollView bersarang */}
        <View style={styles.tabContent}>
          {tab === "status" && <StatusTab orderId={orderId} tokens={tokens} styles={styles} />}
          {tab === "dokumentasi" && <DokumentasiTab orderId={orderId} conversationId={order?.conversationId || null} customerNameLabel={customerName} tokens={tokens} styles={styles} />}
          {tab === "pembayaran" && order && (
            <PembayaranTab order={order} draft={draft} dispatch={dispatch} accounts={accounts} reloadAccounts={loadAccounts} tokens={tokens} styles={styles} />
          )}
          {tab === "invoice" && <OrderInvoiceTab orderId={orderId} />}
          {tab === "garansi" && <OrderWarrantyTab orderId={orderId} order={order} />}
          {tab === "komplain" && <OrderComplaintTab orderId={orderId} />}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: "transparent" },
    pageScroll: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 8 },
    backBtn: { padding: 8, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "700", color: tokens.color.textPrimary, lineHeight: 24 },
    orderNumberChip: {
      flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start",
      backgroundColor: tokens.color.success + "1f", borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, marginTop: 3,
    },
    orderNumberText: { fontSize: 11, fontWeight: "700", color: tokens.color.success, fontFamily: "monospace" },
    // Kartu ringkasan membungkus (tidak dipaksa 1 baris): di font besar / layar 360dp nilai panjang turun ke baris berikutnya
    // alih-alih terpotong.
    summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
    summaryCard: { flexGrow: 1, flexBasis: 96, minWidth: 96, ...tokens.glass.surface, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11 },
    summaryLabel: { fontSize: 10.5, fontWeight: "600", color: tokens.color.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
    summaryValue: { fontSize: 14, fontWeight: "700", color: tokens.color.textPrimary, marginTop: 3, lineHeight: 19 },
    detailBox: {
      ...tokens.glass.surface, borderRadius: 14, padding: 14,
      marginHorizontal: 16, marginBottom: 12, gap: 12,
    },
    detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    detailIconWrap: {
      width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center",
      marginTop: 1,
    },
    detailLabel: { fontSize: 9.5, fontWeight: "600", color: tokens.color.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
    detailText: { fontSize: 12.5, color: tokens.color.textPrimary, lineHeight: 18 },
    detailMuted: { fontSize: 12.5, color: tokens.color.textMuted },
    // Bilah tab: menempel di atas saat halaman digulir (child sticky). Latar solid = warna dasar gradien.
    tabBarSticky: {
      backgroundColor: tokens.glass.tabBarBg, paddingTop: 6, paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    // minWidth 100% + item flexShrink 0: tab tidak pernah dikecilkan sampai label hilang; kalau ruang kurang, digeser mendatar.
    tabBarContent: { paddingHorizontal: 16, gap: 6, minWidth: "100%" },
    tabBtn: {
      flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
      minHeight: 44, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22,
      backgroundColor: tokens.color.subtle, borderWidth: 1, borderColor: "transparent",
    },
    tabBtnActive: { ...tokens.glass.surface, borderColor: tokens.color.accent, backgroundColor: tokens.color.accentSoft },
    tabBtnText: { fontSize: 13.5, fontWeight: "600", color: tokens.color.textMuted },
    tabBtnTextActive: { color: tokens.color.accent, fontWeight: "700" },
    tabContent: { paddingHorizontal: 16, paddingTop: 16 },

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
    docEntry: { ...tokens.glass.surface, borderRadius: 12, padding: 10, marginBottom: 8 },
    docStageLabel: { fontSize: 12, fontWeight: "600", color: tokens.color.textPrimary, flexShrink: 1 },
    docStageDate: { fontSize: 10, color: tokens.color.textMuted },
    docNote: { fontSize: 11, color: tokens.color.textSecondary, marginTop: 2 },
    docEntrySelected: { borderWidth: 2, borderColor: tokens.color.accent },
    sendBar: { marginTop: 8 },
    sendBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: tokens.color.accent, borderRadius: 12, paddingVertical: 13,
    },
    sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
    secBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      ...tokens.glass.surface, borderRadius: 12, paddingVertical: 11,
    },
    secBtnText: { fontSize: 12.5, fontWeight: "600", color: tokens.color.textPrimary },
    docPhotoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    docPhoto: { width: 64, height: 64, borderRadius: 8, backgroundColor: tokens.color.subtle },
    signatureBox: { backgroundColor: tokens.color.success + "14", borderRadius: 12, padding: 10, marginTop: 4 },
    signatureImg: { width: "100%", height: 100, backgroundColor: "#fff", borderRadius: 8, marginBottom: 6 },

    miniRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
    miniCard: { flexGrow: 1, flexBasis: 130, minWidth: 130, ...tokens.glass.surface, borderRadius: 14, padding: 12 },
    miniCardLabel: { fontSize: 10.5, fontWeight: "600", color: tokens.color.textMuted, textTransform: "uppercase" },
    miniCardValue: { fontSize: 16, fontWeight: "700", marginTop: 3 },
    paymentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", ...tokens.glass.surface, borderRadius: 12, padding: 10, marginBottom: 8 },
    paymentAmount: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary },
    paymentMeta: { fontSize: 11, color: tokens.color.textMuted, marginTop: 2 },
    recordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: tokens.color.accentSoft, borderRadius: 12, paddingVertical: 11, marginTop: 4 },
    recordBtnText: { fontSize: 13, fontWeight: "700", color: tokens.color.accent },
    paymentForm: { ...tokens.glass.surface, borderRadius: 14, padding: 14, marginTop: 6 },
    fieldLabel: { fontSize: 12, fontWeight: "700", color: tokens.color.textSecondary, marginBottom: 6 },
    input: { backgroundColor: tokens.color.subtle, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: tokens.color.textPrimary, minHeight: 48 },
    // Grid 2 kolom yang membungkus: flexBasis "47%" (BUKAN flex:1 → basis 0 yang meruntuhkan chip jadi kotak sempit).
    methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    methodChip: { flexGrow: 1, flexBasis: "47%", minHeight: 46, alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, borderColor: tokens.color.border },
    methodChipText: { fontSize: 13.5, fontWeight: "600", color: tokens.color.textSecondary },
    // Kartu rekening: lebar penuh, tumpuk vertikal, seluruh area bisa ditekan.
    accountCard: {
      flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch", minHeight: 68,
      paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: tokens.color.border,
      backgroundColor: tokens.color.card,
    },
    accountIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.subtle },
    accountName: { fontSize: 14.5, fontWeight: "700", color: tokens.color.textPrimary, lineHeight: 20 },
    accountMeta: { fontSize: 12, color: tokens.color.textSecondary, marginTop: 2, lineHeight: 17 },
    accountNumber: { fontFamily: "monospace", color: tokens.color.textMuted },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: tokens.color.border, alignItems: "center", justifyContent: "center" },
    accountState: { marginTop: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: tokens.color.border, gap: 6, alignItems: "flex-start" },
    stateText: { fontSize: 12.5, color: tokens.color.textSecondary, lineHeight: 18 },
    hintText: { fontSize: 12, color: tokens.color.textMuted, marginTop: 8, lineHeight: 17 },
    retryBtn: { minHeight: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: tokens.color.accentSoft, alignItems: "center", justifyContent: "center" },
    retryBtnText: { fontSize: 13, fontWeight: "700", color: tokens.color.accent },
    proofBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: tokens.color.border },
    proofPreview: { width: 96, height: 96, borderRadius: 12, marginTop: 10 },
    cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 46 },
    cancelBtnText: { fontSize: 12.5, fontWeight: "600", color: tokens.color.textSecondary },
    saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 46, backgroundColor: tokens.color.accent, borderRadius: 12 },
    saveBtnText: { fontSize: 12.5, fontWeight: "700", color: "#fff" },
  });
}
