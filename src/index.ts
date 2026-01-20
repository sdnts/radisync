import {
	WorkflowEntrypoint,
	WorkflowEvent,
	WorkflowStep,
} from "cloudflare:workers";
import { handleOAuthCallback } from "./oauth";
import { renderLoginPage } from "./login";
import { fetchRadicaleEvents, updateRadicaleEvents, deleteRadicaleEvents } from "./radicale";
import { deleteGoogleEvents, updateGoogleEvents, fetchGoogleEvents } from "./google";

type WorkflowParams = {};

export class RadicaleToGoogle extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		console.log("[RadicaleToGoogle] Starting workflow");

		const syncResult = await step.do("fetch-radicale-events", async () => {
			console.log("[RadicaleToGoogle] Fetching Radicale events");
			return fetchRadicaleEvents(this.env.BeelinkTunnel, this.env.KV);
		});
		console.log(`[RadicaleToGoogle] Fetched ${syncResult.events.length} events, ${syncResult.deleted.length} deleted`);

		const calendarId = await step.do("get-calendar-id", async () => {
			const id = await this.env.KV.get("googleCalendarId");
			if (!id) {
				throw new Error("No Google Calendar ID found in KV");
			}
			console.log(`[RadicaleToGoogle] Calendar ID: ${id}`);
			return id;
		});

		const deleteResult = await step.do("delete-google-events", async () => {
			if (syncResult.deleted.length === 0) {
				console.log("[RadicaleToGoogle] No events to delete");
				return { deleted: 0, errors: [] };
			}
			console.log(`[RadicaleToGoogle] Deleting ${syncResult.deleted.length} events`);
			return deleteGoogleEvents(this.env.KV, calendarId, syncResult.deleted);
		});

		const upsertResult = await step.do("upsert-google-events", async () => {
			if (syncResult.events.length === 0) {
				console.log("[RadicaleToGoogle] No events to upsert");
				return { updated: 0, created: 0, errors: [] };
			}
			console.log(`[RadicaleToGoogle] Upserting ${syncResult.events.length} events`);
			return updateGoogleEvents(this.env.KV, calendarId, syncResult.events);
		});

		console.log(`[RadicaleToGoogle] Done: deleted=${deleteResult.deleted}, updated=${upsertResult.updated}, created=${upsertResult.created}`);
		return {
			syncToken: syncResult.syncToken,
			deleted: deleteResult,
			upserted: upsertResult,
		};
	}
}

export class GoogleToRadicale extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		console.log("[GoogleToRadicale] Starting workflow");

		const syncResult = await step.do("fetch-google-events", async () => {
			console.log("[GoogleToRadicale] Fetching Google Calendar events");
			return fetchGoogleEvents(this.env.KV);
		});
		console.log(`[GoogleToRadicale] Fetched ${syncResult.events.length} events, ${syncResult.deleted.length} deleted`);

		const deleteResult = await step.do("delete-radicale-events", async () => {
			if (syncResult.deleted.length === 0) {
				console.log("[GoogleToRadicale] No events to delete");
				return { deleted: 0, errors: [] };
			}
			console.log(`[GoogleToRadicale] Deleting ${syncResult.deleted.length} events`);
			return deleteRadicaleEvents(this.env.BeelinkTunnel, syncResult.deleted);
		});

		const upsertResult = await step.do("upsert-radicale-events", async () => {
			if (syncResult.events.length === 0) {
				console.log("[GoogleToRadicale] No events to upsert");
				return { updated: 0, created: 0, errors: [] };
			}
			console.log(`[GoogleToRadicale] Upserting ${syncResult.events.length} events`);
			return updateRadicaleEvents(this.env.BeelinkTunnel, syncResult.events);
		});

		console.log(`[GoogleToRadicale] Done: deleted=${deleteResult.deleted}, updated=${upsertResult.updated}, created=${upsertResult.created}`);
		return {
			syncToken: syncResult.syncToken,
			deleted: deleteResult,
			upserted: upsertResult,
		};
	}
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		const [googleOAuthToken, googleCalendarId] = await Promise.all([
			env.KV.get("googleOAuthToken"),
			env.KV.get("googleCalendarId"),
		]);

		if (!googleOAuthToken || !googleCalendarId) {
			console.error("[scheduled] Missing required KV keys: googleOAuthToken or googleCalendarId not set");
			return;
		}

		console.log("[scheduled] Triggering RadicaleToGoogle workflow");
		const radicaleInstance = await env.RadicaleToGoogle.create();
		console.log(`[scheduled] Started RadicaleToGoogle: ${radicaleInstance.id}`);

		console.log("[scheduled] Triggering GoogleToRadicale workflow");
		const googleInstance = await env.GoogleToRadicale.create();
		console.log(`[scheduled] Started GoogleToRadicale: ${googleInstance.id}`);
	},

	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		console.log(`[fetch] ${req.method} ${url.pathname}`);

		if (url.pathname === "/oauth") {
			return handleOAuthCallback(url, env);
		}

		if (url.pathname === "/logout") {
			await Promise.all([
				env.KV.delete("googleOAuthToken"),
				env.KV.delete("googleCalendarId"),
				env.KV.delete("googleSyncToken"),
				env.KV.delete("radicaleSyncToken"),
			]);
			return new Response(null, {
				status: 302,
				headers: {
					Location: "/",
					"Set-Cookie": "email=; Path=/; Max-Age=0",
				},
			});
		}

		const cookies = req.headers.get("Cookie") || "";
		const emailMatch = cookies.match(/email=([^;]+)/);
		const email = emailMatch ? decodeURIComponent(emailMatch[1]) : null;
		console.log(`[fetch] Rendering login page, email: ${email || "none"}`);

		return renderLoginPage(env, email);
	},
};
