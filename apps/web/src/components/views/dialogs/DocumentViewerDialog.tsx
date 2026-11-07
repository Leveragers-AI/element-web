/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, Suspense, useMemo } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { DocumentViewerView } from "@element-hq/web-shared-components";

import BaseDialog from "./BaseDialog";
import ErrorBoundary from "../elements/ErrorBoundary";
import Spinner from "../elements/Spinner";
import AccessibleButton from "../elements/AccessibleButton";
import {
    documentMediaForEvent,
    documentViewerForEvent,
    openPdfInBrowserWindow,
} from "../../../utils/documentViewer";
import { isPdfEvent } from "../../../utils/pdfViewer";
import { _t } from "../../../languageHandler";

interface Props {
    mxEvent: MatrixEvent;
    onFinished: () => void;
}

/**
 * A PDF or Markdown attachment shown large, over the app, rather than in the narrow right panel.
 * Uses the same viewers as {@link DocumentViewerCard}.
 */
export default function DocumentViewerDialog({ mxEvent, onFinished }: Props): JSX.Element {
    const viewer = documentViewerForEvent(mxEvent);
    const media = useMemo(() => documentMediaForEvent(mxEvent), [mxEvent]);
    const Viewer = viewer?.Component;
    // Same PDF in the browser's own viewer, in a window of its own.
    const openInBrowser =
        media && isPdfEvent(mxEvent) ? (
            <AccessibleButton kind="primary_sm" onClick={() => openPdfInBrowserWindow(media)}>
                {_t("document_viewer|open_in_browser")}
            </AccessibleButton>
        ) : undefined;

    return (
        <BaseDialog
            className="mx_DocumentViewerDialog"
            fixedWidth={false}
            onFinished={onFinished}
            title={media?.name ?? _t("document_viewer|title")}
            headerButton={openInBrowser}
        >
            <div className="mx_DocumentViewerDialog_body">
                {Viewer && media ? (
                    <ErrorBoundary>
                        <Suspense fallback={<Spinner />}>
                            <Viewer media={media} />
                        </Suspense>
                    </ErrorBoundary>
                ) : (
                    <DocumentViewerView status="error" />
                )}
            </div>
        </BaseDialog>
    );
}
