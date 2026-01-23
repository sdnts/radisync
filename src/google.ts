import type { CalendarEvent } from "./radicale";

interface GoogleToken {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
}

interface GoogleEvent {
	id: string;
	summary: string;
	start: { dateTime?: string; date?: string; timeZone?: string };
	end: { dateTime?: string; date?: string; timeZone?: string };
	description?: string;
	location?: string;
	status?: string;
	iCalUID?: string;
}

interface GoogleEventsResponse {
	items?: GoogleEvent[];
	nextSyncToken?: string;
	nextPageToken?: string;
}

export interface GoogleSyncResult {
	events: GoogleEvent[];
	deleted: string[];
	syncToken: string;
}

function parseICalDate(
	icalDate: string,
	timezone?: string,
): { dateTime?: string; date?: string; timeZone?: string } {
	if (icalDate.length === 8) {
		// All-day event: YYYYMMDD
		return {
			date: `${icalDate.slice(0, 4)}-${icalDate.slice(4, 6)}-${icalDate.slice(6, 8)}`,
		};
	}
	// DateTime: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
	const year = icalDate.slice(0, 4);
	const month = icalDate.slice(4, 6);
	const day = icalDate.slice(6, 8);
	const hour = icalDate.slice(9, 11);
	const minute = icalDate.slice(11, 13);
	const second = icalDate.slice(13, 15);
	const isUtc = icalDate.endsWith("Z");
	const dateTime = `${year}-${month}-${day}T${hour}:${minute}:${second}${isUtc ? "Z" : ""}`;

	if (isUtc) {
		return { dateTime };
	}
	return { dateTime, timeZone: timezone || "UTC" };
}

function toGoogleEvent(event: CalendarEvent): Omit<GoogleEvent, "id"> {
	return {
		summary: event.summary,
		start: parseICalDate(event.dtstart, event.timezone),
		end: parseICalDate(event.dtend, event.timezone),
		description: event.description,
		location: event.location,
	};
}

async function getToken(kv: KVNamespace): Promise<GoogleToken> {
	const tokenData = await kv.get("googleOAuthToken");
	if (!tokenData) {
		throw new Error("No Google OAuth token found");
	}
	return JSON.parse(tokenData);
}

export async function fetchGoogleEvents(
	kv: KVNamespace,
): Promise<GoogleSyncResult> {
	const calendarId = await kv.get("googleCalendarId");
	if (!calendarId) {
		throw new Error("No Google Calendar ID found in KV");
	}

	const token = await getToken(kv);
	const syncToken = await kv.get("googleSyncToken");
	console.log(
		`[google] Fetching events, syncToken: ${syncToken ? "present" : "none"}`,
	);

	const events: GoogleEvent[] = [];
	const deleted: string[] = [];
	let pageToken: string | undefined;
	let newSyncToken: string | undefined;

	do {
		const params = new URLSearchParams();
		if (syncToken) {
			params.set("syncToken", syncToken);
		} else {
			params.set("maxResults", "2500");
		}
		if (pageToken) {
			params.set("pageToken", pageToken);
		}

		const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
		console.log(`[google] Fetching: ${url}`);

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token.access_token}`,
			},
		});

		if (response.status === 410) {
			console.log(
				"[google] Sync token expired, clearing and retrying with full sync",
			);
			await kv.delete("googleSyncToken");
			return fetchGoogleEvents(kv);
		}

		if (!response.ok) {
			const error = await response.text();
			throw new Error(
				`Google Calendar API failed: ${response.status} ${error}`,
			);
		}

		const data = (await response.json()) as GoogleEventsResponse;

		for (const event of data.items || []) {
			if (event.status === "cancelled") {
				if (event.iCalUID) {
					deleted.push(event.iCalUID);
				}
			} else {
				events.push(event);
			}
		}

		pageToken = data.nextPageToken;
		if (data.nextSyncToken) {
			newSyncToken = data.nextSyncToken;
		}
	} while (pageToken);

	if (!newSyncToken) {
		throw new Error("No sync token in Google Calendar response");
	}

	console.log(
		`[google] Done: ${events.length} events, ${deleted.length} deleted`,
	);

	return { events, deleted, syncToken: newSyncToken };
}

export async function createGoogleEvents(
	kv: KVNamespace,
	calendarId: string,
	events: CalendarEvent[],
): Promise<{ created: number; errors: string[] }> {
	const token = await getToken(kv);
	const errors: string[] = [];
	let created = 0;

	for (const event of events) {
		const googleEvent = toGoogleEvent(event);
		const response = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token.access_token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					...googleEvent,
					iCalUID: event.uid,
				}),
			},
		);

		if (response.ok) {
			created++;
		} else {
			const error = await response.text();
			errors.push(`Failed to create event ${event.uid}: ${error}`);
		}
	}

	return { created, errors };
}

export async function deleteGoogleEvents(
	kv: KVNamespace,
	calendarId: string,
	uids: string[],
): Promise<{ deleted: number; errors: string[] }> {
	console.log(`[google] Deleting ${uids.length} events`);
	const token = await getToken(kv);
	const errors: string[] = [];
	let deleted = 0;

	for (const uid of uids) {
		const searchResponse = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?iCalUID=${encodeURIComponent(uid)}`,
			{
				headers: {
					Authorization: `Bearer ${token.access_token}`,
				},
			},
		);

		if (!searchResponse.ok) {
			const err = `Failed to find event ${uid}: ${await searchResponse.text()}`;
			console.log(`[google] ${err}`);
			errors.push(err);
			continue;
		}

		const searchResult = (await searchResponse.json()) as {
			items?: { id: string }[];
		};
		if (!searchResult.items || searchResult.items.length === 0) {
			console.log(`[google] Event ${uid} not found, skipping`);
			continue;
		}

		const eventId = searchResult.items[0].id;
		const deleteResponse = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
			{
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token.access_token}`,
				},
			},
		);

		if (deleteResponse.ok || deleteResponse.status === 404) {
			console.log(`[google] Deleted event ${uid}`);
			deleted++;
		} else {
			const err = `Failed to delete event ${uid}: ${await deleteResponse.text()}`;
			console.log(`[google] ${err}`);
			errors.push(err);
		}
	}

	console.log(
		`[google] Delete complete: ${deleted} deleted, ${errors.length} errors`,
	);
	return { deleted, errors };
}

export async function updateGoogleEvents(
	kv: KVNamespace,
	calendarId: string,
	events: CalendarEvent[],
): Promise<{ updated: number; created: number; errors: string[] }> {
	console.log(`[google] Upserting ${events.length} events`);
	const token = await getToken(kv);
	const errors: string[] = [];
	let updated = 0;
	let created = 0;

	for (const event of events) {
		const searchResponse = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?iCalUID=${encodeURIComponent(event.uid)}`,
			{
				headers: {
					Authorization: `Bearer ${token.access_token}`,
				},
			},
		);

		if (!searchResponse.ok) {
			const err = `Failed to search for event ${event.uid}: ${await searchResponse.text()}`;
			console.log(`[google] ${err}`);
			errors.push(err);
			continue;
		}

		const searchResult = (await searchResponse.json()) as {
			items?: { id: string }[];
		};
		const googleEvent = toGoogleEvent(event);

		if (searchResult.items && searchResult.items.length > 0) {
			const eventId = searchResult.items[0].id;
			const updateResponse = await fetch(
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
				{
					method: "PUT",
					headers: {
						Authorization: `Bearer ${token.access_token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(googleEvent),
				},
			);

			if (updateResponse.ok) {
				console.log(`[google] Updated event ${event.uid}`);
				updated++;
			} else {
				const err = `Failed to update event ${event.uid}: ${await updateResponse.text()}`;
				console.log(`[google] ${err}`);
				errors.push(err);
			}
		} else {
			const createResponse = await fetch(
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token.access_token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						...googleEvent,
						iCalUID: event.uid,
					}),
				},
			);

			if (createResponse.ok) {
				console.log(`[google] Created event ${event.uid}`);
				created++;
			} else {
				const err = `Failed to create event ${event.uid}: ${await createResponse.text()}`;
				console.log(`[google] ${err}`);
				errors.push(err);
			}
		}
	}

	console.log(
		`[google] Upsert complete: ${updated} updated, ${created} created, ${errors.length} errors`,
	);
	return { updated, created, errors };
}
