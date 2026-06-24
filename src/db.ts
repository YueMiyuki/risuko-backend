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

export async function getMagicLinkTokenByToken(
	db: D1Database,
	magicToken: string,
): Promise<MagicLinkTokenRow | null> {
	const result = await db
		.prepare(
			`SELECT ${MAGIC_LINK_TOKEN_COLUMNS}
			 FROM magic_link_tokens
			 WHERE magic_token = ? AND used = 0 AND expires_at > ?
			 ORDER BY created_at DESC
			 LIMIT 1`,
		)
		.bind(magicToken, unixNowSeconds())
		.first<MagicLinkTokenRow>();
	return result ?? null;
}

export async function getMagicLinkTokenByEmailAndCode(
	db: D1Database,
	email: string,
	code: string,
): Promise<MagicLinkTokenRow | null> {
	const result = await db
		.prepare(
			`SELECT ${MAGIC_LINK_TOKEN_COLUMNS}
			 FROM magic_link_tokens
			 WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
			 ORDER BY created_at DESC
			 LIMIT 1`,
		)
		.bind(email.toLowerCase(), code, unixNowSeconds())
		.first<MagicLinkTokenRow>();
	return result ?? null;
}

export async function markMagicLinkTokenUsed(
	db: D1Database,
	id: string,
): Promise<boolean> {
	const result = await db
		.prepare("UPDATE magic_link_tokens SET used = 1 WHERE id = ? AND used = 0")
		.bind(id)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

export async function cleanupExpiredMagicLinkTokens(
	db: D1Database,
): Promise<number> {
	const expiredResult = await db
		.prepare("DELETE FROM magic_link_tokens WHERE expires_at <= ?")
		.bind(unixNowSeconds())
		.run();
	const usedResult = await db
		.prepare("DELETE FROM magic_link_tokens WHERE used = 1")
		.run();
	return (expiredResult.meta?.changes ?? 0) + (usedResult.meta?.changes ?? 0);
}

export async function cleanupExpiredSessions(db: D1Database): Promise<number> {
	const result = await db
		.prepare("DELETE FROM sessions WHERE expires_at <= ?")
		.bind(unixNowSeconds())
		.run();
	return result.meta?.changes ?? 0;
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
	return (
		(await getUserByEmail(db, normalizedEmail)) ??
		createUser(db, { email: normalizedEmail })
	);
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
