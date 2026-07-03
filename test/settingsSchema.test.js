import assert from "node:assert/strict";
import test from "node:test";
import {
	SETTINGS_SCHEMA,
	validateSettingsWrite,
} from "../src/settingsSchema.ts";

test("accepts a valid download category payload", () => {
	assert.equal(
		validateSettingsWrite("download", {
			dir: "/home/user/Downloads",
			"auto-file-renaming": true,
			"max-overall-download-limit": "5M",
			split: 8,
			continue: "true",
		}),
		null,
	);
});

test("accepts an empty data object", () => {
	assert.equal(validateSettingsWrite("appearance", {}), null);
});

test("rejects an unknown category", () => {
	assert.match(validateSettingsWrite("warez-stash", {}), /unknown/);
});

test("rejects a non-string category", () => {
	assert.match(validateSettingsWrite(42, {}), /string/);
});

test("rejects non-object data", () => {
	assert.match(validateSettingsWrite("download", "blob"), /object/);
	assert.match(validateSettingsWrite("download", ["a"]), /object/);
	assert.match(validateSettingsWrite("download", null), /object/);
});

test("rejects keys outside the category whitelist", () => {
	assert.match(
		validateSettingsWrite("download", { "my-movie-collection": "..." }),
		/not allowed/,
	);
	assert.match(
		validateSettingsWrite("appearance", { dir: "/tmp" }),
		/not allowed/,
	);
});

test("rejects wrong value types", () => {
	assert.match(
		validateSettingsWrite("download", { "auto-file-renaming": { evil: 1 } }),
		/invalid value type/,
	);
	assert.match(
		validateSettingsWrite("download", { split: [1, 2, 3] }),
		/invalid value type/,
	);
});

test("rejects oversized strings", () => {
	assert.match(
		validateSettingsWrite("download", { dir: "x".repeat(2000) }),
		/invalid value type/,
	);
});

test("scalar options accept the string forms the app emits", () => {
	assert.equal(
		validateSettingsWrite("download", {
			"run-mode": "0",
			"seed-ratio": 1.5,
			"follow-torrent": "mem",
		}),
		null,
	);
});

test("proxy object rejects unknown fields and bad shapes", () => {
	assert.equal(
		validateSettingsWrite("network", {
			proxy: {
				enable: true,
				server: "http://127.0.0.1:8080",
				scope: ["download"],
			},
		}),
		null,
	);
	assert.match(
		validateSettingsWrite("network", { proxy: { smuggled: "data" } }),
		/invalid value type/,
	);
	assert.match(
		validateSettingsWrite("network", { proxy: "not-an-object" }),
		/invalid value type/,
	);
});

test("task routing rules enforce the rule shape", () => {
	assert.equal(
		validateSettingsWrite("task-routing", {
			"task-routing-rules": [
				{
					id: "a",
					label: "ISO",
					pattern: "*.iso",
					dir: "/data",
					enabled: true,
				},
			],
		}),
		null,
	);
	assert.match(
		validateSettingsWrite("task-routing", {
			"task-routing-rules": [{ id: "a", payload: { nested: true } }],
		}),
		/invalid value type/,
	);
});

test("saved credentials must be flat scalar objects", () => {
	assert.equal(
		validateSettingsWrite("credentials", {
			"saved-credentials": [
				{ id: "c1", host: "ftp.example.com", ftpUser: "u", createdAt: 1 },
			],
		}),
		null,
	);
	assert.match(
		validateSettingsWrite("credentials", {
			"saved-credentials": [{ id: "c1", blob: { nested: "storage" } }],
		}),
		/invalid value type/,
	);
});

test("protocols is a flat record", () => {
	assert.equal(
		validateSettingsWrite("protocols", {
			protocols: { magnet: true, thunder: "false" },
		}),
		null,
	);
	assert.match(
		validateSettingsWrite("protocols", {
			protocols: { magnet: { deep: true } },
		}),
		/invalid value type/,
	);
});

test("every category has at least one key", () => {
	for (const [category, keys] of Object.entries(SETTINGS_SCHEMA)) {
		assert.ok(Object.keys(keys).length > 0, `empty category ${category}`);
	}
});
