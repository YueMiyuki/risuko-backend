import type { SendEmail } from "@cloudflare/workers-types";

interface SendEmailParams {
	emailBinding: SendEmail;
	to: string;
	from: string;
	subject: string;
	html: string;
}

interface EmailCopy {
	subject: string;
	greeting: string;
	magicLinkButton: string;
	otpLabel: string;
	footer: string;
}

const zhEmailCopy: EmailCopy = {
	subject: "你的 Risuko Sync 登录链接",
	greeting: "点击下方按钮立即登录：",
	magicLinkButton: "登录 Risuko",
	otpLabel: "或使用以下验证码：",
	footer: "该链接和验证码将在 10 分钟后过期。如非你本人操作，请忽略此邮件。",
};

const enEmailCopy: EmailCopy = {
	subject: "Your Risuko Sync login link",
	greeting: "Click the button below to sign in instantly:",
	magicLinkButton: "Sign in to Risuko",
	otpLabel: "Or use this verification code:",
	footer:
		"This link and code expire in 10 minutes. If you didn't request this, you can safely ignore this email.",
};

const emailCopy: Record<string, EmailCopy> = {
	"zh-CN": zhEmailCopy,
	zh: zhEmailCopy,
	"en-US": enEmailCopy,
	default: enEmailCopy,
};

function getEmailCopy(locale?: string): EmailCopy {
	if (!locale) {
		return emailCopy.default;
	}
	return (
		emailCopy[locale] || emailCopy[locale.split("-")[0]] || emailCopy.default
	);
}

export async function sendEmail({
	emailBinding,
	to,
	from,
	subject,
	html,
}: SendEmailParams): Promise<{ messageId?: string }> {
	try {
		const response = await emailBinding.send({
			to,
			from: { email: from, name: "Risuko Sync" },
			subject,
			html,
			text: subject,
		});
		return { messageId: response.messageId };
	} catch (err) {
		console.error("[Risuko] sendEmail failed:", err);
		throw err;
	}
}

export function buildMagicLinkEmail(
	code: string,
	magicLinkUrl: string,
	locale?: string,
): { subject: string; html: string } {
	const copy = getEmailCopy(locale);
	return {
		subject: copy.subject,
		html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a;">Risuko Sync</h2>
        <p style="color: #4a4a4a; font-size: 16px;">${copy.greeting}</p>
        <a href="${magicLinkUrl}" style="display: block; text-align: center; padding: 16px 24px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 8px; margin: 16px 0; font-weight: 500;">
          ${copy.magicLinkButton}
        </a>
        <p style="color: #4a4a4a; font-size: 14px;">${copy.otpLabel}</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 12px 0;">
          ${code}
        </div>
        <p style="color: #888; font-size: 14px;">${copy.footer}</p>
      </div>
    `,
	};
}
