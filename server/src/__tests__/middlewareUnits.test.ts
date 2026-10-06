// Small pure pieces exercised directly, without a database: the error handler,
// cookie parsing, error helpers, role guards and screenshot type sniffing.

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';
import { readCookie } from '../lib/cookies';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { requireAdmin } from '../middleware/requireAdmin';
import { requireStaff } from '../middleware/requireStaff';
import { requireSystemManager } from '../middleware/requireSystemManager';
import { sniffImageType } from '../routes/issues';

const fakeRes = () => {
  const res = { statusCode: 0, body: undefined as unknown, status: jest.fn(), json: jest.fn() };
  res.status.mockImplementation((code: number) => ((res.statusCode = code), res));
  res.json.mockImplementation((body: unknown) => ((res.body = body), res));
  return res;
};
const handle = (err: unknown) => {
  const res = fakeRes();
  errorHandler(err, {} as Request, res as unknown as Response, (() => {}) as NextFunction);
  return res;
};

describe('errorHandler', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps AppError, ZodError and body-parser errors to their status', () => {
    expect(handle(new AppError(409, 'taken'))).toMatchObject({ statusCode: 409, body: { error: 'taken' } });
    const zod = z.object({ a: z.string({ required_error: 'a is required' }) }).safeParse({});
    expect(handle((zod as { error: unknown }).error)).toMatchObject({ statusCode: 400, body: { error: 'a is required' } });
    expect(handle({ type: 'entity.too.large', status: 413 })).toMatchObject({ statusCode: 413 });
    expect(handle({ type: 'entity.parse.failed', status: 400 })).toMatchObject({ statusCode: 400, body: { error: 'Malformed JSON body.' } });
  });

  it('answers 500 with a generic message and never logs SQL parameters', () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    const drizzleLike = Object.assign(new Error('Failed query: insert into users values ($1)\nparams: secret@example.com,₹99999'), {
      cause: { code: '23505', message: 'duplicate key value' },
    });
    expect(handle(drizzleLike)).toMatchObject({ statusCode: 500, body: { error: 'Internal server error' } });
    expect(logged.mock.calls[0].join(' ')).toContain('23505');
    expect(logged.mock.calls[0].join(' ')).not.toContain('secret@example.com');

    handle(new Error('Failed query: select 1 params: 4111-1111'));
    expect(logged.mock.calls[1].join(' ')).not.toContain('4111');

    handle('a thrown string');
    handle(null);
    expect(logged).toHaveBeenCalledTimes(4);
  });

  it('notFoundHandler answers a JSON 404', () => {
    const res = fakeRes();
    notFoundHandler({} as Request, res as unknown as Response);
    expect(res).toMatchObject({ statusCode: 404, body: { error: 'Not found' } });
  });
});

describe('readCookie', () => {
  const req = (cookie?: string) => ({ headers: cookie === undefined ? {} : { cookie } }) as Request;

  it('finds one cookie among several, URL-decoded', () => {
    expect(readCookie(req('a=1; mb_refresh=abc%20def; b=2'), 'mb_refresh')).toBe('abc def');
  });
  it('returns undefined with no header, no match, or a part without "="', () => {
    expect(readCookie(req(), 'mb_refresh')).toBeUndefined();
    expect(readCookie(req('a=1; junk; b=2'), 'mb_refresh')).toBeUndefined();
  });
  it('falls back to the raw value when it is not valid URL encoding', () => {
    expect(readCookie(req('mb_refresh=%E0%A4%A'), 'mb_refresh')).toBe('%E0%A4%A');
  });
});

describe('error helpers', () => {
  it('carry the right status, with sensible default messages', () => {
    expect(badRequest('x')).toMatchObject({ status: 400, message: 'x' });
    expect(unauthorized()).toMatchObject({ status: 401, message: 'Unauthorized' });
    expect(forbidden()).toMatchObject({ status: 403, message: 'Forbidden' });
    expect(notFound()).toMatchObject({ status: 404, message: 'Not found' });
    expect(conflict('dup')).toMatchObject({ status: 409, message: 'dup' });
  });
});

describe('role guards', () => {
  const run = (guard: (req: Request, res: Response, next: NextFunction) => void, role?: string) => {
    const next = jest.fn();
    guard({ role } as Request, {} as Response, next);
    return next.mock.calls[0][0] as AppError | undefined;
  };

  it('let the right roles through and reject everyone else with 403', () => {
    expect(run(requireAdmin, 'admin')).toBeUndefined();
    expect(run(requireAdmin, 'support')?.status).toBe(403);
    expect(run(requireAdmin)?.status).toBe(403);

    expect(run(requireStaff, 'support')).toBeUndefined();
    expect(run(requireStaff, 'admin')).toBeUndefined();
    expect(run(requireStaff, 'system_manager')?.status).toBe(403);
    expect(run(requireStaff)?.status).toBe(403);

    expect(run(requireSystemManager, 'system_manager')).toBeUndefined();
    expect(run(requireSystemManager, 'admin')).toBeUndefined();
    expect(run(requireSystemManager, 'support')?.status).toBe(403);
    expect(run(requireSystemManager)?.status).toBe(403);
  });
});

describe('sniffImageType', () => {
  it('recognises PNG, JPEG and WebP from their first bytes, and nothing else', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImageType(Buffer.from('<svg/>'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});
