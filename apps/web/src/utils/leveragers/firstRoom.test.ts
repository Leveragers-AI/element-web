/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, afterEach } from "vitest";
import { type Room, KnownMembership } from "matrix-js-sdk/src/matrix";

import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import RoomListStoreV3, { LISTS_LOADED_EVENT } from "../../stores/room-list-v3/RoomListStoreV3";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import DMRoomMap from "../DMRoomMap";
import { pickFirstRoom, viewFirstRoomOrHome } from "./firstRoom";

const SPACE = "!space:example.com";

function fakeRoom(roomId: string, membership: string = KnownMembership.Join, isSpace = false): Room {
    return {
        roomId,
        isSpaceRoom: () => isSpace,
        getMyMembership: () => membership,
    } as unknown as Room;
}

const inSpace = (ids: string[]) => (_space: string, roomId: string) => ids.includes(roomId);

describe("pickFirstRoom", () => {
    it("takes the first room of the space in list order, skipping rooms of other spaces", () => {
        const rooms = [fakeRoom("!other"), fakeRoom("!general"), fakeRoom("!second")];
        const picked = pickFirstRoom(rooms, SPACE, {
            isInSpace: inSpace(["!general", "!second"]),
            isDm: () => false,
        });
        expect(picked?.roomId).toBe("!general");
    });

    it("skips the private chat with the agent when the space has another room", () => {
        const rooms = [fakeRoom("!agent-dm"), fakeRoom("!general")];
        const picked = pickFirstRoom(rooms, SPACE, {
            isInSpace: inSpace(["!agent-dm", "!general"]),
            isDm: (id) => id === "!agent-dm",
        });
        expect(picked?.roomId).toBe("!general");
    });

    it("opens the private chat when it is the only room", () => {
        const picked = pickFirstRoom([fakeRoom("!agent-dm")], SPACE, {
            isInSpace: () => true,
            isDm: () => true,
        });
        expect(picked?.roomId).toBe("!agent-dm");
    });

    it("prefers a joined room to an invite, and never picks a space", () => {
        const rooms = [
            fakeRoom("!sub-space", KnownMembership.Join, true),
            fakeRoom("!invite", KnownMembership.Invite),
            fakeRoom("!joined"),
        ];
        const picked = pickFirstRoom(rooms, SPACE, { isInSpace: () => true, isDm: () => false });
        expect(picked?.roomId).toBe("!joined");
    });

    it("returns nothing for an empty space", () => {
        expect(pickFirstRoom([fakeRoom("!elsewhere")], SPACE, { isInSpace: () => false, isDm: () => false })).toBe(
            undefined,
        );
    });
});

describe("viewFirstRoomOrHome", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function setUp({ spaces, rooms, loading = false }: { spaces: string[]; rooms: Room[]; loading?: boolean }) {
        const store = RoomListStoreV3.instance;
        vi.spyOn(store, "isLoadingRooms", "get").mockReturnValue(loading);
        vi.spyOn(store, "getSortedRooms").mockReturnValue(rooms);
        const spaceStore = SDKContextClass.instance.spaceStore;
        vi.spyOn(spaceStore, "spacePanelSpaces", "get").mockReturnValue(spaces.map((id) => fakeRoom(id)));
        vi.spyOn(spaceStore, "isRoomInSpace").mockReturnValue(true);
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({ getUserIdForRoomId: () => undefined } as unknown as DMRoomMap);
        vi.spyOn(SDKContextClass.instance.roomViewStore, "getRoomId").mockReturnValue(null);
        return vi.spyOn(dis, "dispatch").mockImplementation(() => {});
    }

    it("opens the first room of the first space", async () => {
        const dispatch = setUp({ spaces: [SPACE], rooms: [fakeRoom("!general")] });
        await viewFirstRoomOrHome();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: "!general" }),
        );
    });

    it("waits for the room list to load", async () => {
        const dispatch = setUp({ spaces: [SPACE], rooms: [fakeRoom("!general")], loading: true });
        const done = viewFirstRoomOrHome();
        await Promise.resolve();
        expect(dispatch).not.toHaveBeenCalled();
        RoomListStoreV3.instance.emit(LISTS_LOADED_EVENT);
        await done;
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: "!general" }),
        );
    });

    it("shows the home page, as before, without any space", async () => {
        const dispatch = setUp({ spaces: [], rooms: [fakeRoom("!general")] });
        await viewFirstRoomOrHome();
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewHomePage });
    });

    it("leaves alone a room the person opened meanwhile", async () => {
        const dispatch = setUp({ spaces: [SPACE], rooms: [fakeRoom("!general")] });
        vi.spyOn(SDKContextClass.instance.roomViewStore, "getRoomId").mockReturnValue("!clicked");
        await viewFirstRoomOrHome();
        expect(dispatch).not.toHaveBeenCalled();
    });
});
