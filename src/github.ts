interface GitHubTokenResponse {
	access_token: string;
	token_type: string;
	scope: string;
}

interface GitHubUserResponse {
	id: number;
	login: string;
	email: string | null;
}

export async function exchangeGithubCode(
	code: string,
	clientId: string,
	clientSecret: string,
	redirectUri: string,
): Promise<GitHubTokenResponse | null> {
	const response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: redirectUri,
		}),
	});

	if (!response.ok) {
		console.error(
			"[Risuko] GitHub token exchange HTTP error:",
			response.status,
			await response.text(),
		);
		return null;
	}
	const result = (await response.json()) as GitHubTokenResponse;
	if (!result.access_token) {
		console.error(
			"[Risuko] GitHub token exchange returned no access_token:",
			result,
		);
		return null;
	}
	return result;
}

export async function getGithubUser(
	accessToken: string,
): Promise<GitHubUserResponse | null> {
	const response = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "RisukoSync",
		},
	});

	if (!response.ok) {
		const body = await response.text();
		console.error(
			"[Risuko] GitHub user fetch HTTP error:",
			response.status,
			body,
		);
		return null;
	}
	return (await response.json()) as GitHubUserResponse;
}

export function buildGithubAuthURL(
	clientId: string,
	redirectUri: string,
): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: "read:user user:email",
		response_type: "code",
	});
	return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
