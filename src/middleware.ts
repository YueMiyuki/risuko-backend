import type { Context, Next } from "hono";
import { getUserBySessionToken } from "./db";
import type { Env, Vars } from "./index";

export async function authMiddleware(
	c: Context<{ Bindings: Env; Variables: Vars }>,
	next: Next,
) {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Missing or invalid Authorization header" }, 401);
	}

	const token = authHeader.slice(7);
	const user = await getUserBySessionToken(c.env.DB, token);
	if (!user) {
		return c.json({ error: "Invalid or expired session" }, 401);
	}

	c.set("userId", user.id);
	c.set("user", user);
	c.set("sessionToken", token);
	await next();
}
