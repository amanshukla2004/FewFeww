import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { DateResolver } from './date.resolver.js';

describe('Deterministic DateResolver (10 Golden Rules)', () => {
  const resolver = new DateResolver();

  // Reference timestamp: Monday, Nov 16, 2026 at 10:00 AM IST
  const refZone = 'Asia/Kolkata';
  const refMonday = DateTime.fromISO('2026-11-16T10:00:00', { zone: refZone });

  describe('Rule 1: Date given, no time -> Default to user reminder time (09:00)', () => {
    it('sets default 09:00 AM when time_is_explicit is false in proposed ISO', () => {
      const res = resolver.resolveProposed('2026-11-20', false, {
        timezone: refZone,
        defaultReminderTime: '09:00',
        referenceNow: refMonday,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.timeIsExplicit).toBe(false);
        expect(res.localIso).toContain('2026-11-20T09:00:00');
        // Asia/Kolkata is UTC+05:30 -> 09:00 IST is 03:30 UTC
        expect(res.utcDate.toISOString()).toBe('2026-11-20T03:30:00.000Z');
      }
    });

    it('preserves explicit time when time_is_explicit is true in proposed ISO', () => {
      const res = resolver.resolveProposed('2026-11-20T18:00:00', true, {
        timezone: refZone,
        referenceNow: refMonday,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.timeIsExplicit).toBe(true);
        expect(res.localIso).toContain('2026-11-20T18:00:00');
        // 18:00 IST is 12:30 UTC
        expect(res.utcDate.toISOString()).toBe('2026-11-20T12:30:00.000Z');
      }
    });
  });

  describe('Rule 2: Time given, no date -> Next occurrence in future', () => {
    it('resolves time today if hour is in the future (> 10:00 AM)', () => {
      const res = resolver.resolveNatural('at 4pm', {
        timezone: refZone,
        referenceNow: refMonday,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.timeIsExplicit).toBe(true);
        expect(res.localIso).toContain('2026-11-16T16:00:00');
      }
    });

    it('resolves time tomorrow if hour has already passed today (< 10:00 AM)', () => {
      const res = resolver.resolveNatural('at 8am', {
        timezone: refZone,
        referenceNow: refMonday, // 10:00 AM
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.timeIsExplicit).toBe(true);
        expect(res.localIso).toContain('2026-11-17T08:00:00');
      }
    });
  });

  describe('Rule 3: Bare weekday -> Next occurrence strictly after today', () => {
    it('resolves bare Friday to upcoming Friday', () => {
      const res = resolver.resolveNatural('Friday', {
        timezone: refZone,
        referenceNow: refMonday, // Monday Nov 16
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.localIso).toContain('2026-11-20T09:00:00');
        expect(res.timeIsExplicit).toBe(false);
      }
    });

    it('resolves bare Friday on a Friday to NEXT Friday (+7 days, never today)', () => {
      const refFriday = DateTime.fromISO('2026-11-20T10:00:00', { zone: refZone });
      const res = resolver.resolveNatural('Friday', {
        timezone: refZone,
        referenceNow: refFriday,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        // Must be Nov 27, not Nov 20!
        expect(res.localIso).toContain('2026-11-27T09:00:00');
      }
    });
  });

  describe('Rule 6: Bare hour 1 to 7 without am/pm -> Treat as PM', () => {
    it('resolves "at 5" to 17:00 (5:00 PM)', () => {
      const res = resolver.resolveNatural('at 5', {
        timezone: refZone,
        referenceNow: refMonday,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.localIso).toContain('T17:00:00');
      }
    });

    it('resolves "at 9" to 09:00 (9:00 AM) if future', () => {
      // 06:00 AM reference
      const earlyRef = DateTime.fromISO('2026-11-16T06:00:00', { zone: refZone });
      const res = resolver.resolveNatural('at 9', {
        timezone: refZone,
        referenceNow: earlyRef,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.localIso).toContain('T09:00:00');
      }
    });
  });

  describe('Rule 7: Colloquial periods & Hinglish tokens', () => {
    it('resolves "kal subah" to tomorrow at 09:00 AM', () => {
      const res = resolver.resolveNatural('buy milk kal subah', {
        timezone: refZone,
        referenceNow: refMonday,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.localIso).toContain('2026-11-17T09:00:00');
      }
    });

    it('resolves "tomorrow evening" to tomorrow at 18:00 (6:00 PM)', () => {
      const res = resolver.resolveNatural('call advisor tomorrow evening', {
        timezone: refZone,
        referenceNow: refMonday,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.localIso).toContain('2026-11-17T18:00:00');
      }
    });

    it('resolves "tonight" to 20:00 (8:00 PM)', () => {
      const res = resolver.resolveNatural('review pull request tonight', {
        timezone: refZone,
        referenceNow: refMonday, // 10:00 AM
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.localIso).toContain('2026-11-16T20:00:00');
      }
    });
  });

  describe('Rule 8 & 9: Validation Gates (Past dates & > 2 years)', () => {
    it('rejects dates in the past with NEEDS_CLARIFICATION (in_the_past)', () => {
      const res = resolver.resolveProposed('2026-11-10T10:00:00', true, {
        timezone: refZone,
        referenceNow: refMonday, // Nov 16, 2026
      });

      expect(res.kind).toBe('NEEDS_CLARIFICATION');
      if (res.kind === 'NEEDS_CLARIFICATION') {
        expect(res.reason).toBe('in_the_past');
        expect(res.message).toContain('already passed');
      }
    });

    it('rejects dates more than 2 years in the future (too_far)', () => {
      const res = resolver.resolveProposed('2029-11-20T10:00:00', true, {
        timezone: refZone,
        referenceNow: refMonday,
      });

      expect(res.kind).toBe('NEEDS_CLARIFICATION');
      if (res.kind === 'NEEDS_CLARIFICATION') {
        expect(res.reason).toBe('too_far');
        expect(res.message).toContain('2 years');
      }
    });
  });

  describe('Rule 10: Timezone Conversion Accuracy', () => {
    it('accurately converts America/New_York (EST, UTC-5) to UTC', () => {
      // 2026-11-20 09:00:00 EST -> 2026-11-20 14:00:00 UTC
      const nyRef = DateTime.fromISO('2026-11-16T10:00:00', { zone: 'America/New_York' });
      const res = resolver.resolveProposed('2026-11-20T09:00:00', true, {
        timezone: 'America/New_York',
        referenceNow: nyRef,
      });

      expect(res.kind).toBe('RESOLVED');
      if (res.kind === 'RESOLVED') {
        expect(res.utcDate.toISOString()).toBe('2026-11-20T14:00:00.000Z');
      }
    });
  });
});
