/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type ComponentProps, type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type ImageContent } from "matrix-js-sdk/src/types";
import ChevronLeftIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import ChevronRightIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-right";

import ImageView from "../elements/ImageView";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { _t, getCurrentLanguage } from "../../../languageHandler";
import { mediaFromContent } from "../../../customisations/Media";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { isMimeTypeAllowed } from "../../../utils/blobs";
import { findGalleryImages } from "../../../utils/leveragers/imageGallery";

// Leveragers: Element's lightbox (ImageView) shows one image. This wrapper adds "previous" and "next" (buttons and
// the left/right arrow keys) between the images of the room. ImageView itself is untouched: each image is a fresh
// ImageView, so zoom and rotation start again. With a single image, it is exactly Element's lightbox.

const logger = rootLogger.getChild("ImageGallery:");

type ImageViewProps = ComponentProps<typeof ImageView>;

const LABELS: Record<"previous" | "next", Record<string, string>> = {
    previous: { fr: "Image précédente", en: "Previous image" },
    next: { fr: "Image suivante", en: "Next image" },
};

function label(key: keyof typeof LABELS): string {
    const lang = getCurrentLanguage().split("-")[0];
    return LABELS[key][lang] ?? LABELS[key].en;
}

/** The URL the lightbox can show for `event`, decrypting it first in an encrypted room. */
async function imageUrl(event: MatrixEvent, helpers: Map<string, MediaEventHelper>): Promise<string | null> {
    const media = mediaFromContent(event.getContent<ImageContent>());
    if (!media.isEncrypted) return media.srcHttp;
    const id = event.getId()!;
    let helper = helpers.get(id);
    if (!helper) {
        helper = new MediaEventHelper(event);
        helpers.set(id, helper);
    }
    const url = await helper.sourceUrl.value;
    // Same rule as the timeline: a type the browser may not render safely is shown as its thumbnail.
    const blob = await helper.sourceBlob.value;
    return isMimeTypeAllowed(blob.type) ? url : await helper.thumbnailUrl.value;
}

function viewProps(event: MatrixEvent, src: string, base: ImageViewProps): ImageViewProps {
    const content = event.getContent<ImageContent>();
    return {
        src,
        name: content.body && content.body.length > 0 ? content.body : _t("common|attachment"),
        mxEvent: event,
        permalinkCreator: base.permalinkCreator,
        width: content.info?.w,
        height: content.info?.h,
        fileSize: content.info?.size,
        onFinished: () => base.onFinished(),
    };
}

const buttonStyle = (side: "left" | "right"): React.CSSProperties => ({
    position: "fixed",
    top: "calc(50% + var(--image-view-panel-height) / 2)",
    [side]: "var(--cpd-space-4x)",
    transform: "translateY(-50%)",
    width: "44px",
    height: "44px",
    padding: "10px",
    border: "none",
    borderRadius: "50%",
    background: "#21262c", // same as the lightbox close button, on all themes
    color: "#fff",
    cursor: "pointer",
    pointerEvents: "auto",
});

export default function ImageGalleryView(props: ImageViewProps): JSX.Element {
    const images = useMemo(
        () => (props.mxEvent ? findGalleryImages(MatrixClientPeg.safeGet(), props.mxEvent) : []),
        // Computed once, when the lightbox opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );
    const [index, setIndex] = useState(() => images.findIndex((ev) => ev.getId() === props.mxEvent?.getId()));
    const [current, setCurrent] = useState<ImageViewProps>(props);
    const helpers = useRef(new Map<string, MediaEventHelper>());
    const pending = useRef(0);

    useEffect(() => {
        const map = helpers.current;
        return () => map.forEach((helper) => helper.destroy());
    }, []);

    const go = useCallback(
        (delta: number): void => {
            const target = index + delta;
            if (index < 0 || target < 0 || target >= images.length) return;
            const event = images[target];
            const request = ++pending.current;
            imageUrl(event, helpers.current)
                .then((src) => {
                    // A later arrow press wins. The current image stays until the next one is ready.
                    if (request !== pending.current || !src) return;
                    setIndex(target);
                    setCurrent(viewProps(event, src, props));
                })
                .catch((e) => logger.warn("Could not load image", event.getId(), e));
        },
        [index, images, props],
    );

    useEffect(() => {
        if (images.length < 2) return;
        const onKeyDown = (ev: KeyboardEvent): void => {
            if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
            if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
            ev.preventDefault();
            ev.stopPropagation();
            go(ev.key === "ArrowLeft" ? -1 : 1);
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [go, images.length]);

    if (images.length < 2 || index < 0) return <ImageView {...props} />;

    return (
        <>
            <ImageView key={current.mxEvent?.getId()} {...current} />
            {index > 0 && (
                <button
                    type="button"
                    className="mx_LeveragersImageGallery_previous"
                    aria-label={label("previous")}
                    title={label("previous")}
                    style={buttonStyle("left")}
                    onClick={() => go(-1)}
                >
                    <ChevronLeftIcon width="24px" height="24px" />
                </button>
            )}
            {index < images.length - 1 && (
                <button
                    type="button"
                    className="mx_LeveragersImageGallery_next"
                    aria-label={label("next")}
                    title={label("next")}
                    style={buttonStyle("right")}
                    onClick={() => go(1)}
                >
                    <ChevronRightIcon width="24px" height="24px" />
                </button>
            )}
        </>
    );
}
