// nodemailer wird zur Laufzeit geladen damit ein fehlender
// require() die Vercel-Function nicht mit exit 1 beendet
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const nm = require('nodemailer');
    transporter = nm.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.ionos.de',
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  } catch {
    return null;
  }
}

async function sendActivationMail({ to, name, activationUrl }) {
  const t = getTransporter();
  if (!t) {
    console.warn('Kein SMTP-Transporter – Aktivierungsmail übersprungen.');
    console.log('Aktivierungslink (manuell):', activationUrl);
    return;
  }
  await t.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'BeeQu – Account aktivieren',
    html: `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BeeQu – Account aktivieren</title>
</head>
<body style="margin:0;padding:0;background:#06060A;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#06060A;min-height:100vh;">
    <tr>
      <td align="center" style="padding:48px 16px;">

        <!-- Card -->
        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;border-radius:24px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,0.08),0 32px 80px rgba(0,0,0,0.6);">

          <!-- Hero header -->
          <tr>
            <td style="background:linear-gradient(135deg,#007AFF 0%,#5856D6 100%);padding:40px 44px 36px;position:relative;">
              <!-- Grid overlay effect via border -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <!-- Brand -->
                    <p style="margin:0 0 28px 0;font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.04em;">
                      🐝 BeeQu
                    </p>
                    <!-- Headline -->
                    <h1 style="margin:0 0 10px 0;font-size:32px;font-weight:900;color:#fff;letter-spacing:-0.05em;line-height:1.05;">
                      Hallo ${name}! 👋
                    </h1>
                    <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.65);font-weight:400;line-height:1.5;">
                      Ein letzter Schritt – aktiviere jetzt deinen Account.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- White body -->
          <tr>
            <td style="background:#ffffff;padding:40px 44px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">

                <!-- Feature pills -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:rgba(0,122,255,0.08);border-radius:999px;padding:7px 14px;margin-right:8px;font-size:13px;font-weight:600;color:#007AFF;white-space:nowrap;">
                          ✦ KI-Aufgaben
                        </td>
                        <td width="8"></td>
                        <td style="background:rgba(88,86,214,0.08);border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#5856D6;white-space:nowrap;">
                          📅 Kalender
                        </td>
                        <td width="8"></td>
                        <td style="background:rgba(52,199,89,0.08);border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#34C759;white-space:nowrap;">
                          👥 Teams
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Body text -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:16px;color:#3C3C43;line-height:1.7;">
                      Willkommen bei <strong style="color:#1C1C1E;">BeeQu</strong> – deiner smarten Produktivitäts-App mit KI-Assistent, intelligentem Kalender und Team-Collaboration.
                    </p>
                    <p style="margin:16px 0 0;font-size:16px;color:#3C3C43;line-height:1.7;">
                      Klicke auf den Button um deinen Account zu aktivieren und direkt loszulegen:
                    </p>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td style="padding-bottom:32px;">
                    <a href="${activationUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#007AFF,#5856D6);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 36px;border-radius:14px;letter-spacing:-0.01em;box-shadow:0 8px 28px rgba(0,122,255,0.35);">
                      Account aktivieren &rarr;
                    </a>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="border-top:1px solid rgba(0,0,0,0.07);padding-top:24px;">
                    <p style="margin:0;font-size:13px;color:#8E8E93;line-height:1.6;">
                      Der Link ist <strong style="color:#3C3C43;">24 Stunden gültig</strong>. Falls du dich nicht bei BeeQu registriert hast, kannst du diese E-Mail einfach ignorieren.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0D0D14;padding:20px 44px;border-top:1px solid rgba(255,255,255,0.06);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);">
                      © 2026 BeeTwice GmbH &nbsp;·&nbsp;
                      <a href="https://beequ.de" style="color:rgba(255,255,255,0.4);text-decoration:none;">beequ.de</a>
                    </p>
                  </td>
                  <td align="right">
                    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.2);">
                      🐝 BeeQu
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>`,
  });
}

module.exports = { sendActivationMail };
