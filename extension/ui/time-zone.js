// The time zone of the open page: the profile's one once it is known, the system one until then.
export function systemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

let current = systemTimeZone();

export function setTimeZone(timeZone) {
  current = timeZone;
}

export function currentTimeZone() {
  return current;
}

// A short label of the zone, such as "GMT+6" or "GMT-4".
export function zoneLabel(timeZone = current) {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date());
  return parts.find(part => part.type === 'timeZoneName')?.value ?? timeZone;
}

// The same, for a given moment: daylight saving time changes the offset during the year.
export function zoneLabelAt(instant, timeZone = current) {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date(instant));
  return parts.find(part => part.type === 'timeZoneName')?.value ?? timeZone;
}

export function formatClock(value) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: current, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: current, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

export function formatShortDate(value) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: current, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatDateTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: current, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}

// A calendar day of the profile (YYYY-MM-DD) written as dd.mm.yyyy; the day is a date, not a moment, so no zone applies.
export function formatDayNumeric(day) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
}
