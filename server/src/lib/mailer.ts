import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';

// SMTP settings come from the environment (see server/.env.example). For
// Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<address>,
// SMTP_PASS=<16-char app password — not the account password>.
export const mailerConfigured = (): boolean => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);

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

export const sendMail: SendMail = async (message) => {
  if (!mailerConfigured()) throw new Error('SMTP is not configured (set SMTP_HOST and SMTP_FROM).');
  await getTransport().sendMail({ from: process.env.SMTP_FROM, ...message });
};
