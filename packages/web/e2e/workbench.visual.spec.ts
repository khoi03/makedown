import { test, expect, type Page } from "@playwright/test";

/**
 * Visual-regression coverage for the workbench chrome. These complement the
 * behavioural e2e in workbench.spec.ts: they assert the UI *looks* right, catching
 * styling/layout regressions the functional assertions can't see. They run on the
 * key-free `demo` fixture (deterministic `transform`), so no model/key is involved.
 *
 * Determinism: a fixed viewport, animations disabled (config), the editor caret
 * hidden, and the genuinely-dynamic toolbar bits (sync status, branch name from
 * git, live presence) masked. Baselines are platform-specific — regenerate with
 * `pnpm exec playwright test workbench.visual --update-snapshots` on one host.
 */
test.use({ viewport: { width: 1280, height: 800 } });

/** Toolbar regions whose content is environment- or time-dependent. */
const dynamicChrome = (page: Page) => [
  page.locator(".toolbar__conn"),
  page.locator(".toolbar__branch"),
  page.locator(".presence"),
];

/** Open the demo workspace and wait until it has deterministically settled. */
async function openSettledWorkbench(page: Page): Promise<void> {
  await page.goto("/#/demo");
  // build.md has arrived over the sync WS and rendered.
  await expect(page.getByTestId("editor")).toContainText("target: shout");
  // The sync connection has reached its steady state (avoids a "connecting" flash).
  await expect(page.locator('.toolbar__conn[data-status="connected"]')).toBeVisible();
  // The DAG node is painted.
  await expect(page.locator(".target-node__name", { hasText: "shout" })).toBeVisible();
  // Belt-and-suspenders over the config: kill the CodeMirror caret + any motion.
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .cm-cursor, .cm-cursor-primary, .cm-dropCursor { visibility: hidden !important; }
    `,
  });
}

test.describe("workbench visual regression", () => {
  test("workspace picker", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /demo/i }).first()).toBeVisible();
    await expect(page).toHaveScreenshot("picker.png", { fullPage: true });
  });

  test("workbench — graph, editor, inspector", async ({ page }) => {
    await openSettledWorkbench(page);
    await expect(page).toHaveScreenshot("workbench.png", {
      fullPage: true,
      mask: dynamicChrome(page),
    });
  });

  test("editor showing a source file", async ({ page }) => {
    await openSettledWorkbench(page);
    await page.getByRole("button", { name: "sources/note.md" }).click();
    await expect(page.getByTestId("active-file")).toHaveText("sources/note.md");
    await expect(page.getByTestId("editor")).toContainText("hello from makedown");
    // The panes only — excludes the dynamic toolbar entirely.
    await expect(page.locator(".workbench__panes")).toHaveScreenshot("editor-source.png");
  });

  test("inspector — built artifact", async ({ page }) => {
    await openSettledWorkbench(page);
    await page.getByRole("button", { name: /^build$/i }).click();
    // Wait for the build to reach a terminal state before selecting, so the
    // artifact fetch isn't raced against the in-flight build. The badge reads
    // "Built" on a fresh run and "Reused" when the artifact is already cached
    // (server is reused across tests), so accept either.
    await expect(
      page.locator('.status-badge[data-status="built"], .status-badge[data-status="reused"]'),
    ).toBeVisible({ timeout: 30_000 });
    await page.locator(".target-node", { hasText: "shout" }).click();
    // Artifact content is deterministic (the transform output); scope to the
    // inspector so async provenance timestamps never enter the frame.
    await expect(page.locator(".inspector__artifact")).toContainText("HELLO FROM MAKEDOWN");
    await expect(page.locator(".inspector")).toHaveScreenshot("inspector-artifact.png");
  });

  test("inspector — cost estimate", async ({ page }) => {
    await openSettledWorkbench(page);
    await page.locator(".target-node", { hasText: "shout" }).click();
    await page.getByRole("tab", { name: "Cost" }).click();
    // Deterministic $/token figures for the key-free transform workspace.
    await expect(page.locator(".cost__total")).toBeVisible();
    await expect(page.locator(".inspector")).toHaveScreenshot("inspector-cost.png");
  });
});
