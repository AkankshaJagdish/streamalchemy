import { getCurseDefinition } from './curseDefinitions.js';

export const MAX_CHAT_MESSAGE_LENGTH = 500;
const COMMAND_PATTERN = /^!curse[ \t]+([a-z][a-z0-9_-]*)[ \t]*$/i;

/**
 * Parses a Twitch chat message into a trusted activation request.
 *
 * No evaluation, HTML interpretation, or interpolation is performed. Only
 * the explicit supported-curse whitelist can produce an activation request.
 *
 * @param {unknown} messageText
 * @returns {{ ok: true, request: { curse: string, durationMs: number } }
 *   | { ok: false, reason: string }}
 */
export function parseCurseCommand(messageText) {
  if (typeof messageText !== 'string') {
    return { ok: false, reason: 'invalid-message' };
  }

  if (messageText.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { ok: false, reason: 'message-too-long' };
  }

  const trimmed = messageText.trim();
  if (!trimmed.startsWith('!curse')) {
    return { ok: false, reason: 'not-a-command' };
  }

  // Whitespace-only or missing-argument command.
  if (/^!curse[ \t]*$/i.test(trimmed)) {
    return { ok: false, reason: 'missing-argument' };
  }

  const match = COMMAND_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false, reason: 'malformed-command' };
  }

  const curseName = match[1].toLowerCase();
  const definition = getCurseDefinition(curseName);
  if (!definition) {
    return { ok: false, reason: 'unsupported-curse' };
  }

  return {
    ok: true,
    request: Object.freeze({
      curse: definition.name,
      durationMs: definition.durationMs
    })
  };
}
