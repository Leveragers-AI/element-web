/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor, screen } from "test-utils-rtl";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import ImageGalleryView from "./ImageGalleryView";
import { findGalleryImages } from "../../../utils/leveragers/imageGallery";

vi.mock("../../../utils/leveragers/imageGallery", () => ({ findGalleryImages: vi.fn() }));

function image(id: string): MatrixEvent {
    return new MatrixEvent({
        event_id: `$${id}`,
        room_id: "!room:example.com",
        sender: "@kimi:example.com",
        origin_server_ts: 1_763_000_000_000,
        type: "m.room.message",
        content: { msgtype: "m.image", body: `${id}.png`, url: `mxc://example.com/${id}` },
    });
}

const shown = (): string | null => document.querySelector(".mx_ImageView_image")?.getAttribute("src") ?? null;

describe("<ImageGalleryView />", () => {
    const [first, second, third] = [image("first"), image("second"), image("third")];

    beforeEach(() => {
        stubClient();
        vi.mocked(findGalleryImages).mockReturnValue([first, second, third]);
    });

    it("moves between the images with the arrow keys, and stops at both ends", async () => {
        render(
            <ImageGalleryView src="http://this.is.a.url/example.com/second" mxEvent={second} onFinished={vi.fn()} />,
        );
        expect(shown()).toBe("http://this.is.a.url/example.com/second");

        fireEvent.keyDown(document.body, { key: "ArrowRight" });
        await waitFor(() => expect(shown()).toBe("http://this.is.a.url/example.com/third"));
        expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();

        fireEvent.keyDown(document.body, { key: "ArrowRight" });
        expect(shown()).toBe("http://this.is.a.url/example.com/third");

        fireEvent.keyDown(document.body, { key: "ArrowLeft" });
        fireEvent.keyDown(document.body, { key: "ArrowLeft" });
        await waitFor(() => expect(shown()).toBe("http://this.is.a.url/example.com/second"));
    });

    it("moves with the buttons", async () => {
        render(
            <ImageGalleryView src="http://this.is.a.url/example.com/second" mxEvent={second} onFinished={vi.fn()} />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
        await waitFor(() => expect(shown()).toBe("http://this.is.a.url/example.com/first"));
        expect(screen.queryByRole("button", { name: "Previous image" })).toBeNull();
        expect(screen.getByRole("button", { name: "Next image" })).toBeTruthy();
    });

    it("is Element's lightbox, without buttons, for a single image", () => {
        vi.mocked(findGalleryImages).mockReturnValue([second]);
        render(
            <ImageGalleryView src="http://this.is.a.url/example.com/second" mxEvent={second} onFinished={vi.fn()} />,
        );
        expect(shown()).toBe("http://this.is.a.url/example.com/second");
        expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Previous image" })).toBeNull();
    });

    it("leaves the arrow keys to a dialog opened above the lightbox, and to text fields", async () => {
        render(
            <ImageGalleryView src="http://this.is.a.url/example.com/second" mxEvent={second} onFinished={vi.fn()} />,
        );
        const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

        // Forward, View source…: Element shows them above the lightbox, which stays mounted underneath.
        const above = document.createElement("div");
        above.className = "mx_Dialog_wrapper mx_Dialog_wrapperWithStaticUnder";
        const search = document.createElement("button");
        above.appendChild(search);
        document.body.appendChild(above);
        fireEvent.keyDown(search, { key: "ArrowLeft" });
        await settle();
        expect(shown()).toBe("http://this.is.a.url/example.com/second");
        above.remove();

        const field = document.createElement("input");
        document.body.appendChild(field);
        fireEvent.keyDown(field, { key: "ArrowRight" });
        await settle();
        expect(shown()).toBe("http://this.is.a.url/example.com/second");
        field.remove();

        fireEvent.keyDown(document.body, { key: "ArrowRight" });
        await waitFor(() => expect(shown()).toBe("http://this.is.a.url/example.com/third"));
    });

    it("leaves the other keys to Element", () => {
        const onFinished = vi.fn();
        render(
            <ImageGalleryView src="http://this.is.a.url/example.com/second" mxEvent={second} onFinished={onFinished} />,
        );
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        expect(onFinished).toHaveBeenCalled();
    });
});
