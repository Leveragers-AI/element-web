/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import { decideInstallCase, detectOs, type InstallEnvironment } from "./installScreen";

const CHROME_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const SAFARI_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

function env(overrides: Partial<InstallEnvironment>): InstallEnvironment {
    return {
        userAgent: CHROME_MAC,
        maxTouchPoints: 0,
        isElectron: false,
        isStandalone: false,
        isDismissed: false,
        hasInstallPrompt: true,
        isInstalled: false,
        hasUrlParams: false,
        ...overrides,
    };
}

describe("decideInstallCase", () => {
    it("offers the install on Chrome and Edge", () => {
        expect(decideInstallCase(env({}))).toBe("chromium");
        expect(decideInstallCase(env({ userAgent: EDGE_WIN }))).toBe("chromium");
    });

    it("says the app is already installed when the browser knows it", () => {
        expect(decideInstallCase(env({ isInstalled: true }))).toBe("installed");
    });

    it("shows the Safari steps on a Mac", () => {
        expect(decideInstallCase(env({ userAgent: SAFARI_MAC, hasInstallPrompt: false, isInstalled: null }))).toBe(
            "safari",
        );
    });

    it("points Firefox to Chrome or Edge", () => {
        expect(decideInstallCase(env({ userAgent: FIREFOX_WIN, hasInstallPrompt: false, isInstalled: null }))).toBe(
            "firefox",
        );
    });

    it.each([
        ["inside the installed app", { isStandalone: true }],
        ["in the desktop app", { isElectron: true }],
        ["after « continue in the browser »", { isDismissed: true }],
        ["when coming back from a login or an invite link", { hasUrlParams: true }],
        ["on an iPhone", { userAgent: IPHONE, hasInstallPrompt: false }],
        ["on Android", { userAgent: ANDROID_CHROME }],
        ["on an iPad that looks like a Mac", { userAgent: SAFARI_MAC, maxTouchPoints: 5, hasInstallPrompt: false }],
    ])("shows nothing %s", (_label, overrides) => {
        expect(decideInstallCase(env(overrides as Partial<InstallEnvironment>))).toBeNull();
    });
});

describe("detectOs", () => {
    it("tells Mac from Windows", () => {
        expect(detectOs(CHROME_MAC)).toBe("mac");
        expect(detectOs(EDGE_WIN)).toBe("win");
    });
});
