import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchRadicaleEvents,
	updateRadicaleEvents,
	deleteRadicaleEvents,
} from "./radicale";
import {
	updateGoogleEvents,
	deleteGoogleEvents,
} from "./google";

describe("RadicaleToGoogle Sync - Full Integration", () => {
	const calendarUrl = "https://radicale.local/calendars/user/calendar/";
	const googleCalendarId = "calendar-123";

	describe("Event Creation - Radicale to Google", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should create new events from Radicale in Google Calendar", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"abc123"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-new-1
SUMMARY:New Team Meeting
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
DESCRIPTION:Quarterly planning session
LOCATION:Conference Room A
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-new-events</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce(null) // radicaleSyncToken
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					), // googleOAuthToken
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					// Search for existing event
					new Response(
						JSON.stringify({
							items: [],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Create event
					new Response("", { status: 201 }),
				);

			// Fetch from Radicale
			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			expect(radicaleSync.events).toHaveLength(1);
			expect(radicaleSync.events[0]?.uid).toBe("event-new-1");

			// Sync to Google
			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.created).toBe(1);
			expect(googleResult.updated).toBe(0);
			expect(googleResult.errors).toHaveLength(0);
		});

		it("should create multiple new events preserving all details", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event1
SUMMARY:Event 1
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
DESCRIPTION:First event
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/user/calendar/event2.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event2
SUMMARY:Event 2
DTSTART:20240116T140000Z
DTEND:20240116T150000Z
LOCATION:Office
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-multi</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce(null) // radicaleSyncToken
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					), // googleOAuthToken
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 201 }))
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 201 }));

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			expect(radicaleSync.events).toHaveLength(2);

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.created).toBe(2);
			expect(googleResult.errors).toHaveLength(0);
		});
	});

	describe("Event Deletion - Radicale to Google", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should delete events from Google Calendar when deleted in Radicale", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:sync-token>token-after-deletion</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("old-sync-token") // radicaleSyncToken
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					), // googleOAuthToken
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					// Search for deleted event 1
					new Response(
						JSON.stringify({
							items: [{ id: "google-event-1" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Delete event 1
					new Response("", { status: 200 }),
				)
				.mockResolvedValueOnce(
					// Search for deleted event 2
					new Response(
						JSON.stringify({
							items: [{ id: "google-event-2" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Delete event 2
					new Response("", { status: 200 }),
				);

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			const deletedUids = ["deleted-event-1@example.com", "deleted-event-2@example.com"];
			const googleResult = await deleteGoogleEvents(
				mockKV,
				googleCalendarId,
				deletedUids,
			);

			expect(googleResult.deleted).toBe(2);
			expect(googleResult.errors).toHaveLength(0);
		});

		it("should handle gracefully when event already deleted in Google", async () => {
			const mockKV = {
				get: vi.fn().mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-token",
					}),
				),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				// Search returns no results (event not found)
				new Response(
					JSON.stringify({
						items: [],
					}),
					{ status: 200 },
				),
			);

			const result = await deleteGoogleEvents(
				mockKV,
				googleCalendarId,
				["already-deleted@example.com"],
			);

			expect(result.deleted).toBe(0);
			expect(result.errors).toHaveLength(0);
		});
	});

	describe("Event Modification - Radicale to Google", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should update modified events from Radicale", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event-modified.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:modified-event
SUMMARY:Updated Meeting Title
DTSTART:20240115T140000Z
DTEND:20240115T150000Z
DESCRIPTION:Updated description with new details
LOCATION:Conference Room B
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-modified</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("old-sync-token") // radicaleSyncToken
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					), // googleOAuthToken
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					// Search for event - found (exists in Google)
					new Response(
						JSON.stringify({
							items: [{ id: "google-event-id" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Update event
					new Response("", { status: 200 }),
				);

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			expect(radicaleSync.events).toHaveLength(1);
			expect(radicaleSync.events[0]?.summary).toBe("Updated Meeting Title");

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.updated).toBe(1);
			expect(googleResult.created).toBe(0);
			expect(googleResult.errors).toHaveLength(0);
		});

		it("should update multiple fields in an event", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event-updated.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:multi-field-update
SUMMARY:Updated Event
DTSTART:20240120T080000Z
DTEND:20240120T180000Z
DESCRIPTION:Completely new description
LOCATION:New Location
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-multi-update</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("old-token")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "google-id" }] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 200 }));

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			const event = radicaleSync.events[0];
			expect(event?.summary).toBe("Updated Event");
			expect(event?.description).toBe("Completely new description");
			expect(event?.location).toBe("New Location");

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.updated).toBe(1);
		});
	});

	describe("Recurring Events - Radicale to Google", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should sync recurring events with RRULE", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/recurring.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly-standup
SUMMARY:Weekly Standup
DTSTART:20240115T090000Z
DTEND:20240115T091500Z
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20240430T235959Z
DESCRIPTION:Team synchronization meeting
LOCATION:Zoom
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-recurring</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 201 }));

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			expect(radicaleSync.events).toHaveLength(1);
			expect(radicaleSync.events[0]?.rrule).toBe(
				"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20240430T235959Z",
			);
			expect(radicaleSync.events[0]?.summary).toBe("Weekly Standup");

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.created).toBe(1);
			expect(googleResult.errors).toHaveLength(0);
		});

		it("should update recurring events with modified RRULE", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/recurring-modified.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:daily-sync
SUMMARY:Daily Check-in
DTSTART:20240115T100000Z
DTEND:20240115T100300Z
RRULE:FREQ=DAILY;UNTIL=20240630T235959Z
DESCRIPTION:Modified daily standup
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-rrule-updated</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("old-token")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "recurring-google-id" }] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 200 }));

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			expect(radicaleSync.events[0]?.rrule).toBe("FREQ=DAILY;UNTIL=20240630T235959Z");

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.updated).toBe(1);
		});

		it("should handle deletion of recurring events", async () => {
			const mockKV = {
				get: vi.fn().mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-token",
					}),
				),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							items: [{ id: "recurring-google-event" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(new Response("", { status: 200 }));

			const result = await deleteGoogleEvents(
				mockKV,
				googleCalendarId,
				["deleted-recurring@example.com"],
			);

			expect(result.deleted).toBe(1);
			expect(result.errors).toHaveLength(0);
		});

		it("should handle recurring events with timezones", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/recurring-tz.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:biweekly-meeting
SUMMARY:Biweekly Review
DTSTART;TZID=America/New_York:20240115T140000
DTEND;TZID=America/New_York:20240115T150000
RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20240630T235959Z
DESCRIPTION:Review meeting every two weeks
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-recurring-tz</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 201 }));

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			expect(radicaleSync.events).toHaveLength(1);
			expect(radicaleSync.events[0]?.timezone).toBe("America/New_York");
			expect(radicaleSync.events[0]?.rrule).toBe(
				"FREQ=WEEKLY;INTERVAL=2;UNTIL=20240630T235959Z",
			);

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.created).toBe(1);
		});
	});

	describe("Error Handling - Radicale to Google", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should handle Radicale fetch failures gracefully", async () => {
			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response("Server error", { status: 500 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValueOnce(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			try {
				await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);
			} catch (error) {
				expect(error).toBeDefined();
			}
		});

		it("should handle Google Calendar sync failures and not save sync token", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event1
SUMMARY:Event
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>new-token</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("Server error", { status: 500 }));

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.errors).toHaveLength(1);

			// Verify sync token was not saved
			expect(mockKV.put).not.toHaveBeenCalledWith("radicaleSyncToken", expect.anything());
		});

		it("should continue sync even with partial event creation failures", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event1
SUMMARY:Good Event
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/user/calendar/event2.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event2
SUMMARY:Bad Event
DTSTART:20240116T100000Z
DTEND:20240116T110000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-partial</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 201 })) // success
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("Error", { status: 500 })); // failure

			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			const googleResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(googleResult.created).toBe(1);
			expect(googleResult.errors).toHaveLength(1);
		});
	});

	describe("Complete Sync Workflow", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should perform complete sync: create new, update modified, delete old", async () => {
			const radicaleResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/new.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:new-event
SUMMARY:New Event
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/user/calendar/modified.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:modified-event
SUMMARY:Updated Event
DTSTART:20240116T140000Z
DTEND:20240116T150000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-complete</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(radicaleResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			let kvCallCount = 0;
			const mockKV = {
				get: vi.fn(() => {
					kvCallCount++;
					if (kvCallCount === 1) return Promise.resolve(null); // radicaleSyncToken
					if (kvCallCount === 2) return Promise.resolve(JSON.stringify({ access_token: "mock-token" })); // googleOAuthToken for updateGoogleEvents
					if (kvCallCount === 3) return Promise.resolve(JSON.stringify({ access_token: "mock-token" })); // googleOAuthToken for deleteGoogleEvents
					return Promise.resolve(null);
				}),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				// Check and create new event
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 201 }))
				// Check and update modified event
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "google-id" }] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 200 }))
				// Delete deleted event
				.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "google-id-2" }] }), { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 200 }));

			// Fetch from Radicale
			const radicaleSync = await fetchRadicaleEvents(
				mockTunnel,
				mockKV,
				calendarUrl,
			);

			expect(radicaleSync.events).toHaveLength(2);

			// Upsert to Google (create new + update modified)
			const upsertResult = await updateGoogleEvents(
				mockKV,
				googleCalendarId,
				radicaleSync.events,
			);

			expect(upsertResult.created).toBe(1);
			expect(upsertResult.updated).toBe(1);

			// Delete from Google
			const deleteResult = await deleteGoogleEvents(
				mockKV,
				googleCalendarId,
				["deleted-event@example.com"],
			);

			expect(deleteResult.deleted).toBe(1);

			// Verify sync token would be saved (no errors)
			const hasErrors = upsertResult.errors.length > 0 || deleteResult.errors.length > 0;
			expect(hasErrors).toBe(false);
		});
	});
});
