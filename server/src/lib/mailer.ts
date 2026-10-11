import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';

// Two ways to send, picked from the environment (see server/.env.example):
//   - Resend (preferred): RESEND_API_KEY + RESEND_FROM, sent over HTTPS so it
//     works on hosts that block SMTP ports.
//   - SMTP: SMTP_HOST + SMTP_FROM. For Gmail: SMTP_HOST=smtp.gmail.com,
//     SMTP_PORT=465, SMTP_USER=<address>, SMTP_PASS=<16-char app password>.
// Resend wins when both are set.
const resendConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY && (process.env.RESEND_FROM || process.env.SMTP_FROM));
const smtpConfigured = (): boolean => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
export const mailerConfigured = (): boolean => resendConfigured() || smtpConfigured();

let transport: Transporter | null = null;

const getTransport = (): Transporter => {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587/25 upgrade with STARTTLS.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
};

export type MailMessage = Pick<SendMailOptions, 'to' | 'subject' | 'text' | 'html' | 'attachments'>;
export type SendMail = (message: MailMessage) => Promise<void>;

const toList = (to: MailMessage['to']): string[] =>
  (Array.isArray(to) ? to : [to ?? ''])
    .flatMap((t) => String(typeof t === 'object' && t && 'address' in t ? t.address : t).split(','))
    .map((s) => s.trim())
    .filter(Boolean);

const sendViaResend = async (message: MailMessage): Promise<void> => {
  const attachments = (message.attachments ?? []).map((a) => ({
    filename: a.filename,
    content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(String(a.content ?? '')).toString('base64'),
    content_type: a.contentType,
    content_id: a.cid,
  }));
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || process.env.SMTP_FROM,
      to: toList(message.to),
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: attachments.length ? attachments : undefined,
    }),
  });
  if (!res.ok) {
    // Resend's error body names the problem (e.g. unverified domain); it never echoes the key.
    throw new Error(`Resend rejected the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
};

export const sendMail: SendMail = async (message) => {
  if (resendConfigured()) return sendViaResend(message);
  if (!smtpConfigured()) throw new Error('SMTP is not configured (set SMTP_HOST and SMTP_FROM, or RESEND_API_KEY and RESEND_FROM).');
  await getTransport().sendMail({ from: process.env.SMTP_FROM, ...message });
};
