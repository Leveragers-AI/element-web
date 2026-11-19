/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { EventType, JoinRule, MsgType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type ImageContent } from "matrix-js-sdk/src/types";

import SettingsStore from "../../settings/SettingsStore";
import { computeMediaVisibility } from "../media/mediaVisibility";

// Leveragers: the images the lightbox can move between with the arrow keys. Only the images already loaded in the
// room's timeline, in their order, and only those the person can see (Element's media preview setting).

/** An image message that the lightbox can show: not deleted, decrypted, with a file. */
export function isGalleryImage(event: MatrixEvent): boolean {
    if (event.getType() !== EventType.RoomMessage || event.isRedacted() || event.isDecryptionFailure()) return false;
    const content = event.getContent<ImageContent>();
    return content.msgtype === MsgType.Image && !!(content.url || content.file);
}

/**
 * The images of the timeline that holds `event`, oldest first, `event` included. Empty when the event is not in a
 * loaded timeline of its room (a thread, a search result).
 */
export function findGalleryImages(client: MatrixClient, event: MatrixEvent): MatrixEvent[] {
    const room = client.getRoom(event.getRoomId());
    const eventId = event.getId();
    if (!room || !eventId) return [];
    const timeline = room.getUnfilteredTimelineSet().getTimelineForEvent(eventId);
    if (!timeline) return [];

    const mediaPreviewSetting = SettingsStore.getValue("mediaPreviewConfig", room.roomId);
    const eventVisibility = SettingsStore.getValue("showMediaEventIds");
    const joinRule = room.currentState.getJoinRule();
    const roomIsPrivate = [JoinRule.Invite, JoinRule.Knock, JoinRule.Restricted].includes(joinRule);
    const userId = client.getUserId() ?? undefined;

    return timeline
        .getEvents()
        .filter(
            (ev) =>
                ev.getId() === eventId ||
                (isGalleryImage(ev) &&
                    computeMediaVisibility(
                        mediaPreviewSetting,
                        eventVisibility,
                        userId,
                        ev.getId(),
                        ev.getSender(),
                        roomIsPrivate,
                    )),
        );
}
