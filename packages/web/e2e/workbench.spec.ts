import { test, expect } from "@playwright/test";

/**
 * The critical-path e2e: open a workspace, confirm the collaborative editor
 * loads build.md over the WebSocket, run a build, and see the artifact. Plus a
 * two-client sync test. These cover the integration-seam regressions that
 * shipped past the unit suite (fetch binding, empty-body build, editor/CRDT
 * duplication, WS sync).
 */
test.describe("workbench", () => {
  test("open → editor loads → build → artifact appears", async ({ page }) => {
    await page.goto("/#/demo");

    // build.md arrives over the sync WebSocket and renders in the editor.
    const editor = page.getByTestId("editor");
    await expect(editor).toContainText("target: shout");

    // Regression: content is not duplicated (CRDT/StrictMode dup bug).
    const text = await editor.innerText();
    expect(text.match(/target: shout/g)?.length).toBe(1);

    // The DAG shows the target.
    await expect(page.locator(".target-node__name", { hasText: "shout" })).toBeVisible();

    // Build (this POST was the empty-JSON-body 500): a target badge turns Built.
    await page.getByRole("button", { name: /^build$/i }).click();
    await expect(page.locator(".status-badge", { hasText: "Built" })).toBeVisible({
      timeout: 30_000,
    });

    // Inspect the produced artifact.
    await page.locator(".target-node", { hasText: "shout" }).click();
    await expect(page.locator(".inspector__artifact")).toContainText("HELLO FROM MAKEDOWN");
  });

  test("live edits sync between two clients without duplicating", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await a.goto("/#/demo");
    await b.goto("/#/demo");
    await expect(a.getByTestId("editor")).toContainText("target: shout");
    await expect(b.getByTestId("editor")).toContainText("target: shout");

    // Type a marker in A; it must appear in B.
    await a.locator(".cm-content").click();
    await a.keyboard.type("MARKER-XYZ ");
    await expect(b.getByTestId("editor")).toContainText("MARKER-XYZ", { timeout: 15_000 });

    // And the original content stays single (no duplication on sync).
    const bText = await b.getByTestId("editor").innerText();
    expect(bText.match(/target: shout/g)?.length).toBe(1);

    await ctxA.close();
    await ctxB.close();
  });
});
