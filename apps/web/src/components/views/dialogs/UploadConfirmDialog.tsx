/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2021 The Matrix.org Foundation C.I.C.
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import DialogButtons from "../elements/DialogButtons";
import Field from "../elements/Field";
import { fileSize } from "../../../utils/FileUtils";
import {
    attachmentIcon,
    type MediaPreviewGroupEntry,
    type MediaPreviewGroupEntryContent,
    MediaPreviewGroupPreview,
    useCreateAutoDisposedViewModel,
} from "@element-hq/web-shared-components";
import { MediaPreviewGroupViewModel } from "../../../viewmodels/message-body/MediaPreviewGroupViewModel";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";

interface IProps {
    file: File;
    /** Defaults to 0. */
    currentIndex?: number;
    /** Defaults to 1. */
    totalFiles?: number;
    /**
     * `caption` is the message typed with this file, sent with it as a media caption (MSC2530).
     * Empty when the user did not type one.
     */
    onFinished: (uploadConfirmed: boolean, uploadAll?: boolean, caption?: string) => void;
    /** Text already typed in the composer, shown in the message field when the dialog opens. */
    initialCaption?: string;
}

const previewableFormats = ["video", "audio", "image"];
/**
 * previewable formats needs an object URL to be created for the preview
 */
function formatIsPreviewable(mimetype: string): boolean {
    return previewableFormats.includes(mimetype.split("/")[0]);
}

/**
 * objectUrl should only be undefined if mimetype is text
 */
function computePreviewContent(mimeType: string, fileName: string, objectUrl?: string): MediaPreviewGroupEntryContent {
    if (objectUrl === undefined)
        return {
            type: "text",
        };

    switch (mimeType.split("/")[0]) {
        case "image":
            return {
                type: "image",
                imageSize: "tallbanner",
                image: objectUrl,
                imageAlt: fileName,
            };
        case "video":
            return {
                type: "video",
                videoSize: "tallbanner",
                video: objectUrl,
            };
        case "audio":
            return {
                type: "audio",
                audio: objectUrl,
            };
        default:
            return {
                type: "text",
            };
    }
}

/**
 * Owns the object URL used for the preview so that its lifetime is tied to the lifetime of the
 * view-model: it is revoked when the view-model is disposed, i.e. when the dialog unmounts.
 */
class UploadPreviewViewModel extends MediaPreviewGroupViewModel {
    public constructor(file: File) {
        const mimeType = file.type;
        const objectUrl = formatIsPreviewable(mimeType) ? URL.createObjectURL(file) : undefined;

        const preview: MediaPreviewGroupEntry = {
            id: file.name,
            header: file.name,
            body: fileSize(file.size),
            ...attachmentIcon(mimeType),
            ...computePreviewContent(mimeType, file.name, objectUrl),
        };

        super({ entries: [preview] });

        if (objectUrl !== undefined) this.disposables.track(() => URL.revokeObjectURL(objectUrl));
    }
}

export default function UploadConfirmDialog({
    file,
    currentIndex = 0,
    totalFiles = 1,
    onFinished,
    initialCaption,
}: IProps): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new UploadPreviewViewModel(file));
    const [caption, setCaption] = useState(initialCaption ?? "");
    const captionRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        // Put the cursor after the text taken from the composer, ready to go on typing.
        const field = captionRef.current;
        if (initialCaption && field) field.setSelectionRange(initialCaption.length, initialCaption.length);
    }, [initialCaption]);

    let title: string;
    if (totalFiles > 1 && currentIndex !== undefined) {
        title = _t("upload_file|title_progress", {
            current: currentIndex + 1,
            total: totalFiles,
        });
    } else {
        title = _t("upload_file|title");
    }

    const onCancelClick = useCallback((): void => {
        onFinished(false);
    }, [onFinished]);

    const onUploadClick = useCallback((): void => {
        onFinished(true, false, caption.trim());
    }, [onFinished, caption]);

    const onUploadAllClick = useCallback((): void => {
        onFinished(true, true, caption.trim());
    }, [onFinished, caption]);

    const onCaptionKeyDown = useCallback(
        (ev: React.KeyboardEvent): void => {
            // Same keys as the message composer: Enter sends (or Ctrl+Enter, per the user's setting),
            // Shift+Enter starts a new line, and nothing is sent while an IME composition is in progress.
            if (ev.nativeEvent.isComposing) return;
            if (getKeyBindingsManager().getMessageComposerAction(ev) === KeyBindingAction.SendMessage) {
                ev.preventDefault();
                onUploadClick();
            }
        },
        [onUploadClick],
    );

    let uploadAllButton: JSX.Element | undefined;
    if (currentIndex + 1 < totalFiles) {
        uploadAllButton = (
            <button onClick={onUploadAllClick} className="mx_LegacyDialogButton" type="button">
                {_t("upload_file|upload_all_button")}
            </button>
        );
    }

    return (
        <BaseDialog
            className="mx_UploadConfirmDialog"
            fixedWidth={false}
            onFinished={onCancelClick}
            title={title}
            contentId="mx_Dialog_content"
        >
            <div id="mx_Dialog_content">
                <div className="mx_UploadConfirmDialog_previewOuter">
                    <div className="mx_UploadConfirmDialog_previewInner">
                        <MediaPreviewGroupPreview vm={vm} />
                    </div>
                </div>
                <Field
                    className="mx_UploadConfirmDialog_caption"
                    element="textarea"
                    label={_t("upload_file|caption_label")}
                    rows={2}
                    autoComplete="off"
                    autoFocus={true}
                    value={caption}
                    inputRef={captionRef}
                    onChange={(ev) => setCaption(ev.target.value)}
                    onKeyDown={onCaptionKeyDown}
                />
            </div>

            <DialogButtons
                primaryButton={_t("action|upload")}
                hasCancel={false}
                onPrimaryButtonClick={onUploadClick}
            >
                {uploadAllButton}
            </DialogButtons>
        </BaseDialog>
    );
}
