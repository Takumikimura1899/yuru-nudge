// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import IntensityToggle from "./IntensityToggle";
import type { Intensity } from "./useChat";

const createDefaultProps = (overrides: Partial<{ value: Intensity }> = {}) => ({
  value: "chill" as Intensity,
  onChange: vi.fn(),
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("IntensityToggle", () => {
  test("現在の値のボタンが aria-pressed になる", () => {
    render(<IntensityToggle {...createDefaultProps({ value: "sharp" })} />);

    expect(screen.getByRole("button", { name: "Sharp" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Chill" })).toHaveAttribute("aria-pressed", "false");
  });

  test.each([
    { click: "Sharp", expected: "sharp" },
    { click: "Chill", expected: "chill" },
  ])("$click をクリックすると onChange($expected) が呼ばれる", async ({ click, expected }) => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<IntensityToggle {...props} />);

    await user.click(screen.getByRole("button", { name: click }));

    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith(expected);
  });
});
