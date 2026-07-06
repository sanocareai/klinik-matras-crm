import nodemailer from "nodemailer";

// Kirim email alert ke admin
// Semua env var bersifat opsional — kalau tidak dikonfigurasi, fungsi ini throw Error
// sehingga caller bisa tangkap dan fallback ke logging.
export async function sendEmailAlert({ subject, text }) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    ALERT_EMAIL_TO,
    SMTP_FROM,
  } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_EMAIL_TO) {
    throw new Error(
      "SMTP belum dikonfigurasi — set SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO di .env"
    );
  }

  const port = parseInt(SMTP_PORT || "587");
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // SSL untuk port 465, STARTTLS untuk 587
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to: ALERT_EMAIL_TO,
    subject,
    text,
  });
}
