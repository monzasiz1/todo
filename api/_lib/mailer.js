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
<html lang="de" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>BeeQu – Account aktivieren</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    @media only screen and (max-width:600px){
      .card{width:100%!important;border-radius:0!important;}
      .pad{padding:28px 24px!important;}
      .hero{padding:32px 24px 28px!important;}
      h1{font-size:26px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;">
<tr><td align="center" style="padding:40px 16px;">

  <!-- CARD -->
  <table class="card" width="520" cellpadding="0" cellspacing="0" border="0"
         style="max-width:520px;width:100%;border-radius:20px;overflow:hidden;
                border:1px solid #dde3ec;background:#ffffff;">

    <!-- HERO: solid blue header (works everywhere) -->
    <tr>
      <td class="hero" bgcolor="#007AFF"
          style="background:#007AFF;padding:40px 44px 36px;">
        <!--[if mso]>
        <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false"
                style="width:520px;">
          <v:fill type="gradient" color="#007AFF" color2="#5856D6" angle="135"/>
          <v:textbox inset="0,0,0,0"><div><![endif]-->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <img src="https://beequ.de/icons/icon.png"
                         alt="BeeQu" width="36" height="36"
                         style="display:block;border-radius:9px;border:0;">
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:20px;font-weight:900;color:#ffffff;letter-spacing:-0.04em;">
                      BeeQu
                    </span>
                  </td>
                </tr>
              </table>
              <h1 style="margin:0 0 10px;font-size:30px;font-weight:900;color:#ffffff;
                          letter-spacing:-0.04em;line-height:1.1;">
                Hallo ${name}! 👋
              </h1>
              <p style="margin:0;font-size:15px;color:rgba(255,255,255,0.8);line-height:1.5;">
                Ein letzter Schritt – aktiviere jetzt deinen Account.
              </p>
            </td>
          </tr>
        </table>
        <!--[if mso]></div></v:textbox></v:rect><![endif]-->
      </td>
    </tr>

    <!-- BODY -->
    <tr>
      <td class="pad" style="background:#ffffff;padding:36px 44px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">

          <!-- Feature badges -->
          <tr>
            <td style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#EBF5FF;border-radius:20px;padding:6px 14px;
                              font-size:13px;font-weight:700;color:#007AFF;">
                    ✦&nbsp;KI-Aufgaben
                  </td>
                  <td width="8"></td>
                  <td style="background:#EEEEFF;border-radius:20px;padding:6px 14px;
                              font-size:13px;font-weight:700;color:#5856D6;">
                    📅&nbsp;Kalender
                  </td>
                  <td width="8"></td>
                  <td style="background:#EAFAF0;border-radius:20px;padding:6px 14px;
                              font-size:13px;font-weight:700;color:#1E9E45;">
                    👥&nbsp;Teams
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Text -->
          <tr>
            <td style="padding-bottom:28px;">
              <p style="margin:0 0 14px;font-size:16px;color:#374151;line-height:1.7;">
                Willkommen bei <strong style="color:#111827;">BeeQu</strong> – der smarten
                Produktivitäts-App mit KI-Assistent, intelligentem Kalender und
                Team-Collaboration.
              </p>
              <p style="margin:0;font-size:16px;color:#374151;line-height:1.7;">
                Klicke auf den Button um deinen Account zu aktivieren:
              </p>
            </td>
          </tr>

          <!-- CTA BUTTON — solid blue, works in all clients -->
          <tr>
            <td style="padding-bottom:32px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${activationUrl}"
                           style="height:52px;v-text-anchor:middle;width:220px;"
                           arcsize="15%" strokecolor="#007AFF" fill="t">
                <v:fill type="gradient" color="#007AFF" color2="#5856D6" angle="135"/>
                <w:anchorlock/>
                <center style="color:#fff;font-family:sans-serif;font-size:16px;font-weight:700;">
                  Account aktivieren →
                </center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${activationUrl}"
                 style="display:inline-block;background:#007AFF;color:#ffffff;
                        font-size:16px;font-weight:700;text-decoration:none;
                        padding:15px 32px;border-radius:12px;
                        mso-hide:all;">
                Account aktivieren &rarr;
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Divider + note -->
          <tr>
            <td style="border-top:1px solid #E5E7EB;padding-top:22px;">
              <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.6;">
                Der Link ist <strong style="color:#6B7280;">24 Stunden gültig</strong>.
                Falls du dich nicht bei BeeQu registriert hast, kannst du diese
                E-Mail einfach ignorieren.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>

    <!-- FOOTER -->
    <tr>
      <td bgcolor="#1C1C1E"
          style="background:#1C1C1E;padding:18px 44px;border-top:1px solid #333;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0;font-size:12px;color:#6B7280;">
                © 2026 BeeTwice GmbH &nbsp;·&nbsp;
                <a href="https://beequ.de" style="color:#9CA3AF;text-decoration:none;">beequ.de</a>
              </p>
            </td>
            <td align="right">
              <img src="https://beequ.de/icons/icon.png"
                   alt="BeeQu" width="24" height="24"
                   style="display:block;border-radius:6px;opacity:0.5;border:0;">
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>
  <!-- /CARD -->

</td></tr>
</table>
</body>
</html>`,
  });
}

module.exports = { sendActivationMail };
