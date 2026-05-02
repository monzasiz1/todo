// mailTemplates.js – BeeQu HTML-Mail-Templates

const baseStyle = `
  font-family: 'Inter', Arial, sans-serif;
  background: linear-gradient(135deg, #8ED0FF 0%, #0A84FF 100%);
  color: #222; margin:0; padding:0;
`;

function wrapBeeQuMail({ title, body }) {
  return `
  <div style="${baseStyle} min-height:100vh; padding:0;">
    <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:18px;box-shadow:0 4px 32px #0a84ff22;padding:32px 28px 24px 28px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
        <img src='https://beequ.de/logo-mail.png' alt='BeeQu' style='height:38px;width:38px;border-radius:10px;box-shadow:0 2px 8px #0a84ff33;'>
        <span style='font-size:1.5rem;font-weight:800;color:#0A84FF;'>BeeQu</span>
      </div>
      <h2 style='font-size:1.2rem;font-weight:700;margin:0 0 18px 0;color:#0A84FF;'>${title}</h2>
      <div style='font-size:1.05rem;line-height:1.7;color:#222;'>${body}</div>
      <div style='margin-top:32px;font-size:0.93rem;color:#888;'>Diese Mail wurde automatisch von BeeQu versendet. Bitte nicht antworten.<br>Fragen? <a href='mailto:support@beequ.de' style='color:#0A84FF;'>support@beequ.de</a></div>
    </div>
  </div>
  `;
}

function activationMail({ name, activationUrl }) {
  return wrapBeeQuMail({
    title: 'Bitte bestätige deine E-Mail-Adresse',
    body: `Hallo ${name || ''},<br><br>um deinen BeeQu-Account zu aktivieren, klicke bitte auf den folgenden Button:<br><br>
      <a href='${activationUrl}' style='display:inline-block;padding:12px 28px;background:#0A84FF;color:#fff;font-weight:700;border-radius:8px;text-decoration:none;font-size:1.1rem;'>E-Mail bestätigen</a><br><br>
      Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br><span style='font-size:0.97rem;color:#0A84FF;'>${activationUrl}</span>`
  });
}

function otpMail({ name, otp }) {
  return wrapBeeQuMail({
    title: 'Dein BeeQu Verifizierungscode',
    body: `Hallo ${name || ''},<br><br>dein 6-stelliger Verifizierungscode lautet:<br>
      <div style='font-size:2.2rem;font-weight:800;letter-spacing:0.18em;color:#0A84FF;margin:18px 0;'>${otp}</div>
      Der Code ist 10 Minuten gültig.`
  });
}

module.exports = { activationMail, otpMail };
