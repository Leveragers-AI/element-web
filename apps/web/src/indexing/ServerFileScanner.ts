/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import {
    Direction,
    type EventTimeline,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type TimelineWindow,
} from "matrix-js-sdk/src/matrix";

/** The message types the Files panel lists. */
export const FILE_MSGTYPES = ["m.file", "m.image", "m.video", "m.audio"];

/** Events asked for in each /messages request. */
const PAGE_SIZE = 100;

/** /messages requests at most per fill, so a room with few files is read a part at a time. */
const MAX_PAGES_PER_FILL = 5;

/** Timelines whose scan has started: a null token then means the start of the room was reached. */
const startedTimelines = new WeakSet<EventTimeline>();

/** Whether the event is a file the Files panel should list. */
export function isFileEvent(ev: MatrixEvent): boolean {
    return (
        ev.getType() === "m.room.message" &&
        !ev.isRedacted() &&
        !ev.isDecryptionFailure() &&
        !ev.isRelation("m.replace") &&
        FILE_MSGTYPES.includes(ev.getContent().msgtype ?? "")
    );
}

/**
 * Lists the files of an encrypted room when there is no event index (the web).
 *
 * The server cannot filter encrypted events, so this reads the room history from the newest event
 * backwards, decrypts it here and keeps the file events, older ones going to the start of `timeline`.
 * The server pagination token is kept as the timeline's backwards token, and is null once the start
 * of the room is reached.
 *
 * @returns Whether more files may exist further back.
 */
export async function scanServerForFiles(
    client: MatrixClient,
    room: Room,
    timeline: EventTimeline,
    limit: number,
): Promise<boolean> {
    const timelineSet = timeline.getTimelineSet();
    const mapper = client.getEventMapper();
    let from: string | null = startedTimelines.has(timeline)
        ? timeline.getPaginationToken(Direction.Backward)
        : null;
    if (startedTimelines.has(timeline) && !from) return false;
    startedTimelines.add(timeline);

    let added = 0;
    for (let page = 0; page < MAX_PAGES_PER_FILL && added < limit; page++) {
        const res = await client.createMessagesRequest(room.roomId, from, PAGE_SIZE, Direction.Backward);
        const events = res.chunk.map(mapper);
        await Promise.all(events.map((ev) => client.decryptEventIfNeeded(ev)));
        // Newest first, so each one goes before the ones already added.
        for (const ev of events) {
            if (!isFileEvent(ev) || timelineSet.eventIdToTimeline(ev.getId()!)) continue;
            timelineSet.addEventToTimeline(ev, timeline, {
                toStartOfTimeline: true,
                fromCache: false,
                addToState: false,
            });
            added++;
        }
        from = res.chunk.length > 0 && res.end ? res.end : null;
        if (!from) break;
    }

    timeline.setPaginationToken(from, Direction.Backward);
    return from !== null;
}

/**
 * Emulate a TimelineWindow pagination with {@link scanServerForFiles} as the event source, the way
 * EventIndex.paginateTimelineWindow does with the desktop index.
 */
export function paginateServerFileScan(
    client: MatrixClient,
    room: Room,
    timelineWindow: TimelineWindow,
    direction: Direction,
    limit: number,
): Promise<boolean> {
    const tl = timelineWindow.getTimelineIndex(direction);

    if (!tl) return Promise.resolve(false);
    if (tl.pendingPaginate) return tl.pendingPaginate;
    if (timelineWindow.extend(direction, limit)) return Promise.resolve(true);
    // New files arrive live; only older ones are fetched.
    if (direction !== Direction.Backward) return Promise.resolve(false);

    const paginationPromise = (async (): Promise<boolean> => {
        try {
            return await scanServerForFiles(client, room, tl.timeline, limit);
        } finally {
            tl.pendingPaginate = undefined;
            timelineWindow.extend(direction, limit);
        }
    })();
    tl.pendingPaginate = paginationPromise;
    return paginationPromise;
}
