// Entry point aplikasi mobile Klinik Matras CRM.
// Navigasi: Login → Daftar Percakapan → Chat → Info Pelanggan
import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { LinearGradient } from "expo-linear-gradient";
// EasingReanimated di-alias SENGAJA: ada DUA `Easing` yang tidak bisa saling menggantikan.
// `Easing` dari react-native dipakai RN Animated (transitionSpec React Navigation); `Easing` dari
// Reanimated adalah worklet yang bisa dijalankan di UI thread. Menukar keduanya = app CRASH saat
// animasi mulai ("non-worklet function on the UI thread") — persis yang terjadi 19 Sep 2026 saat
// tab Inbox ditekan.
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, Easing as EasingReanimated,
} from "react-native-reanimated";
import { House, MessageCircle, Users, UserRound, ClipboardList } from "lucide-react-native";
import { setAudioModeAsync } from "expo-audio";
import { isExpoGo, getLaunchNotificationResponse } from "./src/push";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, View, Text, TextInput, StyleSheet, Pressable, Easing } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import ChatListScreen from "./src/screens/ChatListScreen";
import ChatScreen from "./src/screens/ChatScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import HomeScreen from "./src/screens/HomeScreen";
import PelangganScreen from "./src/screens/PelangganScreen";
import OrdersScreen from "./src/screens/OrdersScreen";
import CustomerDetailScreen from "./src/screens/CustomerDetailScreen";
import OrderTimelineScreen from "./src/screens/OrderTimelineScreen";
import ErrorBoundary from "./src/components/ErrorBoundary";
import InAppBanner from "./src/components/InAppBanner";
import SocketStatusBanner from "./src/components/SocketStatusBanner";
import { useColors } from "./src/theme";
import { useTokens, useIsDarkMode } from "./src/constants/theme";
import { queryClient } from "./src/lib/queryClient";
import { useSocketEvents } from "./src/hooks/useSocketEvents";
import { useBadgeSync } from "./src/hooks/useBadgeSync";
import { initOutboxFlush } from "./src/lib/outboxFlush";
import { checkForUpdateOnLaunch } from "./src/lib/autoUpdate";
import { navigationRef, navigateToChat } from "./src/lib/navigationRef";

// BUG (fix, audit startup): sebelum ini TIDAK ADA preventAutoHideAsync() sama
// sekali — splash native otomatis hilang begitu frame JS pertama di-render
// (perilaku default Expo), padahal `if (!fontsLoaded) return <View .../>`
// di App() di bawah masih menampilkan PERSEGI POLOS berwarna (bukan splash,
// bukan UI asli) selama useFonts() memuat 3 berat font Inter — jadi user
// melihat splash -> KEDIP ke kotak polos -> baru UI asli, bukan transisi
// mulus. Fix: tahan splash TETAP tampil (bukan konten pengganti apa pun)
// sampai font selesai dimuat, baru disembunyikan (lihat useEffect di App()).
SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// 4 tab bawah — gaya flat full-width ala Instagram (review Gilang: buang
// konsep floating/rounded/pill sebelumnya). Ikon lucide polos TANPA
// lingkaran/pill background sama sekali — aktif cuma beda warna+ketebalan
// stroke, non-aktif slate-400 biasa.
// "Order" ditambahkan 26 Jul 2026 (analisa gap fitur CRM web vs app) — sisi
// PENGERJAAN (antrean produksi lintas pelanggan), terpisah dari tab
// Pelanggan yang sisi PENJUALAN/pipeline. Ini gap paling bernilai buat sales
// di lapangan: sebelumnya "order mana yang sedang diproses?" tidak bisa
// dijawab tanpa buka satu-satu dari 1.297 pelanggan.
const TAB_ICONS = { Home: House, Chats: MessageCircle, Pelanggan: Users, Order: ClipboardList, Profil: UserRound };

// Tinggi AREA KONTEN bar — 52-56 (compact, TANPA circle/pill jadi tidak
// butuh ruang ekstra). paddingBottom dihitung terpisah di MainTabs() dari
// SATU sumber (bottomPad), bukan ditambah dua kali ke height & padding.
const TAB_BAR_CONTENT_HEIGHT = 56;
const TAB_ICON_SIZE = 24;

function TabIcon({ routeName, focused }) {
  const tokens = useTokens();
  const Icon = TAB_ICONS[routeName];
  // Flat — cuma warna & ketebalan stroke yang beda, TANPA lingkaran/pill
  // background, TANPA animasi (Instagram-style, polos).
  return (
    <Icon
      size={TAB_ICON_SIZE}
      color={focused ? tokens.color.accent : tokens.color.textMuted}
      strokeWidth={focused ? 2.5 : 2}
    />
  );
}

// Tombol tab kustom — GANTI TOTAL PlatformPressable bawaan bottom-tabs
// (di Android otomatis pasang android_ripple/shadow saat ditekan). Feedback
// tekan di sini CUMA opacity 0.6 sesaat, tanpa efek lain apa pun.
function TabBarButton({ children, style, ...rest }) {
  return (
    <Pressable
      {...rest}
      android_ripple={null}
      style={({ pressed }) => [style, tabStyles.item, pressed && tabStyles.itemPressed]}
    >
      {children}
    </Pressable>
  );
}

// Tab bar kapsul kaca (19 Sep 2026, redesain liquid glass). TETAP di dalam alur layout (bukan
// absolute) supaya konten layar tidak tertutup; area di belakang kapsul diberi warna dasar
// gradien agar menyatu dengan latar layar.
const PILL = 46; // diameter lingkaran aktif di tab bar

// Kurva gerak tunggal untuk seluruh perpindahan tab (pil + isi layar), meniru ease-out iOS:
// berangkat cepat, mendarat pelan. Timing, BUKAN pegas — pegas punya ekor panjang yang terbaca
// sebagai "delay" walau gerakannya sendiri halus.
const TAB_DUR = 220;
const TAB_BEZ = [0.33, 0, 0.2, 1];
// Untuk RN Animated (isi layar, lewat transitionSpec React Navigation).
const TAB_SPEC = { duration: TAB_DUR, easing: Easing.bezier(...TAB_BEZ) };
// Untuk Reanimated (pil di tab bar, berjalan di UI thread). Kurva & durasi identik dengan di atas
// supaya pil dan isi layar bergerak sebagai satu kesatuan — hanya mesin animasinya yang beda.
const PILL_SPEC = { duration: TAB_DUR, easing: EasingReanimated.bezier(...TAB_BEZ) };

// Perpindahan ISI LAYAR antar tab: geser murni (transform), TANPA opacity.
//
// Kedua preset bawaan React Navigation ("fade" dan "shift") sama-sama menganimasikan OPACITY satu
// layar penuh. Di Android itu memaksa lapisan seukuran layar digambar ulang ke buffer terpisah tiap
// frame — itulah "cross dissolve yang tidak halus" yang terlihat. Transform cuma memindahkan lapisan
// yang SUDAH jadi, jauh lebih murah, dan karena tiap layar punya latar sendiri yang menutup penuh,
// hasilnya terbaca sebagai geser bersih tanpa saling menembus.
function forSlide({ current }) {
  return {
    sceneStyle: {
      transform: [{
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-28, 0, 28],
        }),
      }],
    },
  };
}

// Satu tab: SATU ikon saja.
// Percobaan sebelumnya (19 Sep 2026) menumpuk dua ikon dan memudarkan opacity-nya. Itu terasa berat
// karena ikon lucide adalah SVG: menganimasikan opacity view berisi SVG memaksa Android menggambar
// ulang lapisan itu TIAP FRAME, dan jumlahnya jadi 10 SVG (2 × 5 tab). Warna sekarang berganti
// seketika — mata tidak menangkapnya karena perhatian mengikuti pil yang meluncur.
function GlassTabItem({ route, focused, slot, onPress, mutedColor }) {
  const Icon = TAB_ICONS[route.name];
  return (
    <Pressable
      onPress={onPress}
      android_ripple={null}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      style={{ width: slot || PILL, height: PILL, alignItems: "center", justifyContent: "center" }}
    >
      <Icon size={22} color={focused ? "#fff" : mutedColor} strokeWidth={focused ? 2.4 : 2} />
    </Pressable>
  );
}

// Tab bar kapsul kaca (19 Sep 2026, redesain liquid glass). TETAP di dalam alur layout (bukan
// absolute) supaya konten layar tidak tertutup; area di belakang kapsul diberi warna dasar
// gradien agar menyatu dengan latar layar.
//
// Pil biru TIDAK lagi muncul-hilang di tab yang berbeda (dulu potong mendadak) — satu pil yang sama
// MELUNCUR ke tab tujuan dengan pegas lembut, dijalankan Reanimated di UI thread.
function GlassTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const tokens = useTokens();
  const g = tokens.glass;
  const [lebar, setLebar] = useState(0);
  const jumlah = state.routes.length;
  const slot = lebar ? lebar / jumlah : 0;
  const progress = useSharedValue(state.index);
  const terakhir = useRef(state.index);

  // Jaring pengaman untuk perpindahan tab yang BUKAN dari tekan tombol (mis. dari notifikasi).
  // Perpindahan normal sudah digerakkan langsung di onPress di bawah.
  useEffect(() => {
    if (terakhir.current === state.index) return;
    terakhir.current = state.index;
    progress.value = withTiming(state.index, PILL_SPEC);
  }, [state.index, progress]);

  const pilStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * slot + (slot - PILL) / 2 }],
  }), [slot]);

  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10), backgroundColor: g.tabBarBg }}>
      <View
        onLayout={(e) => setLebar(e.nativeEvent.layout.width - 12)} // 12 = paddingHorizontal kiri+kanan
        style={[g.surface, g.shadow, { flexDirection: "row", alignItems: "center", height: 58, borderRadius: 30, paddingHorizontal: 6 }]}
      >
        {slot > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", left: 6, width: PILL, height: PILL, borderRadius: PILL / 2, overflow: "hidden" }, pilStyle]}
          >
            <LinearGradient colors={["#4C86FF", "#1F4FD8"]} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          return (
            <GlassTabItem
              key={route.key}
              route={route}
              focused={focused}
              slot={slot}
              mutedColor={tokens.color.textMuted}
              onPress={() => {
                const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (focused || e.defaultPrevented) return;
                // Pil bergerak SEKARANG, di frame yang sama dengan sentuhan — tidak menunggu React
                // selesai memproses perpindahan. Inilah yang menghilangkan kesan "delay"; versi
                // sebelumnya baru mulai bergerak setelah state navigasi berubah (±1-2 frame telat).
                terakhir.current = index;
                progress.value = withTiming(index, PILL_SPEC);
                navigation.navigate(route.name, route.params);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const tokens = useTokens();
  const tabBarBase = useMemo(() => createTabBarStyle(tokens), [tokens]);
  // SATU sumber kebenaran untuk padding bawah — dipakai PERSIS SEKALI di
  // total height DAN di paddingBottom (bukan dua nilai/dua tempat berbeda
  // yang keduanya menambahkan insets.bottom secara terpisah — itu penyebab
  // bar jadi gemuk di review sebelumnya). Math.max(..., 6) supaya tetap ada
  // jarak minimal di device tanpa gesture nav (insets.bottom bisa 0).
  const bottomPad = Math.max(insets.bottom, 6);
  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      // Layar tab tetap TERPASANG di hierarki native (default-nya dilepas & dipasang ulang tiap
      // pindah). Melepas-pasang itu pekerjaan native tepat saat animasi berjalan — sumber patah
      // yang tidak kelihatan dari sisi JS.
      detachInactiveScreens={false}
      screenOptions={({ route }) => ({
        headerShown: false,
        // Perpindahan tab: silang-pudar 160 ms. Durasi default (±250 ms) terasa menggantung karena
        // layar tujuan baru selesai dirender di awal animasi; 160 ms + easing keluar membuat
        // perpindahan terbaca "langsung" tapi tetap halus, dan dua layar tumpang tindih lebih singkat.
        // "shift" hanya dipakai untuk MENGAKTIFKAN animasi; gerakannya sendiri diambil alih
        // forSlide di atas (lihat alasannya di sana), dengan kurva & durasi yang sama persis
        // dengan pil di tab bar supaya keduanya bergerak sebagai satu kesatuan.
        animation: "shift",
        sceneStyleInterpolator: forSlide,
        transitionSpec: { animation: "timing", config: TAB_SPEC },
        // freezeOnBlur SENGAJA TIDAK dipakai di tab (dicoba & dicabut 19 Sep 2026): membekukan layar
        // berarti React harus merender ULANG SELURUH pohon layar tujuan tepat saat animasi mulai —
        // thread JS sibuk di 2-3 frame pertama dan perpindahan terlihat patah, justru gejala yang
        // mau dihilangkan. Kelima tab dibiarkan hidup; biayanya kecil karena layar-layar ini tidak
        // menjalankan timer sendiri, dan event socket hanya menyentuh Inbox.
        freezeOnBlur: false,
        tabBarShowLabel: false,
        tabBarIcon: ({ focused }) => <TabIcon routeName={route.name} focused={focused} />,
        tabBarButton: (props) => <TabBarButton {...props} />,
        // Total tinggi bar = TAB_BAR_CONTENT_HEIGHT + bottomPad, TIDAK LEBIH.
        tabBarStyle: [tabBarBase, { height: TAB_BAR_CONTENT_HEIGHT + bottomPad, paddingBottom: bottomPad }],
        tabBarActiveTintColor: tokens.color.accent,
        tabBarInactiveTintColor: tokens.color.textMuted,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Chats" component={ChatListScreen} options={{ lazy: false }} />
      <Tab.Screen name="Pelanggan" component={PelangganScreen} />
      <Tab.Screen name="Order" component={OrdersScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Bar butuh warna reaktif (createTabBarStyle di bawah, dipanggil dari
// MainTabs) — item/itemPressed TIDAK bergantung warna sama sekali (murni
// layout+opacity), jadi TETAP statis di sini & dipakai lintas komponen
// (TabBarButton, didefinisikan terpisah dari MainTabs, tidak bisa akses
// tokens reaktif punya MainTabs).
const tabStyles = StyleSheet.create({
  // 4 ikon terdistribusi merata — flex:1 per item (default bottom-tabs)
  // sudah otomatis space-evenly di dalam row penuh lebar bar.
  item: {
    flex: 1, alignItems: "center", justifyContent: "center", height: TAB_BAR_CONTENT_HEIGHT,
    shadowColor: "transparent", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0,
  },
  itemPressed: { opacity: 0.6 },
});

function createTabBarStyle(tokens) {
  // Flat full-width — TANPA margin, TANPA border radius, TANPA shadow
  // container. Pemisah dari konten cuma border-top hairline tipis.
  return {
    position: "relative",
    left: 0, right: 0, bottom: 0,
    borderRadius: 0,
    backgroundColor: tokens.color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.color.border,
    // Nol-kan eksplisit — jangan sampai warisan shadow token lain nempel lagi.
    shadowColor: "transparent", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0,
  };
}

// InboxScreen (M-B) pakai desain light-blue baru — beda dari Login/Chat yang
// masih gaya header biru tua lama. Warna strip status bar/notch ikut
// menyesuaikan layar aktif supaya tidak ada strip gelap ganjil di atas Inbox
// yang sudah terang.
//
// ⚠️ SafeAreaTopBg MEMBUNGKUS <NavigationContainer><Root/></NavigationContainer>
// dari LUAR Stack.Navigator (lihat App()) — jadi tidak bisa pakai
// useNavigationState/useRoute di sini, komponen ini BUKAN keturunan
// Stack.Navigator, cuma keturunan NavigationContainer (yang provide
// context "default" kosong sebelum ada Navigator aktif → error "Couldn't
// get the navigation state. Is your component inside a navigator?").
// Pola resmi React Navigation untuk kasus ini: pasang onStateChange di
// NavigationContainer, simpan nama route aktif ke state di App(), lalu
// teruskan sebagai prop ke sini.
const LIGHT_SCREENS = ["Home", "Chats", "Pelanggan", "Order", "Profil", "CustomerDetail"];
function SafeAreaTopBg({ routeName, children }) {
  const tokens = useTokens();
  const colors = useColors();
  const isDark = useIsDarkMode();
  const isLightScreen = LIGHT_SCREENS.includes(routeName);
  const bg = isLightScreen ? tokens.color.bg : colors.header;
  // Screen kategori "light-blue" (Home/Chats/dst) ikut scheme sistem: teks
  // status bar gelap di atas bg terang (light mode), putih di atas bg gelap
  // (dark mode). Screen kategori lama (header biru tua/navy, colors.header)
  // TETAP gelap di KEDUA varian tema (lihat DARK_COLOR di theme.js — header
  // dark-nya masih cukup gelap utk teks putih), jadi status bar-nya SELALU
  // "light" (teks putih) apa pun scheme-nya.
  const statusBarStyle = isLightScreen ? (isDark ? "light" : "dark") : "light";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <StatusBar style={statusBarStyle} />
      {children}
    </SafeAreaView>
  );
}

function respondToNotification(response) {
  const { conversationId, customerId, isGroup } = response?.notification?.request?.content?.data || {};
  const name = response?.notification?.request?.content?.title || "Pelanggan";
  navigateToChat({ conversationId, name, isGroup: !!isGroup, customerId });
}

function Root() {
  const { user, loading } = useAuth();
  const colors = useColors();

  // BUG (fix, 16 Agt 2026): sesi audio expo-audio SEBELUM INI cuma pernah
  // dikonfigurasi di dalam VoiceRecorderBar.js — saat MULAI rekam. Kalau
  // sales membuka chat dan langsung menekan play di voice note (miliknya
  // sendiri atau punya customer) TANPA pernah merekam dulu di sesi app itu,
  // sesi audio native belum pernah di-setup sama sekali → player.play()
  // tidak merespons (bukan error, cuma diam). Fix: inisialisasi sekali di
  // root app, sebelum layar mana pun butuh audio (rekam ATAU putar).
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
  }, []);

  // Socket.IO event → store, dan flush antrean outbox — aktif selama user
  // login, tidak peduli sedang di layar mana (Inbox/Chat/Customer).
  useSocketEvents();
  // Badge angka ikon app mengikuti total unread — lihat useBadgeSync.js.
  useBadgeSync();
  useEffect(() => {
    if (!user) return;
    const unsubscribe = initOutboxFlush();
    return unsubscribe;
  }, [user]);

  // Cek update OTA otomatis sekali tiap app dibuka (lihat lib/autoUpdate.js
  // untuk penjelasan kenapa cuma saat launch, bukan tiap kali kembali dari
  // background) — TIDAK bergantung `user` (jalan juga di layar Login),
  // supaya perbaikan penting tetap sampai walau sales belum sempat login.
  useEffect(() => { checkForUpdateOnLaunch(); }, []);

  // Ketuk notifikasi → langsung buka chat percakapan itu. Nama customer
  // diambil dari judul notifikasi (dikirim backend). Dilewati di Expo Go —
  // lihat catatan isExpoGo di src/push.js.
  //
  // 2 jalur ditangani (keduanya perlu, tidak saling gantikan):
  // 1. addNotificationResponseReceivedListener — app sudah berjalan
  //    (foreground/background), user tap notifikasi → listener ini terpanggil.
  // 2. getLaunchNotificationResponse() — app di-COLD-START (killed) lewat tap
  //    notifikasi. Listener #1 baru terpasang SETELAH app selesai boot, jadi
  //    response yang justru me-launch app bisa lewat tanpa terdeteksi kalau
  //    HANYA mengandalkan listener — perlu dicek eksplisit sekali di awal.
  useEffect(() => {
    if (isExpoGo || !user) return;
    getLaunchNotificationResponse().then((response) => {
      if (response) respondToNotification(response);
    });
    const Notifications = require("expo-notifications");
    const sub = Notifications.addNotificationResponseReceivedListener(respondToNotification);
    return () => sub.remove();
  }, [user]);

  // Masih membaca token tersimpan dari storage
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.header }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <>
      {/* Transisi seragam geser-dari-kanan, dijalankan react-native-screens di sisi native.
          freezeOnBlur SENGAJA tidak dipakai: layar di belakang (Inbox) harus tetap hidup supaya saat
          menekan kembali tidak ada render ulang besar yang bertabrakan dengan animasi. */}
      <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        {user ? (
          <>
            {/* MainTabs = 4 tab bawah (Home/Chats/Pelanggan/Profil). Layar di
                bawah ini di-push DI ATAS tab navigator — otomatis fullscreen
                & tab bar tersembunyi selama layar ini aktif (perilaku baku
                nested navigator React Navigation, tidak perlu config manual). */}
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen name="ChatRoom" component={ChatScreen} />
            <Stack.Screen name="CustomerDetail" component={CustomerDetailScreen} />
            <Stack.Screen name="OrderTimeline" component={OrderTimelineScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
      {user && <InAppBanner />}
      {user && <SocketStatusBanner />}
    </>
  );
}

// Terapkan Inter sebagai font default global (konsisten dengan CRM web) —
// dipasang sekali lewat defaultProps Text/TextInput, bukan per komponen.
let interAppliedGlobally = false;
function applyInterGlobally() {
  if (interAppliedGlobally) return;
  interAppliedGlobally = true;
  Text.defaultProps = Text.defaultProps || {};
  Text.defaultProps.style = [{ fontFamily: "Inter_400Regular" }, Text.defaultProps.style];
  TextInput.defaultProps = TextInput.defaultProps || {};
  TextInput.defaultProps.style = [{ fontFamily: "Inter_400Regular" }, TextInput.defaultProps.style];
}

// GAP (fix): dulu TIDAK ADA persistensi state navigasi sama sekali — kalau
// Android mematikan proses app ini di background (tekanan memori, umum
// terjadi kalau user buka app lain lumayan lama), JS runtime hilang total.
// Begitu user balik, app COLD-START ulang dari nol dan selalu mendarat di
// tab default (Home) — BUKAN melanjutkan tab/layar yang terakhir dibuka
// (mis. Inbox), walau dari sisi user terasa seperti app "masih jalan di
// background" (icon masih ada di recent apps). Fix: simpan state navigasi
// ke AsyncStorage tiap kali berubah, baca lagi sebagai initialState saat app
// benar-benar mulai ulang. Dibungkus try/catch KETAT — kalau gagal baca/
// parse apa pun, jatuh ke `undefined` (perilaku LAMA: mulai fresh dari Home),
// TIDAK PERNAH bikin app crash gara-gara data tersimpan yang rusak/dari versi
// lama yang skema layarnya sudah beda.
const NAV_PERSISTENCE_KEY = "navState_v1";

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [routeName, setRouteName] = useState();
  const [navReady, setNavReady] = useState(false);
  const [initialNavState, setInitialNavState] = useState();
  const colors = useColors();

  // Baru sembunyikan splash SETELAH font siap — lihat preventAutoHideAsync()
  // di atas kenapa ini penting (splash native tetap tampil menutupi jeda
  // ini, bukan kotak polos di bawahnya).
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // Baca state navigasi tersimpan SEKALI di awal — splash native (dipertahankan
  // lewat preventAutoHideAsync di atas) menutupi jeda baca AsyncStorage ini,
  // jadi tidak ada kedipan UI kosong sama sekali.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(NAV_PERSISTENCE_KEY)
      .then((raw) => { if (alive && raw) setInitialNavState(JSON.parse(raw)); })
      .catch(() => {}) // rusak/gagal baca → biarkan undefined, mulai fresh
      .finally(() => { if (alive) setNavReady(true); });
    return () => { alive = false; };
  }, []);

  if (!fontsLoaded || !navReady) {
    return <View style={{ flex: 1, backgroundColor: colors.header }} />;
  }
  applyInterGlobally();

  // Update nama route aktif lewat navigationRef (bukan hook) — dibaca ulang
  // saat navigator pertama kali siap (onReady) dan tiap kali state navigasi
  // berubah (onStateChange, misal push/pop/back). Sekalian simpan state
  // TERBARU ke AsyncStorage di sini (fire-and-forget — gagal simpan sekali
  // bukan hal fatal, cuma berarti restore berikutnya jatuh ke state sebelumnya).
  function syncRouteName(state) {
    setRouteName(navigationRef.getCurrentRoute()?.name);
    const s = state ?? navigationRef.getRootState?.();
    if (s) AsyncStorage.setItem(NAV_PERSISTENCE_KEY, JSON.stringify(s)).catch(() => {});
  }

  // ⚠️ URUTAN PROVIDER DI BAWAH PENTING, JANGAN DIBOLAK-BALIK.
  //
  // BUG BESAR YANG DIPERBAIKI (29 Agustus 2026, laporan owner "profil blank
  // di semua chat"): BottomSheetModalProvider SEBELUMNYA jadi pembungkus
  // PALING LUAR, di ATAS QueryClientProvider/SafeAreaProvider/AuthProvider.
  //
  // Kenapa itu fatal: @gorhom/bottom-sheet merender isi setiap
  // BottomSheetModal lewat @gorhom/portal, dan portal itu BUKAN
  // React.createPortal (yang mempertahankan context). Lihat sendiri di
  // node_modules/@gorhom/portal/…/PortalProvider.js — PortalHost dirender
  // sebagai SAUDARA dari {children}:
  //     <PortalStateContext.Provider>
  //       {children}                        ← seluruh app
  //       <PortalHost name={rootHostName}/>  ← isi sheet dirender DI SINI
  //     </PortalStateContext.Provider>
  // dan PortalHost.js merender `state.map(item => item.node)` — node-nya
  // dipasang ULANG di posisi HOST, bukan di posisi JSX-nya ditulis. Artinya
  // SEMUA context yang hidup di dalam {children} TIDAK terjangkau dari isi
  // sheet.
  //
  // Akibat nyatanya: CustomerSheet (bottom sheet) → CustomerProfileContent →
  // OrderFormModal, yang memanggil useAuth() (dapat null → destructuring
  // `const { user } = useAuth()` melempar TypeError) DAN useQuery() (tidak
  // menemukan QueryClient → melempar). Di build produksi tanpa error
  // boundary, render error = LAYAR KOSONG total, bukan pesan error.
  //
  // Perbaikan: QueryClientProvider/SafeAreaProvider/AuthProvider dipindah ke
  // LUAR BottomSheetModalProvider, sehingga PortalHost (yang hidup DI DALAM
  // BottomSheetModalProvider) ikut berada di dalam ketiga context itu.
  // BottomSheetModalProvider TETAP membungkus NavigationContainer, jadi sheet
  // tetap tampil di atas semua layar seperti sebelumnya.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            {/* ErrorBoundary sengaja MEMBUNGKUS BottomSheetModalProvider,
                bukan cuma <Root/>: isi bottom sheet dirender lewat PortalHost
                yang hidup DI DALAM provider ini (di luar Root), jadi boundary
                di dalam Root TIDAK akan pernah menangkap error dari isi
                sheet — persis kelas error yang bikin layar kosong kemarin. */}
            <ErrorBoundary>
              <BottomSheetModalProvider>
                <NavigationContainer
                  ref={navigationRef}
                  initialState={initialNavState}
                  onReady={() => syncRouteName()}
                  onStateChange={syncRouteName}
                >
                  <SafeAreaTopBg routeName={routeName}>
                    <Root />
                  </SafeAreaTopBg>
                </NavigationContainer>
              </BottomSheetModalProvider>
            </ErrorBoundary>
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
