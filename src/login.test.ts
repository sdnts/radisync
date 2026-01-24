import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuthUrl, handleOAuthCallback } from "./oauth";
import { renderLoginPage } from "./login";

describe("Google OAuth Login Flow", () => {
	it("should build correct Google OAuth auth URL", () => {
		const clientId = "test-client-id";
		const appHost = "https://example.com";

		const authUrl = buildAuthUrl(clientId, appHost);

		expect(authUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
		expect(authUrl).toContain(`client_id=${clientId}`);
		expect(authUrl).toContain(
			`redirect_uri=${encodeURIComponent(`${appHost}/oauth`)}`,
		);
		expect(authUrl).toContain("response_type=code");
		expect(authUrl).toContain(
			"scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar+email",
		);
		expect(authUrl).toContain("access_type=offline");
		expect(authUrl).toContain("prompt=consent");
	});

	it("should render login page with Google OAuth login button when not authenticated", () => {
		const env = {
			GoogleOAuthClientId: "test-client-id",
			AppHost: "https://example.com",
		} as unknown as Env;

		const response = renderLoginPage(env, null);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html");
		expect(response).toBeInstanceOf(Response);
	});

	it("should render login page with logout button when authenticated", () => {
		const env = {
			GoogleOAuthClientId: "test-client-id",
			AppHost: "https://example.com",
		} as unknown as Env;
		const email = "user@example.com";

		const response = renderLoginPage(env, email);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html");
		expect(response).toBeInstanceOf(Response);
	});

	describe("OAuth callback handling", () => {
		beforeEach(() => {
			vi.resetAllMocks();
		});

		it("should initiate Google OAuth flow when code is provided", async () => {
			// Mock global fetch to simulate Google OAuth response
			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					// Token exchange response
					new Response(
						JSON.stringify({
							access_token: "mock-access-token",
							refresh_token: "mock-refresh-token",
							expires_in: 3600,
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// User info response
					new Response(
						JSON.stringify({
							email: "test@example.com",
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Calendar list response
					new Response(
						JSON.stringify({
							items: [],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Create calendar response
					new Response(
						JSON.stringify({
							id: "calendar-123",
						}),
						{ status: 200 },
					),
				);

			// Mock KV store
			const mockKV = {
				put: vi.fn().mockResolvedValue(undefined),
				get: vi.fn().mockResolvedValue(null),
				delete: vi.fn().mockResolvedValue(undefined),
			};

			const env = {
				GoogleOAuthClientId: "test-client-id",
				GoogleOAuthClientSecret: "test-client-secret",
				AppHost: "https://example.com",
				KV: mockKV,
			} as unknown as Env;

			const url = new URL("https://example.com/oauth?code=auth-code-123");

			const response = await handleOAuthCallback(url, env);

			// Verify OAuth code was exchanged for token
			expect(globalThis.fetch).toHaveBeenCalledWith(
				"https://oauth2.googleapis.com/token",
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
				}),
			);

			// Verify token was stored in KV
			expect(mockKV.put).toHaveBeenCalledWith(
				"googleOAuthToken",
				expect.stringContaining("mock-access-token"),
			);

			// Verify calendar ID was stored in KV
			expect(mockKV.put).toHaveBeenCalledWith(
				"googleCalendarId",
				expect.any(String),
			);

			// Verify response redirects to home
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("https://example.com/");

			// Verify email is set in cookie
			const setCookie = response.headers.get("Set-Cookie");
			expect(setCookie).toContain("email=test%40example.com");
			expect(setCookie).toContain("Path=/");
			expect(setCookie).toContain("HttpOnly");
			expect(setCookie).toContain("SameSite=Lax");
		});

		it("should reject OAuth callback without code parameter", async () => {
			const mockKV = {
				put: vi.fn().mockResolvedValue(undefined),
				get: vi.fn().mockResolvedValue(null),
				delete: vi.fn().mockResolvedValue(undefined),
			};

			const env = {
				GoogleOAuthClientId: "test-client-id",
				GoogleOAuthClientSecret: "test-client-secret",
				AppHost: "https://example.com",
				KV: mockKV,
			} as unknown as Env;

			const url = new URL("https://example.com/oauth");

			const response = await handleOAuthCallback(url, env);

			expect(response.status).toBe(400);
		});

		it("should store email in cookie and oauth token in KV on successful callback", async () => {
			// Mock fetch for Google API responses
			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					// Token exchange response
					new Response(
						JSON.stringify({
							access_token: "test-access-token-xyz",
							refresh_token: "test-refresh-token-xyz",
							expires_in: 3600,
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// User info response
					new Response(
						JSON.stringify({
							email: "john.doe@example.com",
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Calendar list response
					new Response(
						JSON.stringify({
							items: [],
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					// Create calendar response
					new Response(
						JSON.stringify({
							id: "cal-xyz-123",
						}),
						{ status: 200 },
					),
				);

			const mockKV = {
				put: vi.fn().mockResolvedValue(undefined),
				get: vi.fn().mockResolvedValue(null),
				delete: vi.fn().mockResolvedValue(undefined),
			};

			const env = {
				GoogleOAuthClientId: "test-client-id",
				GoogleOAuthClientSecret: "test-client-secret",
				AppHost: "https://example.com",
				KV: mockKV,
			} as unknown as Env;

			const url = new URL("https://example.com/oauth?code=auth-code-xyz");

			const response = await handleOAuthCallback(url, env);

			// Verify email is stored in Set-Cookie header
			const setCookie = response.headers.get("Set-Cookie");
			expect(setCookie).toContain("email=john.doe%40example.com");

			// Verify OAuth token is stored in KV
			expect(mockKV.put).toHaveBeenCalledWith(
				"googleOAuthToken",
				expect.stringContaining("test-access-token-xyz"),
			);

			expect(response.status).toBe(302);
		});
	});
});
