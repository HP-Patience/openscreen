import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

for (const layout of ["horizontal", "vertical"] as const) {
	for (const action of ["keep", "switch"] as const) {
		test(`system language prompt fits and ${action} works in ${layout} HUD`, async () => {
			const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openscreen-language-prompt-"));
			const env = { ...process.env, HEADLESS: "true", ELECTRON_USER_DATA_DIR: profile };
			delete env.ELECTRON_RUN_AS_NODE;
			const executablePath = process.env.OPENSCREEN_TEST_EXECUTABLE;
			const app = await electron.launch({
				...(executablePath ? { executablePath } : {}),
				args: [
					...(executablePath ? [] : [ROOT]),
					`--user-data-dir=${profile}`,
					"--force-device-scale-factor=1.5",
				],
				env,
			});
			try {
				const page = await app.firstWindow();
				await page.locator("[data-tray-layout]").waitFor();
				await page.evaluate((trayLayout) => {
					localStorage.clear();
					localStorage.setItem("openscreen_user_preferences", JSON.stringify({ trayLayout }));
				}, layout);
				await page.addInitScript(() => {
					Object.defineProperty(navigator, "languages", { get: () => ["zh-CN"] });
					Object.defineProperty(navigator, "language", { get: () => "zh-CN" });
				});
				// Expansion near a display edge must not put the buttons off-screen.
				await app.evaluate(({ BrowserWindow, screen }) => {
					const win = BrowserWindow.getAllWindows()[0];
					const { workArea } = screen.getDisplayMatching(win.getBounds());
					win.setPosition(workArea.x, workArea.y);
				});
				await page.reload();
				// Hidden packaged windows may not paint frames for screenshots on Windows.
				await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
				const keep = page.getByRole("button", { name: "Keep current language", exact: true });
				const change = page.getByRole("button", { name: /Switch to/ });
				await expect(keep).toBeVisible();
				for (const button of [keep, change]) {
					await expect
						.poll(() =>
							button.evaluate((el) => {
								const r = el.getBoundingClientRect();
								return (
									r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
								);
							}),
						)
						.toBe(true);
				}
				const expandedHeight = await page.evaluate(() => innerHeight);
				const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
					const b = BrowserWindow.getAllWindows()[0].getBounds();
					return { b, w: screen.getDisplayMatching(b).workArea };
				});
				expect(bounds.b.x).toBeGreaterThanOrEqual(bounds.w.x - 1);
				expect(bounds.b.y).toBeGreaterThanOrEqual(bounds.w.y - 1);
				expect(bounds.b.x + bounds.b.width).toBeLessThanOrEqual(bounds.w.x + bounds.w.width + 1);
				expect(bounds.b.y + bounds.b.height).toBeLessThanOrEqual(bounds.w.y + bounds.w.height + 1);
				await page.screenshot({ path: test.info().outputPath("language-prompt.png") });
				// Real Playwright pointer clicks, not JS click() or force, catch clipping/overlap.
				await (action === "keep" ? keep : change).click();
				await expect(keep).toHaveCount(0);
				await expect
					.poll(() => page.evaluate(() => document.documentElement.lang))
					.toBe(action === "keep" ? "en" : "zh-CN");
				await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(expandedHeight - 40);
				await page.reload();
				await expect(page.locator("[data-tray-layout]")).toHaveAttribute(
					"data-tray-layout",
					layout,
				);
				await expect(keep).toHaveCount(0);
				await expect
					.poll(() =>
						page.evaluate(() => localStorage.getItem("openscreen-system-language-prompt-seen")),
					)
					.toBe("1");
			} finally {
				await app
					.evaluate(({ app }) => app.exit(0))
					.catch(() => {
						// Exiting can close the evaluation transport before it replies.
					});
				await app.close();
				fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			}
		});
	}
}
