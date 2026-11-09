import { AccountMail, appUrl, linkEmail } from './accountMail';
import { Plan, planPriceLabel } from './plan';

// The emails about the plan: welcome, the notice to existing users, reminders
// before access ends, the receipt, and a payment that couldn't be confirmed.
// Plain and short: the date, the price, what is included, one link. No marketing.

export const mailDate = (d: Date): string => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

const INCLUDED = 'Goals, Loans, Investments, Plan ahead and Pro insights';
const FREE = 'Home, Transactions, Budgets, Accounts, People and the monthly and category reports stay free.';
const plan_ = () => `${appUrl()}/plan`;

export const welcomeMail = (to: string, name: string, endsOn: Date, plan: Plan): AccountMail =>
  linkEmail(
    to,
    'Welcome to Prapanji: 6 months of full access',
    `Hi ${name.split(' ')[0] || 'there'}, welcome! You have free full access to ${INCLUDED} until ${mailDate(endsOn)}.`,
    'See your plan',
    plan_(),
    `After that, keeping them is ${planPriceLabel(plan)}. ${FREE}`
  );

export const existingNoticeMail = (to: string, name: string, endsOn: Date, plan: Plan): AccountMail =>
  linkEmail(
    to,
    `Your free full access ends on ${mailDate(endsOn)}`,
    `Hi ${name.split(' ')[0] || 'there'}, Prapanji is moving to a simple plan. Your free full access to ${INCLUDED} runs until ${mailDate(endsOn)}.`,
    'See your plan',
    plan_(),
    `After that, keeping them is ${planPriceLabel(plan)}. ${FREE} Nothing you've saved is ever deleted.`
  );

export type ReminderKind = 'd30' | 'd7' | 'd1' | 'ended';

export const reminderMail = (kind: ReminderKind, to: string, endsOn: Date, plan: Plan): AccountMail => {
  const when = mailDate(endsOn);
  if (kind === 'ended') {
    return linkEmail(
      to,
      'Your full access has ended. Your data is safe',
      `Your free full access ended on ${when}. Goals, Loans, Investments, Plan ahead and Pro insights are paused. Your data is safe: everything you saved is still here.`,
      'Renew to turn them back on',
      plan_(),
      `Renewing is ${planPriceLabel(plan)}. ${FREE}`
    );
  }
  const left = kind === 'd30' ? 'about a month' : kind === 'd7' ? 'one week' : 'one day';
  return linkEmail(
    to,
    kind === 'd1' ? 'Your full access ends tomorrow' : `Your full access ends in ${kind === 'd7' ? '7 days' : '30 days'}`,
    `You have ${left} left of full access. It ends on ${when}.`,
    'Renew',
    plan_(),
    `Renewing is ${planPriceLabel(plan)} and adds a year after your current end date, so no time is lost. ${FREE}`
  );
};

export const receiptMail = (to: string, endsOn: Date, amountInr: number, txnId: string): AccountMail =>
  linkEmail(
    to,
    'Payment confirmed. Thank you',
    `We received ₹${amountInr.toLocaleString('en-IN')} (transaction ${txnId}). Your plan now runs until ${mailDate(endsOn)}.`,
    'See your plan',
    plan_(),
    'Keep this email as your receipt.'
  );

export const claimRejectedMail = (to: string, reason: string, resend: boolean): AccountMail =>
  linkEmail(
    to,
    resend ? 'Please send your payment details again' : "We couldn't confirm your payment",
    resend
      ? `We couldn't read or match your payment details. ${reason ? `Note: ${reason}. ` : ''}Please send the screenshot and transaction ID again.`
      : `We couldn't confirm your payment. ${reason ? `Reason: ${reason}. ` : ''}If you paid, please contact support with your transaction ID.`,
    'Open your plan',
    plan_(),
    'Your access has not changed.'
  );

export const paymentDetailsChangedMail = (to: string, byEmail: string, upiId: string): AccountMail =>
  linkEmail(
    to,
    'Payment details changed',
    `${byEmail} changed the payment details shown to users. The UPI ID is now ${upiId}. If this wasn't expected, check the audit log now.`,
    'Open the app',
    appUrl(),
    'This message goes to every admin whenever the payment QR or UPI ID changes.'
  );
