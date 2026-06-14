import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SharePanel } from "./SharePanel.js";
import type { ApiClient, CreatedShare, ShareSummary } from "../../lib/api.js";

/**
 * The panel mints a link (token shown once → prominent copy), lists live shares
 * with revoke, and surfaces a permission error rather than failing silently.
 */
function fakeApi(over: Partial<ApiClient>): ApiClient {
  return {
    listShares: vi.fn().mockResolvedValue([] as ShareSummary[]),
    createShare: vi.fn(),
    revokeShare: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ApiClient;
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("SharePanel", () => {
  it("creates a link and reveals the absolute URL once", async () => {
    const created: CreatedShare = { id: "s1", token: "tok-123", path: "/s/tok-123", expiresAt: null };
    const api = fakeApi({
      createShare: vi.fn().mockResolvedValue(created),
      listShares: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue([
          { id: "s1", target: "summary", includeProvenance: false, createdAt: "2026-06-13T00:00:00Z", expiresAt: null, revoked: false },
        ]),
    });
    render(<SharePanel api={api} workspaceId="w1" target="summary" />);

    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));

    const link = await screen.findByLabelText<HTMLInputElement>("Share link");
    expect(link.value).toBe(`${window.location.origin}/s/tok-123`);
    expect(api.createShare).toHaveBeenCalledWith("w1", "summary", { includeProvenance: false });
  });

  it("passes the provenance preference when checked", async () => {
    const api = fakeApi({
      createShare: vi.fn().mockResolvedValue({ id: "s2", token: "t", path: "/s/t", expiresAt: null }),
    });
    render(<SharePanel api={api} workspaceId="w1" target="report" />);

    fireEvent.click(screen.getByLabelText("Include provenance"));
    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));

    await waitFor(() =>
      expect(api.createShare).toHaveBeenCalledWith("w1", "report", { includeProvenance: true }),
    );
  });

  it("lists existing live shares and revokes one", async () => {
    const list: ShareSummary[] = [
      { id: "s9", target: "summary", includeProvenance: true, createdAt: "2026-06-13T00:00:00Z", expiresAt: null, revoked: false },
    ];
    const api = fakeApi({ listShares: vi.fn().mockResolvedValue(list) });
    render(<SharePanel api={api} workspaceId="w1" target="summary" />);

    const revoke = await screen.findByRole("button", { name: "Revoke" });
    fireEvent.click(revoke);
    await waitFor(() => expect(api.revokeShare).toHaveBeenCalledWith("s9"));
  });

  it("surfaces a permission error from the server", async () => {
    const api = fakeApi({
      createShare: vi.fn().mockRejectedValue(new Error("You do not have access to this workspace")),
    });
    render(<SharePanel api={api} workspaceId="w1" target="summary" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));
    expect(await screen.findByText(/do not have access/)).toBeInTheDocument();
  });
});
