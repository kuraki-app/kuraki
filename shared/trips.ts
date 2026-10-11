/**
 * How a trip is titled and dated, decided from the facts the server sent.
 *
 * The server deliberately stores no label. It keeps the dominant place and the
 * date range, and both clients format them here, so a trip cannot be called
 * "Jaipur · March 2024" on the web and something else on a phone.
 *
 * Pure and tested here rather than inline in a component, for the same reason
 * album-cover.ts is: `mobile/` has no React Native render harness, so a rule
 * left inside a component is checked by eye and nowhere else.
 */

export type TripFacts = {
  /** Non-empty only when the user named the trip themselves. */
  name?: string;
  place_city?: string;
  place_country?: string;
  started_at?: string;
  ended_at?: string;
};

/**
 * Month names are spelled out rather than taken from Intl.
 *
 * Hermes ships without full ICU on some Android builds, so
 * `Intl.DateTimeFormat(undefined, { month: 'long' })` can return "M03" on a
 * phone while a browser returns "March". That is exactly the cross-client
 * disagreement this module exists to prevent, and a twelve-element array costs
 * nothing to be certain about.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/**
 * tripTitle is what the card and the page heading say.
 *
 * A user's own name always wins. Otherwise the dominant place stands in, and
 * only when there is no place at all does it fall back to a bare word — a trip
 * with no GPS anywhere still has to be called something, and "Trip" beside its
 * date range is honest, where inventing a place would not be.
 */
export function tripTitle(trip: TripFacts): string {
  const name = (trip.name ?? '').trim();
  if (name) return name;
  const city = (trip.place_city ?? '').trim();
  if (city) return city;
  const country = (trip.place_country ?? '').trim();
  if (country) return country;
  return 'Trip';
}

/**
 * tripSubtitle renders the span the way a person would write it, collapsing
 * whatever the two ends share:
 *
 *   same day      -> "3 March 2024"
 *   same month    -> "1-4 March 2024"
 *   same year     -> "28 Feb - 3 Mar 2024"
 *   crosses a year-> "28 Dec 2023 - 2 Jan 2024"
 *
 * Repeating the month and year at both ends is how a date range starts reading
 * as a database field instead of a memory.
 *
 * Returns '' when either end is missing or unparseable, so a caller can drop
 * the line rather than print "Invalid Date".
 */
export function tripSubtitle(trip: TripFacts): string {
  const start = parseDay(trip.started_at);
  const end = parseDay(trip.ended_at);
  if (!start || !end) return '';

  const sameYear = start.year === end.year;
  const sameMonth = sameYear && start.month === end.month;

  if (sameMonth && start.day === end.day) {
    return `${start.day} ${MONTHS[start.month]} ${start.year}`;
  }
  if (sameMonth) {
    return `${start.day}-${end.day} ${MONTHS[start.month]} ${start.year}`;
  }
  if (sameYear) {
    return `${start.day} ${SHORT_MONTHS[start.month]} - ${end.day} ${SHORT_MONTHS[end.month]} ${start.year}`;
  }
  return `${start.day} ${SHORT_MONTHS[start.month]} ${start.year} - ${end.day} ${SHORT_MONTHS[end.month]} ${end.year}`;
}

type Day = { year: number; month: number; day: number };

/**
 * parseDay reads the calendar day out of a timestamp without constructing a
 * Date.
 *
 * `new Date('2024-03-01T23:30:00Z')` is shifted into the reader's zone, so a
 * late-evening photo renders as the next day west of UTC and the previous one
 * east of it -- the same trap labelDate hit on the web timeline. The server's
 * strings are already the calendar day the trip happened on, so they are read
 * as text.
 */
function parseDay(value: string | undefined): Day | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}
