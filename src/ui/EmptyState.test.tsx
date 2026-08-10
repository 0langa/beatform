// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DemoDef } from "../audio/demoTrack";
import { EmptyState } from "./EmptyState";

/**
 * P-3's fourth path. The empty state taught "drop a file / browse / try a
 * demo", all three of which assume the user has decided what to listen to; the
 * Gallery is the one route that needs nothing from them.
 *
 * What is worth pinning is that it is a FOURTH path and not a replacement —
 * the three that were there keep working and keep their weight — plus the two
 * naming rules the copy has to obey.
 */

// Real `DemoDef`s rather than a cast: the empty state never calls `render`,
// but a fixture that opts out of the type would go on compiling if the shape
// the component reads ever changed underneath it.
const never = () => Promise.reject(new Error("the empty state must not render a demo"));
const DEMOS: DemoDef[] = [
  { id: "pulse", name: "Pulse", render: never },
  { id: "drift", name: "Drift", render: never },
];

afterEach(cleanup);

function mount() {
  const onOpenFile = vi.fn();
  const onDemo = vi.fn();
  const onGallery = vi.fn();
  render(
    <EmptyState demos={DEMOS} onOpenFile={onOpenFile} onDemo={onDemo} onGallery={onGallery} />,
  );
  return { onOpenFile, onDemo, onGallery };
}

describe("the empty state's four paths", () => {
  it("offers the Gallery alongside the file and demo paths, not instead of them", () => {
    const { onOpenFile, onDemo, onGallery } = mount();

    fireEvent.click(screen.getByRole("button", { name: /Browse files/ }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Pulse/ }));
    expect(onDemo).toHaveBeenCalledWith("pulse");

    fireEvent.click(screen.getByRole("button", { name: /Browse looks and themes/ }));
    expect(onGallery).toHaveBeenCalledTimes(1);
  });

  it("gives the Gallery chip weight, leaving Browse files as the only primary", () => {
    mount();
    const gallery = document.querySelector(".gallery-chip")!;
    // The same family as the demo chips — the file paths stay the headline.
    expect(gallery.classList.contains("chip")).toBe(true);
    expect(document.querySelectorAll(".btn-primary")).toHaveLength(1);
  });

  it("uses the shipped vocabulary and none of the retired words", () => {
    mount();
    const copy = document.querySelector(".empty-card")!.textContent ?? "";
    expect(copy).toMatch(/Gallery/);
    expect(copy).toMatch(/looks and themes/);
    // Style / Look / Theme / Gallery is the vocabulary; these four are retired
    // and must never come back through a new string.
    expect(copy).not.toMatch(/Template|Inspector|Studio|Essentials/);
  });
});
