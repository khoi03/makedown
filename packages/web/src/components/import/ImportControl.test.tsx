import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportControl } from "./ImportControl.js";
import type { ApiClient, ImportedSource } from "../../lib/api.js";

function fakeApi(over: Partial<ApiClient>): ApiClient {
  return { importSource: vi.fn(), ...over } as unknown as ApiClient;
}

/** Fire a file selection on the hidden input. */
function selectFile(file: File): void {
  const input = screen.getByTestId("import-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportControl", () => {
  it("uploads the chosen file and shows the {{ref}} to paste into build.md", async () => {
    const result: ImportedSource = { path: "sources/report.md", cached: false, chars: 42 };
    const importSource = vi.fn().mockResolvedValue(result);
    render(<ImportControl api={fakeApi({ importSource })} workspaceId="w1" />);

    selectFile(new File(["%PDF fake"], "report.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(importSource).toHaveBeenCalledTimes(1));
    expect(importSource).toHaveBeenCalledWith("w1", "report.pdf", expect.any(String));
    expect(await screen.findByText("{{sources/report.md}}")).toBeInTheDocument();
  });

  it("indicates when the result came from the conversion cache", async () => {
    const importSource = vi.fn().mockResolvedValue({ path: "sources/x.md", cached: true, chars: 1 });
    render(<ImportControl api={fakeApi({ importSource })} workspaceId="w1" />);

    selectFile(new File(["x"], "x.docx"));

    expect(await screen.findByText(/cache/i)).toBeInTheDocument();
  });

  it("surfaces an import error inline instead of failing silently", async () => {
    const importSource = vi.fn().mockRejectedValue(new Error("markitdown not found. Install with: pip install"));
    render(<ImportControl api={fakeApi({ importSource })} workspaceId="w1" />);

    selectFile(new File(["x"], "x.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/pip install/i);
  });

  it("does nothing when no file is chosen", () => {
    const importSource = vi.fn();
    render(<ImportControl api={fakeApi({ importSource })} workspaceId="w1" />);
    const input = screen.getByTestId("import-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(importSource).not.toHaveBeenCalled();
  });
});
