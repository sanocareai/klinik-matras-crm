// Siapkan reverse proxy TLS lokal (nginx di Docker) untuk rehearsal staging.
// Idempoten — aman dipanggil berkali-kali; TANPA rahasia (sertifikat
// self-signed dibuat lokal, bukan diunduh/ditanam).
//
// Pakai: node setup-proxy.mjs [up|down]
//
// Variabel bisa ditimpa lewat env (lihat run-apps.mjs untuk port/origin yang
// HARUS cocok dengan ini): STAGE5_PROXY_DIR, STAGE5_SANSS_PORT,
// STAGE5_HUB_PORT, STAGE5_SANSS_PROXY_PORT (publik 8443), STAGE5_HUB_PROXY_PORT (publik 9443).
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROXY_DIR = process.env.STAGE5_PROXY_DIR || "C:\\tmp\\stage5-proxy";
const SANSS_PORT = process.env.STAGE5_SANSS_PORT || 41800;
const HUB_PORT = process.env.STAGE5_HUB_PORT || 31800;
const SANSS_PROXY_PORT = process.env.STAGE5_SANSS_PROXY_PORT || 8443;
const HUB_PROXY_PORT = process.env.STAGE5_HUB_PROXY_PORT || 9443;
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

  # --- SANSS publik: https://localhost:${SANSS_PROXY_PORT} -> 127.0.0.1:${SANSS_PORT} ---
  server {
    listen ${SANSS_PROXY_PORT} ssl;
    server_name localhost;
    ssl_certificate     /etc/nginx/certs/stage5.crt;
    ssl_certificate_key /etc/nginx/certs/stage5.key;

    # D-200 — blokir internal server-ke-server dari proxy PUBLIK (docs/HUB-SSO.md).
    # Panggilan sungguhan HUB->SANSS tetap jalan: HUB_INTERNAL_URL menunjuk
    # backend LANGSUNG (host.docker.internal:${SANSS_PORT}), bukan lewat proxy ini.
    location /api/hub/internal/ { return 404; }

    location / {
      proxy_pass http://host.docker.internal:${SANSS_PORT};
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      # $http_host (BUKAN $host) — Next.js Server Actions (sisi HUB)
      # membandingkan X-Forwarded-Host dgn Origin APA ADANYA termasuk port.
      proxy_set_header X-Forwarded-Host $http_host;
      proxy_set_header X-Real-IP $remote_addr;
    }
  }

  # --- HUB publik: https://localhost:${HUB_PROXY_PORT} -> 127.0.0.1:${HUB_PORT} ---
  server {
    listen ${HUB_PROXY_PORT} ssl;
    server_name localhost;
    ssl_certificate     /etc/nginx/certs/stage5.crt;
    ssl_certificate_key /etc/nginx/certs/stage5.key;

    # Simetris dgn DEPLOYMENT.md §6b (HUB) — blokir SANSS->HUB revoke dari publik.
    location /api/sso/revoke { return 404; }

    location / {
      proxy_pass http://host.docker.internal:${HUB_PORT};
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
      "-p", `${SANSS_PROXY_PORT}:${SANSS_PROXY_PORT}`,
      "-p", `${HUB_PROXY_PORT}:${HUB_PROXY_PORT}`,
      "-v", `${confDir.replace(/\\/g, "/")}/nginx.conf:/etc/nginx/nginx.conf:ro`,
      "-v", `${certsDir.replace(/\\/g, "/")}:/etc/nginx/certs:ro`,
      "--add-host", "host.docker.internal:host-gateway",
      "nginx:alpine",
    ],
    { stdio: "inherit" },
  );
  console.log(`${CONTAINER} dijalankan. Publik: https://localhost:${SANSS_PROXY_PORT} (SANSS), https://localhost:${HUB_PROXY_PORT} (HUB).`);
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
