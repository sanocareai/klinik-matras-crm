import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guard arsitektur performa: gagal kalau ada yang menarik fitur berat ke jalur startup,
// membuat callback bubble tidak stabil, atau menambah kebocoran object URL/timer.
// (Bukti runtime: perf-harness/ — render count, long task, heap.)
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

// ── Graf import STATIS dari main.jsx (dynamic import() tidak diikuti) ──────────
const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return { pkg: spec };
  for (const c of [base, base + ".js", base + ".jsx", path.join(base, "index.js"), path.join(base, "index.jsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return { file: c };
  }
  return {};
}
function staticGraph(entry) {
  const files = new Set(), pkgs = new Set(), queue = [entry];
  while (queue.length) {
    const f = queue.pop(); if (files.has(f)) continue; files.add(f);
    if (!/\.(jsx?|mjs)$/.test(f)) continue;
    const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(STATIC_IMPORT)) {
      const r = resolveImport(f, m[1]);
      if (r.pkg) pkgs.add(r.pkg); else if (r.file) queue.push(r.file);
    }
  }
  return { files, pkgs };
}
const graph = staticGraph(path.join(SRC, "main.jsx"));
const rel = (f) => path.relative(SRC, f).replaceAll("\\", "/");

test("lazy-load: fitur berat TIDAK ada di graf import statis startup", () => {
  const heavyFiles = ["components/knowledge/MarkdownEditor.jsx", "components/customer/OrderSection.jsx", "features/inbox/components/CustomerPanel/OrderEditDrawer.jsx", "features/inbox/components/ChatWindow/MediaUploader.jsx", "features/inbox/components/ChatWindow/VoiceRecorder.jsx", "pages/Dashboard.jsx", "pages/Laporan.jsx"];
  const heavyPkgs = ["recharts", "@uiw/react-codemirror", "@codemirror/view", "@emoji-mart/react", "@emoji-mart/data", "yet-another-react-lightbox", "react-markdown", "xlsx", "@react-google-maps/api", "react-easy-crop"];
  const reachable = [...graph.files].map(rel);
  assert.deepEqual(heavyFiles.filter((f) => reachable.includes(f)), [], "file berat ter-import statis dari startup");
  assert.deepEqual(heavyPkgs.filter((p) => graph.pkgs.has(p)), [], "paket berat ter-import statis dari startup");
});

test("vite.config: clsx dipisah dari chunk recharts (kalau tidak, entry mengunduh chart)", () => {
  const cfg = readFileSync(path.join(SRC, "../vite.config.js"), "utf8");
  assert.match(cfg, /"vendor-utils":\s*\[[^\]]*"clsx"/);
});

test("drawer order & panel berat di-mount hanya setelah dibuka (lazy + guard mount)", () => {
  const composer = read("features/inbox/components/ChatWindow/Composer.jsx");
  assert.match(composer, /const OrderEditDrawer = lazy\(/);
  assert.match(composer, /\(showCreateOrder \|\| createOrderMounted\.current\) && \(/);
  const panel = read("features/inbox/components/CustomerPanel/index.jsx");
  assert.match(panel, /const OrderEditDrawer = lazy\(/);
  assert.match(panel, /drawerMounted\.current\) && \(/);
});

// ── Isolasi render ─────────────────────────────────────────────────────────────
test("render isolation: MessageList memberi bubble callback STABIL & itemContent stabil", () => {
  const ml = read("features/inbox/components/ChatWindow/MessageList.jsx");
  assert.match(ml, /itemContent=\{renderItem\}/);
  assert.match(ml, /const renderItem = useCallback\(/);
  const jsx = ml.slice(ml.indexOf("const renderItem = useCallback("), ml.indexOf("if (!conversationId) return null;"));
  for (const prop of ["onReply", "onForward", "onEdit", "onRetry", "onOpenMedia", "onDeleteLocal", "onDeleteEveryone", "onEnterSelection", "onToggleSelect", "onJumpToReply"]) {
    assert.doesNotMatch(jsx, new RegExp(`${prop}=\\{\\(`), `${prop} tidak boleh arrow inline`);
    assert.match(jsx, new RegExp(`${prop}=\\{[^}]*stable\\.${prop}`));
  }
  assert.match(read("features/inbox/components/ChatWindow/MessageBubble.jsx"), /export default memo\(MessageBubbleBase\)/);
});

test("render isolation: Inbox tidak subscribe total unread; ConversationItem tidak subscribe id aktif", () => {
  const inbox = read("pages/Inbox.jsx");
  const body = inbox.slice(inbox.indexOf("export default function Inbox"));
  assert.doesNotMatch(body, /useTotalUnreadCount\(/);
  assert.match(inbox, /function UnreadTitle\(\)/);
  const item = read("features/inbox/components/ConversationList/ConversationItem.jsx");
  assert.doesNotMatch(item, /useActiveId\(\)/);
  assert.match(item, /s\.activeConversationId === id/);
});

test("render isolation: state ketikan (draft) ada di composerStore, bukan di MessageList/ChatWindow", () => {
  const ml = read("features/inbox/components/ChatWindow/MessageList.jsx");
  const cw = read("features/inbox/components/ChatWindow/index.jsx");
  assert.doesNotMatch(ml, /useDraft|composerStore/);
  assert.doesNotMatch(cw, /useDraft\(/);
});

test("virtualization: daftar percakapan & pesan memakai Virtuoso, posisi scroll dijaga saat prepend", () => {
  assert.match(read("features/inbox/components/ConversationList/index.jsx"), /<Virtuoso/);
  const ml = read("features/inbox/components/ChatWindow/MessageList.jsx");
  assert.match(ml, /<Virtuoso/);
  assert.match(ml, /firstItemIndex=\{firstItemIndex\}/);
});

// ── Cleanup ────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) { const p = path.join(dir, n); statSync(p).isDirectory() ? walk(p, out) : /\.(jsx?|mjs)$/.test(n) && out.push(p); }
  return out;
}
test("cleanup: tiap file yang membuat object URL juga melepasnya, dan tidak membuatnya di dalam render", () => {
  for (const f of walk(SRC)) {
    const code = readFileSync(f, "utf8");
    if (!code.includes("createObjectURL")) continue;
    assert.ok(code.includes("revokeObjectURL"), `${rel(f)} membuat object URL tapi tidak pernah melepasnya`);
    assert.doesNotMatch(code, /src=\{URL\.createObjectURL\(/, `${rel(f)}: createObjectURL di dalam render bocor tiap render`);
  }
});

test("cleanup: VoiceRecorder mematikan mikrofon, timer & object URL saat unmount", () => {
  const code = read("features/inbox/components/ChatWindow/VoiceRecorder.jsx");
  const eff = code.slice(code.indexOf("useEffect(() => () => {"));
  assert.match(eff, /clearInterval\(timerRef\.current\)/);
  assert.match(eff, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  assert.match(eff, /revokeObjectURL/);
});

test("cleanup: setInterval selalu punya clearInterval di file yang sama", () => {
  for (const f of walk(SRC)) {
    const code = readFileSync(f, "utf8");
    if (/\bsetInterval\(/.test(code)) assert.match(code, /clearInterval\(/, `${rel(f)} setInterval tanpa clearInterval`);
  }
});

test("media: bubble & galeri memakai thumbnail, bukan file resolusi penuh", () => {
  assert.match(read("features/inbox/components/ChatWindow/MessageBubble.jsx"), /src=\{thumbUrl\(m\.mediaUrl, 480\)\}/);
  assert.match(read("features/inbox/components/CustomerPanel/MediaGallery.jsx"), /src=\{thumbUrl\(m\.mediaUrl, 320\)\}/);
});
