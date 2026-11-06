/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";
import { getSampleFilePath } from "../../sample-files";

test.describe("Image Upload", () => {
    test.use({
        displayName: "Alice",
    });

    test.beforeEach(async ({ page, app, user }) => {
        await app.client.createRoom({ name: "My Pictures" });
        await app.viewRoomByName("My Pictures");

        // Wait until configuration is finished
        await expect(
            page
                .locator(".mx_GenericEventListSummary[data-layout='group'] .mx_GenericEventListSummary_summary")
                .getByText(`${user.displayName} created and configured the room.`),
        ).toBeVisible();
    });

    test("should show image preview when uploading an image", { tag: "@screenshot" }, async ({ page, app }) => {
        await app.setComposerInputFiles("room", getSampleFilePath("riot.png"));

        await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Close dialog" })).toBeEnabled();
        await expect(page.locator(".mx_Dialog")).toMatchScreenshot("image-upload-preview.png");
    });

    test("should send a message typed in the upload dialog as the caption of the image", async ({ page, app }) => {
        await app.setComposerInputFiles("room", getSampleFilePath("riot.png"));

        const dialog = page.locator(".mx_Dialog");
        const message = dialog.getByRole("textbox", { name: "Add a message" });
        await expect(message).toBeFocused();
        await message.fill("What is in this picture?");
        await dialog.getByRole("button", { name: "Upload" }).click();

        await app.timeline.scrollToBottom();
        const tile = page.locator(".mx_EventTile_last");
        await expect(tile.locator(".mx_ImageBody")).toBeVisible();
        await expect(tile.getByText("What is in this picture?")).toBeVisible();
    });

    test("should allow upload via drag and drop", { tag: "@screenshot" }, async ({ page, app }) => {
        await app.composerDragAndUploadFiles("room", getSampleFilePath("riot.png"), "image/png");
        await app.timeline.scrollToBottom();
        const imgTile = page.locator(".mx_ImageBody").first();
        await expect(imgTile).toBeVisible();
    });
});
