/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, afterEach } from "vitest";
import { JoinRule, MatrixEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../settings/SettingsStore";
import { MediaPreviewValue } from "../../@types/media_preview";
import { findGalleryImages, isGalleryImage } from "./imageGallery";

const ROOM = "!room:example.com";
const ME = "@me:example.com";

function image(id: string, sender = "@kimi:example.com"): MatrixEvent {
    return new MatrixEvent({
        event_id: id,
        room_id: ROOM,
        sender,
        type: "m.room.message",
        content: { msgtype: "m.image", body: `${id}.png`, url: `mxc://example.com/${id}` },
    });
}

function text(id: string): MatrixEvent {
    return new MatrixEvent({
        event_id: id,
        room_id: ROOM,
        sender: "@kimi:example.com",
        type: "m.room.message",
        content: { msgtype: "m.text", body: "hello" },
    });
}

function fakeClient(events: MatrixEvent[], joinRule = JoinRule.Invite): MatrixClient {
    const room = {
        roomId: ROOM,
        currentState: { getJoinRule: () => joinRule },
        getUnfilteredTimelineSet: () => ({
            getTimelineForEvent: (id: string) =>
                events.some((ev) => ev.getId() === id) ? { getEvents: () => events } : null,
        }),
    };
    return {
        getRoom: (id: string) => (id === ROOM ? room : null),
        getUserId: () => ME,
    } as unknown as MatrixClient;
}

function mockSettings(mediaPreviews: MediaPreviewValue, overrides: Record<string, boolean> = {}): void {
    vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string) => {
        if (name === "mediaPreviewConfig") return { media_previews: mediaPreviews };
        if (name === "showMediaEventIds") return overrides;
        return undefined;
    }) as typeof SettingsStore.getValue);
}

describe("isGalleryImage", () => {
    it("accepts an image message and refuses the rest", () => {
        expect(isGalleryImage(image("$a"))).toBe(true);
        expect(isGalleryImage(text("$t"))).toBe(false);
        const noFile = new MatrixEvent({ type: "m.room.message", content: { msgtype: "m.image", body: "x" } });
        expect(isGalleryImage(noFile)).toBe(false);
    });
});

describe("findGalleryImages", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps the images of the timeline in their order, without the other messages", () => {
        mockSettings(MediaPreviewValue.On);
        const events = [image("$a"), text("$t"), image("$b"), image("$c")];
        const ids = findGalleryImages(fakeClient(events), events[2]).map((ev) => ev.getId());
        expect(ids).toEqual(["$a", "$b", "$c"]);
    });

    it("skips images whose media is hidden, but keeps the clicked one and the person's own", () => {
        mockSettings(MediaPreviewValue.Off);
        const events = [image("$a"), image("$mine", ME), image("$clicked"), image("$d")];
        const ids = findGalleryImages(fakeClient(events), events[2]).map((ev) => ev.getId());
        expect(ids).toEqual(["$mine", "$clicked"]);
    });

    it("follows a per-image choice to show it", () => {
        mockSettings(MediaPreviewValue.Off, { $d: true });
        const events = [image("$clicked"), image("$d")];
        const ids = findGalleryImages(fakeClient(events), events[0]).map((ev) => ev.getId());
        expect(ids).toEqual(["$clicked", "$d"]);
    });

    it("returns nothing for an event outside a loaded timeline (thread, search)", () => {
        mockSettings(MediaPreviewValue.On);
        const loaded = [image("$a"), image("$b")];
        expect(findGalleryImages(fakeClient(loaded), image("$elsewhere"))).toEqual([]);
    });
});
