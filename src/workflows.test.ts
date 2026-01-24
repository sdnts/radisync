import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { GoogleEvent } from "./radicale";

interface MockStep {
	do: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

// Mock GoogleToRadicale workflow
class MockGoogleToRadicale {
	env: Env;
	id: string;

	constructor(env: Env, id: string) {
		this.env = env;
		this.id = id;
	}

	async run(_event: unknown, step: MockStep) {
		const { deleteRadicaleEvents, updateRadicaleEvents } =
			await import("./radicale");
		const { fetchGoogleEvents: fetchGoogleEventsFromGoogle } =
			await import("./google");

		console.log("[GoogleToRadicale] Starting workflow");

		const syncResult = await step.do(
			"fetch-google-events",
			async () => {
				console.log("[GoogleToRadicale] Fetching Google Calendar events");
				return fetchGoogleEventsFromGoogle(this.env.KV);
			},
		);
		console.log(
			`[GoogleToRadicale] Fetched ${syncResult.events.length} events, ${syncResult.deleted.length} deleted`,
		);

		const deleteResult = await step.do(
			"delete-radicale-events",
			async () => {
				if (syncResult.deleted.length === 0) {
					console.log("[GoogleToRadicale] No events to delete");
					return { deleted: 0, errors: [] };
				}
				console.log(
					`[GoogleToRadicale] Deleting ${syncResult.deleted.length} events`,
				);
				return deleteRadicaleEvents(
					this.env.BeelinkTunnel,
					this.env.RadicaleUrl,
					syncResult.deleted,
				);
			},
		);

		const upsertResult = await step.do(
			"upsert-radicale-events",
			async () => {
				if (syncResult.events.length === 0) {
					console.log("[GoogleToRadicale] No events to upsert");
					return { updated: 0, created: 0, errors: [] };
				}
				console.log(
					`[GoogleToRadicale] Upserting ${syncResult.events.length} events`,
				);
				return updateRadicaleEvents(
					this.env.BeelinkTunnel,
					this.env.RadicaleUrl,
					syncResult.events,
				);
			},
		);

		// Only save sync token if there were no errors
		const hasErrors =
			deleteResult.errors.length > 0 || upsertResult.errors.length > 0;
		if (!hasErrors) {
			await step.do("save-sync-token", async () => {
				console.log("[GoogleToRadicale] Saving sync token");
				await this.env.KV.put("googleSyncToken", syncResult.syncToken);
			});
		} else {
			console.log(
				`[GoogleToRadicale] Skipping sync token save due to ${deleteResult.errors.length + upsertResult.errors.length} errors`,
			);
		}

		console.log(
			`[GoogleToRadicale] Done: deleted=${deleteResult.deleted}, updated=${upsertResult.updated}, created=${upsertResult.created}`,
		);
		return {
			syncToken: syncResult.syncToken,
			deleted: deleteResult,
			upserted: upsertResult,
		};
	}
}

describe("GoogleToRadicale workflow", () => {
	const calendarUrl = "https://radicale.local/calendars/user/calendar/";
	const googleCalendarId = "calendar-123";

	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("should sync new events from Google Calendar to Radicale", async () => {
		const googleEvents: GoogleEvent[] = [
			{
				id: "event-1",
				summary: "Team Meeting",
				start: { dateTime: "2024-01-15T10:00:00Z" },
				end: { dateTime: "2024-01-15T11:00:00Z" },
				iCalUID: "event-1-uid@google.com",
			},
			{
				id: "event-2",
				summary: "Standup",
				start: { dateTime: "2024-01-16T09:30:00Z" },
				end: { dateTime: "2024-01-16T10:00:00Z" },
				iCalUID: "event-2-uid@google.com",
			},
		];

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId) // googleCalendarId in fetch step
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				) // googleOAuthToken
				.mockResolvedValueOnce(null), // googleSyncToken (first sync)
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// HEAD checks for new events (both return 404 - not found)
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT for first event creation
				.mockResolvedValueOnce(new Response("", { status: 201 }))
				// HEAD check for second event
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT for second event creation
				.mockResolvedValueOnce(new Response("", { status: 201 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: googleEvents,
					nextSyncToken: "sync-token-123",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.upserted.created).toBe(2);
		expect(result.upserted.updated).toBe(0);
		expect(result.upserted.errors).toHaveLength(0);
		expect(result.deleted.deleted).toBe(0);
		expect(result.syncToken).toBe("sync-token-123");
	});

	it("should delete events from Radicale that were deleted in Google Calendar", async () => {
		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// DELETE request for the deleted event
				.mockResolvedValueOnce(new Response("", { status: 200 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockImplementationOnce(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "cancelled-event",
								status: "cancelled",
								iCalUID: "deleted-event-uid@google.com",
							},
						],
						nextSyncToken: "sync-token-456",
					}),
					{ status: 200 },
				),
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.deleted.deleted).toBe(1);
		expect(result.deleted.errors).toHaveLength(0);
		expect(result.upserted.created).toBe(0);
	});

	it("should update existing events in Radicale", async () => {
		const googleEvents: GoogleEvent[] = [
			{
				id: "event-1",
				summary: "Updated Meeting Title",
				start: { dateTime: "2024-01-15T10:00:00Z" },
				end: { dateTime: "2024-01-15T12:00:00Z" },
				iCalUID: "event-1-uid@google.com",
				description: "New description",
			},
		];

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// HEAD check returns 200 - event exists
				.mockResolvedValueOnce(new Response("", { status: 200 }))
				// PUT to update the event
				.mockResolvedValueOnce(new Response("", { status: 200 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: googleEvents,
					nextSyncToken: "sync-token-789",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.upserted.updated).toBe(1);
		expect(result.upserted.created).toBe(0);
		expect(result.upserted.errors).toHaveLength(0);
	});

	it("should sync recurring events from Google Calendar", async () => {
		const recurringEvent: GoogleEvent = {
			id: "recurring-event",
			summary: "Weekly Standup",
			start: { dateTime: "2024-01-15T09:00:00Z" },
			end: { dateTime: "2024-01-15T09:30:00Z" },
			iCalUID: "standup-uid@google.com",
			recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
		};

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// HEAD check - event doesn't exist
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT to create the recurring event
				.mockResolvedValueOnce(new Response("", { status: 201 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: [recurringEvent],
					nextSyncToken: "sync-token-recurring",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.upserted.created).toBe(1);
		expect(result.upserted.errors).toHaveLength(0);

		// Verify the recurrence rule was included in the iCal data
		const putCalls = (mockTunnel.fetch as Mock).mock.calls.filter(
			(call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "PUT",
		);
		expect(putCalls).toHaveLength(1);
		const icalData = putCalls[0]?.[1]?.body as string;
		expect(icalData).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
	});

	it("should handle sync with both creates, updates, and deletes", async () => {
		const googleEvents: GoogleEvent[] = [
			{
				id: "new-event",
				summary: "New Meeting",
				start: { dateTime: "2024-01-20T14:00:00Z" },
				end: { dateTime: "2024-01-20T15:00:00Z" },
				iCalUID: "new-uid@google.com",
			},
			{
				id: "existing-event",
				summary: "Updated Existing",
				start: { dateTime: "2024-01-21T10:00:00Z" },
				end: { dateTime: "2024-01-21T11:00:00Z" },
				iCalUID: "existing-uid@google.com",
			},
		];

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// DELETE for deleted event
				.mockResolvedValueOnce(new Response("", { status: 200 }))
				// HEAD check for new event - doesn't exist
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT to create new event
				.mockResolvedValueOnce(new Response("", { status: 201 }))
				// HEAD check for existing event - exists
				.mockResolvedValueOnce(new Response("", { status: 200 }))
				// PUT to update existing event
				.mockResolvedValueOnce(new Response("", { status: 200 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockImplementationOnce(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "cancelled-event",
								status: "cancelled",
								iCalUID: "deleted-uid@google.com",
							},
							...googleEvents,
						],
						nextSyncToken: "sync-token-complex",
					}),
					{ status: 200 },
				),
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.deleted.deleted).toBe(1);
		expect(result.deleted.errors).toHaveLength(0);
		expect(result.upserted.created).toBe(1);
		expect(result.upserted.updated).toBe(1);
		expect(result.upserted.errors).toHaveLength(0);
		expect(result.syncToken).toBe("sync-token-complex");
	});

	it("should skip sync token save if there are errors", async () => {
		const googleEvents: GoogleEvent[] = [
			{
				id: "event-1",
				summary: "Event that will fail to create",
				start: { dateTime: "2024-01-15T10:00:00Z" },
				end: { dateTime: "2024-01-15T11:00:00Z" },
				iCalUID: "fail-uid@google.com",
			},
		];

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// HEAD check - doesn't exist
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT fails with server error
				.mockResolvedValueOnce(new Response("Server error", { status: 500 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: googleEvents,
					nextSyncToken: "sync-token-with-errors",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		// Verify sync token was NOT saved due to errors
		expect(mockKV.put).not.toHaveBeenCalled();
		expect(result.upserted.errors).toHaveLength(1);
		expect(result.syncToken).toBe("sync-token-with-errors");
	});

	it("should handle all-day events from Google Calendar", async () => {
		const allDayEvent: GoogleEvent = {
			id: "holiday",
			summary: "Holiday",
			start: { date: "2024-12-25" },
			end: { date: "2024-12-26" },
			iCalUID: "holiday-uid@google.com",
		};

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// HEAD check - doesn't exist
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT to create
				.mockResolvedValueOnce(new Response("", { status: 201 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: [allDayEvent],
					nextSyncToken: "sync-token-allday",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.upserted.created).toBe(1);
		expect(result.upserted.errors).toHaveLength(0);

		// Verify the all-day event was formatted correctly in iCal
		const putCalls = (mockTunnel.fetch as Mock).mock.calls.filter(
			(call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "PUT",
		);
		const icalData = putCalls[0]?.[1]?.body as string;
		expect(icalData).toContain("VALUE=DATE");
		expect(icalData).toContain("20241225"); // YYYYMMDD format
	});

	it("should handle events with timezone information", async () => {
		const tzEvent: GoogleEvent = {
			id: "tz-event",
			summary: "Office Hours",
			start: {
				dateTime: "2024-01-15T14:00:00",
				timeZone: "America/New_York",
			},
			end: {
				dateTime: "2024-01-15T15:00:00",
				timeZone: "America/New_York",
			},
			iCalUID: "office-hours-uid@google.com",
		};

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// HEAD check
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT to create
				.mockResolvedValueOnce(new Response("", { status: 201 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: [tzEvent],
					nextSyncToken: "sync-token-tz",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.upserted.created).toBe(1);
		expect(result.upserted.errors).toHaveLength(0);

		// Verify timezone was handled (should be converted to UTC in iCal)
		const putCalls = (mockTunnel.fetch as Mock).mock.calls.filter(
			(call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "PUT",
		);
		const icalData = putCalls[0]?.[1]?.body as string;
		expect(icalData).toContain("DTSTART:");
		expect(icalData).toContain("Z"); // UTC format
	});

	it("should handle Radicale delete errors gracefully", async () => {
		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// DELETE fails but returns 404 (already deleted, treated as success)
				.mockResolvedValueOnce(new Response("", { status: 404 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: [
						{
							id: "cancelled",
							status: "cancelled",
							iCalUID: "deleted-uid@google.com",
						},
					],
					nextSyncToken: "sync-token-404",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		// 404 on delete is treated as success (already deleted)
		expect(result.deleted.deleted).toBe(1);
		expect(result.deleted.errors).toHaveLength(0);
	});

	it("should handle events with description and location", async () => {
		const eventWithDetails: GoogleEvent = {
			id: "detailed-event",
			summary: "Conference",
			start: { dateTime: "2024-06-15T08:00:00Z" },
			end: { dateTime: "2024-06-15T18:00:00Z" },
			iCalUID: "conf-uid@google.com",
			description: "Annual tech conference with keynotes",
			location: "Convention Center, San Francisco",
		};

		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// HEAD check
				.mockResolvedValueOnce(new Response("", { status: 404 }))
				// PUT to create
				.mockResolvedValueOnce(new Response("", { status: 201 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: [eventWithDetails],
					nextSyncToken: "sync-token-details",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		expect(result.upserted.created).toBe(1);

		// Verify description and location are in iCal
		const putCalls = (mockTunnel.fetch as Mock).mock.calls.filter(
			(call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "PUT",
		);
		const icalData = putCalls[0]?.[1]?.body as string;
		expect(icalData).toContain("DESCRIPTION:Annual tech conference with keynotes");
		expect(icalData).toContain("LOCATION:Convention Center, San Francisco");
	});

	it("should handle 404 errors when deleting non-existent events as success", async () => {
		const mockKV = {
			get: vi
				.fn()
				.mockResolvedValueOnce(googleCalendarId)
				.mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-google-token",
					}),
				)
				.mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace;

		const mockTunnel = {
			fetch: vi
				.fn()
				// DELETE returns 404 - event already deleted
				.mockResolvedValueOnce(new Response("Not found", { status: 404 }))
				// DELETE returns 200 - event deleted
				.mockResolvedValueOnce(new Response("", { status: 200 })),
		} as unknown as Fetcher;

		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					items: [
						{
							id: "cancelled-1",
							status: "cancelled",
							iCalUID: "already-deleted@google.com",
						},
						{
							id: "cancelled-2",
							status: "cancelled",
							iCalUID: "to-delete@google.com",
						},
					],
					nextSyncToken: "sync-token-404s",
				}),
				{ status: 200 },
			),
		);

		const workflow = new MockGoogleToRadicale(
			{
				KV: mockKV,
				BeelinkTunnel: mockTunnel,
				RadicaleUrl: calendarUrl,
			} as unknown as Env,
			"workflow-id",
		);

		const result = await workflow.run(
			{},
			{
				do: async <T>(name: string, fn: () => Promise<T>) => fn(),
			} satisfies MockStep,
		);

		// Both should be counted as successfully handled (404 is not an error)
		expect(result.deleted.deleted).toBe(2);
		expect(result.deleted.errors).toHaveLength(0);
	});
});
