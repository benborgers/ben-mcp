export const calendarTimeZone = "America/Los_Angeles";
const accounts = [
  { email: "ben.borgers@owner.com", token: "CALENDAR_WORK_REFRESH_TOKEN" },
  { email: "borgersbenjamin@gmail.com", token: "CALENDAR_PERSONAL_REFRESH_TOKEN" },
];

type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean }[];
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function midnight(date: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let timestamp = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: calendarTimeZone, timeZoneName: "longOffset",
  });
  for (let i = 0; i < 3; i++) {
    const offset = formatter.formatToParts(timestamp).find((part) => part.type === "timeZoneName")!.value;
    const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) throw new Error("Could not calculate Pacific time offset");
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
    timestamp = target - minutes * 60000;
  }
  return new Date(timestamp).toISOString();
}

export function dayBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid calendar date");
  }
  const next = new Date(parsed.getTime() + 86400000).toISOString().slice(0, 10);
  return { timeMin: midnight(date), timeMax: midnight(next) };
}

async function accountEvents(account: typeof accounts[number], date: string) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: required("CALENDAR_GOOGLE_CLIENT_ID"),
      client_secret: required("CALENDAR_GOOGLE_CLIENT_SECRET"),
      refresh_token: required(account.token),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw new Error(`Calendar authentication failed for ${account.email} (${tokenResponse.status})`);
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      ...dayBounds(date), timeZone: calendarTimeZone,
      singleEvents: "true", orderBy: "startTime", maxResults: "2500", showDeleted: "false",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(account.email)}/events?${query}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Calendar read failed for ${account.email} (${response.status})`);
    const data = await response.json() as { items?: CalendarEvent[]; nextPageToken?: string };
    events.push(...(data.items ?? []).filter((event) => event.status !== "cancelled"));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events.map((event) => ({
    calendar: account.email, id: event.id, title: event.summary ?? "(Untitled)",
    start: event.start, end: event.end, allDay: Boolean(event.start.date),
    description: event.description ?? null, location: event.location ?? null,
    url: event.htmlLink ?? null, meetingUrl: event.hangoutLink ?? null,
    attendees: event.attendees ?? [],
  }));
}

export async function getCalendarEvents(date: string) {
  dayBounds(date);
  const events = [];
  for (const account of accounts) events.push(...await accountEvents(account, date));
  events.sort((a, b) => {
    const start = (event: typeof a) => event.start.dateTime ?? midnight(event.start.date!);
    return Date.parse(start(a)) - Date.parse(start(b)) || a.calendar.localeCompare(b.calendar);
  });
  return { date, timeZone: calendarTimeZone, calendars: accounts.map(({ email }) => email), events };
}
