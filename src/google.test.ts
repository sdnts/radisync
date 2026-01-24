import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchGoogleEvents,
	createGoogleEvents,
	deleteGoogleEvents,
	updateGoogleEvents,
	type GoogleSyncResult,
} from "./google";
import type { CalendarEvent } from "./radicale";

describe("Google Calendar sync operations", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe("fetchGoogleEvents", () => {
		it("should fetch and parse basic events from Google Calendar", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-123") // googleCalendarId
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
							refresh_token: "refresh-123",
						}),
					) // googleOAuthToken
					.mockResolvedValueOnce(null), // googleSyncToken
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "event-1",
								summary: "Team Meeting",
								start: { dateTime: "2024-01-15T10:00:00Z" },
								end: { dateTime: "2024-01-15T11:00:00Z" },
								iCalUID: "ical-123@google.com",
							},
						],
						nextSyncToken: "sync-token-abc",
					}),
					{ status: 200 },
				),
			);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events).toHaveLength(1);
			expect(result.events[0]).toMatchObject({
				id: "event-1",
				summary: "Team Meeting",
				start: { dateTime: "2024-01-15T10:00:00Z" },
				end: { dateTime: "2024-01-15T11:00:00Z" },
			});
			expect(result.syncToken).toBe("sync-token-abc");
			expect(result.deleted).toHaveLength(0);
		});

		it("should handle all-day events correctly", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-456")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "all-day-event",
								summary: "Holiday",
								start: { date: "2024-12-25" },
								end: { date: "2024-12-26" },
								iCalUID: "holiday-2024@google.com",
							},
						],
						nextSyncToken: "sync-token-holiday",
					}),
					{ status: 200 },
				),
			);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events[0]).toMatchObject({
				summary: "Holiday",
				start: { date: "2024-12-25" },
				end: { date: "2024-12-26" },
			});
		});

		it("should handle events with timezones", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-789")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
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
								iCalUID: "office-hours@google.com",
							},
						],
						nextSyncToken: "sync-token-tz",
					}),
					{ status: 200 },
				),
			);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events[0]).toMatchObject({
				summary: "Office Hours",
				start: {
					dateTime: "2024-01-15T14:00:00",
					timeZone: "America/New_York",
				},
			});
		});

		it("should handle recurring events with recurrence rules", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-recurring")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "weekly-standup",
								summary: "Weekly Standup",
								start: { dateTime: "2024-01-15T09:00:00Z" },
								end: { dateTime: "2024-01-15T09:30:00Z" },
								iCalUID: "standup@google.com",
								recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
							},
						],
						nextSyncToken: "sync-token-recurring",
					}),
					{ status: 200 },
				),
			);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events[0]).toMatchObject({
				summary: "Weekly Standup",
				recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
			});
		});

		it("should handle events with description and location", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-details")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "detailed-event",
								summary: "Conference",
								start: { dateTime: "2024-06-15T08:00:00Z" },
								end: { dateTime: "2024-06-15T18:00:00Z" },
								description: "Annual tech conference with keynotes",
								location: "Convention Center, San Francisco",
								iCalUID: "conf-2024@google.com",
							},
						],
						nextSyncToken: "sync-token-conf",
					}),
					{ status: 200 },
				),
			);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events[0]).toMatchObject({
				summary: "Conference",
				description: "Annual tech conference with keynotes",
				location: "Convention Center, San Francisco",
			});
		});

		it("should identify cancelled events as deleted", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-cancelled")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "active-event",
								summary: "Active Meeting",
								start: { dateTime: "2024-01-15T10:00:00Z" },
								end: { dateTime: "2024-01-15T11:00:00Z" },
								iCalUID: "active@google.com",
								status: "confirmed",
							},
							{
								id: "cancelled-event",
								summary: "Cancelled Meeting",
								start: { dateTime: "2024-01-16T10:00:00Z" },
								end: { dateTime: "2024-01-16T11:00:00Z" },
								iCalUID: "cancelled@google.com",
								status: "cancelled",
							},
						],
						nextSyncToken: "sync-token-mixed",
					}),
					{ status: 200 },
				),
			);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events).toHaveLength(1);
			expect(result.events[0]?.summary).toBe("Active Meeting");
			expect(result.deleted).toHaveLength(1);
			expect(result.deleted[0]).toBe("cancelled@google.com");
		});

		it("should paginate through multiple result pages", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-paginated")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					// First page
					new Response(
						JSON.stringify({
							items: [
								{
									id: "event-1",
									summary: "Event 1",
									start: { dateTime: "2024-01-01T10:00:00Z" },
									end: { dateTime: "2024-01-01T11:00:00Z" },
									iCalUID: "event-1@google.com",
								},
							],
							nextPageToken: "page-token-2",
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Second page with sync token
					new Response(
						JSON.stringify({
							items: [
								{
									id: "event-2",
									summary: "Event 2",
									start: { dateTime: "2024-01-02T10:00:00Z" },
									end: { dateTime: "2024-01-02T11:00:00Z" },
									iCalUID: "event-2@google.com",
								},
							],
							nextSyncToken: "sync-token-paginated",
						}),
						{ status: 200 },
					),
				);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events).toHaveLength(2);
			expect(result.events[0]?.summary).toBe("Event 1");
			expect(result.events[1]?.summary).toBe("Event 2");
			expect(result.syncToken).toBe("sync-token-paginated");
			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		});

		it("should use sync token from KV for incremental sync", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-incremental")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce("previous-sync-token"), // googleSyncToken
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "updated-event",
								summary: "Updated Event",
								start: { dateTime: "2024-01-15T10:00:00Z" },
								end: { dateTime: "2024-01-15T11:00:00Z" },
								iCalUID: "updated@google.com",
							},
						],
						nextSyncToken: "new-sync-token",
					}),
					{ status: 200 },
				),
			);

			await fetchGoogleEvents(mockKV);

			// Verify that the request included the sync token
			const fetchCall = (globalThis.fetch as Mock).mock.calls[0];
			expect(fetchCall[0]).toContain("syncToken=previous-sync-token");
		});

		it("should handle sync token expiration (410 status) and retry with full sync", async () => {
			const mockKV = {
				get: vi
					.fn()
					// First call sequence for initial attempt
					.mockResolvedValueOnce("calendar-expired")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce("expired-sync-token")
					// Second call sequence after KV delete
					.mockResolvedValueOnce("calendar-expired")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null), // sync token was deleted
				delete: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					new Response("", { status: 410 }), // Token expired
				)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							items: [
								{
									id: "event-after-retry",
									summary: "Event After Retry",
									start: { dateTime: "2024-01-15T10:00:00Z" },
									end: { dateTime: "2024-01-15T11:00:00Z" },
									iCalUID: "after-retry@google.com",
								},
							],
							nextSyncToken: "fresh-sync-token",
						}),
						{ status: 200 },
					),
				);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events).toHaveLength(1);
			expect(result.syncToken).toBe("fresh-sync-token");
			expect(mockKV.delete).toHaveBeenCalledWith("googleSyncToken");
		});

		it("should throw error when missing Google Calendar ID", async () => {
			const mockKV = {
				get: vi.fn().mockResolvedValueOnce(null), // No calendar ID
			} as unknown as KVNamespace;

			await expect(fetchGoogleEvents(mockKV)).rejects.toThrow(
				"No Google Calendar ID found in KV",
			);
		});

		it("should throw error when missing OAuth token", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-123")
					.mockResolvedValueOnce(null), // No token
			} as unknown as KVNamespace;

			await expect(fetchGoogleEvents(mockKV)).rejects.toThrow(
				"No Google OAuth token found",
			);
		});

		it("should throw error on API failure", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-123")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response("Unauthorized", { status: 401 }),
			);

			await expect(fetchGoogleEvents(mockKV)).rejects.toThrow(
				"Google Calendar API failed",
			);
		});

		it("should throw error when no sync token in response", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-123")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								id: "event-1",
								summary: "Event",
								start: { dateTime: "2024-01-15T10:00:00Z" },
								end: { dateTime: "2024-01-15T11:00:00Z" },
								iCalUID: "event@google.com",
							},
						],
						// No nextSyncToken
					}),
					{ status: 200 },
				),
			);

			await expect(fetchGoogleEvents(mockKV)).rejects.toThrow(
				"No sync token in Google Calendar response",
			);
		});

		it("should handle empty event list", async () => {
			const mockKV = {
				get: vi
					.fn()
					.mockResolvedValueOnce("calendar-empty")
					.mockResolvedValueOnce(
						JSON.stringify({
							access_token: "mock-token",
						}),
					)
					.mockResolvedValueOnce(null),
			} as unknown as KVNamespace;

			globalThis.fetch = vi.fn().mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [],
						nextSyncToken: "sync-token-empty",
					}),
					{ status: 200 },
				),
			);

			const result = await fetchGoogleEvents(mockKV);

			expect(result.events).toHaveLength(0);
			expect(result.deleted).toHaveLength(0);
			expect(result.syncToken).toBe("sync-token-empty");
		});
	});

	describe("createGoogleEvents", () => {
		it("should create events in Google Calendar", async () => {
			const mockKV = {
				get: vi.fn().mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-token",
					}),
				),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response("", { status: 200 }))
				.mockResolvedValueOnce(new Response("", { status: 200 }));

			const events: CalendarEvent[] = [
				{
					uid: "event-1",
					summary: "New Event",
					dtstart: "20240115T100000Z",
					dtend: "20240115T110000Z",
				},
				{
					uid: "event-2",
					summary: "Another Event",
					dtstart: "20240116T140000",
					dtend: "20240116T150000",
					timezone: "America/New_York",
				},
			];

			const result = await createGoogleEvents(mockKV, "calendar-123", events);

			expect(result.created).toBe(2);
			expect(result.errors).toHaveLength(0);
		});

		it("should record creation errors", async () => {
			const mockKV = {
				get: vi.fn().mockResolvedValueOnce(
					JSON.stringify({
						access_token: "mock-token",
					}),
				),
			} as unknown as KVNamespace;

			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(new Response("", { status: 200 }))
				.mockResolvedValueOnce(
					new Response("Server error", { status: 500 }),
				);

			const events: CalendarEvent[] = [
				{
					uid: "good-event",
					summary: "Good Event",
					dtstart: "20240115T100000Z",
					dtend: "20240115T110000Z",
				},
				{
					uid: "bad-event",
					summary: "Bad Event",
					dtstart: "20240116T100000Z",
					dtend: "20240116T110000Z",
				},
			];

			const result = await createGoogleEvents(mockKV, "calendar-123", events);

			expect(result.created).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("bad-event");
		});
	});

	describe("deleteGoogleEvents", () => {
		it("should delete events from Google Calendar", async () => {
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
					// Search for event 1
					new Response(
						JSON.stringify({
							items: [{ id: "google-id-1" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Delete event 1
					new Response(null, { status: 200 }),
				)
				.mockResolvedValueOnce(
					// Search for event 2
					new Response(
						JSON.stringify({
							items: [{ id: "google-id-2" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Delete event 2
					new Response(null, { status: 200 }),
				);

			const result = await deleteGoogleEvents(mockKV, "calendar-123", [
				"uid-1@example.com",
				"uid-2@example.com",
			]);

			expect(result.deleted).toBe(2);
			expect(result.errors).toHaveLength(0);
		});

		it("should handle events not found", async () => {
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
							items: [],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							items: [{ id: "google-id-2" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					new Response(null, { status: 200 }),
				);

			const result = await deleteGoogleEvents(mockKV, "calendar-123", [
				"missing-uid@example.com",
				"found-uid@example.com",
			]);

			expect(result.deleted).toBe(1);
			expect(result.errors).toHaveLength(0);
		});
	});

	describe("updateGoogleEvents", () => {
		it("should update existing events", async () => {
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
					// Search for event 1
					new Response(
						JSON.stringify({
							items: [{ id: "google-id-1" }],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Update event 1
					new Response("", { status: 200 }),
				);

			const events: CalendarEvent[] = [
				{
					uid: "uid-1@example.com",
					summary: "Updated Event",
					dtstart: "20240115T100000Z",
					dtend: "20240115T110000Z",
				},
			];

			const result = await updateGoogleEvents(
				mockKV,
				"calendar-123",
				events,
			);

			expect(result.updated).toBe(1);
			expect(result.created).toBe(0);
			expect(result.errors).toHaveLength(0);
		});

		it("should create events that don't exist", async () => {
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
					// Search - event not found
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

			const events: CalendarEvent[] = [
				{
					uid: "new-uid@example.com",
					summary: "New Event",
					dtstart: "20240115T100000Z",
					dtend: "20240115T110000Z",
				},
			];

			const result = await updateGoogleEvents(
				mockKV,
				"calendar-123",
				events,
			);

			expect(result.created).toBe(1);
			expect(result.updated).toBe(0);
			expect(result.errors).toHaveLength(0);
		});
	});
});
