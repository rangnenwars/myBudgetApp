import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';

// Two ways to send, picked from the environment (see server/.env.example):
//   1. Resend's HTTPS API — set RESEND_API_KEY and MAIL_FROM. This is what
//      production uses: DigitalOcean blocks outbound SMTP on ports 25, 465
//      and 587, so a plain SMTP relay can't be reached from a Droplet.
//   2. SMTP — set SMTP_HOST and SMTP_FROM (+ SMTP_PORT/SMTP_USER/SMTP_PASS).
//      For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<address>,
//      SMTP_PASS=<16-char app password — not the account password>.
// RESEND_API_KEY wins when both are set. MAIL_FROM falls back to SMTP_FROM.

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 15_000;

const fromAddress = (): string | undefined => process.env.MAIL_FROM || process.env.SMTP_FROM;

export const mailerConfigured = (): boolean =>
  Boolean(fromAddress() && (process.env.RESEND_API_KEY || process.env.SMTP_HOST));

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

type Recipient = string | { name?: string; address: string };

/** Flattens nodemailer's `to` (string, "a, b" list, address object, or array of those) into one address per entry. */
const recipientList = (to: MailMessage['to']): string[] => {
  const items: Recipient[] = Array.isArray(to) ? (to as Recipient[]) : to ? [to as Recipient] : [];
  return items.flatMap((item) =>
    typeof item === 'string'
      ? item.split(',').map((s) => s.trim()).filter(Boolean)
      : [item.name ? `${item.name} <${item.address}>` : item.address],
  );
};

const resendAttachments = (attachments: MailMessage['attachments']) =>
  (attachments ?? []).map((a) => {
    if (a.content === undefined) throw new Error(`Attachment "${a.filename ?? ''}" has no content — only inline content is supported.`);
    const bytes = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), (a.encoding as BufferEncoding) || 'utf8');
    return {
      filename: a.filename,
      content: bytes.toString('base64'),
      ...(a.contentType ? { content_type: a.contentType } : {}),
      ...(a.cid ? { content_id: a.cid } : {}),
    };
  });

const sendViaResend: SendMail = async (message) => {
  const to = recipientList(message.to);
  if (to.length === 0) throw new Error('Email has no recipients.');

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress(),
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments ? resendAttachments(message.attachments) : undefined,
    }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Resend's error body is {"name", "message", "statusCode"}; never echo the API key or the message content.
    const detail = await res.json().then((b: { message?: string }) => b.message, () => undefined);
    throw new Error(`Resend rejected the email (HTTP ${res.status}${detail ? `: ${detail}` : ''}).`);
  }
};

export const sendMail: SendMail = async (message) => {
  if (!mailerConfigured()) {
    throw new Error('Email is not configured (set RESEND_API_KEY + MAIL_FROM, or SMTP_HOST + SMTP_FROM).');
  }
  if (process.env.RESEND_API_KEY) return sendViaResend(message);
  await getTransport().sendMail({ from: fromAddress(), ...message });
};
