let transporter = null;

try {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.ionos.de',
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
} catch (e) {
  console.warn('nodemailer nicht verfügbar:', e.message);
}

async function sendActivationMail({ to, name, activationUrl }) {
  if (!transporter) {
    console.warn('Kein SMTP-Transporter – Aktivierungsmail übersprungen.');
    console.log('Aktivierungslink:', activationUrl);
    return;
  }
  await transporter.sendMail({
    from:    `BeeQu <${process.env.SMTP_USER}>`,
    to,
    subject: 'BeeQu – Account aktivieren',
    html: `
      <!DOCTYPE html>
      <html lang="de">
      <head><meta charset="UTF-8"></head>
      <body style="margin:0;padding:0;background:#f4f7fb;font-family:Inter,-apple-system,sans-serif;">
        <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:20px;box-shadow:0 4px 32px rgba(0,122,255,0.10);overflow:hidden;">
          <div style="background:linear-gradient(135deg,#007AFF,#5856D6);padding:32px 36px 28px;">
            <span style="font-size:1.4rem;font-weight:800;color:#fff;letter-spacing:-0.03em;">🐝 BeeQu</span>
            <h1 style="color:#fff;font-size:1.4rem;font-weight:800;margin:16px 0 4px;letter-spacing:-0.03em;">Hallo ${name}! 👋</h1>
            <p style="color:rgba(255,255,255,0.8);margin:0;font-size:0.95rem;">Aktiviere jetzt deinen Account.</p>
          </div>
          <div style="padding:32px 36px;">
            <p style="color:#1C1C1E;font-size:1rem;line-height:1.65;margin:0 0 24px;">
              Willkommen bei BeeQu – deiner smarten Aufgaben-App.<br>
              Klicke auf den Button um deinen Account zu aktivieren:
            </p>
            <a href="${activationUrl}"
               style="display:inline-block;background:#007AFF;color:#fff;font-weight:700;font-size:1rem;padding:14px 32px;border-radius:12px;text-decoration:none;">
              Account aktivieren →
            </a>
            <p style="color:#8E8E93;font-size:0.82rem;margin:24px 0 0;line-height:1.5;">
              Der Link ist 24 Stunden gültig.
            </p>
          </div>
          <div style="background:#f4f7fb;padding:14px 36px;border-top:1px solid rgba(0,0,0,0.06);">
            <p style="color:#AEAEB2;font-size:0.78rem;margin:0;">© 2026 BeeTwice GmbH</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

module.exports = { sendActivationMail };
