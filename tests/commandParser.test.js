import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  parseCurseCommand
} from '../src/engine/commandParser.js';

describe('parseCurseCommand', () => {
  it('recognises !curse gravity and returns structured data', () => {
    expect(parseCurseCommand('!curse gravity')).toEqual({
      ok: true,
      request: { curse: 'gravity', durationMs: 30_000 }
    });
  });

  it('recognises uppercase curse names case-insensitively', () => {
    expect(parseCurseCommand('!curse GRAVITY')).toEqual({
      ok: true,
      request: { curse: 'gravity', durationMs: 30_000 }
    });
  });

  it('rejects a command with a missing argument', () => {
    expect(parseCurseCommand('!curse')).toMatchObject({
      ok: false,
      reason: 'missing-argument'
    });
  });

  it('rejects unsupported curses', () => {
    expect(parseCurseCommand('!curse unknown')).toMatchObject({
      ok: false,
      reason: 'unsupported-curse'
    });
  });

  it('accepts trailing whitespace', () => {
    expect(parseCurseCommand('!curse gravity   \t')).toMatchObject({
      ok: true,
      request: { curse: 'gravity' }
    });
  });

  it('handles leading and repeated command whitespace safely', () => {
    expect(parseCurseCommand('  !curse   gravity  ')).toMatchObject({
      ok: true,
      request: { curse: 'gravity', durationMs: 30_000 }
    });
    expect(parseCurseCommand('  !curse gravity  ')).toMatchObject({
      ok: true,
      request: { curse: 'gravity' }
    });
  });

  it.each([
    '!curse gravity extra',
    '!curse <script>alert(1)</script>',
    '!curse gravity; process.exit(1)',
    '!curse gravity && echo hacked',
    '!curse ${globalThis.process}',
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '!curse grav\nity'
  ])('rejects malformed or injected input: %s', (message) => {
    expect(parseCurseCommand(message).ok).toBe(false);
  });

  it('ignores unrelated chat messages', () => {
    expect(parseCurseCommand('hello chat')).toMatchObject({
      ok: false,
      reason: 'not-a-command'
    });
  });

  it('rejects oversized messages', () => {
    expect(parseCurseCommand('!curse gravity' + 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH)))
      .toMatchObject({ ok: false, reason: 'message-too-long' });
  });

  it('rejects non-string input', () => {
    expect(parseCurseCommand({ text: '!curse gravity' })).toMatchObject({
      ok: false,
      reason: 'invalid-message'
    });
  });
});
