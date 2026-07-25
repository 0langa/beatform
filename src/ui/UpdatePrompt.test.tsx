// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UpdatePrompt } from "./UpdatePrompt";

/**
 * The release notes rendered by this dialog are UNTRUSTED remote text: the
 * latest.json `notes` blurb (the manifest itself is not signature-verified —
 * only the installer payload is) and the CHANGELOG fetched over the network.
 * They are rendered as pure React text nodes today, which is the property
 * that makes that safe. Nothing asserted it, so a future swap to a markdown
 * library that emits HTML would pass CI silently. These tests pin it.
 */

const noop = () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAvailable(notes: string) {
  // Keep the network out of it: the cumulative-notes fetch would otherwise
  // race the assertions. A rejected fetch makes the component keep the blurb.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(new Error("offline"))),
  );
  return render(
    <UpdatePrompt
      update={{ state: "available", version: "9.9.9", notes }}
      onInstall={noop}
      onRelaunch={noop}
      onDismiss={noop}
    />,
  );
}

describe("UpdatePrompt release notes", () => {
  it("renders hostile markup as inert text, never as elements", () => {
    const { container } = renderAvailable(
      'Real line\n<img src=x onerror="window.__pwned=1">\n<script>window.__pwned2=1</script>',
    );
    // The payload is visible to the user as literal text...
    expect(container.textContent).toContain("<img src=x");
    expect(container.textContent).toContain("<script>");
    // ...but never became DOM.
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    expect((globalThis as Record<string, unknown>).__pwned2).toBeUndefined();
  });

  it("still renders the constructs the project's own notes use", () => {
    const { container } = renderAvailable("## Heading\n\n- a bullet\n\n**bold** text");
    expect(container.querySelector("h4")?.textContent).toBe("Heading");
    expect(container.querySelector("li")?.textContent).toContain("a bullet");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("shows the offered version and the primary actions", () => {
    renderAvailable("notes");
    expect(screen.getByText(/9\.9\.9/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /install now/i })).toBeTruthy();
  });
});
