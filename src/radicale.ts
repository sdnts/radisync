export interface CalendarEvent {
	uid: string;
	summary: string;
	dtstart: string;
	dtend: string;
	timezone?: string;
	description?: string;
	location?: string;
	rrule?: string;
}

export interface SyncResult {
	events: CalendarEvent[];
	deleted: string[];
	syncToken: string;
}

function parseCalDAVResponse(xml: string): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	const calendarDataRegex =
		/<(?:[a-z]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?calendar-data>/gi;
	let match;

	while ((match = calendarDataRegex.exec(xml)) !== null) {
		// Unfold iCal lines (CRLF + space/tab continuation)
		const icalData = match[1].replace(/\r?\n[ \t]/g, "");

		// Extract just the VEVENT block to avoid matching VTIMEZONE's DTSTART
		const veventMatch = icalData.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/);
		if (!veventMatch) continue;
		const veventData = veventMatch[1];

		// Get timezone from VTIMEZONE block if present
		const vtimezoneMatch = icalData.match(
			/BEGIN:VTIMEZONE[\s\S]*?TZID:([^\r\n]+)/,
		);
		const vtimezone = vtimezoneMatch?.[1]?.trim();

		const uidMatch = veventData.match(/UID:(.+)/);
		const summaryMatch = veventData.match(/SUMMARY:(.+)/);
		const dtstartMatch = veventData.match(
			/DTSTART(?:;TZID=([^:;]+))?(?:;[^:]*)?:(.+)/,
		);
		const dtendMatch = veventData.match(
			/DTEND(?:;TZID=([^:;]+))?(?:;[^:]*)?:(.+)/,
		);
		const descriptionMatch = veventData.match(/DESCRIPTION:(.+)/);
		const locationMatch = veventData.match(/LOCATION:(.+)/);
		const rruleMatch = veventData.match(/RRULE:(.+)/);

		if (uidMatch && summaryMatch && dtstartMatch) {
			// Prefer TZID from DTSTART/DTEND, fall back to VTIMEZONE
			const timezone =
				dtstartMatch[1]?.trim() || dtendMatch?.[1]?.trim() || vtimezone;
			const event = {
				uid: uidMatch[1].trim(),
				summary: summaryMatch[1].trim(),
				dtstart: dtstartMatch[2].trim(),
				dtend: dtendMatch ? dtendMatch[2].trim() : dtstartMatch[2].trim(),
				timezone,
				description: descriptionMatch ? descriptionMatch[1].trim() : undefined,
				location: locationMatch ? locationMatch[1].trim() : undefined,
				rrule: rruleMatch ? rruleMatch[1].trim() : undefined,
			};
			console.log(
				`[radicale] Parsed event: ${event.summary}, dtstart=${event.dtstart}, dtend=${event.dtend}, tz=${event.timezone}, rrule=${event.rrule || "none"}`,
			);
			events.push(event);
		}
	}

	return events;
}

function parseSyncToken(xml: string): string | null {
	const syncTokenMatch = xml.match(
		/<(?:[a-z]+:)?sync-token[^>]*>([^<]+)<\/(?:[a-z]+:)?sync-token>/i,
	);
	return syncTokenMatch ? syncTokenMatch[1].trim() : null;
}

function parseDeletedHrefs(xml: string): string[] {
	const deleted: string[] = [];
	const responseRegex =
		/<(?:[a-z]+:)?response[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?response>/gi;
	let match;

	while ((match = responseRegex.exec(xml)) !== null) {
		const responseXml = match[1];
		const statusMatch = responseXml.match(
			/<(?:[a-z]+:)?status[^>]*>([^<]+)<\/(?:[a-z]+:)?status>/i,
		);
		if (statusMatch && statusMatch[1].includes("404")) {
			const hrefMatch = responseXml.match(
				/<(?:[a-z]+:)?href[^>]*>([^<]+)<\/(?:[a-z]+:)?href>/i,
			);
			if (hrefMatch) {
				const href = hrefMatch[1].trim();
				const uidMatch = href.match(/([^/]+)\.ics$/);
				if (uidMatch) {
					deleted.push(uidMatch[1]);
				}
			}
		}
	}

	return deleted;
}

export interface GoogleEvent {
	id: string;
	summary: string;
	start: { dateTime?: string; date?: string; timeZone?: string };
	end: { dateTime?: string; date?: string; timeZone?: string };
	description?: string;
	location?: string;
	iCalUID?: string;
	recurrence?: string[];
}

function toICalDateUTC(start: GoogleEvent["start"]): {
	value: string;
	isAllDay: boolean;
} {
	if (start.date) {
		// All-day event: YYYY-MM-DD -> YYYYMMDD
		return { value: start.date.replace(/-/g, ""), isAllDay: true };
	}
	// DateTime event - convert to UTC
	const dt = start.dateTime!;
	const tz = start.timeZone;

	// Parse the datetime and convert to UTC
	let date: Date;
	if (dt.endsWith("Z")) {
		date = new Date(dt);
	} else if (tz) {
		// Parse as local time in the given timezone, then convert to UTC
		// Create a date string that JavaScript can parse with timezone
		date = new Date(dt);
		// The datetime is in the specified timezone, so we need to interpret it correctly
		// Use Intl to get the offset and adjust
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
		// Parse the original datetime components
		const match = dt.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
		if (match) {
			// Create date as if in UTC, then find the offset
			const [, year, month, day, hour, min, sec] = match;
			// Build a date in the target timezone
			const tzDate = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);
			// Get what this time would be in the target timezone
			const utcString = tzDate.toLocaleString("en-US", { timeZone: "UTC" });
			const tzString = tzDate.toLocaleString("en-US", { timeZone: tz });
			const utcDate = new Date(utcString);
			const localDate = new Date(tzString);
			const offset = localDate.getTime() - utcDate.getTime();
			// The input time is in tz, so subtract offset to get UTC
			date = new Date(tzDate.getTime() - offset);
		} else {
			date = new Date(dt);
		}
	} else {
		date = new Date(dt);
	}

	const utcString = date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
	return { value: utcString, isAllDay: false };
}

function toICalendar(event: GoogleEvent): string {
	const uid = event.iCalUID || event.id;
	const dtstart = toICalDateUTC(event.start);
	const dtend = toICalDateUTC(event.end);
	const now = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");

	let ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//radisync//caldav//EN\r\n`;
	ical += `BEGIN:VEVENT\r\n`;
	ical += `UID:${uid}\r\n`;
	ical += `DTSTAMP:${now}\r\n`;
	ical += `SUMMARY:${event.summary || "Untitled"}\r\n`;

	if (dtstart.isAllDay) {
		ical += `DTSTART;VALUE=DATE:${dtstart.value}\r\n`;
		ical += `DTEND;VALUE=DATE:${dtend.value}\r\n`;
	} else {
		// Always use UTC (Z suffix) for timed events
		ical += `DTSTART:${dtstart.value}\r\n`;
		ical += `DTEND:${dtend.value}\r\n`;
	}

	// Add recurrence rules if present
	if (event.recurrence) {
		for (const rule of event.recurrence) {
			ical += `${rule}\r\n`;
		}
	}

	if (event.description) {
		ical += `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}\r\n`;
	}
	if (event.location) {
		ical += `LOCATION:${event.location}\r\n`;
	}

	ical += `END:VEVENT\r\nEND:VCALENDAR\r\n`;
	return ical;
}

export async function fetchRadicaleEvents(
	tunnel: Fetcher,
	kv: KVNamespace,
	calendarUrl: string,
): Promise<SyncResult> {
	const syncToken = await kv.get("radicaleSyncToken");
	console.log(
		`[radicale] Fetching events, syncToken: ${syncToken ? "present" : "none"}`,
	);

	const syncTokenElement = syncToken
		? `<d:sync-token>${syncToken}</d:sync-token>`
		: `<d:sync-token/>`;

	const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:sync-level>1</d:sync-level>
  ${syncTokenElement}
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
</d:sync-collection>`;

	console.log("[radicale] Sending REPORT request");
	const response = await tunnel.fetch(calendarUrl, {
		method: "REPORT",
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
		},
		body: reportBody,
	});

	if (!response.ok) {
		console.log(
			`[radicale] Request failed: ${response.status} ${response.statusText}`,
		);
		throw new Error(
			`CalDAV sync-collection request failed: ${response.status} ${response.statusText}`,
		);
	}

	const xml = await response.text();
	const events = parseCalDAVResponse(xml);
	const deleted = parseDeletedHrefs(xml);
	const newSyncToken = parseSyncToken(xml);

	if (!newSyncToken) {
		throw new Error("No sync-token in response");
	}

	console.log(
		`[radicale] Done: ${events.length} events, ${deleted.length} deleted`,
	);

	return { events, deleted, syncToken: newSyncToken };
}

export async function updateRadicaleEvents(
	tunnel: Fetcher,
	calendarUrl: string,
	events: GoogleEvent[],
): Promise<{ updated: number; created: number; errors: string[] }> {
	console.log(`[radicale] Upserting ${events.length} events`);
	const errors: string[] = [];
	let updated = 0;
	let created = 0;

	for (const event of events) {
		const uid = event.iCalUID || event.id;
		const eventUrl = `${calendarUrl}${uid}.ics`;
		const icalData = toICalendar(event);

		// Check if event exists
		const headResponse = await tunnel.fetch(eventUrl, { method: "HEAD" });
		const exists = headResponse.ok;

		const putResponse = await tunnel.fetch(eventUrl, {
			method: "PUT",
			headers: {
				"Content-Type": "text/calendar; charset=utf-8",
			},
			body: icalData,
		});

		if (putResponse.ok) {
			if (exists) {
				console.log(`[radicale] Updated event ${uid}`);
				updated++;
			} else {
				console.log(`[radicale] Created event ${uid}`);
				created++;
			}
		} else {
			const err = `Failed to upsert event ${uid}: ${putResponse.status} ${putResponse.statusText}`;
			console.log(`[radicale] ${err}`);
			errors.push(err);
		}
	}

	console.log(
		`[radicale] Upsert complete: ${updated} updated, ${created} created, ${errors.length} errors`,
	);
	return { updated, created, errors };
}

export async function deleteRadicaleEvents(
	tunnel: Fetcher,
	calendarUrl: string,
	uids: string[],
): Promise<{ deleted: number; errors: string[] }> {
	console.log(`[radicale] Deleting ${uids.length} events`);
	const errors: string[] = [];
	let deleted = 0;

	for (const uid of uids) {
		const eventUrl = `${calendarUrl}${uid}.ics`;

		const deleteResponse = await tunnel.fetch(eventUrl, {
			method: "DELETE",
		});

		if (deleteResponse.ok || deleteResponse.status === 404) {
			console.log(`[radicale] Deleted event ${uid}`);
			deleted++;
		} else {
			const err = `Failed to delete event ${uid}: ${deleteResponse.status} ${deleteResponse.statusText}`;
			console.log(`[radicale] ${err}`);
			errors.push(err);
		}
	}

	console.log(
		`[radicale] Delete complete: ${deleted} deleted, ${errors.length} errors`,
	);
	return { deleted, errors };
}
