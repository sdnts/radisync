import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchRadicaleEvents,
	updateRadicaleEvents,
	deleteRadicaleEvents,
	type CalendarEvent,
	type GoogleEvent,
} from "./radicale";

describe("Radicale sync operations", () => {
	const calendarUrl = "https://radicale.local/calendars/user/calendar/";

	describe("fetchRadicaleEvents", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should fetch and parse basic events from Radicale", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
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
UID:event1
SUMMARY:Test Event
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-123</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events).toHaveLength(1);
			expect(result.events[0]).toEqual({
				uid: "event1",
				summary: "Test Event",
				dtstart: "20240115T100000Z",
				dtend: "20240115T110000Z",
				timezone: undefined,
				description: undefined,
				location: undefined,
				rrule: undefined,
			});
			expect(result.syncToken).toBe("token-123");
			expect(result.deleted).toHaveLength(0);
		});

		it("should handle events with timezones", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event2.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:event2
SUMMARY:Meeting with TZ
DTSTART;TZID=America/New_York:20240115T140000
DTEND;TZID=America/New_York:20240115T150000
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-456</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events).toHaveLength(1);
			expect(result.events[0]?.timezone).toBe("America/New_York");
			expect(result.events[0]?.dtstart).toBe("20240115T140000");
		});

		it("should parse event with description and location", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event3.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event3
SUMMARY:Conference
DTSTART:20240120T080000Z
DTEND:20240120T170000Z
DESCRIPTION:Annual tech conference
LOCATION:Convention Center
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-789</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events[0]).toMatchObject({
				uid: "event3",
				summary: "Conference",
				description: "Annual tech conference",
				location: "Convention Center",
			});
		});

		it("should parse recurring events with RRULE", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event4.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event4
SUMMARY:Weekly Standup
DTSTART:20240115T090000Z
DTEND:20240115T091500Z
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-rrule</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events[0]?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
		});

		it("should handle line continuations in iCal data (CRLF + space)", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event5.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event5
SUMMARY:Long Event Name
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
DESCRIPTION:This is a long description
 that spans multiple
 lines with continuation
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-continuation</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events).toHaveLength(1);
			expect(result.events[0]).toBeDefined();
		});

		it("should parse multiple events in single response", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
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
DTSTART:20240116T100000Z
DTEND:20240116T110000Z
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
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events).toHaveLength(2);
			expect(result.events[0]?.uid).toBe("event1");
			expect(result.events[1]?.uid).toBe("event2");
		});

		it("should handle deleted events in response", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event-new.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-new
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
    <d:href>/calendars/user/calendar/event-deleted.ics</d:href>
    <d:propstat>
      <d:prop/>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-delete</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events).toHaveLength(1);
			expect(result.deleted).toHaveLength(1);
			expect(result.deleted[0]).toBe("event-deleted");
		});

		it("should use existing sync token from KV", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response/>
  <d:sync-token>token-new</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue("token-old"),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			// Verify KV.get was called to retrieve existing sync token
			expect(mockKV.get).toHaveBeenCalledWith("radicaleSyncToken");

			// Verify REPORT request was sent (check fetch was called)
			expect(mockTunnel.fetch).toHaveBeenCalled();
			const [, fetchOptions] = (mockTunnel.fetch as Mock).mock.calls[0];
			expect(fetchOptions.body).toContain("token-old");
		});

		it("should throw error if response is not ok", async () => {
			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response("Unauthorized", { status: 401 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			await expect(
				fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl),
			).rejects.toThrow("CalDAV sync-collection request failed");
		});

		it("should throw error if response has no sync-token", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response/>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			await expect(
				fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl),
			).rejects.toThrow("No sync-token in response");
		});

		it("should skip events missing required fields (UID, SUMMARY, DTSTART)", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/bad1.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:bad1
SUMMARY:Missing DTSTART
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/user/calendar/good.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:good
SUMMARY:Valid Event
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-skip</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events).toHaveLength(1);
			expect(result.events[0]?.uid).toBe("good");
		});

		it("should use DTSTART time as DTEND fallback if DTEND missing", async () => {
			const mockResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/calendar/event.ics</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:no-end
SUMMARY:Instant Event
DTSTART:20240115T100000Z
END:VEVENT
END:VCALENDAR
</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>token-noend</d:sync-token>
</d:multistatus>`;

			const mockTunnel = {
				fetch: vi.fn().mockResolvedValue(
					new Response(mockResponse, { status: 207 }),
				),
			} as unknown as Fetcher;

			const mockKV = {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			const result = await fetchRadicaleEvents(mockTunnel, mockKV, calendarUrl);

			expect(result.events[0]?.dtend).toBe("20240115T100000Z");
		});
	});

	describe("updateRadicaleEvents", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should create new events and update existing ones", async () => {
			const mockTunnel = {
				fetch: vi
					.fn()
					.mockResolvedValueOnce(new Response("", { status: 404 })) // HEAD for new event - not found
					.mockResolvedValueOnce(new Response("", { status: 201 })) // PUT for new event - created
					.mockResolvedValueOnce(new Response("", { status: 200 })) // HEAD for existing event - found
					.mockResolvedValueOnce(new Response("", { status: 200 })), // PUT for existing event - updated
			} as unknown as Fetcher;

			const events: GoogleEvent[] = [
				{
					id: "event1",
					summary: "New Event",
					start: { dateTime: "2024-01-15T10:00:00Z" },
					end: { dateTime: "2024-01-15T11:00:00Z" },
				},
				{
					id: "event2",
					summary: "Updated Event",
					start: { dateTime: "2024-01-15T14:00:00Z" },
					end: { dateTime: "2024-01-15T15:00:00Z" },
				},
			];

			const result = await updateRadicaleEvents(mockTunnel, calendarUrl, events);

			expect(result.created).toBe(1);
			expect(result.updated).toBe(1);
			expect(result.errors).toHaveLength(0);
		});

		it("should handle event creation errors", async () => {
			const mockTunnel = {
				fetch: vi
					.fn()
					.mockResolvedValueOnce(new Response("", { status: 404 })) // HEAD - not found
					.mockResolvedValueOnce(new Response("Server error", { status: 500 })), // PUT - error
			} as unknown as Fetcher;

			const events: GoogleEvent[] = [
				{
					id: "bad-event",
					summary: "Problem Event",
					start: { dateTime: "2024-01-15T10:00:00Z" },
					end: { dateTime: "2024-01-15T11:00:00Z" },
				},
			];

			const result = await updateRadicaleEvents(mockTunnel, calendarUrl, events);

			expect(result.created).toBe(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("Failed to upsert event");
		});

		it("should include iCalUID in request if provided", async () => {
			const mockTunnel = {
				fetch: vi
					.fn()
					.mockResolvedValueOnce(new Response("", { status: 404 })) // HEAD
					.mockResolvedValueOnce(new Response("", { status: 201 })), // PUT
			} as unknown as Fetcher;

			const events: GoogleEvent[] = [
				{
					id: "google-id",
					iCalUID: "ical-uid-123",
					summary: "Event with iCal UID",
					start: { dateTime: "2024-01-15T10:00:00Z" },
					end: { dateTime: "2024-01-15T11:00:00Z" },
				},
			];

			await updateRadicaleEvents(mockTunnel, calendarUrl, events);

			// Verify the PUT request was made to the correct URL with iCalUID
			expect(mockTunnel.fetch).toHaveBeenCalledWith(
				expect.stringContaining("ical-uid-123"),
				expect.any(Object),
			);
		});
	});

	describe("deleteRadicaleEvents", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should delete events and count successes", async () => {
			const mockTunnel = {
				fetch: vi
					.fn()
					.mockResolvedValueOnce(new Response("", { status: 200 })) // event1 deleted
					.mockResolvedValueOnce(new Response("", { status: 200 })), // event2 deleted
			} as unknown as Fetcher;

			const result = await deleteRadicaleEvents(mockTunnel, calendarUrl, [
				"event1",
				"event2",
			]);

			expect(result.deleted).toBe(2);
			expect(result.errors).toHaveLength(0);
		});

		it("should treat 404 as success when deleting", async () => {
			const mockTunnel = {
				fetch: vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })), // already deleted
			} as unknown as Fetcher;

			const result = await deleteRadicaleEvents(mockTunnel, calendarUrl, [
				"already-deleted",
			]);

			expect(result.deleted).toBe(1);
			expect(result.errors).toHaveLength(0);
		});

		it("should record errors for failed deletions", async () => {
			const mockTunnel = {
				fetch: vi
					.fn()
					.mockResolvedValueOnce(new Response("", { status: 200 })) // success
					.mockResolvedValueOnce(new Response("Server error", { status: 500 })), // error
			} as unknown as Fetcher;

			const result = await deleteRadicaleEvents(mockTunnel, calendarUrl, [
				"good-event",
				"bad-event",
			]);

			expect(result.deleted).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("bad-event");
		});

		it("should handle empty deletion list", async () => {
			const mockTunnel = {
				fetch: vi.fn(),
			} as unknown as Fetcher;

			const result = await deleteRadicaleEvents(mockTunnel, calendarUrl, []);

			expect(result.deleted).toBe(0);
			expect(result.errors).toHaveLength(0);
			expect(mockTunnel.fetch).not.toHaveBeenCalled();
		});
	});
});
