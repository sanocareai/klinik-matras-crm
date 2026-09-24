import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { allowedActions, describeAudit, formatRupiah, newIdempotencyKey, statusInfo } from "@sano/delivery-shared";
import { biayaArmadaApi, client } from "../client";
import { useSession } from "../SessionContext";
import { useTheme } from "../theme";
import { tanggalWIB, waktuWIB } from "../format";
import { ActionModal, Box, Btn, Chip, Row, Section } from "../ui";

function statusPembayaran(s) {
  const fe = s.finExpense;
  if (s.status === "DIBAYAR") return { label: "Sudah dibayar", tone: "green", info: fe?.paidAt ? `Dibayar ${waktuWIB(fe.paidAt)}` : null };
  if (s.status === "DITOLAK") return { label: "Ditolak", tone: "red", info: fe?.rejectReason ? `Alasan: ${fe.rejectReason}` : null };
  if (s.status === "DIBATALKAN") return { label: "Dibatalkan", tone: "neutral", info: null };
  if (["DISETUJUI", "OTOMATIS_DISETUJUI"].includes(s.status)) return { label: "Disetujui, belum dibayar", tone: "accent", info: fe?.approvedAt ? `Disetujui ${waktuWIB(fe.approvedAt)}` : (s.status === "OTOMATIS_DISETUJUI" ? "Disetujui otomatis oleh kebijakan" : null) };
  if (s.status === "MENUNGGU_PERSETUJUAN") return { label: "Menunggu persetujuan Finance", tone: "accent", info: null };
  if (s.status === "PERLU_REVISI") return { label: "Menunggu perbaikan pemohon", tone: "orange", info: null };
  return { label: "Belum diajukan", tone: "neutral", info: null };
}

export default function BiayaDetailScreen({ route, navigation }) {
  const t = useTheme();
  const { id } = route.params;
  const { user, abilities } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { aksi, ... }
  const [busy, setBusy] = useState(false);
  const [aksiError, setAksiError] = useState("");
  const kunci = useRef({});

  const muat = useCallback(async () => {
    setError("");
    try { setData(await biayaArmadaApi.detail(id)); }
    catch (e) { setError(e.message || "Gagal memuat"); }
  }, [id]);
  useEffect(() => navigation.addListener("focus", muat), [navigation, muat]);
  useEffect(() => { muat(); }, [muat]);

  // Kunci idempotensi dibuat SEKALI per aksi dan dipakai ulang saat "coba lagi"; dibuang setelah sukses.
  const kunciAksi = (nama) => (kunci.current[nama] ??= newIdempotencyKey(`ctl-${nama}`));

  async function jalankan(nama, fn) {
    setBusy(true); setAksiError("");
    try {
      await fn(kunciAksi(nama));
      delete kunci.current[nama];
      setModal(null);
      await muat();
    } catch (e) {
      setAksiError(e.message || "Aksi gagal");
    } finally { setBusy(false); }
  }

  if (!data) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
        {error ? <View style={{ padding: 16 }}><Box action={<Btn title="Coba lagi" kind="ghost" onPress={muat} />}>{error}</Box></View> : <ActivityIndicator style={{ marginTop: 40 }} color={t.accent} />}
      </SafeAreaView>
    );
  }

  const info = statusInfo(data.status);
  const aksi = allowedActions(data, abilities, user?.id);
  const bayar = statusPembayaran(data);
  const finId = data.finExpenseId;
  const ada = Object.values(aksi).some(Boolean);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink3, fontSize: 12 }}>{data.submissionNumber}</Text>
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: "800" }}>{formatRupiah(data.amount)}</Text>
          </View>
          <Chip label={info.label} tone={info.tone} />
        </View>

        {data.status === "PERLU_REVISI" && (
          <Box tone="orange">
            Perlu revisi{data.revisionRequestedBy?.name ? ` dari ${data.revisionRequestedBy.name}` : ""}: {data.revisionReason || "-"}
          </Box>
        )}
        {!!error && <Box>{error}</Box>}

        <Section title="Rincian">
          <Row label="Jenis biaya" value={data.expenseType} />
          <Row label="Tanggal" value={tanggalWIB(data.date)} />
          <Row label="Pemohon" value={data.requestedBy?.name} />
          <Row label="Kendaraan" value={data.vehicle?.plateNumber || data.vehiclePlateSnapshot} />
          <Row label="Rute" value={data.routeNameSnapshot || (data.route ? tanggalWIB(data.route.date) : null)} />
          <Row label="Job" value={data.job ? `${data.job.type === "PICKUP" ? "Ambil" : "Kirim"} · ${data.job.status}` : null} />
          <Row label="Vendor / tempat" value={data.vendorName} />
          {data.metadata?.odometerKm != null && <Row label="Odometer" value={`${data.metadata.odometerKm} km`} />}
          {data.metadata?.liters != null && <Row label="Liter" value={String(data.metadata.liters)} />}
          {!!data.description && <Row label="Keterangan" value={data.description} />}
          {!!data.notes && <Row label="Catatan" value={data.notes} />}
        </Section>

        <Section title="Status pembayaran">
          <View style={{ gap: 6 }}>
            <Chip label={bayar.label} tone={bayar.tone} />
            {!!bayar.info && <Text style={{ color: t.ink2, fontSize: 13 }}>{bayar.info}</Text>}
            {!!data.finExpense?.expenseNumber && <Row label="Dokumen Finance" value={data.finExpense.expenseNumber} />}
          </View>
        </Section>

        <Section title="Foto struk">
          {(data.proofs || []).length === 0 ? (
            <Text style={{ color: t.ink3, fontSize: 13 }}>Belum ada foto struk.</Text>
          ) : data.proofs.map((p) => (
            <View key={p.id} style={{ gap: 4 }}>
              <Image
                source={{ uri: client.mediaUrl(p.url), headers: client.getToken() ? { Authorization: `Bearer ${client.getToken()}` } : undefined }}
                style={[s.foto, { backgroundColor: t.field }]} resizeMode="contain" accessibilityLabel="Foto struk"
              />
              <Text style={{ color: t.ink3, fontSize: 12 }}>Versi {p.version} · {waktuWIB(p.createdAt)}</Text>
            </View>
          ))}
        </Section>

        <Section title="Riwayat">
          {(data.auditTrail || []).length === 0 ? (
            <Text style={{ color: t.ink3, fontSize: 13 }}>Belum ada riwayat.</Text>
          ) : data.auditTrail.map((a) => (
            <View key={a.id} style={s.tl}>
              <View style={[s.dot, { backgroundColor: t.accent }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 13 }}>{describeAudit(a)}</Text>
                <Text style={{ color: t.ink3, fontSize: 12 }}>{a.actor?.name || "Sistem"} · {waktuWIB(a.createdAt)}</Text>
              </View>
            </View>
          ))}
        </Section>

        {ada && <Text style={{ color: t.ink3, fontSize: 12 }}>Tombol di bawah hanya muncul sesuai izin akun dan status pengajuan.</Text>}
      </ScrollView>

      {ada && (
        <View style={[s.actions, { backgroundColor: t.bg, borderColor: t.border }]}>
          {aksi.edit && <Btn title="Perbaiki / edit" kind="ghost" onPress={() => navigation.navigate("BiayaForm", { id })} style={s.act} />}
          {aksi.ajukan && <Btn title={data.status === "PERLU_REVISI" ? "Ajukan ulang" : "Ajukan"} onPress={() => { setAksiError(""); setModal({ aksi: "ajukan" }); }} style={s.act} />}
          {aksi.tarik && <Btn title="Tarik kembali" kind="ghost" onPress={() => { setAksiError(""); setModal({ aksi: "tarik" }); }} style={s.act} />}
          {aksi.batalkan && <Btn title="Batalkan" kind="danger" onPress={() => { setAksiError(""); setModal({ aksi: "batalkan" }); }} style={s.act} />}
          {aksi.mintaRevisi && <Btn title="Minta revisi" kind="ghost" onPress={() => { setAksiError(""); setModal({ aksi: "revisi" }); }} style={s.act} />}
          {aksi.setujui && <Btn title="Setujui" onPress={() => { setAksiError(""); setModal({ aksi: "setujui" }); }} style={s.act} />}
          {aksi.tolak && <Btn title="Tolak" kind="danger" onPress={() => { setAksiError(""); setModal({ aksi: "tolak" }); }} style={s.act} />}
        </View>
      )}

      <ActionModal
        visible={modal?.aksi === "ajukan"} title={data.status === "PERLU_REVISI" ? "Ajukan ulang?" : "Ajukan biaya ini?"}
        message="Setelah diajukan, pengajuan menunggu persetujuan Finance dan tidak bisa diedit sampai ditarik atau diminta revisi."
        confirmLabel="Ajukan" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={() => jalankan("ajukan", (k) => biayaArmadaApi.ajukan(id, k))}
      />
      <ActionModal
        visible={modal?.aksi === "tarik"} title="Tarik kembali pengajuan?" message="Pengajuan kembali menjadi draf supaya bisa diedit."
        confirmLabel="Tarik" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={() => jalankan("tarik", (k) => biayaArmadaApi.tarik(id, k))}
      />
      <ActionModal
        visible={modal?.aksi === "batalkan"} title="Batalkan pengajuan?" message="Pengajuan yang dibatalkan tidak bisa dipakai lagi." danger reason reasonLabel="Alasan pembatalan"
        confirmLabel="Batalkan" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={(alasan) => jalankan("batalkan", (k) => biayaArmadaApi.batalkan(id, alasan, k))}
      />
      <ActionModal
        visible={modal?.aksi === "revisi"} title="Minta revisi" message="Pengajuan dikembalikan ke pemohon. Tulis apa yang perlu diperbaiki." reason reasonLabel="Yang perlu diperbaiki"
        confirmLabel="Kirim permintaan" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={(alasan) => jalankan("revisi", (k) => biayaArmadaApi.mintaRevisi(id, alasan, k))}
      />
      <ActionModal
        visible={modal?.aksi === "setujui"} title="Setujui pengajuan?" message={`Nominal ${formatRupiah(data.amount)} disetujui dan diteruskan ke Finance untuk dibayar.`}
        confirmLabel="Setujui" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={() => jalankan("setujui", (k) => biayaArmadaApi.setujui(finId, k))}
      />
      <ActionModal
        visible={modal?.aksi === "tolak"} title="Tolak pengajuan?" danger reason reasonLabel="Alasan penolakan"
        confirmLabel="Tolak" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={(alasan) => jalankan("tolak", (k) => biayaArmadaApi.tolak(finId, alasan, k))}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 24 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  foto: { width: "100%", height: 220, borderRadius: 10 },
  tl: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  act: { flexGrow: 1, minWidth: 120 },
});
