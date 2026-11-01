import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/utils/logger.js';

describe('logger secret redaction', () => {
  it('redacts credential fields and bearer/OAuth strings', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const logger = createLogger(sink);
    logger.info('test', {
      accessToken: 'private-access-token',
      clientSecret: 'private-client-secret',
      authorization: 'Bearer private-bearer-token',
      note: 'OAuth private-oauth-token'
    });
    const encoded = JSON.stringify(sink.info.mock.calls);
    expect(encoded).not.toContain('private-access-token');
    expect(encoded).not.toContain('private-client-secret');
    expect(encoded).not.toContain('private-bearer-token');
    expect(encoded).not.toContain('private-oauth-token');
    expect(encoded).toContain('[REDACTED]');
  });
});
