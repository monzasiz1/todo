let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  try {
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
    console.warn('Kein SMTP-Transporter – Mail übersprungen.');
    console.log('Aktivierungslink:', activationUrl);
    return;
  }

  const firstName = name.split(' ')[0];

  await t.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `${firstName}, aktiviere deinen BeeQu-Account`,
    html: `<!DOCTYPE html>
<html lang="de" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
@media only screen and (max-width:600px){
  .w-full{width:100%!important}
  .px-mobile{padding-left:28px!important;padding-right:28px!important}
  .py-mobile{padding-top:36px!important;padding-bottom:36px!important}
  h1{font-size:28px!important;line-height:1.15!important}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#F0F4F8;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#F0F4F8;">
  <tr>
    <td align="center" style="padding:48px 16px 48px;">

      <!--[if mso]><table role="presentation" width="560"><tr><td><![endif]-->
      <table role="presentation" class="w-full" width="560" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;width:100%;">

        <!-- ═══ HEADER BAR ═══ -->
        <tr>
          <td bgcolor="#007AFF" style="background-color:#007AFF;border-radius:16px 16px 0 0;padding:28px 48px;">
            <!--[if mso]>
            <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false"
                    style="width:560px;height:88px;">
              <v:fill type="solid" color="#007AFF"/>
              <v:textbox inset="0,0,0,0"><div><![endif]-->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding-right:12px;vertical-align:middle;">
                        <img src="https://beequ.de/icons/icon.svg"
                             alt="BeeQu" width="40" height="40"
                             style="display:block;border-radius:50%;border:2px solid rgba(255,255,255,0.3);">
                      </td>
                      <td style="vertical-align:middle;">
                        <span style="font-size:22px;font-weight:900;color:#ffffff;
                                     letter-spacing:-0.04em;font-family:Inter,-apple-system,Arial,sans-serif;">
                          BeeQu
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.6);
                               font-family:Inter,-apple-system,Arial,sans-serif;
                               letter-spacing:0.05em;text-transform:uppercase;">
                    von BeeTwice
                  </span>
                </td>
              </tr>
            </table>
            <!--[if mso]></div></v:textbox></v:rect><![endif]-->
          </td>
        </tr>

        <!-- ═══ MAIN CARD ═══ -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:48px 48px 40px;"
              class="px-mobile py-mobile">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

              <!-- Greeting -->
              <tr>
                <td style="padding-bottom:8px;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#007AFF;
                             letter-spacing:0.06em;text-transform:uppercase;
                             font-family:Inter,-apple-system,Arial,sans-serif;">
                    Willkommen bei BeeQu
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:24px;">
                  <h1 style="margin:0;font-size:32px;font-weight:900;color:#111827;
                              line-height:1.15;letter-spacing:-0.04em;
                              font-family:Inter,-apple-system,Arial,sans-serif;">
                    Hallo ${firstName},<br>fast geschafft!
                  </h1>
                </td>
              </tr>

              <!-- Divider -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" width="40" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="height:3px;background-color:#007AFF;border-radius:2px;"></td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Body text -->
              <tr>
                <td style="padding-bottom:32px;">
                  <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.75;
                             font-family:Inter,-apple-system,Arial,sans-serif;">
                    Schön, dass du dabei bist. Dein BeeQu-Account ist fast bereit –
                    klicke auf den Button um deine E-Mail-Adresse zu bestätigen
                    und direkt loszulegen.
                  </p>
                  <p style="margin:0;font-size:16px;color:#374151;line-height:1.75;
                             font-family:Inter,-apple-system,Arial,sans-serif;">
                    Mit BeeQu organisierst du Aufgaben, Kalender und dein Team
                    an einem Ort – mit KI die deine Sprache versteht.
                  </p>
                </td>
              </tr>

              <!-- CTA Button -->
              <tr>
                <td style="padding-bottom:40px;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                               href="${activationUrl}"
                               style="height:54px;v-text-anchor:middle;width:240px;"
                               arcsize="14%" stroke="f" fillcolor="#007AFF">
                    <w:anchorlock/>
                    <center style="color:#fff;font-family:Inter,Arial,sans-serif;
                                   font-size:16px;font-weight:700;">
                      E-Mail bestätigen
                    </center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="${activationUrl}"
                     style="display:inline-block;background-color:#007AFF;color:#ffffff;
                            font-size:16px;font-weight:700;text-decoration:none;
                            padding:16px 36px;border-radius:12px;
                            font-family:Inter,-apple-system,Arial,sans-serif;
                            letter-spacing:-0.01em;mso-hide:all;">
                    E-Mail bestätigen &nbsp;&rarr;
                  </a>
                  <!--<![endif]-->
                </td>
              </tr>

              <!-- What's included -->
              <tr>
                <td style="padding-bottom:32px;border-top:1px solid #F3F4F6;padding-top:28px;">
                  <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#6B7280;
                             letter-spacing:0.04em;text-transform:uppercase;
                             font-family:Inter,-apple-system,Arial,sans-serif;">
                    Was dich erwartet
                  </p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding-bottom:12px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="32" style="vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;border-radius:6px;
                                          background-color:#EBF5FF;text-align:center;
                                          font-size:13px;line-height:24px;">✦</div>
                            </td>
                            <td style="vertical-align:top;">
                              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;
                                         font-family:Inter,-apple-system,Arial,sans-serif;">
                                <strong style="color:#111827;">KI-Assistent</strong> —
                                schreib einfach was du vorhast, die KI erledigt den Rest.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-bottom:12px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="32" style="vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;border-radius:6px;
                                          background-color:#EEEEFF;text-align:center;
                                          font-size:13px;line-height:24px;">📅</div>
                            </td>
                            <td style="vertical-align:top;">
                              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;
                                         font-family:Inter,-apple-system,Arial,sans-serif;">
                                <strong style="color:#111827;">Intelligenter Kalender</strong> —
                                alle Aufgaben und Termine in einer Übersicht.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="32" style="vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;border-radius:6px;
                                          background-color:#EAFAF0;text-align:center;
                                          font-size:13px;line-height:24px;">👥</div>
                            </td>
                            <td style="vertical-align:top;">
                              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;
                                         font-family:Inter,-apple-system,Arial,sans-serif;">
                                <strong style="color:#111827;">Teams & Chat</strong> —
                                Gruppen erstellen und gemeinsam Aufgaben verwalten.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Security note -->
              <tr>
                <td style="background-color:#F9FAFB;border-radius:10px;padding:16px 20px;">
                  <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.6;
                             font-family:Inter,-apple-system,Arial,sans-serif;">
                    🔒 Dieser Link ist <strong style="color:#6B7280;">24 Stunden gültig</strong>
                    und kann nur einmal verwendet werden. Falls du dich nicht bei BeeQu
                    registriert hast, kannst du diese E-Mail ignorieren.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td bgcolor="#F9FAFB"
              style="background-color:#F9FAFB;border-radius:0 0 16px 16px;
                     padding:24px 48px;border-top:1px solid #E5E7EB;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0 0 4px;font-size:13px;color:#374151;font-weight:600;
                             font-family:Inter,-apple-system,Arial,sans-serif;">
                    BeeTwice GmbH
                  </p>
                  <p style="margin:0;font-size:12px;color:#9CA3AF;
                             font-family:Inter,-apple-system,Arial,sans-serif;">
                    © 2026 · <a href="https://beequ.de" style="color:#007AFF;text-decoration:none;">beequ.de</a>
                    &nbsp;·&nbsp;
                    <a href="https://beequ.de/datenschutz" style="color:#9CA3AF;text-decoration:none;">Datenschutz</a>
                    &nbsp;·&nbsp;
                    <a href="https://beequ.de/agb" style="color:#9CA3AF;text-decoration:none;">AGB</a>
                  </p>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <img src="https://beequ.de/icons/icon.svg"
                       alt="BeeQu" width="28" height="28"
                       style="display:block;border-radius:50%;border:0;opacity:0.35;">
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->

    </td>
  </tr>
</table>

</body>
</html>`,
  });
}

module.exports = { sendActivationMail };
