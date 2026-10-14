import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setTimeZone, currentTimeZone, systemTimeZone, zoneLabel, zoneLabelAt, formatClock, formatDateTime, formatDayNumeric, formatShortDate,
} from '../extension/ui/time-zone.js';

test.afterEach(() => setTimeZone(systemTimeZone()));

test('the label is a short offset', () => {
  assert.equal(zoneLabel('Asia/Bishkek'), 'GMT+6');
  assert.equal(zoneLabel('UTC'), 'GMT+0');
  assert.equal(zoneLabelAt(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York'), 'GMT-4');
  assert.equal(zoneLabelAt(Date.parse('2026-12-01T12:00:00Z'), 'America/New_York'), 'GMT-5');
  assert.match(zoneLabel('America/New_York'), /^GMT-[45]$/);
});

test('the zone of the page defaults to the system one and follows setTimeZone', () => {
  assert.equal(currentTimeZone(), systemTimeZone());
  setTimeZone('Asia/Bishkek');
  assert.equal(currentTimeZone(), 'Asia/Bishkek');
  assert.equal(zoneLabel(), 'GMT+6');
});

test('times are written in the zone of the page', () => {
  const instant = '2026-10-12T03:14:05.000Z';
  setTimeZone('Asia/Bishkek');
  assert.equal(formatClock(instant), '09:14');
  assert.equal(formatDateTime(instant), '12.10.2026, 09:14:05');
  setTimeZone('America/New_York');
  assert.equal(formatClock(instant), '23:14');
  assert.equal(formatDateTime(instant), '11.10.2026, 23:14:05');
  assert.match(formatShortDate(instant), /^11 окт\.? 2026/);
});

test('a calendar day is written without any zone shift', () => {
  setTimeZone('Pacific/Kiritimati');
  assert.equal(formatDayNumeric('2026-10-12'), '12.10.2026');
  setTimeZone('Pacific/Pago_Pago');
  assert.equal(formatDayNumeric('2026-10-12'), '12.10.2026');
});
