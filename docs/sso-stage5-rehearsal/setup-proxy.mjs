// Siapkan reverse proxy TLS lokal (nginx di Docker) untuk rehearsal staging.
// Idempoten — aman dipanggil berkali-kali; TANPA rahasia (sertifikat
// self-signed dibuat lokal, bukan diunduh/ditanam).
//
// Same-domain embedding (Okt 2026) — SATU origin publik sekarang, bukan dua:
// /workspace/* -> HUB (basePath Next.js, lihat next.config.ts HUB), semua
// jalur lain -> SANSS, meniru persis topologi production yang diusulkan
// (app.sanomatrassehat.com/workspace di belakang nginx yang sama).
//
// Pakai: node setup-proxy.mjs [up|down]
//
// Variabel bisa ditimpa lewat env (lihat run-apps.mjs untuk port/origin yang
// HARUS cocok dengan ini): STAGE5_PROXY_DIR, STAGE5_SANSS_PORT,
// STAGE5_HUB_PORT, STAGE5_PUBLIC_PORT (publik, default 8443).
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROXY_DIR = process.env.STAGE5_PROXY_DIR || "C:\\tmp\\stage5-proxy";
const SANSS_PORT = process.env.STAGE5_SANSS_PORT || 41800;
const HUB_PORT = process.env.STAGE5_HUB_PORT || 31800;
const PUBLIC_PORT = process.env.STAGE5_PUBLIC_PORT || 8443;
const CONTAINER = "stage5-nginx";

const certsDir = path.join(PROXY_DIR, "certs");
const confDir = path.join(PROXY_DIR, "conf");

function up() {
  fs.mkdirSync(certsDir, { recursive: true });
  fs.mkdirSync(confDir, { recursive: true });

  const crt = path.join(certsDir, "stage5.crt");
  const key = path.join(certsDir, "stage5.key");
  if (!fs.existsSync(crt) || !fs.existsSync(key)) {
    console.log("membuat sertifikat self-signed (localhost, 7 hari)...");
    execSync(
      `openssl req -x509 -nodes -newkey rsa:2048 -days 7 -keyout "${key}" -out "${crt}" -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
      { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
    );
  } else {
    console.log("sertifikat sudah ada, dipakai ulang.");
  }

  const conf = `worker_processes 1;
events { worker_connections 1024; }

http {
  default_type application/octet-stream;
  sendfile off;

  # --- Satu origin publik: https://localhost:${PUBLIC_PORT} ---
  # /workspace/* -> HUB (basePath Next.js — diteruskan APA ADANYA, proxy_pass
  # TANPA path di sini supaya nginx tidak memotong prefiksnya: Next.js
  # sendiri yang mengharapkan /workspace tetap ada di URI masuk).
  # Semua jalur lain -> SANSS, seperti sebelumnya.
  server {
    listen ${PUBLIC_PORT} ssl;
    server_name localhost;
    ssl_certificate     /etc/nginx/certs/stage5.crt;
    ssl_certificate_key /etc/nginx/certs/stage5.key;

    # D-200 — blokir internal server-ke-server dari proxy PUBLIK (docs/HUB-SSO.md).
    # Panggilan sungguhan HUB->SANSS tetap jalan: HUB_INTERNAL_URL menunjuk
    # backend LANGSUNG (host.docker.internal:${SANSS_PORT}), bukan lewat proxy ini.
    location /api/hub/internal/ { return 404; }
    # Simetris dgn DEPLOYMENT.md §6b (HUB) — blokir SANSS->HUB revoke dari publik.
    # Path SUNGGUHAN di balik basePath adalah /workspace/api/sso/revoke.
    location /workspace/api/sso/revoke { return 404; }

    # Lebih spesifik dari location / di bawah — nginx selalu memilih prefix
    # terpanjang yang cocok, jadi urutan penulisan di sini tidak penting,
    # tapi location /workspace tetap menang untuk apa pun di bawahnya.
    #
    # DUA location, bukan satu — ditemukan lewat ERR_TOO_MANY_REDIRECTS nyata
    # di rehearsal: "location /workspace/ {...}" (dengan garis miring di akhir
    # pola) membuat nginx SENDIRI otomatis 301 "/workspace" -> "/workspace/"
    # (perilaku nginx yang terdokumentasi untuk location berpola trailing
    # slash) — sementara Next.js (trailingSlash default false) 308
    # "/workspace/" -> "/workspace" ke arah SEBALIKNYA. Dua redirect yang
    # berlawanan arah = lingkaran tak putus. "location = /workspace" (exact
    # match, TANPA garis miring) menyerap bentuk tanpa-slash SEBELUM nginx
    # sempat menambahkan sendiri, sehingga Next.js menerimanya persis seperti
    # yang sudah kanonik (tidak perlu redirect balik).
    location = /workspace {
      proxy_pass http://host.docker.internal:${HUB_PORT};
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-Host $http_host;
      proxy_set_header X-Real-IP $remote_addr;
    }
    location /workspace/ {
      proxy_pass http://host.docker.internal:${HUB_PORT};
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      # $http_host (BUKAN $host) — Next.js Server Actions (sisi HUB)
      # membandingkan X-Forwarded-Host dgn Origin APA ADANYA termasuk port.
      proxy_set_header X-Forwarded-Host $http_host;
      proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
      proxy_pass http://host.docker.internal:${SANSS_PORT};
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-Host $http_host;
      proxy_set_header X-Real-IP $remote_addr;
    }
  }
}
`;
  fs.writeFileSync(path.join(confDir, "nginx.conf"), conf);

  const running = execSync(`docker ps --filter name=${CONTAINER} --format "{{.Names}}"`, { encoding: "utf8" }).trim();
  if (running === CONTAINER) {
    console.log(`${CONTAINER} sudah jalan — restart supaya config terbaru terpakai.`);
    execFileSync("docker", ["restart", CONTAINER], { stdio: "inherit" });
    return;
  }
  try {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: "ignore" });
  } catch {
    /* tidak ada container lama — tidak masalah */
  }
  execFileSync(
    "docker",
    [
      "run", "-d", "--name", CONTAINER,
      "-p", `${PUBLIC_PORT}:${PUBLIC_PORT}`,
      "-v", `${confDir.replace(/\\/g, "/")}/nginx.conf:/etc/nginx/nginx.conf:ro`,
      "-v", `${certsDir.replace(/\\/g, "/")}:/etc/nginx/certs:ro`,
      "--add-host", "host.docker.internal:host-gateway",
      "nginx:alpine",
    ],
    { stdio: "inherit" },
  );
  console.log(`${CONTAINER} dijalankan. Publik: https://localhost:${PUBLIC_PORT} (SANSS di /, HUB di /workspace).`);
}

function down() {
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "inherit" });
  } catch {
    console.log(`${CONTAINER} sudah tidak ada.`);
  }
}

const cmd = process.argv[2] || "up";
if (cmd === "up") up();
else if (cmd === "down") down();
else {
  console.error("usage: setup-proxy.mjs [up|down]");
  process.exit(1);
}
