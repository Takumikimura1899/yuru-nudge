// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vite-plus/test";
import ChatCard from "./ChatCard";

afterEach(() => {
  cleanup();
});

describe("ChatCard", () => {
  test("mood='sharp' を渡すとアバターにメガネ（data-testid='avatar-glasses'）が表示される", () => {
    render(<ChatCard bubble="今日はここまで" mood="sharp" />);

    expect(screen.getByTestId("avatar-glasses")).toBeInTheDocument();
  });
});
