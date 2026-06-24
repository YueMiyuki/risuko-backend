const CACHE_URL_BASE = "https://risuko-sync.internal/cache/";

/**
 * Returns true if the key is still in cooldown (i.e. was seen recently).
 * If not in cooldown, marks it as seen for `ttlSeconds`.
 */
export async function checkCooldown(
	key: string,
	ttlSeconds: number,
): Promise<boolean> {
	const cacheUrl = new URL(`${CACHE_URL_BASE}${encodeURIComponent(key)}`);
	const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
	const cache = caches.default;

	const cached = await cache.match(cacheKey);
	if (cached) {
		return true; // still in cooldown
	}

	// Set cooldown marker with TTL via s-maxage (what the CDN cache respects)
	const response = new Response("1", {
		headers: {
			"Cache-Control": `s-maxage=${ttlSeconds}`,
			"Content-Type": "text/plain",
		},
	});
	await cache.put(cacheKey, response);
	return false;
}
