// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import MutterForm from "./MutterForm";

const createDefaultProps = () => ({
  onSend: vi.fn().mockResolvedValue(true),
  busy: false,
});

afterEach(() => {
  cleanup();
});

describe("MutterForm", () => {
  test("入力するとトリムした内容で onSend が呼ばれ、成功したら入力がクリアされる", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<MutterForm {...props} />);

    const textarea = screen.getByRole("textbox", { name: "つぶやき" });
    await user.type(textarea, "  部屋を片付けたい  ");
    await user.click(screen.getByRole("button", { name: "つぶやく" }));

    expect(props.onSend).toHaveBeenCalledTimes(1);
    expect(props.onSend).toHaveBeenCalledWith("部屋を片付けたい");
    expect(textarea).toHaveValue("");
  });

  test("送信が失敗（false）なら入力を保持する", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    props.onSend.mockResolvedValue(false);
    render(<MutterForm {...props} />);

    const textarea = screen.getByRole("textbox", { name: "つぶやき" });
    await user.type(textarea, "部屋を片付けたい");
    await user.click(screen.getByRole("button", { name: "つぶやく" }));

    expect(textarea).toHaveValue("部屋を片付けたい");
  });

  test.each([
    { name: "空のとき", setup: async () => {} },
    {
      name: "空白のみのとき",
      setup: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByRole("textbox"), "   ");
      },
    },
  ])("$name は送信ボタンが無効", async ({ setup }) => {
    const user = userEvent.setup();
    render(<MutterForm {...createDefaultProps()} />);

    await setup(user);

    expect(screen.getByRole("button", { name: "つぶやく" })).toBeDisabled();
  });

  test("140文字を超えると送信ボタンが無効になり、残数がマイナス表示される", async () => {
    const user = userEvent.setup();
    render(<MutterForm {...createDefaultProps()} />);

    const textarea = screen.getByRole("textbox", { name: "つぶやき" });
    await user.click(textarea);
    await user.paste("あ".repeat(141));

    expect(screen.getByRole("button", { name: "つぶやく" })).toBeDisabled();
    expect(screen.getByText("あと-1文字")).toBeInTheDocument();
  });

  test("140文字ちょうどは送信できる", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<MutterForm {...props} />);

    const textarea = screen.getByRole("textbox", { name: "つぶやき" });
    await user.click(textarea);
    await user.paste("あ".repeat(140));
    await user.click(screen.getByRole("button", { name: "つぶやく" }));

    expect(props.onSend).toHaveBeenCalledWith("あ".repeat(140));
  });

  test("busy のときは入力があっても送信できない", async () => {
    const user = userEvent.setup();
    const props = { ...createDefaultProps(), busy: true };
    render(<MutterForm {...props} />);

    await user.type(screen.getByRole("textbox"), "部屋を片付けたい");

    expect(screen.getByRole("button", { name: "つぶやく" })).toBeDisabled();
  });

  test("残り文字数が表示される", async () => {
    const user = userEvent.setup();
    render(<MutterForm {...createDefaultProps()} />);

    expect(screen.getByText("あと140文字")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "あいう");
    expect(screen.getByText("あと137文字")).toBeInTheDocument();
  });
});
