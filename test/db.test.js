import assert from "node:assert/strict";
import test from "node:test";
import {
	createUser,
	cleanupExpiredMagicLinkTokens,
	generateOTP,
	getUserBySessionToken,
	markMagicLinkTokenUsed,
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

test("markMagicLinkTokenUsed updates the token exactly once", async () => {
	let prepareCalls = 0;
	let updateSql = "";

	const db = {
		prepare(sql) {
			prepareCalls += 1;
			updateSql = sql;
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

	await markMagicLinkTokenUsed(db, "token_123");

	assert.equal(prepareCalls, 1);
	assert.match(updateSql, /UPDATE magic_link_tokens SET used = 1/);
});

test("cleanupExpiredMagicLinkTokens uses targeted deletes", async () => {
	const sqlCalls = [];
	let callIndex = 0;

	const db = {
		prepare(sql) {
			sqlCalls.push(sql);
			callIndex += 1;
			return {
				bind() {
					return this;
				},
				async run() {
					return { meta: { changes: callIndex } };
				},
			};
		},
	};

	const removed = await cleanupExpiredMagicLinkTokens(db);

	assert.equal(sqlCalls.length, 2);
	assert.match(
		sqlCalls[0],
		/DELETE FROM magic_link_tokens WHERE expires_at <= \?/,
	);
	assert.match(sqlCalls[1], /DELETE FROM magic_link_tokens WHERE used = 1/);
	assert.equal(removed, 3);
});
