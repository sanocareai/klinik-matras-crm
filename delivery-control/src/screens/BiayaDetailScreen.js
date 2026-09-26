import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { allowedActions, describeAudit, formatRupiah, newIdempotencyKey, statusInfo } from "@sano/delivery-shared";
import { biayaArmadaApi, client } from "../client";
import { FotoStruk } from "../FotoStruk";
import { useSession } from "../SessionContext";
import { elevation, radius, type, useTheme } from "../theme";
import { tanggalWIB, waktuWIB } from "../format";
import { Icon, iconForExpense } from "../icons";
import { ActionModal, Box, Btn, Chip, Gradient, IconBox, Row, Section, StateView } from "../ui";

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
        {error
          ? <StateView icon="alert" tone="red" title="Detail belum dapat dimuat" message={error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={muat} />} />
          : <StateView loading title="Memuat detail…" />}
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
        <Gradient colors={[t.accentSoft, t.surface]} radius={radius.xl} style={[s.hero, { borderColor: t.border }, elevation(t, 1)]}>
          <View style={s.heroTop}>
            <IconBox name={iconForExpense(data.expenseType)} tone="accent" size={48} solid />
            <View style={{ flex: 1 }}>
              <Text style={[type.heading, { color: t.ink }]} numberOfLines={1}>{data.expenseType}</Text>
              <Text style={{ color: t.ink3, fontSize: 12 }}>{data.submissionNumber}</Text>
            </View>
            <Chip label={info.label} tone={info.tone} />
          </View>
          <Text style={[type.overline, { color: t.ink3, marginTop: 14 }]}>NOMINAL</Text>
          <Text style={[s.amount, { color: t.ink }]}>{formatRupiah(data.amount)}</Text>
          <View style={s.heroMeta}>
            <View style={s.meta}><Icon name="calendar" size={14} color={t.ink2} /><Text style={{ color: t.ink2, fontSize: 13 }}>{tanggalWIB(data.date)}</Text></View>
            {!!data.requestedBy?.name && <View style={s.meta}><Icon name="user" size={14} color={t.ink2} /><Text style={{ color: t.ink2, fontSize: 13 }} numberOfLines={1}>{data.requestedBy.name}</Text></View>}
          </View>
        </Gradient>

        {data.status === "PERLU_REVISI" && (
          <Box tone="orange" icon="edit">
            Perlu revisi{data.revisionRequestedBy?.name ? ` dari ${data.revisionRequestedBy.name}` : ""}: {data.revisionReason || "-"}
          </Box>
        )}
        {!!error && <Box>{error}</Box>}

        <Section title="Rincian" icon="fileText">
          <View>
            <Row icon="receipt" label="Jenis biaya" value={data.expenseType} />
            <Row icon="calendar" label="Tanggal" value={tanggalWIB(data.date)} />
            <Row icon="user" label="Pemohon" value={data.requestedBy?.name} />
            <Row icon="truck" label="Kendaraan" value={data.vehicle?.plateNumber || data.vehiclePlateSnapshot} />
            <Row icon="route" label="Rute" value={data.routeNameSnapshot || (data.route ? tanggalWIB(data.route.date) : null)} />
            <Row icon="box" label="Job" value={data.job ? `${data.job.type === "PICKUP" ? "Ambil" : "Kirim"} · ${data.job.status}` : null} />
            <Row icon="store" label="Vendor / tempat" value={data.vendorName} last={data.metadata?.odometerKm == null && data.metadata?.liters == null && !data.description && !data.notes} />
            {data.metadata?.odometerKm != null && <Row icon="gauge" label="Odometer" value={`${data.metadata.odometerKm} km`} />}
            {data.metadata?.liters != null && <Row icon="fuel" label="Liter" value={String(data.metadata.liters)} />}
            {!!data.description && <Row icon="note" label="Keterangan" value={data.description} />}
            {!!data.notes && <Row icon="note" label="Catatan" value={data.notes} last />}
          </View>
        </Section>

        <Section title="Status pembayaran" icon="wallet">
          <View style={s.bayar}>
            <IconBox name={bayar.tone === "green" ? "checkCircle" : bayar.tone === "red" ? "x" : bayar.tone === "orange" ? "edit" : "clock"} tone={bayar.tone} size={40} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.label, { color: t.ink, fontSize: 14 }]}>{bayar.label}</Text>
              {!!bayar.info && <Text style={{ color: t.ink2, fontSize: 13 }}>{bayar.info}</Text>}
            </View>
          </View>
          {!!data.finExpense?.expenseNumber && <Row icon="hash" label="Dokumen Finance" value={data.finExpense.expenseNumber} last />}
        </Section>

        <Section title="Foto struk" icon="camera">
          {(data.proofs || []).length === 0 ? (
            <View style={[s.fotoKosong, { backgroundColor: t.field, borderColor: t.fieldBorder }]}>
              <Icon name="image" size={26} color={t.ink3} />
              <Text style={{ color: t.ink3, fontSize: 13 }}>Belum ada foto struk.</Text>
            </View>
          ) : data.proofs.map((p) => (
            <View key={p.id} style={{ gap: 6 }}>
              <FotoStruk url={p.url} style={[s.foto, { backgroundColor: t.field }]} />
              <Text style={{ color: t.ink3, fontSize: 12 }}>Versi {p.version} · {waktuWIB(p.createdAt)}</Text>
            </View>
          ))}
        </Section>

        <Section title="Riwayat" icon="clock">
          {(data.auditTrail || []).length === 0 ? (
            <Text style={{ color: t.ink3, fontSize: 13 }}>Belum ada riwayat.</Text>
          ) : data.auditTrail.map((a, i) => {
            const akhir = i === data.auditTrail.length - 1;
            return (
              <View key={a.id} style={s.tl}>
                <View style={s.tlRail}>
                  <View style={[s.dot, { backgroundColor: i === 0 ? t.accent : t.surface, borderColor: t.accent }]} />
                  {!akhir && <View style={[s.line, { backgroundColor: t.borderStrong }]} />}
                </View>
                <View style={{ flex: 1, paddingBottom: akhir ? 0 : 14 }}>
                  <Text style={{ color: t.ink, fontSize: 14, fontWeight: "600", lineHeight: 19 }}>{describeAudit(a)}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{a.actor?.name || "Sistem"} · {waktuWIB(a.createdAt)}</Text>
                </View>
              </View>
            );
          })}
        </Section>

        {ada && (
          <View style={s.note}>
            <Icon name="shield" size={14} color={t.ink3} />
            <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>Tombol di bawah hanya muncul sesuai izin akun dan status pengajuan.</Text>
          </View>
        )}
      </ScrollView>

      {ada && (
        <View style={[s.actions, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 2)]}>
          {aksi.edit && <Btn title="Perbaiki / edit" kind="ghost" icon="edit" onPress={() => navigation.navigate("BiayaForm", { id })} style={s.act} />}
          {aksi.ajukan && <Btn title={data.status === "PERLU_REVISI" ? "Ajukan ulang" : "Ajukan"} icon="send" onPress={() => { setAksiError(""); setModal({ aksi: "ajukan" }); }} style={s.act} />}
          {aksi.tarik && <Btn title="Tarik kembali" kind="ghost" icon="undo" onPress={() => { setAksiError(""); setModal({ aksi: "tarik" }); }} style={s.act} />}
          {aksi.batalkan && <Btn title="Batalkan" kind="danger" icon="x" onPress={() => { setAksiError(""); setModal({ aksi: "batalkan" }); }} style={s.act} />}
          {aksi.mintaRevisi && <Btn title="Minta revisi" kind="secondary" icon="edit" onPress={() => { setAksiError(""); setModal({ aksi: "revisi" }); }} style={s.act} />}
          {aksi.setujui && <Btn title="Setujui" icon="checkCircle" onPress={() => { setAksiError(""); setModal({ aksi: "setujui" }); }} style={s.act} />}
          {aksi.tolak && <Btn title="Tolak" kind="danger" icon="x" onPress={() => { setAksiError(""); setModal({ aksi: "tolak" }); }} style={s.act} />}
        </View>
      )}

      <ActionModal
        visible={modal?.aksi === "ajukan"} title={data.status === "PERLU_REVISI" ? "Ajukan ulang?" : "Ajukan biaya ini?"}
        message="Setelah diajukan, pengajuan menunggu persetujuan Finance dan tidak bisa diedit sampai ditarik atau diminta revisi."
        confirmLabel="Ajukan" icon="send" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={() => jalankan("ajukan", (k) => biayaArmadaApi.ajukan(id, k))}
      />
      <ActionModal
        visible={modal?.aksi === "tarik"} title="Tarik kembali pengajuan?" message="Pengajuan kembali menjadi draf supaya bisa diedit."
        confirmLabel="Tarik" icon="undo" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={() => jalankan("tarik", (k) => biayaArmadaApi.tarik(id, k))}
      />
      <ActionModal
        visible={modal?.aksi === "batalkan"} title="Batalkan pengajuan?" message="Pengajuan yang dibatalkan tidak bisa dipakai lagi." danger reason reasonLabel="Alasan pembatalan"
        confirmLabel="Batalkan" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={(alasan) => jalankan("batalkan", (k) => biayaArmadaApi.batalkan(id, alasan, k))}
      />
      <ActionModal
        visible={modal?.aksi === "revisi"} title="Minta revisi" message="Pengajuan dikembalikan ke pemohon. Tulis apa yang perlu diperbaiki." reason reasonLabel="Yang perlu diperbaiki"
        confirmLabel="Kirim permintaan" icon="edit" busy={busy} error={aksiError} onCancel={() => setModal(null)}
        onConfirm={(alasan) => jalankan("revisi", (k) => biayaArmadaApi.mintaRevisi(id, alasan, k))}
      />
      <ActionModal
        visible={modal?.aksi === "setujui"} title="Setujui pengajuan?" message={`Nominal ${formatRupiah(data.amount)} disetujui dan diteruskan ke Finance untuk dibayar.`}
        confirmLabel="Setujui" icon="checkCircle" busy={busy} error={aksiError} onCancel={() => setModal(null)}
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
  body: { padding: 18, gap: 14, paddingBottom: 28 },
  hero: { padding: 18, borderWidth: 1 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  amount: { fontSize: 32, fontWeight: "800", letterSpacing: -0.8, fontVariant: ["tabular-nums"], marginTop: 2 },
  heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  bayar: { flexDirection: "row", alignItems: "center", gap: 12 },
  foto: { width: "100%", height: 240, borderRadius: radius.md },
  fotoKosong: { height: 120, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 6 },
  tl: { flexDirection: "row", gap: 12 },
  tlRail: { width: 14, alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, marginTop: 3 },
  line: { width: 2, flex: 1, marginTop: 2, borderRadius: 1 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 14, borderTopWidth: 1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  act: { flexGrow: 1, minWidth: 130 },
});
