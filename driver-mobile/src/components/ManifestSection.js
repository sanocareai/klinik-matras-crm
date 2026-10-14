// Manifest barang + checklist muat di kartu job driver. Sumber = job.manifest dari server (unit tertaut ke job); progres efektif = server ∪ antrean offline.
// Tampilkan: qty, nama produk, ukuran, spesifikasi, dan U1/U2/U3 (ketuk satu unit = konfirmasi unit itu; "Semua dimuat" = semua).
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Boxes, CheckCircle2, Circle } from "lucide-react-native";
import { useTheme } from "../hooks/useTheme";
import { manifestOf, teksBaris, progresMuatEfektif, bolehKonfirmasiMuat, muatTertunda } from "../lib/manifestView";

export default function ManifestSection({ job, queue = [], onKonfirmasi, busy = false, gerbangAktif = false }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [buka, setBuka] = useState(true);
  const m = manifestOf(job);
  if (!m) return null;
  const progres = progresMuatEfektif(job, queue);
  const bisaKonfirmasi = bolehKonfirmasiMuat(job) && typeof onKonfirmasi === "function";
  const tertunda = muatTertunda(queue, job.id);

  return (
    <View style={styles.box} testID="manifest-section">
      <Pressable style={styles.head} onPress={() => setBuka((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: buka }}>
        <Boxes size={14} color={theme.INK2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>BARANG YANG DIBAWA</Text>
          <Text style={styles.ringkas} testID="manifest-ringkas">{m.ringkas}</Text>
        </View>
        <Text style={styles.toggle}>{buka ? "Tutup" : "Buka"}</Text>
      </Pressable>

      {buka && (
        <View style={styles.body}>
          {m.baris.length === 0 && <Text style={styles.muted}>Belum ada unit tertaut pada job ini.</Text>}
          {m.baris.map((b, i) => (
            <View key={`${b.nama}-${i}`} style={[styles.baris, b.bundel ? { marginLeft: 10 } : null]} testID="manifest-baris">
              {b.bundel && i === 0 || (b.bundel && m.baris[i - 1]?.bundel?.no !== b.bundel.no)
                ? <Text style={styles.set}>Set {b.bundel.nama}</Text> : null}
              <Text style={styles.barisTeks}>{teksBaris(b)}</Text>
              <View style={styles.unitRow}>
                {b.unit.map((u) => {
                  const sudah = u.dimuat || tertunda.semua || tertunda.unitIds.has(u.id);
                  const Ikon = sudah ? CheckCircle2 : Circle;
                  const bisaKetuk = bisaKonfirmasi && !sudah && !busy;
                  return (
                    <Pressable
                      key={u.id ?? u.kode}
                      disabled={!bisaKetuk}
                      onPress={() => onKonfirmasi({ unitIds: [u.id] })}
                      style={[styles.unit, sudah ? styles.unitOk : null]}
                      accessibilityLabel={`${u.label} ${sudah ? "sudah dimuat" : "belum dimuat"}`}
                      testID={`unit-${u.label}`}
                    >
                      <Ikon size={12} color={sudah ? theme.GREEN : theme.INK3} />
                      <Text style={[styles.unitTeks, sudah ? { color: theme.GREEN } : null]}>{u.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {m.sumber ? <Text style={styles.sumber} testID="manifest-sumber">Sumber: {m.sumber.label}</Text> : null}
          {m.sumber?.picLead ? <Text style={styles.picLead} testID="manifest-pic-lead">PIC lead: {m.sumber.picLead}</Text> : null}
          {m.tambahanBelumMasuk?.length > 0 ? (
            <Text style={styles.peringatan}>
              Ada tambahan pesanan yang belum masuk job ini: {m.tambahanBelumMasuk.map((u) => u.label).join(", ")} — hubungi dispatcher.
            </Text>
          ) : null}
        </View>
      )}

      {progres && progres.total > 0 && (
        <View style={styles.muat} testID="muat-barang">
          <View style={styles.muatHead}>
            <Text style={[styles.muatLabel, progres.lengkap ? { color: theme.GREEN } : null]} testID="muat-label">{progres.label}</Text>
            {bisaKonfirmasi && !progres.lengkap && (
              <Pressable style={[styles.semuaBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => onKonfirmasi({ semua: true })} testID="muat-semua">
                <Text style={styles.semuaBtnTeks}>Semua dimuat</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((progres.dimuat / progres.total) * 100)}%`, backgroundColor: progres.lengkap ? theme.GREEN : theme.ACCENT }]} />
          </View>
          {gerbangAktif && !progres.lengkap && bolehKonfirmasiMuat(job) && (
            <Text style={styles.wajib}>Konfirmasi semua unit dimuat sebelum menyelesaikan pengiriman.</Text>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    box: { borderWidth: 1, borderColor: t.BORDER, borderRadius: 12, marginTop: 8, backgroundColor: t.FIELD_BG },
    head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
    kicker: { color: t.INK3, fontSize: 9.5, fontWeight: "700", letterSpacing: 0.6 },
    ringkas: { color: t.INK, fontSize: 13, fontWeight: "700", marginTop: 1 },
    toggle: { color: t.ACCENT, fontSize: 11, fontWeight: "700" },
    body: { paddingHorizontal: 10, paddingBottom: 8, gap: 8, borderTopWidth: 1, borderTopColor: t.BORDER, paddingTop: 8 },
    muted: { color: t.INK3, fontSize: 12 },
    baris: { gap: 4 },
    set: { color: t.INK3, fontSize: 10.5, fontWeight: "700", textTransform: "uppercase" },
    barisTeks: { color: t.INK, fontSize: 13, fontWeight: "700" },
    unitRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    unit: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6, minHeight: 32, borderRadius: 100, backgroundColor: t.SURFACE, borderWidth: 1, borderColor: t.BORDER },
    unitOk: { borderColor: t.GREEN + "66" },
    unitTeks: { color: t.INK, fontSize: 12, fontWeight: "700" },
    sumber: { color: t.INK2, fontSize: 12 },
    picLead: { color: t.INK3, fontSize: 11.5 },
    peringatan: { color: t.ORANGE, fontSize: 11.5, fontWeight: "700" },
    muat: { paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.BORDER, gap: 6 },
    muatHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    muatLabel: { color: t.INK, fontSize: 12.5, fontWeight: "700", flex: 1 },
    semuaBtn: { backgroundColor: t.ACCENT_BG, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, minHeight: 34, justifyContent: "center" },
    semuaBtnTeks: { color: t.ACCENT, fontSize: 12, fontWeight: "700" },
    track: { height: 6, borderRadius: 3, backgroundColor: t.TRACK_BG, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3 },
    wajib: { color: t.ORANGE, fontSize: 11, fontWeight: "700" },
  });
}
