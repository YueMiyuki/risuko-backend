import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { checkCooldown } from "./cache";
import {
	cleanupExpired,
	consumeMagicLinkTokenByEmailAndCode,
	consumeMagicLinkTokenByToken,
	createMagicLinkToken,
	createSession,
	createShareSession,
	createUser,
	deleteSession,
	deleteSettings,
	deleteShareSession,
	fulfillShareSession,
	generateOTP,
	getOrCreateUserByEmail,
	getSettings,
	getShareSessionById,
	resolveShareSessionByDeviceCode,
	resolveShareSessionById,
	getUserByEmail,
	getUserByGithubId,
	getUserBySessionToken,
	type ShareDirection,
	type ShareSessionRow,
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
import { buildShareLandingPage, type ShareFileMeta } from "./share";
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

	const tokenRow = await consumeMagicLinkTokenByEmailAndCode(
		c.env.DB,
		normalizedEmail,
		code,
	);
	if (!tokenRow) {
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

	const tokenRow = await consumeMagicLinkTokenByToken(c.env.DB, token);
	if (!tokenRow) {
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

const SHARE_TTL_SECONDS = 60 * 60; // 1 hour
const MAX_SHARE_FILES = 256;

type ShareContext = Context<{ Bindings: Env; Variables: Vars }>;

async function resolveOptionalUserId(c: ShareContext): Promise<string | null> {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return null;
	}
	const user = await getUserBySessionToken(c.env.DB, authHeader.slice(7));
	return user?.id ?? null;
}

function sanitizeFileMeta(input: unknown): ShareFileMeta[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const files: ShareFileMeta[] = [];
	for (const entry of input.slice(0, MAX_SHARE_FILES)) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const name = (entry as { name?: unknown }).name;
		const size = (entry as { size?: unknown }).size;
		if (typeof name !== "string") {
			continue;
		}
		files.push({
			name: name.slice(0, 1024),
			size: typeof size === "number" && Number.isFinite(size) ? size : 0,
		});
	}
	return files;
}

function parseFileMeta(raw: string | null): ShareFileMeta[] {
	if (!raw) {
		return [];
	}
	try {
		return sanitizeFileMeta(JSON.parse(raw));
	} catch {
		return [];
	}
}

function shareSessionToJson(session: ShareSessionRow) {
	return {
		shareId: session.id,
		deviceCode: session.device_code,
		direction: session.direction,
		ticket: session.ticket,
		files: parseFileMeta(session.file_meta),
		expiresAt: session.expires_at,
	};
}

async function shareRateLimit(
	c: ShareContext,
	bucket: string,
	cooldownSeconds: number,
): Promise<Response | null> {
	if (c.env.DISABLE_RATE_LIMIT) {
		return null;
	}
	const ip = c.req.header("CF-Connecting-IP") || "unknown";
	const inCooldown = await checkCooldown(
		`share:${bucket}:${ip}`,
		cooldownSeconds,
	);
	if (inCooldown) {
		return c.json({ error: "Too many requests. Please slow down." }, 429);
	}
	const { success } = await c.env.RATE_LIMITER.limit({
		key: `share:${bucket}:${ip}`,
	});
	if (!success) {
		return c.json({ error: "Rate limit exceeded. Please slow down." }, 429);
	}
	return null;
}

app.post("/share", authMiddleware, async (c) => {
	const limited = await shareRateLimit(c, "create", 2);
	if (limited) {
		return limited;
	}

	const body = await c.req.json<{
		direction?: string;
		ticket?: string;
		files?: unknown;
	}>();

	const direction = body.direction;
	if (direction !== "send" && direction !== "receive") {
		return c.json({ error: "direction must be 'send' or 'receive'" }, 400);
	}

	if (direction === "send" && !body.ticket) {
		return c.json(
			{ error: "ticket is required when direction is 'send'" },
			400,
		);
	}

	const files = sanitizeFileMeta(body.files);
	const userId = c.get("userId");
	const expiresAt = Math.floor(Date.now() / 1000) + SHARE_TTL_SECONDS;

	const session = await createShareSession(c.env.DB, {
		direction: direction as ShareDirection,
		ticket: direction === "send" ? body.ticket : null,
		fileMeta: files.length > 0 ? JSON.stringify(files) : null,
		userId,
		expiresAt,
	});

	const url = `${new URL(c.req.url).origin}/share/${session.device_code}`;
	return c.json({ ...shareSessionToJson(session), url });
});

app.get("/share/code/:code", authMiddleware, async (c) => {
	const limited = await shareRateLimit(c, "resolve", 1);
	if (limited) {
		return limited;
	}
	const code = c.req.param("code");
	if (!code) {
		return c.json({ error: "Missing device code" }, 400);
	}
	const userId = c.get("userId");
	const session = await resolveShareSessionByDeviceCode(c.env.DB, code, userId);
	if (!session) {
		return c.json({ error: "Invalid or expired device code" }, 404);
	}
	return c.json(shareSessionToJson(session));
});

app.post("/share/:id/fulfill", authMiddleware, async (c) => {
	const limited = await shareRateLimit(c, "fulfill", 1);
	if (limited) {
		return limited;
	}
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "Missing share id" }, 400);
	}
	const body = await c.req.json<{ ticket?: string; files?: unknown }>();
	if (!body.ticket) {
		return c.json({ error: "ticket is required" }, 400);
	}
	const files = sanitizeFileMeta(body.files);
	const ok = await fulfillShareSession(
		c.env.DB,
		id,
		body.ticket,
		files.length > 0 ? JSON.stringify(files) : null,
	);
	if (!ok) {
		return c.json(
			{ error: "Share session not found, already fulfilled, or expired" },
			404,
		);
	}
	const session = await getShareSessionById(c.env.DB, id);
	if (!session) {
		return c.json({ error: "Share session not found" }, 404);
	}
	return c.json(shareSessionToJson(session));
});

app.delete("/share/:id", authMiddleware, async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "Missing share id" }, 400);
	}
	const userId = c.get("userId");
	const session = await getShareSessionById(c.env.DB, id);
	if (session?.user_id && session.user_id !== userId) {
		return c.json({ error: "Not authorized to revoke this share" }, 403);
	}
	await deleteShareSession(c.env.DB, id);
	return c.json({ success: true });
});

app.get("/share/:id", async (c) => {
	const limited = await shareRateLimit(c, "get", 1);
	if (limited) {
		return limited;
	}
	const id = c.req.param("id");

	const wantsJson =
		c.req.query("format") === "json" ||
		(c.req.header("Accept") || "").includes("application/json");
	if (wantsJson) {
		const userId = await resolveOptionalUserId(c);
		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}
		const session = await resolveShareSessionById(c.env.DB, id, userId);
		if (!session) {
			return c.json({ error: "Invalid or expired share link" }, 404);
		}
		return c.json(shareSessionToJson(session));
	}

	const session = await getShareSessionById(c.env.DB, id);

	if (!session) {
		return c.html(
			"<!doctype html><meta charset='utf-8'><title>Risuko</title><p style='font-family:system-ui;padding:32px'>This share link is invalid or has expired.</p>",
			404,
		);
	}

	const scheme = c.env.APP_DEEP_LINK_SCHEME || "risuko";
	const html = buildShareLandingPage({
		shareId: session.id,
		deviceCode: session.device_code,
		direction: session.direction,
		files: parseFileMeta(session.file_meta),
		deepLinkScheme: scheme,
		locale: c.req.query("locale") ?? undefined,
	});
	return c.html(html);
});

app.all("*", (c) => {
	return c.json({ error: "Not found" }, 404);
});

export default {
	fetch: app.fetch,
	scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
		console.log("[Risuko] scheduled cleanup started", event.cron);
		ctx.waitUntil(
			cleanupExpired(env.DB)
				.then((counts) =>
					console.log("[Risuko] scheduled cleanup removed:", counts),
				)
				.catch((err) => {
					console.error("[Risuko] scheduled cleanup failed:", err);
				}),
		);
	},
};
