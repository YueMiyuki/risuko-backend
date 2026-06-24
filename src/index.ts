import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkCooldown } from "./cache";
import {
	cleanupExpiredMagicLinkTokens,
	cleanupExpiredSessions,
	createMagicLinkToken,
	createSession,
	createUser,
	deleteSession,
	deleteSettings,
	generateOTP,
	getMagicLinkTokenByToken,
	getMagicLinkTokenByEmailAndCode,
	getOrCreateUserByEmail,
	getSettings,
	getUserByEmail,
	getUserByGithubId,
	markMagicLinkTokenUsed,
	type UserRow,
	upsertSettings,
} from "./db";
import { buildMagicLinkEmail, sendEmail } from "./email";
import {
	buildGithubAuthURL,
	exchangeGithubCode,
	getGithubUser,
} from "./github";
import { authMiddleware } from "./middleware";
export interface Env {
	DB: D1Database;
	EMAIL: SendEmail;
	EMAIL_FROM: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	APP_DEEP_LINK_SCHEME: string;
	DISABLE_RATE_LIMIT?: string;
	RATE_LIMITER: RateLimit;
	OTP_LIMITER: RateLimit;
	VERIFY_LIMITER: RateLimit;
}

export interface Vars {
	userId: string;
	user: UserRow;
	sessionToken: string;
}

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use("*", cors());

// Global rate limiter
app.use("*", async (c, next) => {
	if (c.env.DISABLE_RATE_LIMIT) {
		return await next();
	}
	const ip = c.req.header("CF-Connecting-IP") || "unknown";
	const inCooldown = await checkCooldown(`ip:${ip}`, 1);
	if (inCooldown) {
		return c.json({ error: "Too many requests. Please slow down." }, 429);
	}
	const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
	if (!success) {
		return c.json({ error: "Rate limit exceeded. Please slow down." }, 429);
	}
	await next();
});

app.get("/", (c) => c.json({ status: "ok" }));

app.get("/config", (c) => {
	const githubEnabled = !!(
		c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET
	);
	const emailEnabled = !!c.env.EMAIL;
	return c.json({
		authMethods: {
			email: emailEnabled,
			github: githubEnabled,
		},
		deepLinkScheme: c.env.APP_DEEP_LINK_SCHEME || "risuko",
	});
});

app.post("/auth/magic-link", async (c) => {
	const { email, locale } = await c.req.json<{
		email?: string;
		locale?: string;
	}>();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return c.json({ error: "Valid email is required" }, 400);
	}

	const normalizedEmail = email.toLowerCase();

	if (!c.env.DISABLE_RATE_LIMIT) {
		const inCooldown = await checkCooldown(`otp:${normalizedEmail}`, 30);
		if (inCooldown) {
			return c.json(
				{ error: "Please wait 30 seconds before requesting another code." },
				429,
			);
		}

		const { success: otpOk } = await c.env.OTP_LIMITER.limit({
			key: normalizedEmail,
		});
		if (!otpOk) {
			return c.json(
				{ error: "Too many requests. Please try again later." },
				429,
			);
		}
	}

	const code = generateOTP();
	const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
	const { magicToken } = await createMagicLinkToken(c.env.DB, {
		email: normalizedEmail,
		code,
		expiresAt,
	});

	const magicLinkUrl = `${new URL(c.req.url).origin}/auth/magic-link/callback?token=${encodeURIComponent(magicToken)}`;

	const { subject, html } = buildMagicLinkEmail(code, magicLinkUrl, locale);
	try {
		await sendEmail({
			emailBinding: c.env.EMAIL,
			to: email,
			from: c.env.EMAIL_FROM,
			subject,
			html,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown email error";
		console.error("[Risuko] magic-link email failed:", message);
		return c.json(
			{
				error: `Failed to send verification email: ${message}`,
			},
			500,
		);
	}

	return c.json({ success: true });
});

app.post("/auth/verify-otp", async (c) => {
	const { email, code } = await c.req.json<{ email?: string; code?: string }>();
	if (!email || !code) {
		return c.json({ error: "Email and code are required" }, 400);
	}

	const normalizedEmail = email.toLowerCase();

	// 10s per email 
	if (!c.env.DISABLE_RATE_LIMIT) {
		const inCooldown = await checkCooldown(`verify:${normalizedEmail}`, 10);
		if (inCooldown) {
			return c.json(
				{ error: "Too many attempts. Please wait a few seconds." },
				429,
			);
		}

		// Rate limit
		const { success: verifyOk } = await c.env.VERIFY_LIMITER.limit({
			key: normalizedEmail,
		});
		if (!verifyOk) {
			return c.json(
				{ error: "Too many verification attempts. Please try again later." },
				429,
			);
		}
	}

	const tokenRow = await getMagicLinkTokenByEmailAndCode(
		c.env.DB,
		normalizedEmail,
		code,
	);

	if (!tokenRow) {
		return c.json({ error: "Invalid or expired verification code" }, 400);
	}

	const tokenUsed = await markMagicLinkTokenUsed(c.env.DB, tokenRow.id);
	if (!tokenUsed) {
		return c.json({ error: "Invalid or expired verification code" }, 400);
	}

	const user = await getOrCreateUserByEmail(c.env.DB, normalizedEmail);

	const session = await createSession(c.env.DB, user.id);

	return c.json({
		token: session.token,
		user: {
			id: user.id,
			email: user.email,
			githubUsername: user.github_username,
		},
	});
});

app.get("/auth/magic-link/callback", async (c) => {
	const token = c.req.query("token");
	if (!token) {
		return c.json({ error: "Missing magic link token" }, 400);
	}

	const tokenRow = await getMagicLinkTokenByToken(c.env.DB, token);
	if (!tokenRow) {
		return c.json({ error: "Invalid or expired magic link" }, 400);
	}

	const tokenUsed = await markMagicLinkTokenUsed(c.env.DB, tokenRow.id);
	if (!tokenUsed) {
		return c.json({ error: "Invalid or expired magic link" }, 400);
	}

	const user = await getOrCreateUserByEmail(c.env.DB, tokenRow.email);
	const session = await createSession(c.env.DB, user.id);

	const scheme = c.env.APP_DEEP_LINK_SCHEME || "risuko";
	const redirectUrl = `${scheme}://auth?token=${encodeURIComponent(session.token)}`;
	return c.redirect(redirectUrl, 302);
});

app.get("/auth/github", (c) => {
	const redirectUri = `${new URL(c.req.url).origin}/auth/github/callback`;
	const url = buildGithubAuthURL(c.env.GITHUB_CLIENT_ID, redirectUri);
	return c.redirect(url, 302);
});

app.get("/auth/github/callback", async (c) => {
	const code = c.req.query("code");
	if (!code) {
		return c.json({ error: "Missing authorization code" }, 400);
	}

	if (!c.env.GITHUB_CLIENT_SECRET) {
		console.error("[Risuko] GITHUB_CLIENT_SECRET is not configured");
		return c.json(
			{ error: "GitHub OAuth is not configured on this server" },
			500,
		);
	}

	if (!c.env.DISABLE_RATE_LIMIT) {
		const ip = c.req.header("CF-Connecting-IP") || "unknown";
		const inCooldown = await checkCooldown(`gh:${ip}`, 15);
		if (inCooldown) {
			return c.json(
				{ error: "Too many requests. Please try again later." },
				429,
			);
		}
		const { success: ghOk } = await c.env.RATE_LIMITER.limit({
			key: `gh:${ip}`,
		});
		if (!ghOk) {
			return c.json(
				{ error: "Too many requests. Please try again later." },
				429,
			);
		}
	}

	const redirectUri = `${new URL(c.req.url).origin}/auth/github/callback`;
	const tokenResp = await exchangeGithubCode(
		code,
		c.env.GITHUB_CLIENT_ID,
		c.env.GITHUB_CLIENT_SECRET,
		redirectUri,
	);
	if (!tokenResp) {
		console.error("[Risuko] GitHub token exchange failed");
		return c.json(
			{
				error:
					"Failed to exchange GitHub code. Check your callback URL and OAuth app settings.",
			},
			500,
		);
	}

	console.log(
		"[Risuko] GitHub token exchange OK, scopes:",
		tokenResp.scope,
		"token_type:",
		tokenResp.token_type,
	);

	const ghUser = await getGithubUser(tokenResp.access_token);
	if (!ghUser) {
		console.error(
			"[Risuko] Failed to fetch GitHub user with token. Scopes:",
			tokenResp.scope,
		);
		return c.json(
			{
				error:
					"Failed to fetch GitHub user. Check that your OAuth app requests the user scope and that the token is valid.",
			},
			500,
		);
	}

	let user = await getUserByGithubId(c.env.DB, ghUser.id);
	if (!user && ghUser.email) {
		user = await getUserByEmail(c.env.DB, ghUser.email);
		if (user) {
			await c.env.DB.prepare(
				"UPDATE users SET github_id = ?, github_username = ? WHERE id = ?",
			)
				.bind(ghUser.id, ghUser.login, user.id)
				.run();
		}
	}
	if (!user) {
		user = await createUser(c.env.DB, {
			githubId: ghUser.id,
			githubUsername: ghUser.login,
			email: ghUser.email?.toLowerCase(),
		});
	}

	const session = await createSession(c.env.DB, user.id);

	const scheme = c.env.APP_DEEP_LINK_SCHEME || "risuko";
	const redirectUrl = `${scheme}://auth?token=${encodeURIComponent(session.token)}`;
	return c.redirect(redirectUrl, 302);
});

app.get("/auth/me", authMiddleware, async (c) => {
	const user = c.get("user");
	return c.json({
		id: user.id,
		email: user.email,
		githubUsername: user.github_username,
	});
});

app.post("/auth/logout", authMiddleware, async (c) => {
	const token = c.get("sessionToken");
	await deleteSession(c.env.DB, token);
	return c.json({ success: true });
});

app.get("/settings", authMiddleware, async (c) => {
	const userId = c.get("userId");
	const rows = await getSettings(c.env.DB, userId);
	const result: Record<string, unknown> = {};
	const timestamps: Record<string, number> = {};
	for (const row of rows) {
		try {
			result[row.category] = JSON.parse(row.data);
		} catch {
			result[row.category] = null;
		}
		timestamps[row.category] = row.updated_at;
	}
	return c.json({ settings: result, timestamps });
});

app.put("/settings", authMiddleware, async (c) => {
	const userId = c.get("userId");
	const { category, data } = await c.req.json<{
		category?: string;
		data?: unknown;
	}>();
	if (!category || data === undefined) {
		return c.json({ error: "category and data are required" }, 400);
	}
	const updatedAt = Math.floor(Date.now() / 1000);
	await upsertSettings(
		c.env.DB,
		userId,
		category,
		JSON.stringify(data),
		updatedAt,
	);
	return c.json({ success: true, updatedAt });
});

app.get("/settings/:category", authMiddleware, async (c) => {
	const userId = c.get("userId");
	const category = c.req.param("category");
	const rows = await getSettings(c.env.DB, userId, category);
	if (rows.length === 0) {
		return c.json({ error: "Category not found" }, 404);
	}
	try {
		return c.json({
			category,
			data: JSON.parse(rows[0].data),
			updatedAt: rows[0].updated_at,
		});
	} catch {
		return c.json({ error: "Corrupted data" }, 500);
	}
});

app.delete("/settings/:category", authMiddleware, async (c) => {
	const userId = c.get("userId");
	const category = c.req.param("category");
	await deleteSettings(c.env.DB, userId, category);
	return c.json({ success: true });
});

app.delete("/settings", authMiddleware, async (c) => {
	const userId = c.get("userId");
	await deleteSettings(c.env.DB, userId);
	return c.json({ success: true });
});

app.all("*", (c) => {
	return c.json({ error: "Not found" }, 404);
});

export default {
	fetch: app.fetch,
	scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
		console.log("[Risuko] scheduled cleanup started", event.cron);
		ctx.waitUntil(
			Promise.all([
				cleanupExpiredMagicLinkTokens(env.DB).then((count) =>
					console.log("[Risuko] cleaned up expired magic link tokens:", count),
				),
				cleanupExpiredSessions(env.DB).then((count) =>
					console.log("[Risuko] cleaned up expired sessions:", count),
				),
			]).catch((err) => {
				console.error("[Risuko] scheduled cleanup failed:", err);
			}),
		);
	},
};
