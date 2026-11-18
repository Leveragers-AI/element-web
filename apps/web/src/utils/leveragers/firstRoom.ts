/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { type Room, KnownMembership } from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import RoomListStoreV3, { LISTS_LOADED_EVENT } from "../../stores/room-list-v3/RoomListStoreV3";
import DMRoomMap from "../DMRoomMap";
import { SDKContextClass } from "../../contexts/SDKContextClass";

// Leveragers: on a device that has no "last room" yet (first sign-in), open the first room of the user's first
// space instead of Element's home page. No room or space name is written here: the order is the one shown in the
// space bar and in the room list.

const logger = rootLogger.getChild("FirstRoom:");

/** How long to wait for the room list to load before falling back to the home page. */
export const ROOM_LIST_TIMEOUT_MS = 10_000;

export interface FirstRoomHelpers {
    isInSpace: (spaceId: string, roomId: string) => boolean;
    isDm: (roomId: string) => boolean;
}

/**
 * The room to open in `spaceId`, from the room list in its displayed order: joined rooms before invites, and the
 * private chats (with the agent) only when the space has no other room. `undefined` when the space has no room.
 */
export function pickFirstRoom(sortedRooms: Room[], spaceId: string, helpers: FirstRoomHelpers): Room | undefined {
    const inSpace = sortedRooms.filter((room) => !room.isSpaceRoom() && helpers.isInSpace(spaceId, room.roomId));
    const rank = (room: Room): number =>
        (room.getMyMembership() === KnownMembership.Join ? 0 : 2) + (helpers.isDm(room.roomId) ? 1 : 0);
    let best: Room | undefined;
    for (const room of inSpace) {
        // Strictly lower only: among equals, the first in list order wins.
        if (!best || rank(room) < rank(best)) best = room;
    }
    return best;
}

function roomListLoaded(): Promise<boolean> {
    const store = RoomListStoreV3.instance;
    if (!store.isLoadingRooms) return Promise.resolve(true);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            store.off(LISTS_LOADED_EVENT, onLoaded);
            resolve(false);
        }, ROOM_LIST_TIMEOUT_MS);
        const onLoaded = (): void => {
            clearTimeout(timer);
            store.off(LISTS_LOADED_EVENT, onLoaded);
            resolve(true);
        };
        store.on(LISTS_LOADED_EVENT, onLoaded);
    });
}

async function findFirstRoom(): Promise<{ space: Room; room: Room } | undefined> {
    // The room list loads after the first sync, once the spaces are known.
    if (!(await roomListLoaded())) return undefined;
    const space = SDKContextClass.instance.spaceStore.spacePanelSpaces[0];
    if (!space) return undefined;
    const room = pickFirstRoom(RoomListStoreV3.instance.getSortedRooms(), space.roomId, {
        isInSpace: (spaceId, roomId) => SDKContextClass.instance.spaceStore.isRoomInSpace(spaceId, roomId),
        isDm: (roomId) => !!DMRoomMap.shared()?.getUserIdForRoomId(roomId),
    });
    return room ? { space, room } : undefined;
}

/**
 * In place of Element's home page after sign-in: open the first room of the first space, or the home page as
 * before when there is none. Never throws.
 */
export async function viewFirstRoomOrHome(): Promise<void> {
    let found: { space: Room; room: Room } | undefined;
    try {
        found = await findFirstRoom();
    } catch (e) {
        logger.warn("Could not pick the first room", e);
    }
    // The person opened something else while the list was loading: leave it.
    if (SDKContextClass.instance.roomViewStore.getRoomId()) return;
    if (found) {
        logger.debug(`opening ${found.room.roomId} in ${found.space.roomId}`);
        // Select the space first: a private chat also belongs to Element's Home (hidden on our build), which would
        // otherwise stay selected, with no space highlighted in the bar.
        SDKContextClass.instance.spaceStore.setActiveSpace(found.space.roomId, false);
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: found.room.roomId,
            metricsTrigger: undefined,
        });
    } else {
        dis.dispatch({ action: Action.ViewHomePage });
    }
}
