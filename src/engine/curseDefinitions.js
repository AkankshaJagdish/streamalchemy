/**
 * The only curses enabled in the MVP.
 *
 * These definitions are trusted application data. Viewer-controlled strings
 * are never used as definition keys unless they pass the parser whitelist.
 */
export const CURSE_DEFINITIONS = Object.freeze({
  gravity: Object.freeze({
    name: 'gravity',
    displayName: 'Gravity Curse',
    durationMs: 30_000
  })
});

export const SUPPORTED_CURSES = Object.freeze(
  Object.keys(CURSE_DEFINITIONS)
);

export function getCurseDefinition(name) {
  if (typeof name !== 'string') return undefined;
  return CURSE_DEFINITIONS[name];
}
