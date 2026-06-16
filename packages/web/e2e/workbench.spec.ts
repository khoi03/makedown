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

  test("share → public link renders the artifact read-only → revoke 404s", async ({ page, context }) => {
    await page.goto("/#/demo");
    await expect(page.getByTestId("editor")).toContainText("target: shout");

    // Build, then open the artifact inspector. Asserting on the artifact (not a
    // "Built" badge) keeps this order-independent: the target may already be
    // built and reused if an earlier test produced it against the same server.
    await page.getByRole("button", { name: /^build$/i }).click();
    await page.locator(".target-node", { hasText: "shout" }).click();
    await expect(page.locator(".inspector__artifact")).toContainText("HELLO FROM MAKEDOWN", {
      timeout: 30_000,
    });

    // Mint a public link and read it out of the one-time input.
    await page.getByRole("button", { name: "Create link" }).click();
    const link = page.getByLabel("Share link");
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    expect(url).toMatch(/\/s\/.+/);

    // A fresh tab (no app state) opens the link and sees the rendered artifact
    // with no editor — a true public, read-only view.
    const viewer = await context.newPage();
    await viewer.goto(url);
    await expect(viewer.locator("body")).toContainText("HELLO FROM MAKEDOWN");
    await expect(viewer.locator(".cm-content")).toHaveCount(0);

    // Revoke from the workbench; the link then 404s.
    await page.getByRole("button", { name: "Revoke" }).click();
    await viewer.goto(url);
    await expect(viewer.locator("body")).toContainText(/not found/i);
    await viewer.close();
  });

  test("files sidebar lists sources and opens one in the editor", async ({ page }) => {
    await page.goto("/#/demo");

    // build.md loads in the editor and is the active file.
    await expect(page.getByTestId("editor")).toContainText("target: shout");
    await expect(page.getByTestId("active-file")).toHaveText("build.md");

    // The Files sidebar lists the workspace source declared in build.md.
    const noteItem = page.getByRole("button", { name: "sources/note.md" });
    await expect(noteItem).toBeVisible();

    // Opening it swaps the editor to the source content and marks it active.
    await noteItem.click();
    await expect(page.getByTestId("active-file")).toHaveText("sources/note.md");
    await expect(noteItem).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("editor")).toContainText("hello from makedown");

    // Switching back to build.md works.
    await page.getByRole("button", { name: "build.md", exact: true }).click();
    await expect(page.getByTestId("active-file")).toHaveText("build.md");
    await expect(page.getByTestId("editor")).toContainText("target: shout");
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
