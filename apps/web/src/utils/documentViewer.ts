/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type ComponentType, lazy } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type MediaEventContent } from "matrix-js-sdk/src/types";

import { type DocumentMedia } from "../@types/document-viewer";
import { _t } from "../languageHandler";
import { MediaEventHelper } from "./MediaEventHelper";
import { isPdfEvent } from "./pdfViewer";
import { isMarkdownEvent } from "./markdownViewer";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { type OpenDocumentViewerPayload } from "../dispatcher/payloads/OpenDocumentViewerPayload";

/** The props every document viewer component takes. */
export interface DocumentViewerProps {
    media: DocumentMedia;
}

/** A viewer for one kind of attachment, shown in the right panel. */
export interface DocumentViewer {
    /** Whether this viewer can open the event's attachment. */
    matches: (mxEvent: MatrixEvent) => boolean;
    /** Label for the timeline action that opens the viewer, in the current language. */
    openLabel: () => string;
    /**
     * Renders the attachment. Loaded on first use, so that a viewer's dependencies stay out of the
     * bundle until someone opens a file it handles.
     */
    Component: ComponentType<DocumentViewerProps>;
}

/** Code split a viewer component, typed against the props every viewer takes. */
function lazyViewer(load: () => Promise<ComponentType<DocumentViewerProps>>): ComponentType<DocumentViewerProps> {
    return lazy(() => load().then((Component) => ({ default: Component })));
}

/**
 * The viewers, in the order they are tried: the first whose `matches` accepts an event opens it.
 * Supporting another format is a matter of adding an entry here.
 */
const DOCUMENT_VIEWERS: readonly DocumentViewer[] = [
    {
        matches: isPdfEvent,
        openLabel: () => _t("pdf_viewer|open"),
        Component: lazyViewer(() =>
            import("../components/views/right_panel/PdfViewer").then((module) => module.PdfViewer),
        ),
    },
    {
        matches: isMarkdownEvent,
        openLabel: () => _t("markdown_viewer|open"),
        Component: lazyViewer(() =>
            import("../components/views/right_panel/MarkdownViewer").then((module) => module.MarkdownViewer),
        ),
    },
];

/** The viewer, if any, that can open this event's attachment. */
export function documentViewerForEvent(mxEvent: MatrixEvent): DocumentViewer | undefined {
    return DOCUMENT_VIEWERS.find((viewer) => viewer.matches(mxEvent));
}

/**
 * Adapt an event's media to the handle a viewer wants, if some viewer can open it. `sourceBlob`
 * decrypts transparently, so the viewer never has to know whether the room is encrypted.
 */
export function documentMediaForEvent(mxEvent: MatrixEvent, helper?: MediaEventHelper): DocumentMedia | undefined {
    if (!documentViewerForEvent(mxEvent)) return;

    const mediaEventHelper = helper ?? new MediaEventHelper(mxEvent);
    const size = mxEvent.getContent<MediaEventContent>().info?.size;

    return {
        uri: mediaEventHelper.media.srcMxc,
        name: mediaEventHelper.fileName,
        size: typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : undefined,
        blob: () => mediaEventHelper.sourceBlob.value,
    };
}

/**
 * Open the given event's attachment in the right panel of the room it belongs to. The card picks the
 * viewer with {@link documentViewerForEvent}.
 *
 * Dispatched rather than calling RightPanelStore directly: this module is reached from the message
 * body view models, and the store leads back round to the message bodies via SDKContextClass.
 */
function openDocumentViewerInRightPanel(mxEvent: MatrixEvent): void {
    defaultDispatcher.dispatch<OpenDocumentViewerPayload>({
        action: Action.OpenDocumentViewer,
        event: mxEvent,
    });
}

/**
 * Leveragers: open the attachment large, over the app, rather than in the narrow right panel.
 * Loaded on demand, for the same import-cycle reason as above.
 */
export function openDocumentViewer(mxEvent: MatrixEvent): void {
    void Promise.all([import("../Modal"), import("../components/views/dialogs/DocumentViewerDialog")]).then(
        ([{ default: Modal }, { default: DocumentViewerDialog }]) => {
            Modal.createDialog(DocumentViewerDialog, { mxEvent }, "mx_DocumentViewerDialog_wrapper");
        },
        () => openDocumentViewerInRightPanel(mxEvent),
    );
}

/**
 * Leveragers: open a PDF in the browser's own viewer, in a window of its own, the way Telegram hands
 * a PDF to the system viewer. Call it from a click: the window opens at once, while the click still
 * allows it, and the decrypted file is loaded into it once ready.
 */
export function openPdfInBrowserWindow(media: DocumentMedia): void {
    const win = window.open("", "_blank", "popup,width=1000,height=900");
    media.blob().then(
        (blob) => {
            const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
            if (win) win.location.href = url;
            else window.open(url, "_blank");
            // The window has read the file by then; a reload after that would fail.
            window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
        },
        () => win?.close(),
    );
}
