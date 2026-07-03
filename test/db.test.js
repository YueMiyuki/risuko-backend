import assert from "node:assert/strict";
import test from "node:test";
import {
	cleanupExpired,
	consumeMagicLinkTokenByEmailAndCode,
	createShareSession,
	createUser,
	generateDeviceCode,
	generateOTP,
	getUserBySessionToken,
	resolveShareSessionById,
} from "../src/db.ts";

test("generateOTP does not depend on Math.random", () => {
	const originalRandom = Math.random;
	Math.random = () => {
		throw new Error("Math.random should not be called");
	};

	try {
		const code = generateOTP();
		assert.match(code, /^\d{6}$/);
	} finally {
		Math.random = originalRandom;
	}
});

test("createUser returns the inserted row without a follow-up read", async () => {
	const originalNow = Date.now;
	Date.now = () => 1_700_000_000_000;

	let prepareCalls = 0;
	const db = {
		prepare(sql) {
			prepareCalls += 1;
			assert.equal(prepareCalls, 1, `unexpected extra query: ${sql}`);
			return {
				bind() {
					return this;
				},
				async run() {
					return { meta: { changes: 1 } };
				},
			};
		},
	};

	try {
		const user = await createUser(db, { email: "hello@example.com" });
		assert.equal(prepareCalls, 1);
		assert.deepEqual(user, {
			id: user.id,
			email: "hello@example.com",
			github_id: null,
			github_username: null,
			created_at: 1_700_000_000,
		});
	} finally {
		Date.now = originalNow;
	}
});

test("getUserBySessionToken uses one joined lookup", async () => {
	let prepareCalls = 0;
	let capturedSql = "";

	const db = {
		prepare(sql) {
			prepareCalls += 1;
			capturedSql = sql;
			return {
				bind() {
					return this;
				},
				async first() {
					return {
						id: "user_123",
						email: "hello@example.com",
						github_id: null,
						github_username: null,
						created_at: 1_700_000_000,
					};
				},
			};
		},
	};

	const user = await getUserBySessionToken(db, "session_token");

	assert.equal(prepareCalls, 1);
	assert.match(capturedSql, /JOIN users/i);
	assert.deepEqual(user, {
		id: "user_123",
		email: "hello@example.com",
		github_id: null,
		github_username: null,
		created_at: 1_700_000_000,
	});
});

test("consumeMagicLinkTokenByEmailAndCode validates and marks used in one statement", async () => {
	let prepareCalls = 0;
	let sql = "";

	const db = {
		prepare(q) {
			prepareCalls += 1;
			sql = q;
			return {
				bind() {
					return this;
				},
				async first() {
					return {
						id: "tok_1",
						email: "a@b.com",
						code: "123456",
						expires_at: 1,
						used: 1,
						created_at: 1,
					};
				},
			};
		},
	};

	const row = await consumeMagicLinkTokenByEmailAndCode(
		db,
		"A@B.com",
		"123456",
	);

	assert.equal(prepareCalls, 1);
	assert.match(sql, /UPDATE magic_link_tokens/);
	assert.match(sql, /RETURNING/);
	assert.equal(row.id, "tok_1");
});

test("cleanupExpired batches all deletes into one round trip", async () => {
	const sqlCalls = [];
	let batchCalls = 0;

	const db = {
		prepare(q) {
			return {
				bind() {
					sqlCalls.push(q);
					return this;
				},
			};
		},
		async batch(statements) {
			batchCalls += 1;
			assert.equal(statements.length, 3);
			return [
				{ meta: { changes: 1 } },
				{ meta: { changes: 2 } },
				{ meta: { changes: 3 } },
			];
		},
	};

	const counts = await cleanupExpired(db);

	assert.equal(batchCalls, 1);
	assert.match(
		sqlCalls[0],
		/DELETE FROM magic_link_tokens WHERE expires_at <= \? OR used = 1/,
	);
	assert.deepEqual(counts, {
		magicLinkTokens: 1,
		sessions: 2,
		shareSessions: 3,
	});
});

test("generateDeviceCode produces unambiguous fixed-length codes", () => {
	const code = generateDeviceCode(8);
	assert.equal(code.length, 8);
	// Crockford base32 alphabet excludes I, L, O, U and lowercase.
	assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
});

test("createShareSession inserts once and returns the row", async () => {
	const originalNow = Date.now;
	Date.now = () => 1_700_000_000_000;

	let prepareCalls = 0;
	let insertSql = "";
	const db = {
		prepare(sql) {
			prepareCalls += 1;
			insertSql = sql;
			return {
				bind() {
					return this;
				},
				async run() {
					return { meta: { changes: 1 } };
				},
			};
		},
	};

	try {
		const session = await createShareSession(db, {
			ticket: "blob-ticket",
			fileMeta: JSON.stringify([{ name: "a.bin", size: 10 }]),
			userId: null,
			expiresAt: 1_700_003_600,
		});
		assert.equal(prepareCalls, 1);
		assert.match(insertSql, /INSERT INTO share_sessions/);
		assert.equal(session.direction, "send");
		assert.equal(session.ticket, "blob-ticket");
		assert.equal(session.expires_at, 1_700_003_600);
		assert.equal(session.created_at, 1_700_000_000);
		assert.match(session.device_code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
	} finally {
		Date.now = originalNow;
	}
});

test("createShareSession retries on a device-code collision", async () => {
	let runCalls = 0;
	const db = {
		prepare() {
			return {
				bind() {
					return this;
				},
				async run() {
					runCalls += 1;
					if (runCalls === 1) {
						throw new Error(
							"UNIQUE constraint failed: share_sessions.device_code",
						);
					}
					return { meta: { changes: 1 } };
				},
			};
		},
	};

	const session = await createShareSession(db, {
		ticket: "blob-ticket",
		expiresAt: 1_700_003_600,
	});
	assert.equal(runCalls, 2);
	assert.equal(session.direction, "send");
	assert.equal(session.ticket, "blob-ticket");
});

test("resolveShareSessionById consumes send sessions for non-owners by device code", async () => {
	const session = {
		id: "share_send",
		device_code: "ABCD1234",
		direction: "send",
		ticket: "blob-ticket",
		file_meta: null,
		user_id: "owner",
		expires_at: 1_700_003_600,
		created_at: 1_700_000_000,
	};
	let deleteSql = "";
	const db = {
		prepare(sql) {
			if (/DELETE FROM share_sessions/.test(sql)) {
				deleteSql = sql;
				return {
					bind() {
						return this;
					},
					async first() {
						return session;
					},
				};
			}
			throw new Error(`unexpected query: ${sql}`);
		},
	};

	const resolved = await resolveShareSessionById(db, "abcd1234", "peer");
	assert.equal(resolved?.id, "share_send");
	assert.match(deleteSql, /device_code = \?/);
	assert.match(deleteSql, /user_id != \?/);
});

test("resolveShareSessionById falls back to a plain read for the owner", async () => {
	const session = {
		id: "share_send",
		device_code: "WXYZ5678",
		direction: "send",
		ticket: "blob-ticket",
		file_meta: null,
		user_id: "owner",
		expires_at: 1_700_003_600,
		created_at: 1_700_000_000,
	};
	let prepareCalls = 0;
	const db = {
		prepare(sql) {
			prepareCalls += 1;
			return {
				bind() {
					return this;
				},
				async first() {
					if (/DELETE FROM share_sessions/.test(sql)) {
						return null;
					}
					if (/SELECT/.test(sql)) {
						return session;
					}
					return null;
				},
			};
		},
	};

	const resolved = await resolveShareSessionById(db, "share_send", "owner");
	assert.equal(resolved?.id, "share_send");
	assert.equal(prepareCalls, 2);
});
