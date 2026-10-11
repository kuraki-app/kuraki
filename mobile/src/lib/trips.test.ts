import { describe, expect, it } from 'vitest';

import { tripSubtitle, tripTitle } from '@/lib/trips';

describe('tripTitle', () => {
  it('prefers the name the user gave it', () => {
    expect(tripTitle({ name: 'Rajasthan', place_city: 'Jaipur' })).toBe('Rajasthan');
  });

  it('falls back to the dominant city, then the country', () => {
    expect(tripTitle({ place_city: 'Jaipur', place_country: 'India' })).toBe('Jaipur');
    expect(tripTitle({ place_country: 'India' })).toBe('India');
  });

  it('never renders an empty heading for a trip with no place', () => {
    expect(tripTitle({})).toBe('Trip');
    expect(tripTitle({ name: '   ', place_city: '' })).toBe('Trip');
  });
});

describe('tripSubtitle', () => {
  it('collapses a single day', () => {
    expect(tripSubtitle({ started_at: '2024-03-03T09:00:00Z', ended_at: '2024-03-03T21:00:00Z' }))
      .toBe('3 March 2024');
  });

  it('collapses a span inside one month', () => {
    expect(tripSubtitle({ started_at: '2024-03-01T09:00:00Z', ended_at: '2024-03-04T18:00:00Z' }))
      .toBe('1-4 March 2024');
  });

  it('keeps both months but one year when the span crosses a month', () => {
    expect(tripSubtitle({ started_at: '2024-02-28T09:00:00Z', ended_at: '2024-03-03T18:00:00Z' }))
      .toBe('28 Feb - 3 Mar 2024');
  });

  it('spells out both years when the span crosses one', () => {
    expect(tripSubtitle({ started_at: '2023-12-28T09:00:00Z', ended_at: '2024-01-02T18:00:00Z' }))
      .toBe('28 Dec 2023 - 2 Jan 2024');
  });

  // A late-evening timestamp must not shift a day in either direction. Reading
  // the string rather than constructing a Date is what guarantees it, and this
  // is the regression the web timeline's labelDate already hit once.
  it('reads the calendar day as written, regardless of the reader timezone', () => {
    expect(tripSubtitle({ started_at: '2024-03-01T23:30:00Z', ended_at: '2024-03-01T23:59:00Z' }))
      .toBe('1 March 2024');
  });

  it('returns nothing usable rather than an Invalid Date', () => {
    expect(tripSubtitle({})).toBe('');
    expect(tripSubtitle({ started_at: 'nonsense', ended_at: '2024-03-01T00:00:00Z' })).toBe('');
  });
});
