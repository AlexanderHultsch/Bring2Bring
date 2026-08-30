// SPECIFICATION.md section 3.1 / 5 (H2): the import day boundary must fall at
// local midnight, not UTC midnight, or an import in the gap between the two
// gets filed under the wrong day and silently swallowed by the anti-cheat's
// INSERT OR IGNORE. Built from Intl.DateTimeFormat().formatToParts() rather
// than a locale tag that happens to format as ISO (that's locale data, not a
// guarantee) — the parts are assembled explicitly. The instant is a parameter
// so this can be tested at a chosen moment without mocking the clock.
export function localImportDay(timezone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
