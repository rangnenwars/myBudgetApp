// SMTP transport settings and the no-SMTP fallbacks, with nodemailer mocked.

const mockSendMail = jest.fn().mockResolvedValue({});
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: mockCreateTransport } }));

const savedEnv = { ...process.env };
const SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

beforeEach(() => {
  jest.resetModules(); // mailer caches its transport — start each test fresh
  mockSendMail.mockClear();
  mockCreateTransport.mockClear();
  for (const v of SMTP_VARS) delete process.env[v];
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  process.env = savedEnv;
});

const loadMailer = () => require('../lib/mailer') as typeof import('../lib/mailer');
const loadAccountMail = () => require('../lib/accountMail') as typeof import('../lib/accountMail');

describe('mailer', () => {
  it('is configured only with both SMTP_HOST and SMTP_FROM', () => {
    const { mailerConfigured } = loadMailer();
    expect(mailerConfigured()).toBe(false);
    process.env.SMTP_HOST = 'smtp.example.com';
    expect(mailerConfigured()).toBe(false);
    process.env.SMTP_FROM = 'Prapanji <no-reply@example.com>';
    expect(mailerConfigured()).toBe(true);
  });

  it('refuses to send when not configured', async () => {
    await expect(loadMailer().sendMail({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(/SMTP is not configured/);
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('uses implicit TLS on 465, sends from SMTP_FROM, and reuses one transport', async () => {
    Object.assign(process.env, { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'app-password', SMTP_FROM: 'Prapanji <me@gmail.com>' });
    const { sendMail } = loadMailer();
    await sendMail({ to: 'a@example.com', subject: 'one', text: 't' });
    await sendMail({ to: 'b@example.com', subject: 'two', text: 't' });

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockCreateTransport).toHaveBeenCalledWith({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'me@gmail.com', pass: 'app-password' } });
    expect(mockSendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: 'Prapanji <me@gmail.com>', to: 'a@example.com', subject: 'one' }));
  });

  it('defaults to port 587 with STARTTLS and no auth, and honours SMTP_SECURE', async () => {
    Object.assign(process.env, { SMTP_HOST: 'relay.local', SMTP_FROM: 'x@relay.local' });
    await loadMailer().sendMail({ to: 'a@example.com', subject: 's', text: 't' });
    expect(mockCreateTransport).toHaveBeenLastCalledWith({ host: 'relay.local', port: 587, secure: false, auth: undefined });

    jest.resetModules();
    process.env.SMTP_SECURE = 'true';
    await loadMailer().sendMail({ to: 'a@example.com', subject: 's', text: 't' });
    expect(mockCreateTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 587, secure: true }));
  });
});

describe('account mail', () => {
  const mail = { to: 'u@example.com', subject: 'Reset your password', text: 'Link: https://app/reset?token=SECRET', html: '<p>x</p>' };

  it('captures mail in the outbox under test', async () => {
    const { sendAccountMail, outbox } = loadAccountMail();
    await sendAccountMail(mail);
    expect(outbox.at(-1)).toEqual(mail);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('in production without SMTP, warns without ever logging the link (it is a credential)', async () => {
    process.env.NODE_ENV = 'production';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await loadAccountMail().sendAccountMail(mail);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('SECRET');
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('in development without SMTP, prints the email so links can be tested locally', async () => {
    process.env.NODE_ENV = 'development';
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await loadAccountMail().sendAccountMail(mail);
      expect(String(log.mock.calls[0][0])).toContain('token=SECRET');
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('sends through SMTP when configured outside tests', async () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'no-reply@example.com' });
    try {
      await loadAccountMail().sendAccountMail(mail);
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'u@example.com', from: 'no-reply@example.com' }));
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('builds links from APP_URL without a trailing slash, and escapes the HTML', () => {
    const { appUrl, linkEmail } = loadAccountMail();
    process.env.APP_URL = 'https://prapanji.in///';
    expect(appUrl()).toBe('https://prapanji.in');
    delete process.env.APP_URL;
    expect(appUrl()).toBe('http://localhost:8080');

    const m = linkEmail('u@example.com', 'Subject', 'Hi <b>there</b>', 'Open', 'https://x/?a=1&b="2"', 'Bye');
    expect(m.html).toContain('Hi &lt;b&gt;there&lt;/b&gt;');
    expect(m.html).toContain('href="https://x/?a=1&amp;b=&quot;2&quot;"');
    expect(m.text).toContain('Open: https://x/?a=1&b="2"');
  });
});
