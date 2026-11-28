/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "test-utils-rtl";

import { SignInScreen } from "./SignInScreen";
import { findServer, readLastEmail, rememberEmail } from "./frontDoor";

vi.mock("./frontDoor", async (importOriginal) => {
    const original = await importOriginal<typeof import("./frontDoor")>();
    return { ...original, findServer: vi.fn() };
});

const FRONT_DOOR = "https://front.example";

function field(): HTMLInputElement {
    return screen.getByRole("textbox") as HTMLInputElement;
}

async function submit(email: string): Promise<void> {
    fireEvent.change(field(), { target: { value: email } });
    await act(async () => fireEvent.click(screen.getByRole("button")));
}

describe("SignInScreen", () => {
    afterEach(() => {
        // eslint-disable-next-line unicorn/no-document-cookie -- the cookie under test
        document.cookie = "lvg_last_email=; Max-Age=0; Path=/";
        vi.mocked(findServer).mockReset();
    });

    it("pre-fills the last email", () => {
        rememberEmail("jo@acme.example");
        render(<SignInScreen frontDoorUrl={FRONT_DOOR} startSignIn={vi.fn()} />);
        expect(field().value).toBe("jo@acme.example");
    });

    it("starts the sign-in on the server found, with the trimmed email, and remembers it", async () => {
        vi.mocked(findServer).mockResolvedValue({ server: "acme.leveragers.com" });
        const startSignIn = vi.fn().mockResolvedValue(true);
        render(<SignInScreen frontDoorUrl={FRONT_DOOR} startSignIn={startSignIn} />);
        await submit("  jo@acme.example ");
        expect(findServer).toHaveBeenCalledWith("jo@acme.example", FRONT_DOOR);
        expect(startSignIn).toHaveBeenCalledWith("acme.leveragers.com", "jo@acme.example");
        expect(readLastEmail()).toBe("jo@acme.example");
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByRole("button")).toBeDisabled();
    });

    it("asks again for a malformed address", async () => {
        vi.mocked(findServer).mockResolvedValue({ error: "invalid_email" });
        const startSignIn = vi.fn();
        render(<SignInScreen frontDoorUrl={FRONT_DOOR} startSignIn={startSignIn} />);
        await submit("jo@");
        expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
        expect(field()).toHaveAttribute("aria-invalid", "true");
        expect(startSignIn).not.toHaveBeenCalled();
        expect(readLastEmail()).toBe("");
    });

    it("says to try again and keeps the email when the front door fails", async () => {
        vi.mocked(findServer).mockResolvedValue({ error: "front_door" });
        const startSignIn = vi.fn();
        render(<SignInScreen frontDoorUrl={FRONT_DOOR} startSignIn={startSignIn} />);
        await submit("jo@acme.example");
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Can't reach sign-in. Check your connection and try again.",
        );
        expect(field().value).toBe("jo@acme.example");
        expect(screen.getByRole("button")).toBeEnabled();
        expect(startSignIn).not.toHaveBeenCalled();
    });

    it("says to try again when the sign-in cannot start on the server", async () => {
        vi.mocked(findServer).mockResolvedValue({ server: "acme.leveragers.com" });
        render(<SignInScreen frontDoorUrl={FRONT_DOOR} startSignIn={vi.fn().mockRejectedValue(new Error("down"))} />);
        await submit("jo@acme.example");
        expect(screen.getByRole("alert")).toHaveTextContent("Can't reach sign-in.");
        expect(field().value).toBe("jo@acme.example");
    });
});
