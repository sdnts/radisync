import { buildAuthUrl } from "./oauth";

export function renderLoginPage(env: Env, email: string | null): Response {
	const authUrl = buildAuthUrl(env.GoogleOAuthClientId, env.AppHost);
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>radisync</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			min-height: 100vh;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: flex-start;
			padding-top: 140px;
			background-color: #1a1a1a;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		}
		.login-button {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 10px 20px;
			background-color: #333;
			border: 1px solid #555;
			border-radius: 6px;
			font-size: 13px;
			font-weight: 500;
			color: #fff;
			cursor: pointer;
			transition: background-color 0.2s, box-shadow 0.2s;
			text-decoration: none;
		}
		.login-button:hover {
			background-color: #444;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		}
		.google-icon {
			width: 16px;
			height: 16px;
		}
		.title {
			margin-bottom: 40px;
			font-family: monospace;
			font-size: 12pt;
			color: #fff;
			text-align: center;
		}
		.email {
			display: block;
			margin-top: 8px;
			color: #666;
			font-size: 10pt;
		}
		.arrow {
			display: block;
			margin-top: 16px;
			color: #666;
			font-size: 24px;
		}
		.radicale-logo {
			display: block;
			margin: 12px auto 0;
			width: 48px;
			height: 48px;
			opacity: 0.8;
		}

	</style>
</head>
<body>
	<span class="title">radisync${
		email
			? `<span class="email">${email}</span>
		<span class="arrow">↕</span>
		<svg class="radicale-logo" viewBox="0 0 200 300">
			<path fill="#a40000" d="M 186,188 C 184,98 34,105 47,192 C 59,279 130,296 130,296 C 130,296 189,277 186,188 z" />
			<path fill="#ffffff" d="M 73,238 C 119,242 140,241 177,222 C 172,270 131,288 131,288 C 131,288 88,276 74,238 z" />
			<g fill="none" stroke="#4e9a06" stroke-width="15">
				<path d="M 103,137 C 77,69 13,62 13,62" />
				<path d="M 105,136 C 105,86 37,20 37,20" />
				<path d="M 105,135 C 112,73 83,17 83,17" />
			</g>
		</svg>`
			: ""
	}</span>
	${
		email
			? `<a href="/logout" class="login-button">Logout</a>`
			: `<a href="${authUrl}" class="login-button">
		<svg class="google-icon" viewBox="0 0 24 24">
			<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
			<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
			<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
			<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
		</svg>
		Login with Google
	</a>`
	}
</body>
</html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html" },
	});
}
