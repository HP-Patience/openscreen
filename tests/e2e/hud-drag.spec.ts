import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

// Run after npm run build-vite, or with VITE_DEV_SERVER_URL pointing to a dev server.
// Synthetic pointer input avoids moving the user's system cursor.
test("HUD dragging preserves size and follows fractional offsets in both layouts", async () => {
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openscreen-hud-drag-"));
	const env = { ...process.env, HEADLESS: "true", ELECTRON_USER_DATA_DIR: profile };
	delete env.ELECTRON_RUN_AS_NODE;
	const app = await electron.launch({ args: [ROOT, `--user-data-dir=${profile}`], env });
	try {
		const page = await app.firstWindow();
		const bar = page.locator("[data-tray-layout]");
		await bar.waitFor();
		await page.waitForTimeout(800);
		await page.evaluate(() => {
			[...document.querySelectorAll("button")]
				.find((b) => /Keep current language/.test(b.textContent ?? ""))
				?.click();
		});
		for (const layout of ["horizontal", "vertical"]) {
			if ((await bar.getAttribute("data-tray-layout")) !== layout) {
				await page.getByTestId("launch-tray-layout-button").click();
			}
			await expect(bar).toHaveAttribute("data-tray-layout", layout);
			await page.waitForTimeout(500);
			const initial = await app.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].getBounds(),
			);
			for (const [dx, dy] of [
				[120 / 1.05, 0],
				[-120 / 1.05, 60 / 1.05],
				[120 / 1.05, 0],
			]) {
				const grip = bar.locator(":scope > div").first();
				const box = (await grip.boundingBox())!;
				const before = await app.evaluate(({ BrowserWindow }) =>
					BrowserWindow.getAllWindows()[0].getBounds(),
				);
				await grip.evaluate((el) =>
					el.addEventListener(
						"pointerdown",
						(event) => {
							const pointer = event as PointerEvent;
							(el as HTMLElement).dataset.startX = String(pointer.screenX);
							(el as HTMLElement).dataset.startY = String(pointer.screenY);
						},
						{ once: true },
					),
				);
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
				await page.mouse.down();
				for (let step = 1; step <= 20; step++) {
					await grip.evaluate(
						(el, offset) => {
							el.dispatchEvent(
								new PointerEvent("pointermove", {
									bubbles: true,
									buttons: 1,
									pointerId: 1,
									screenX: Number((el as HTMLElement).dataset.startX) + offset.x,
									screenY: Number((el as HTMLElement).dataset.startY) + offset.y,
								}),
							);
						},
						{ x: (dx * step) / 20, y: (dy * step) / 20 },
					);
				}
				await expect
					.poll(async () => {
						const after = await app.evaluate(({ BrowserWindow }) =>
							BrowserWindow.getAllWindows()[0].getBounds(),
						);
						return Math.max(Math.abs(after.x - before.x - dx), Math.abs(after.y - before.y - dy));
					})
					.toBeLessThanOrEqual(2);
				await page.mouse.up();
				const after = await app.evaluate(({ BrowserWindow }) =>
					BrowserWindow.getAllWindows()[0].getBounds(),
				);
				const afterBox = (await grip.boundingBox())!;
				expect(Math.abs(after.width - initial.width)).toBeLessThanOrEqual(2);
				expect(Math.abs(after.height - initial.height)).toBeLessThanOrEqual(2);
				expect(Math.abs(afterBox.x - box.x)).toBeLessThanOrEqual(2);
				expect(Math.abs(afterBox.y - box.y)).toBeLessThanOrEqual(2);
			}
		}
	} finally {
		await app.close();
		fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
