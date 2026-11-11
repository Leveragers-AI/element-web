/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
    decideInstallCase,
    detectOs,
    INSTALLED_LOOKUP_TIMEOUT_MS,
    type InstallEnvironment,
    showInstallScreenIfNeeded,
} from "./installScreen";
import { renderInstallScreen } from "./InstallScreen";
import { parseAppUrl } from "../url_utils";

vi.mock("./InstallScreen", () => ({ renderInstallScreen: vi.fn() }));

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

/** Test helper; the code under test uses `document.cookie` too (no Cookie Store API in Safari/Firefox). */
function writeCookie(value: string): void {
    // eslint-disable-next-line unicorn/no-document-cookie
    document.cookie = value;
}

describe("showInstallScreenIfNeeded", () => {
    const COOKIE = "lvg_install_screen_dismissed";
    const lookup = vi.fn<() => Promise<unknown[]>>();
    const at = (url: string): ReturnType<typeof parseAppUrl> => parseAppUrl(new URL(url));

    beforeEach(() => {
        vi.mocked(renderInstallScreen).mockReset().mockResolvedValue(undefined);
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME_MAC);
        lookup.mockReset().mockResolvedValue([]);
        Object.defineProperty(navigator, "getInstalledRelatedApps", { value: lookup, configurable: true });
        Object.defineProperty(window, "onbeforeinstallprompt", { value: null, configurable: true, writable: true });
        writeCookie(`${COOKIE}=; Max-Age=0; Path=/`);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete (navigator as { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps;
        delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
        writeCookie(`${COOKIE}=; Max-Age=0; Path=/`);
    });

    it.each([
        "https://agents.leveragers.com/",
        "https://agents.leveragers.com/#",
        "https://agents.leveragers.com/index.html",
    ])("shows the screen at the front door: %s", async (url) => {
        await showInstallScreenIfNeeded(at(url));
        expect(renderInstallScreen).toHaveBeenCalledWith("chromium", "mac");
    });

    it.each([
        "https://agents.leveragers.com/#/home",
        "https://agents.leveragers.com/#/login",
        "https://agents.leveragers.com/#/welcome",
        "https://agents.leveragers.com/#/room/!abc:chat.leveragers.com",
        "https://agents.leveragers.com/#/room/#general:chat.leveragers.com",
        "https://agents.leveragers.com/?loginToken=abc",
        "https://agents.leveragers.com/#code=abc&state=def",
        "https://agents.leveragers.com/#/register?client_secret=a&session_id=b&hs_url=c&is_url=d&sid=e",
    ])("skips the screen, without asking the browser, for %s", async (url) => {
        await showInstallScreenIfNeeded(at(url));
        expect(renderInstallScreen).not.toHaveBeenCalled();
        expect(lookup).not.toHaveBeenCalled();
    });

    it("does not ask the browser once the screen was dismissed, and refreshes the cookie", async () => {
        writeCookie(`${COOKIE}=1; Path=/`);
        const setCookie = vi.spyOn(document, "cookie", "set");
        await showInstallScreenIfNeeded(at("https://agents.leveragers.com/"));
        expect(renderInstallScreen).not.toHaveBeenCalled();
        expect(lookup).not.toHaveBeenCalled();
        expect(setCookie).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${COOKIE}=1; Max-Age=\\d+; Path=/`)));
    });

    it("writes no cookie when the screen was never dismissed", async () => {
        const setCookie = vi.spyOn(document, "cookie", "set");
        await showInstallScreenIfNeeded(at("https://agents.leveragers.com/"));
        expect(setCookie).not.toHaveBeenCalled();
    });

    it("does not ask the browser on a phone", async () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID_CHROME);
        await showInstallScreenIfNeeded(at("https://agents.leveragers.com/"));
        expect(lookup).not.toHaveBeenCalled();
        expect(renderInstallScreen).not.toHaveBeenCalled();
    });

    it("says the app is installed when the browser says so", async () => {
        lookup.mockResolvedValue([{ platform: "webapp" }]);
        await showInstallScreenIfNeeded(at("https://agents.leveragers.com/"));
        expect(renderInstallScreen).toHaveBeenCalledWith("installed", "mac");
    });

    it("stops waiting for a browser that never answers, as if the app were not installed", async () => {
        vi.useFakeTimers();
        lookup.mockReturnValue(new Promise(() => {}));
        const shown = showInstallScreenIfNeeded(at("https://agents.leveragers.com/"));
        await vi.advanceTimersByTimeAsync(INSTALLED_LOOKUP_TIMEOUT_MS);
        await shown;
        expect(renderInstallScreen).toHaveBeenCalledWith("chromium", "mac");
    });

    it("treats a failing lookup as not installed", async () => {
        lookup.mockImplementation(() => {
            throw new Error("not allowed");
        });
        await showInstallScreenIfNeeded(at("https://agents.leveragers.com/"));
        expect(renderInstallScreen).toHaveBeenCalledWith("chromium", "mac");
    });

    it("never rejects when the screen fails, so the app still starts", async () => {
        vi.mocked(renderInstallScreen).mockRejectedValue(new Error("chunk failed"));
        await expect(showInstallScreenIfNeeded(at("https://agents.leveragers.com/"))).resolves.toBeUndefined();
    });
});
