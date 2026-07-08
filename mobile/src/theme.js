// Palet warna gaya WhatsApp + aksen brand Klinik Matras.
// Dipusatkan di sini supaya konsisten & gampang diubah.
export const colors = {
  // Gaya WhatsApp
  header: "#075E54",        // hijau tua header
  headerText: "#ffffff",
  accent: "#25D366",        // hijau tombol/FAB
  chatBg: "#ECE5DD",        // latar area chat
  bubbleOut: "#DCF8C6",     // bubble pesan keluar
  bubbleIn: "#ffffff",      // bubble pesan masuk
  tick: "#4FC3F7",

  // Umum
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e5e7eb",
  text: "#111827",
  textSecondary: "#6b7280",
  textMuted: "#9ca3af",
  danger: "#dc2626",
  warning: "#f59e0b",
  primary: "#2563eb",       // biru brand CRM (badge, link)
};

// Warna avatar inisial — sama seperti versi web
export const avatarColors = [
  "#2563eb", "#16a34a", "#f59e0b", "#dc2626",
  "#7c3aed", "#ec4899", "#f97316", "#0891b2",
];

// Badge warna per pipeline stage (konsisten dengan design system web)
export const stageColors = {
  LEAD: "#f59e0b",
  QUALIFIED: "#2563eb",
  QUOTED: "#7c3aed",
  WON: "#16a34a",
  LOST: "#dc2626",
};

export const stageLabels = {
  LEAD: "Lead",
  QUALIFIED: "Qualified",
  QUOTED: "Offers/Negosiasi",
  WON: "Won",
  LOST: "Lost",
};
