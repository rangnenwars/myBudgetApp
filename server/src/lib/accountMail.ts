import { mailerConfigured, sendMail } from './mailer';

// Account emails (password reset, email verification) on top of the shared
// SMTP mailer in lib/mailer.ts (configured by SMTP_HOST / SMTP_PORT /
// SMTP_USER / SMTP_PASS / SMTP_FROM). What happens without SMTP:
//   - development: the email is printed to the server log so links can be
//     tested locally;
//   - production: nothing is sent and only a warning is logged (never the
//     link — it's a credential);
//   - tests (NODE_ENV=test): captured in `outbox` for assertions.

export interface AccountMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Test-only capture of account emails (NODE_ENV=test). */
export const outbox: AccountMail[] = [];

export const sendAccountMail = async (mail: AccountMail): Promise<void> => {
  if (process.env.NODE_ENV === 'test') {
    outbox.push(mail);
    return;
  }
  if (!mailerConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[mail] SMTP not configured — "${mail.subject}" to ${mail.to} was not sent.`);
    } else {
      console.log(`[mail] (dev, not sent) To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    }
    return;
  }
  await sendMail(mail);
};

/** Public base URL of the web app, used to build links in emails. */
export const appUrl = (): string => (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A short email with one call-to-action link, as text and simple HTML. */
export const linkEmail = (to: string, subject: string, intro: string, linkLabel: string, link: string, outro: string): AccountMail => ({
  to,
  subject,
  text: `${intro}\n\n${linkLabel}: ${link}\n\n${outro}\n\n— My Budget`,
  html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p><p style="color:#666">${escapeHtml(outro)}</p><p>— My Budget</p>`,
});
