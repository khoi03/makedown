import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, resolveBadge } from "./StatusBadge.js";

describe("resolveBadge", () => {
  it("prefers a live status over the stale baseline", () => {
    expect(resolveBadge("building", true).label).toBe("Building");
    expect(resolveBadge("denied", false).label).toBe("Denied");
  });
  it("falls back to stale/fresh when there is no live status", () => {
    expect(resolveBadge(undefined, true)).toEqual({ key: "stale", label: "Stale" });
    expect(resolveBadge(undefined, false)).toEqual({ key: "fresh", label: "Fresh" });
  });
});

describe("StatusBadge", () => {
  it("renders the resolved label and exposes the status for styling", () => {
    const { container } = render(<StatusBadge status="building" stale />);
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(container.querySelector('[data-status="building"]')).not.toBeNull();
  });

  it("shows Fresh for a non-stale target with no run status", () => {
    render(<StatusBadge stale={false} />);
    expect(screen.getByText("Fresh")).toBeInTheDocument();
  });
});
