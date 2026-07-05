type Validator = (value: unknown) => boolean;

const bool: Validator = (v) =>
	typeof v === "boolean" ||
	v === 0 ||
	v === 1 ||
	v === "true" ||
	v === "false" ||
	v === "0" ||
	v === "1";

const str =
	(maxLen: number): Validator =>
	(v) =>
		typeof v === "string" && v.length <= maxLen;

const scalar =
	(maxLen = 32): Validator =>
	(v) =>
		typeof v === "boolean" ||
		(typeof v === "number" && Number.isFinite(v)) ||
		(typeof v === "string" && v.length <= maxLen);

const strArr =
	(maxItems: number, itemLen: number): Validator =>
	(v) =>
		Array.isArray(v) &&
		v.length <= maxItems &&
		v.every((item) => typeof item === "string" && item.length <= itemLen);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const flatRecord =
	(maxKeys: number, keyLen: number, valueLen: number): Validator =>
	(v) => {
		if (!isPlainObject(v)) {
			return false;
		}
		const entries = Object.entries(v);
		return (
			entries.length <= maxKeys &&
			entries.every(
				([key, value]) =>
					key.length <= keyLen && (value === null || scalar(valueLen)(value)),
			)
		);
	};

const jsonObject =
	(maxBytes: number): Validator =>
	(v) => {
		if (!isPlainObject(v)) {
			return false;
		}
		return JSON.stringify(v).length <= maxBytes;
	};

const shape =
	(fields: Record<string, Validator>): Validator =>
	(v) => {
		if (!isPlainObject(v)) {
			return false;
		}
		return Object.entries(v).every(([key, value]) => {
			const check = fields[key];
			return check !== undefined && (value === undefined || check(value));
		});
	};

const arrayOf =
	(maxItems: number, item: Validator): Validator =>
	(v) =>
		Array.isArray(v) && v.length <= maxItems && v.every(item);

const proxy = shape({
	enable: bool,
	server: str(2048),
	bypass: str(4096),
	scope: strArr(8, 32),
});

const taskRoutingRule = shape({
	id: str(64),
	label: str(256),
	pattern: str(1024),
	dir: str(1024),
	enabled: bool,
});

const savedCredential: Validator = (v) => {
	if (!isPlainObject(v)) {
		return false;
	}
	const entries = Object.entries(v);
	return (
		entries.length <= 24 &&
		entries.every(([key, value]) => key.length <= 64 && scalar(32768)(value))
	);
};

export const SETTINGS_SCHEMA: Record<string, Record<string, Validator>> = {
	appearance: {
		theme: str(32),
		"font-family": str(32),
		"font-size": str(32),
		"hide-app-menu": bool,
		"tray-speedometer": bool,
		"show-progress-bar": bool,
		"task-list-style": str(16),
		"sidebar-collapsed": bool,
	},
	language: {
		locale: str(16),
	},
	network: {
		proxy,
		"all-proxy": str(2048),
		cookie: str(16384),
	},
	tracker: {
		"auto-sync-tracker": bool,
		"tracker-source": strArr(64, 2048),
		"last-sync-tracker-time": scalar(32),
		"bt-tracker": str(65536),
	},
	directories: {
		"favorite-directories": strArr(16, 1024),
		"history-directories": strArr(16, 1024),
		"file-category-dirs": flatRecord(32, 64, 1024),
	},
	download: {
		"run-mode": scalar(16),
		"keep-seeding": bool,
		"new-task-show-downloading": bool,
		"auto-retry": bool,
		"auto-retry-interval": scalar(32),
		"auto-retry-strategy": str(16),
		"no-confirm-before-delete-task": bool,
		"resume-all-when-app-launched": bool,
		"use-remote-file-time": bool,
		"keep-window-state": bool,
		"auto-hide-window": bool,
		dir: str(1024),
		"auto-file-renaming": bool,
		continue: bool,
		"connect-timeout": scalar(32),
		"file-allocation": str(16),
		"max-concurrent-downloads": scalar(32),
		"max-download-limit": scalar(32),
		"max-overall-download-limit": scalar(32),
		"max-overall-upload-limit": scalar(32),
		"engine-mode": str(8),
		"max-worker-retries": scalar(32),
		"netrc-path": str(1024),
		"no-netrc": bool,
		"no-proxy": str(4096),
		out: str(1024),
		referer: str(4096),
		"remote-time": bool,
		"seed-ratio": scalar(32),
		"seed-time": scalar(32),
		split: scalar(32),
		"uri-selector": str(32),
		"user-agent": str(1024),
		"follow-torrent": scalar(16),
		header: str(8192),
		"load-cookies": str(1024),
		"bt-create-subfolder": bool,
	},
	media: {
		"media-format": str(256),
		"youtube-format": str(256),
		"m3u8-output-format": str(16),
	},
	rss: {
		"rss-auto-update": bool,
		"rss-update-interval": scalar(32),
	},
	stats: {
		version: scalar(16),
		baselines: jsonObject(1024 * 1024),
		monthly: jsonObject(1024 * 1024),
		speed: jsonObject(1024 * 1024),
	},
	"task-routing": {
		"task-routing-rules": arrayOf(64, taskRoutingRule),
	},
	notifications: {
		"task-notification": bool,
		"completion-script-enabled": bool,
		"completion-script-command": str(2048),
		"completion-script-args": str(4096),
		"completion-script-timeout-ms": scalar(32),
	},
	"low-speed": {
		"auto-detect-low-speed-tasks": bool,
		"low-speed-threshold": scalar(32),
		"lowest-speed-limit": scalar(32),
		"lowest-speed-limit-timeout": scalar(32),
	},
	system: {
		"open-at-login": bool,
		"prevent-sleep-while-downloading": bool,
		"purge-record-on-start": bool,
		"shutdown-when-complete": bool,
		"auto-check-update": bool,
		"last-check-update-time": scalar(32),
	},
	engine: {
		"external-engine-enabled": bool,
		"external-engine-host": str(256),
		"external-engine-port": scalar(32),
		"external-engine-secret": str(512),
		"engine-overrides": flatRecord(64, 64, 2048),
		"rpc-listen-port": scalar(32),
		"rpc-secret": str(512),
	},
	dns: {
		"doh-enable": bool,
		"doh-url": str(1024),
		"doh-bootstrap": str(1024),
		"doh-fallback": bool,
		"doh-provider": str(32),
	},
	protocols: {
		protocols: flatRecord(16, 32, 8),
	},
	logs: {
		"log-dir-override": str(1024),
		"log-level": str(16),
	},
	credentials: {
		"saved-credentials": arrayOf(50, savedCredential),
	},
	bittorrent: {
		"bt-enable-lpd": bool,
		"bt-exclude-tracker": str(65536),
		"bt-force-encryption": bool,
		"bt-load-saved-metadata": bool,
		"bt-save-metadata": bool,
		"bt-max-peers-per-torrent": scalar(32),
		"bt-max-outstanding-per-peer": scalar(32),
		"bt-enable-upnp": bool,
		"bt-upnp-lease": scalar(32),
		"bt-enable-lsd": bool,
		"bt-encryption-policy": str(16),
		"bt-listen-v6": bool,
		"enable-dht": bool,
		"enable-dht6": bool,
		"enable-peer-exchange": bool,
		"dht-listen-port": scalar(32),
	},
	ports: {
		"listen-port": scalar(32),
		"ed2k-port": scalar(32),
	},
	ftp: {
		"ftp-passwd": str(512),
		"ftp-user": str(256),
		"sftp-passwd": str(512),
		"sftp-private-key": str(32768),
		"sftp-private-key-passphrase": str(512),
		"sftp-user": str(256),
	},
	"g2-gnutella": {
		"gnutella-cache": str(4096),
		"g2-cache": str(4096),
		"gift-enabled": bool,
		"gift-host": str(256),
		"gift-port": scalar(32),
		"adc-hub": str(1024),
		"adc-nick": str(256),
		"ed2k-server": str(4096),
	},
};

// Catch-all category: accepts any key (size/shape-bounded) so newly added
// client settings sync without a schema edit here. Values are capped, not
// key-checked — a sensitive new setting should get its own named category.
export const MISC_CATEGORY = "misc";

const miscValue: Validator = (v) =>
	v === null ||
	scalar(8192)(v) ||
	strArr(512, 256)(v) ||
	flatRecord(128, 64, 8192)(v);

function validateMiscWrite(data: Record<string, unknown>): string | null {
	const entries = Object.entries(data);
	if (entries.length > 256) {
		return "too many keys in misc category";
	}
	for (const [key, value] of entries) {
		if (key.length > 64) {
			return `key "${key.slice(0, 64)}" is too long in misc category`;
		}
		if (value !== undefined && !miscValue(value)) {
			return `invalid value for key "${key}" in misc category`;
		}
	}
	return null;
}

export function validateSettingsWrite(
	category: unknown,
	data: unknown,
): string | null {
	if (typeof category !== "string") {
		return "category must be a string";
	}
	if (!isPlainObject(data)) {
		return "data must be an object";
	}
	if (category === MISC_CATEGORY) {
		return validateMiscWrite(data);
	}
	const keySchema = SETTINGS_SCHEMA[category];
	if (!keySchema) {
		return `unknown settings category "${category.slice(0, 64)}"`;
	}
	for (const [key, value] of Object.entries(data)) {
		const check = keySchema[key];
		if (!check) {
			return `key "${key.slice(0, 64)}" is not allowed in category "${category}"`;
		}
		if (!check(value)) {
			return `invalid value type for key "${key}" in category "${category}"`;
		}
	}
	return null;
}
