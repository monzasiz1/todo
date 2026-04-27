// mailer.js – BeeQu E-Mail Versand (nodemailer)
const nodemailer = require('nodemailer');

const FROM = 'BeeQu <no-reply@beequ.de>';

// SMTP-Konfiguration (hier als Beispiel, anpassen!)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.beequ.de',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: false, // true für 465, false für 587
  auth: {
    user: process.env.SMTP_USER || 'no-reply@beequ.de',
    pass: process.env.SMTP_PASS || 'DEIN_PASSWORT',
  },
});

function sendMail({ to, subject, html, text }) {
  return transporter.sendMail({
    from: FROM,
    to,
    subject,
    html,
    text,
  });
}

module.exports = { sendMail };
