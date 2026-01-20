const SCOPES = "https://www.googleapis.com/auth/calendar email";

export function buildAuthUrl(clientId: string, appHost: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: `${appHost}/oauth`,
		response_type: "code",
		scope: SCOPES,
		access_type: "offline",
		prompt: "consent",
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForToken(
	code: string,
	clientId: string,
	clientSecret: string,
	appHost: string
): Promise<object> {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: `${appHost}/oauth`,
			grant_type: "authorization_code",
		}),
	});
	return response.json();
}

export async function handleOAuthCallback(
	url: URL,
	env: Env
): Promise<Response> {
	console.log("[oauth] Handling OAuth callback");
	const code = url.searchParams.get("code");
	if (!code) {
		console.log("[oauth] Missing code parameter");
		return new Response("Missing code parameter", { status: 400 });
	}

	console.log("[oauth] Exchanging code for token");
	const token = await exchangeCodeForToken(
		code,
		env.GoogleOAuthClientId,
		env.GoogleOAuthClientSecret,
		env.AppHost
	) as { access_token: string };
	await env.KV.put("googleOAuthToken", JSON.stringify(token));
	console.log("[oauth] Token stored in KV");

	const userInfo = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: { Authorization: `Bearer ${token.access_token}` },
	});
	const {email} = await userInfo.json() as { email: string };
	console.log(`[oauth] User email: ${email}`);

	console.log("[oauth] Looking for existing Radicale calendar");
	const listResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
		headers: { Authorization: `Bearer ${token.access_token}` },
	});
	const calendarList = await listResponse.json() as { items?: Array<{ id: string; summary: string }> };
	const existingCalendar = calendarList.items?.find(c => c.summary === "Radicale");

	let calendarId: string;
	if (existingCalendar) {
		calendarId = existingCalendar.id;
		console.log(`[oauth] Found existing Radicale calendar: ${calendarId}`);
	} else {
		console.log("[oauth] Creating Radicale calendar");
		const calendarResponse = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token.access_token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ summary: "Radicale" }),
		});
		const calendar = await calendarResponse.json() as { id: string };
		calendarId = calendar.id;
		console.log(`[oauth] Calendar created: ${calendarId}`);
	}
	await env.KV.put("googleCalendarId", calendarId);

	return new Response(null, {
		status: 302,
		headers: {
			Location: `${env.AppHost}/`,
			"Set-Cookie": `email=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax`,
		},
	});
}
