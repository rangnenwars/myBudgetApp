import { mailerConfigured, sendMail } from '../lib/mailer';

// Pure unit tests: global fetch is stubbed, so no network and no database.
const ENV_KEYS = ['RESEND_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_FROM'] as const;

describe('mailer (Resend over HTTPS)', () => {
  const saved: Record<string, string | undefined> = {};
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    global.fetch = realFetch;
  });

  const useResend = () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM = 'Prapanji <no-reply@prapanji.in>';
  };

  it('is configured with a Resend key + sender, or with SMTP host + sender, and not otherwise', () => {
    expect(mailerConfigured()).toBe(false);

    process.env.RESEND_API_KEY = 're_test_key';
    expect(mailerConfigured()).toBe(false); // no sender yet
    process.env.MAIL_FROM = 'a@prapanji.in';
    expect(mailerConfigured()).toBe(true);

    delete process.env.RESEND_API_KEY;
    expect(mailerConfigured()).toBe(false); // sender but no transport
    process.env.SMTP_HOST = 'smtp.example.com';
    expect(mailerConfigured()).toBe(true);
  });

  it('MAIL_FROM falls back to SMTP_FROM so existing SMTP setups keep working', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'old@example.com';
    expect(mailerConfigured()).toBe(true);
  });

  it('posts to the Resend API with a bearer key and the message as JSON', async () => {
    useResend();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

    await sendMail({ to: 'user@example.com', subject: 'Reset', text: 'plain', html: '<p>html</p>' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'Prapanji <no-reply@prapanji.in>',
      to: ['user@example.com'],
      subject: 'Reset',
      text: 'plain',
      html: '<p>html</p>',
    });
  });

  it('splits a comma-joined recipient list (the issue digest sends "a, b") into an array', async () => {
    useResend();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await sendMail({ to: 'a@x.com, b@x.com', subject: 's', text: 't' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(['a@x.com', 'b@x.com']);
  });

  it('maps inline screenshot attachments to base64 + content_id', async () => {
    useResend();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await sendMail({
      to: 'a@x.com',
      subject: 's',
      html: '<img src="cid:shot@mybudget">',
      attachments: [{ filename: 'issue-1.png', content: Buffer.from('PNGDATA'), contentType: 'image/png', cid: 'shot@mybudget' }],
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).attachments).toEqual([
      { filename: 'issue-1.png', content: Buffer.from('PNGDATA').toString('base64'), content_type: 'image/png', content_id: 'shot@mybudget' },
    ]);
  });

  it('throws with Resend\'s message on an HTTP error, without leaking the API key', async () => {
    useResend();
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'The prapanji.in domain is not verified.' }) });

    const err = await sendMail({ to: 'a@x.com', subject: 's', text: 't' }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('HTTP 403');
    expect((err as Error).message).toContain('domain is not verified');
    expect((err as Error).message).not.toContain('re_test_key');
  });

  it('refuses to send with no recipients, and with nothing configured', async () => {
    useResend();
    await expect(sendMail({ to: undefined, subject: 's', text: 't' })).rejects.toThrow(/no recipients/);
    expect(fetchMock).not.toHaveBeenCalled();

    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    await expect(sendMail({ to: 'a@x.com', subject: 's', text: 't' })).rejects.toThrow(/not configured/);
  });
});
