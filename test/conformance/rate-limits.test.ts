import { describe, expect, test } from 'vitest';
import { RateLimitError } from '../../src/abstract/errors.js';
import { forges } from '../support/harness.js';

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

describe.each(forges)('%s rate limits', (forge, setup) => {
  const limitHeaders = (remaining: number, reset: number) => {
    const prefix = forge === 'github' ? 'x-ratelimit' : 'ratelimit';
    return {
      [`${prefix}-limit`]: '5000',
      [`${prefix}-remaining`]: String(remaining),
      [`${prefix}-reset`]: String(reset),
    };
  };

  test('a short rate limit is waited out', async () => {
    const { service, ref, fake } = setup();
    fake.interruptions.push({ status: 429, headers: { 'Retry-After': '0' } });

    const project = await service.getProject(ref);
    expect(project.repo).toBe(ref.repo);
    expect(fake.requests).toBe(2);
  });

  test('transient server errors on reads are retried', async () => {
    const { service, ref, fake } = setup();
    fake.interruptions.push({ status: 502 }, { status: 503 });
    await service.getProject(ref);
    expect(fake.requests).toBe(3);
  });

  test('server errors on writes are not retried', async () => {
    const { service, ref, fake } = setup();
    const project = await service.getProject(ref);
    fake.interruptions.push({ status: 502 });

    await expect(project.createIssue('x', '')).rejects.toMatchObject({
      status: 502,
    });
    expect(fake.requests).toBe(2);
  });

  test('a long rate limit throws RateLimitError with the reset time', async () => {
    const { service, ref, fake } = setup();
    const reset = inAnHour();
    fake.interruptions.push({
      status: forge === 'github' ? 403 : 429,
      body: { message: 'API rate limit exceeded' },
      headers: limitHeaders(0, reset),
    });

    const error = await service.getProject(ref).catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.resetAt).toEqual(new Date(reset * 1000));
    expect(fake.requests).toBe(1);
  });

  test('getRateLimitRemaining', async () => {
    const { service, ref, fake } = setup();
    fake.rateLimit = { limit: 5000, remaining: 4321, reset: inAnHour() };
    await service.getProject(ref);

    expect(await service.getRateLimitRemaining()).toBe(4321);
    expect(service.rateLimit?.remaining).toBe(4321);
  });
});
