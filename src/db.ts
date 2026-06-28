import type { D1Database } from "@cloudflare/workers-types";

const USER_COLUMNS = "id, email, github_id, github_username, created_at";
const USER_COLUMNS_WITH_ALIAS =
	"u.id, u.email, u.github_id, u.github_username, u.created_at";
const MAGIC_LINK_TOKEN_COLUMNS =
	"id, email, code, expires_at, used, created_at";

export interface UserRow {
	id: string;
	email: string | null;
	github_id: number | null;
	github_username: string | null;
	created_at: number;
}

export interface SessionRow {
	token: string;
	user_id: string;
	expires_at: number;
	created_at: number;
}

export interface SettingsRow {
	user_id: string;
	category: string;
	data: string;
	updated_at: number;
}

export interface MagicLinkTokenRow {
	id: string;
	email: string;
	code: string;
	expires_at: number;
	used: number;
	created_at: number;
}

export type ShareDirection = "send" | "receive";

export interface ShareSessionRow {
	id: string;
	device_code: string;
	direction: ShareDirection;
	ticket: string | null;
	file_meta: string | null;
	user_id: string | null;
	expires_at: number;
	created_at: number;
}

const SHARE_SESSION_COLUMNS =
	"id, device_code, direction, ticket, file_meta, user_id, expires_at, created_at";

function unixNowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function generateRandomBytes(byteLength: number): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return bytes;
}

function generateRandomHexToken(byteLength: number): string {
	const bytes = generateRandomBytes(byteLength);
	let token = "";
	for (const byte of bytes) {
		token += byte.toString(16).padStart(2, "0");
	}
	return token;
}

export function generateId(): string {
	return crypto.randomUUID();
}

export function generateToken(): string {
	return generateRandomHexToken(32);
}

// Crockford base32 (no I, L, O, U) — unambiguous for typing/reading aloud.
const DEVICE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SHARE_DEVICE_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

function shareLookupKey(key: string): { byCode: boolean; value: string } {
	const trimmed = key.trim();
	const upper = trimmed.toUpperCase();
	if (SHARE_DEVICE_CODE_RE.test(upper)) {
		return { byCode: true, value: upper };
	}
	return { byCode: false, value: trimmed };
}

export function generateDeviceCode(length = 8): string {
	const bytes = generateRandomBytes(length);
	let code = "";
	for (const byte of bytes) {
		code += DEVICE_CODE_ALPHABET[byte % DEVICE_CODE_ALPHABET.length];
	}
	return code;
}

export function generateOTP(): string {
	const max = 900_000;
	const limit = Math.floor(0x1_0000_0000 / max) * max;
	const bytes = new Uint32Array(1);

	let value = 0;
	do {
		crypto.getRandomValues(bytes);
		value = bytes[0];
	} while (value >= limit);

	return String(100_000 + (value % max));
}

export async function createMagicLinkToken(
	db: D1Database,
	params: {
		email: string;
		code: string;
		magicToken?: string;
		expiresAt: number;
	},
): Promise<{ magicToken: string }> {
	const id = generateId();
	const magicToken = params.magicToken ?? generateToken();
	await db
		.prepare(
			"INSERT INTO magic_link_tokens (id, email, code, magic_token, expires_at) VALUES (?, ?, ?, ?, ?)",
		)
		.bind(
			id,
			params.email.toLowerCase(),
			params.code,
			magicToken,
			params.expiresAt,
		)
		.run();
	return { magicToken };
}

export async function consumeMagicLinkTokenByEmailAndCode(
	db: D1Database,
	email: string,
	code: string,
): Promise<MagicLinkTokenRow | null> {
	const result = await db
		.prepare(
			`UPDATE magic_link_tokens
			 SET used = 1
			 WHERE id = (
			   SELECT id FROM magic_link_tokens
			   WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
			   ORDER BY created_at DESC
			   LIMIT 1
			 )
			 RETURNING ${MAGIC_LINK_TOKEN_COLUMNS}`,
		)
		.bind(email.toLowerCase(), code, unixNowSeconds())
		.first<MagicLinkTokenRow>();
	return result ?? null;
}

export async function consumeMagicLinkTokenByToken(
	db: D1Database,
	magicToken: string,
): Promise<MagicLinkTokenRow | null> {
	const result = await db
		.prepare(
			`UPDATE magic_link_tokens
			 SET used = 1
			 WHERE id = (
			   SELECT id FROM magic_link_tokens
			   WHERE magic_token = ? AND used = 0 AND expires_at > ?
			   ORDER BY created_at DESC
			   LIMIT 1
			 )
			 RETURNING ${MAGIC_LINK_TOKEN_COLUMNS}`,
		)
		.bind(magicToken, unixNowSeconds())
		.first<MagicLinkTokenRow>();
	return result ?? null;
}

export interface CleanupCounts {
	magicLinkTokens: number;
	sessions: number;
	shareSessions: number;
}

export async function cleanupExpired(db: D1Database): Promise<CleanupCounts> {
	const now = unixNowSeconds();
	const results = await db.batch([
		db
			.prepare(
				"DELETE FROM magic_link_tokens WHERE expires_at <= ? OR used = 1",
			)
			.bind(now),
		db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
		db.prepare("DELETE FROM share_sessions WHERE expires_at <= ?").bind(now),
	]);
	return {
		magicLinkTokens: results[0]?.meta?.changes ?? 0,
		sessions: results[1]?.meta?.changes ?? 0,
		shareSessions: results[2]?.meta?.changes ?? 0,
	};
}

export async function createShareSession(
	db: D1Database,
	params: {
		direction: ShareDirection;
		ticket?: string | null;
		fileMeta?: string | null;
		userId?: string | null;
		expiresAt: number;
	},
): Promise<ShareSessionRow> {
	const id = generateId();
	const createdAt = unixNowSeconds();
	const ticket = params.ticket ?? null;
	const fileMeta = params.fileMeta ?? null;
	const userId = params.userId ?? null;

	// Retry on the device-code collision
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const deviceCode = generateDeviceCode();
		try {
			await db
				.prepare(
					`INSERT INTO share_sessions
					 (id, device_code, direction, ticket, file_meta, user_id, expires_at, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					id,
					deviceCode,
					params.direction,
					ticket,
					fileMeta,
					userId,
					params.expiresAt,
					createdAt,
				)
				.run();
			return {
				id,
				device_code: deviceCode,
				direction: params.direction,
				ticket,
				file_meta: fileMeta,
				user_id: userId,
				expires_at: params.expiresAt,
				created_at: createdAt,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!/UNIQUE/i.test(message)) {
				throw err;
			}
		}
	}
	throw new Error("Failed to allocate a unique device code");
}

export async function getShareSessionById(
	db: D1Database,
	id: string,
): Promise<ShareSessionRow | null> {
	const lookup = shareLookupKey(id);
	const result = await db
		.prepare(
			lookup.byCode
				? `SELECT ${SHARE_SESSION_COLUMNS}
				   FROM share_sessions
				   WHERE device_code = ? AND expires_at > ?
				   LIMIT 1`
				: `SELECT ${SHARE_SESSION_COLUMNS}
				   FROM share_sessions
				   WHERE id = ? AND expires_at > ?
				   LIMIT 1`,
		)
		.bind(lookup.value, unixNowSeconds())
		.first<ShareSessionRow>();
	return result ?? null;
}

export async function getShareSessionByDeviceCode(
	db: D1Database,
	deviceCode: string,
): Promise<ShareSessionRow | null> {
	const result = await db
		.prepare(
			`SELECT ${SHARE_SESSION_COLUMNS}
			 FROM share_sessions
			 WHERE device_code = ? AND expires_at > ?
			 LIMIT 1`,
		)
		.bind(deviceCode.toUpperCase(), unixNowSeconds())
		.first<ShareSessionRow>();
	return result ?? null;
}

export async function resolveShareSessionByDeviceCode(
	db: D1Database,
	deviceCode: string,
	resolverUserId: string,
): Promise<ShareSessionRow | null> {
	const now = unixNowSeconds();
	const code = deviceCode.toUpperCase();

	const sendPickup = await db
		.prepare(
			`DELETE FROM share_sessions
			 WHERE device_code = ? AND expires_at > ? AND direction = 'send'
			   AND (user_id IS NULL OR user_id != ?)
			 RETURNING ${SHARE_SESSION_COLUMNS}`,
		)
		.bind(code, now, resolverUserId)
		.first<ShareSessionRow>();
	if (sendPickup) {
		return sendPickup;
	}

	const session = await getShareSessionByDeviceCode(db, code);
	if (!session) {
		return null;
	}

	return resolveShareSessionRow(db, session, resolverUserId, now);
}

export async function resolveShareSessionById(
	db: D1Database,
	id: string,
	resolverUserId: string,
): Promise<ShareSessionRow | null> {
	const now = unixNowSeconds();
	const lookup = shareLookupKey(id);

	const sendPickup = await db
		.prepare(
			lookup.byCode
				? `DELETE FROM share_sessions
				   WHERE device_code = ? AND expires_at > ? AND direction = 'send'
				     AND (user_id IS NULL OR user_id != ?)
				   RETURNING ${SHARE_SESSION_COLUMNS}`
				: `DELETE FROM share_sessions
				   WHERE id = ? AND expires_at > ? AND direction = 'send'
				     AND (user_id IS NULL OR user_id != ?)
				   RETURNING ${SHARE_SESSION_COLUMNS}`,
		)
		.bind(lookup.value, now, resolverUserId)
		.first<ShareSessionRow>();
	if (sendPickup) {
		return sendPickup;
	}

	const session = await getShareSessionById(db, id);
	if (!session) {
		return null;
	}

	return resolveShareSessionRow(db, session, resolverUserId, now);
}

async function resolveShareSessionRow(
	db: D1Database,
	session: ShareSessionRow,
	resolverUserId: string,
	now: number,
): Promise<ShareSessionRow | null> {
	if (session.direction === "receive" && session.ticket) {
		if (session.user_id !== resolverUserId) {
			return null;
		}
		const ownerPickup = await db
			.prepare(
				`DELETE FROM share_sessions
				 WHERE id = ? AND user_id = ? AND ticket IS NOT NULL AND expires_at > ?
				 RETURNING ${SHARE_SESSION_COLUMNS}`,
			)
			.bind(session.id, resolverUserId, now)
			.first<ShareSessionRow>();
		return ownerPickup ?? session;
	}

	return session;
}

export async function fulfillShareSession(
	db: D1Database,
	id: string,
	ticket: string,
	fileMeta: string | null,
): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE share_sessions
			 SET ticket = ?, file_meta = ?
			 WHERE id = ? AND direction = 'receive' AND ticket IS NULL AND expires_at > ?`,
		)
		.bind(ticket, fileMeta, id, unixNowSeconds())
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

export async function deleteShareSession(
	db: D1Database,
	id: string,
): Promise<void> {
	await db.prepare("DELETE FROM share_sessions WHERE id = ?").bind(id).run();
}

export async function getUserByEmail(
	db: D1Database,
	email: string,
): Promise<UserRow | null> {
	const result = await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
		.bind(email.toLowerCase())
		.first<UserRow>();
	return result ?? null;
}

export async function getUserByGithubId(
	db: D1Database,
	githubId: number,
): Promise<UserRow | null> {
	const result = await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE github_id = ?`)
		.bind(githubId)
		.first<UserRow>();
	return result ?? null;
}

export async function getUserBySessionToken(
	db: D1Database,
	token: string,
): Promise<UserRow | null> {
	const result = await db
		.prepare(
			`SELECT ${USER_COLUMNS_WITH_ALIAS}
			 FROM sessions AS s
			 INNER JOIN users AS u ON u.id = s.user_id
			 WHERE s.token = ? AND s.expires_at > ?
			 LIMIT 1`,
		)
		.bind(token, unixNowSeconds())
		.first<UserRow>();
	return result ?? null;
}

export async function getOrCreateUserByEmail(
	db: D1Database,
	email: string,
): Promise<UserRow> {
	const normalizedEmail = email.toLowerCase();
	const id = generateId();
	const createdAt = unixNowSeconds();
	const result = await db
		.prepare(
			`INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)
			 ON CONFLICT(email) DO UPDATE SET email = excluded.email
			 RETURNING ${USER_COLUMNS}`,
		)
		.bind(id, normalizedEmail, createdAt)
		.first<UserRow>();
	if (!result) {
		throw new Error("Failed to upsert user by email");
	}
	return result;
}

export async function createUser(
	db: D1Database,
	params: { email?: string; githubId?: number; githubUsername?: string },
): Promise<UserRow> {
	const id = generateId();
	const createdAt = unixNowSeconds();
	const email = params.email?.toLowerCase() ?? null;
	const githubId = params.githubId ?? null;
	const githubUsername = params.githubUsername ?? null;
	await db
		.prepare(
			"INSERT INTO users (id, email, github_id, github_username, created_at) VALUES (?, ?, ?, ?, ?)",
		)
		.bind(id, email, githubId, githubUsername, createdAt)
		.run();
	return {
		id,
		email,
		github_id: githubId,
		github_username: githubUsername,
		created_at: createdAt,
	};
}

export async function createSession(
	db: D1Database,
	userId: string,
	expiresInSeconds: number = 30 * 24 * 60 * 60,
): Promise<SessionRow> {
	const token = generateToken();
	const createdAt = unixNowSeconds();
	const expiresAt = createdAt + expiresInSeconds;
	await db
		.prepare(
			"INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
		)
		.bind(token, userId, expiresAt, createdAt)
		.run();
	return {
		token,
		user_id: userId,
		expires_at: expiresAt,
		created_at: createdAt,
	};
}

export async function deleteSession(
	db: D1Database,
	token: string,
): Promise<void> {
	await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export async function getSettings(
	db: D1Database,
	userId: string,
	category?: string,
): Promise<SettingsRow[]> {
	if (category) {
		const result = await db
			.prepare(
				"SELECT user_id, category, data, updated_at FROM settings WHERE user_id = ? AND category = ?",
			)
			.bind(userId, category)
			.all<SettingsRow>();
		return result.results ?? [];
	}
	const result = await db
		.prepare(
			"SELECT user_id, category, data, updated_at FROM settings WHERE user_id = ?",
		)
		.bind(userId)
		.all<SettingsRow>();
	return result.results ?? [];
}

export async function upsertSettings(
	db: D1Database,
	userId: string,
	category: string,
	data: string,
	updatedAt?: number,
): Promise<void> {
	const now = updatedAt ?? unixNowSeconds();
	await db
		.prepare(
			`INSERT INTO settings (user_id, category, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, category) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		)
		.bind(userId, category, data, now)
		.run();
}

export async function deleteSettings(
	db: D1Database,
	userId: string,
	category?: string,
): Promise<void> {
	if (category) {
		await db
			.prepare("DELETE FROM settings WHERE user_id = ? AND category = ?")
			.bind(userId, category)
			.run();
	} else {
		await db
			.prepare("DELETE FROM settings WHERE user_id = ?")
			.bind(userId)
			.run();
	}
}
