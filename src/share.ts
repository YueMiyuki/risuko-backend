export interface ShareFileMeta {
	name: string;
	size: number;
}

interface ShareLandingCopy {
	title: string;
	sendingHeading: string;
	receivingHeading: string;
	deviceCodeLabel: string;
	openButton: string;
	openHint: string;
	filesLabel: string;
	noFilesYet: string;
	getAppLabel: string;
	getAppLink: string;
	footer: string;
}

const enCopy: ShareLandingCopy = {
	title: "Risuko file share",
	sendingHeading: "Someone wants to send you files",
	receivingHeading: "Someone is waiting to receive files",
	deviceCodeLabel: "Device code",
	openButton: "Open in Risuko",
	openHint:
		"Already have Risuko installed? Open it and use this device code, or tap the button above.",
	filesLabel: "Files",
	noFilesYet: "Files will be chosen by the other device.",
	getAppLabel: "Don't have Risuko yet? Download it",
	getAppLink: "https://risuko.app",
	footer: "Transfers are end-to-end encrypted and peer-to-peer.",
};

const zhCopy: ShareLandingCopy = {
	title: "Risuko 文件分享",
	sendingHeading: "有人想向你发送文件",
	receivingHeading: "有人正在等待接收文件",
	deviceCodeLabel: "设备码",
	openButton: "在 Risuko 中打开",
	openHint: "已经安装 Risuko？打开应用并输入此设备码，或点击上方按钮。",
	filesLabel: "文件",
	noFilesYet: "文件将由对方设备选择。",
	getAppLabel: "还没有 Risuko？立即下载",
	getAppLink: "https://risuko.app",
	footer: "传输全程端到端加密，点对点直连。",
};

function getCopy(locale?: string): ShareLandingCopy {
	if (!locale) {
		return enCopy;
	}
	if (locale === "zh" || locale.startsWith("zh-")) {
		return zhCopy;
	}
	return enCopy;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const value = bytes / 1024 ** exponent;
	return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function buildShareLandingPage(params: {
	shareId: string;
	deviceCode: string;
	direction: "send" | "receive";
	files: ShareFileMeta[];
	deepLinkScheme: string;
	locale?: string;
}): string {
	const copy = getCopy(params.locale);
	const heading =
		params.direction === "send" ? copy.sendingHeading : copy.receivingHeading;
	const deepLink = `${params.deepLinkScheme}://share/${encodeURIComponent(params.deviceCode)}`;

	const filesMarkup =
		params.files.length > 0
			? `<ul class="files">${params.files
					.map(
						(file) =>
							`<li><span class="file-name">${escapeHtml(file.name)}</span><span class="file-size">${escapeHtml(formatBytes(file.size))}</span></li>`,
					)
					.join("")}</ul>`
			: `<p class="muted">${escapeHtml(copy.noFilesYet)}</p>`;

	const directionLabel =
		params.direction === "send"
			? params.locale?.startsWith("zh")
				? "接收文件"
				: "Receive files"
			: params.locale?.startsWith("zh")
				? "发送文件"
				: "Send files";

	return `<!doctype html>
<html lang="${escapeHtml(params.locale ?? "en")}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<meta name="color-scheme" content="dark" />
<title>${escapeHtml(copy.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --background: oklch(0.07 0 0);
    --foreground: oklch(0.95 0 0);
    --card: oklch(0.1 0 0);
    --primary: oklch(0.7 0.16 260);
    --accent: oklch(0.7 0.18 300);
    --muted: oklch(0.12 0 0);
    --muted-foreground: oklch(0.6 0 0);
    --border: oklch(0.2 0 0);
    --radius: 0.625rem;
    --font-sans: "Inter", system-ui, -apple-system, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: var(--font-sans);
    background: var(--background);
    color: var(--foreground);
    line-height: 1.5;
  }

  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px 32px;
  }

  .sheet {
    width: 100%;
    max-width: 420px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    overflow: hidden;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .brand-mark {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--primary), var(--accent));
    flex-shrink: 0;
  }
  .brand-name {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .brand-sub {
    font-size: 12px;
    color: var(--muted-foreground);
    margin-top: 1px;
  }
  .direction {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--primary) 35%, var(--border));
    color: var(--primary);
    background: color-mix(in oklab, var(--primary) 10%, transparent);
  }

  .sheet-body {
    padding: 22px 18px 18px;
  }

  .heading {
    margin: 0 0 20px;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.35;
  }

  .code-block {
    margin-bottom: 14px;
  }
  .code-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted-foreground);
    margin-bottom: 8px;
  }
  .code-value {
    display: block;
    width: 100%;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: clamp(26px, 8vw, 34px);
    letter-spacing: 0.14em;
    text-align: center;
    padding: 18px 14px;
    border-radius: var(--radius);
    background: var(--background);
    border: 1px solid var(--border);
    color: var(--foreground);
    user-select: all;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 14px;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .btn-copy {
    background: var(--muted);
    border-color: var(--border);
    color: var(--foreground);
  }
  .btn-copy:hover { border-color: var(--muted-foreground); }
  .btn-copy.done {
    color: #28c840;
    border-color: color-mix(in oklab, #28c840 50%, var(--border));
  }
  .btn-open {
    background: var(--primary);
    color: oklch(0.98 0 0);
  }
  .btn-open:hover {
    background: color-mix(in oklab, var(--primary) 88%, white);
  }

  .hint {
    margin: 0 0 22px;
    font-size: 13px;
    color: var(--muted-foreground);
    line-height: 1.55;
  }

  .section {
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }
  .section-label {
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .files { list-style: none; padding: 0; margin: 0; }
  .files li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: baseline;
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .files li:last-child { border-bottom: 0; padding-bottom: 0; }
  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .file-size {
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }
  .muted {
    margin: 0;
    font-size: 13px;
    color: var(--muted-foreground);
  }

  .sheet-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    margin-top: 18px;
    padding: 14px 18px;
    border-top: 1px solid var(--border);
    background: var(--muted);
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .foot-note { margin: 0; max-width: 16rem; line-height: 1.45; }
  .get-app {
    color: var(--primary);
    text-decoration: none;
    font-weight: 600;
    white-space: nowrap;
  }
  .get-app:hover { text-decoration: underline; }

  @media (max-width: 380px) {
    .actions { grid-template-columns: 1fr; }
    .sheet-foot { flex-direction: column; align-items: flex-start; }
  }

  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
  }
</style>
</head>
<body>
  <div class="page">
    <main class="sheet">
      <header class="sheet-head">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <div class="brand-name">Risuko</div>
            <div class="brand-sub">${escapeHtml(copy.title)}</div>
          </div>
        </div>
        <span class="direction">${escapeHtml(directionLabel)}</span>
      </header>

      <div class="sheet-body">
        <h1 class="heading">${escapeHtml(heading)}</h1>

        <div class="code-block">
          <span class="code-label">${escapeHtml(copy.deviceCodeLabel)}</span>
          <code class="code-value" id="code">${escapeHtml(params.deviceCode)}</code>
        </div>

        <div class="actions">
          <button class="btn btn-copy" id="copy" type="button">${escapeHtml(params.locale?.startsWith("zh") ? "复制" : "Copy code")}</button>
          <a class="btn btn-open" href="${escapeHtml(deepLink)}">${escapeHtml(copy.openButton)}</a>
        </div>
        <p class="hint">${escapeHtml(copy.openHint)}</p>

        <section class="section" aria-labelledby="files-label">
          <h2 class="section-label" id="files-label">${escapeHtml(copy.filesLabel)}</h2>
          ${filesMarkup}
        </section>
      </div>

      <footer class="sheet-foot">
        <p class="foot-note">${escapeHtml(copy.footer)}</p>
        <a class="get-app" href="${escapeHtml(copy.getAppLink)}">${escapeHtml(copy.getAppLabel)}</a>
      </footer>
    </main>
  </div>
  <script>
    (function () {
      var code = ${JSON.stringify(params.deviceCode)};
      var btn = document.getElementById("copy");
      if (!btn) return;
      var copied = ${JSON.stringify(params.locale?.startsWith("zh") ? "已复制" : "Copied")};
      var label = ${JSON.stringify(params.locale?.startsWith("zh") ? "复制" : "Copy code")};
      btn.addEventListener("click", function () {
        var done = function () {
          btn.textContent = copied;
          btn.classList.add("done");
          setTimeout(function () {
            btn.textContent = label;
            btn.classList.remove("done");
          }, 1500);
        };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(done).catch(function () {
            var range = document.createRange();
            range.selectNodeContents(document.getElementById("code"));
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            done();
          });
        }
      });
    })();
  </script>
</body>
</html>`;
}
