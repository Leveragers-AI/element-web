/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/*
 * Écran « Installez l'application » (Leveragers).
 *
 * Ce fichier est importé tôt par `vector/index.ts` : il écoute `beforeinstallprompt` dès le
 * chargement de la page (Chrome ne l'envoie qu'une fois, et souvent avant la fin du démarrage),
 * puis décide s'il faut montrer l'écran. L'écran lui-même (React, styles, polices) n'est chargé
 * qu'à ce moment-là, dans un fichier à part.
 */

import { logger } from "matrix-js-sdk/src/logger";

import type { URLParams } from "../url_utils";

/**
 * Le choix « continuer dans le navigateur », retenu pour ce navigateur. Dans un cookie et non dans
 * le localStorage : Element vide le localStorage avant d'envoyer vers la page de connexion, et à
 * la déconnexion, ce qui ferait revenir l'écran.
 */
const DISMISS_COOKIE = "lvg_install_screen_dismissed";

/** Ce que l'écran doit montrer. */
export type InstallCase = "chromium" | "installed" | "safari" | "firefox";
export type InstallOs = "mac" | "win";

/** Évènement de Chrome et Edge, absent des types du DOM. */
export interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e) => {
        // Sans preventDefault, Chrome afficherait sa propre bannière : c'est notre bouton qui l'ouvre.
        e.preventDefault();
        deferredPrompt = e as BeforeInstallPromptEvent;
    });
}

/** La fenêtre d'installation de Chrome, si elle est disponible. */
export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
    return deferredPrompt;
}

export function clearDeferredPrompt(): void {
    deferredPrompt = null;
}

export interface InstallEnvironment {
    userAgent: string;
    maxTouchPoints: number;
    isElectron: boolean;
    isStandalone: boolean;
    isDismissed: boolean;
    hasInstallPrompt: boolean;
    /** `null` quand le navigateur ne sait pas le dire (tout sauf Chrome et Edge récents). */
    isInstalled: boolean | null;
    /** Sign-in return, invitation, or any in-app route (`#/room/…`) in the URL. */
    hasUrlParams: boolean;
}

/**
 * The exits that need no browser lookup: true when the screen must not be shown.
 * Run before `getInstalledRelatedApps()`, which may be slow.
 */
export function skipInstallScreen(env: Omit<InstallEnvironment, "isInstalled">): boolean {
    if (env.isElectron || env.isStandalone || env.isDismissed) return true;
    // Retour de connexion (SSO), lien d'invitation, lien vers un salon : on ne s'intercale pas.
    if (env.hasUrlParams) return true;

    const ua = env.userAgent;
    // Téléphones et tablettes : rien (Element X). Un iPad récent se présente comme un Mac tactile.
    if (/Android|iPhone|iPad|iPod|Mobile/.test(ua)) return true;
    if (/Macintosh/.test(ua) && env.maxTouchPoints > 1) return true;
    // The steps are written for macOS and Windows only (Linux, ChromeOS: nothing).
    return !/Macintosh|Windows/.test(ua);
}

/**
 * Décide quel écran montrer, ou `null` pour ne rien montrer et ouvrir l'app directement.
 * Fonction pure, testée à part.
 */
export function decideInstallCase(env: InstallEnvironment): InstallCase | null {
    if (skipInstallScreen(env)) return null;

    const ua = env.userAgent;
    if (env.isInstalled) return "installed";
    if (env.hasInstallPrompt) return "chromium";
    if (/Firefox\//.test(ua)) return "firefox";
    const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS|Edg\//.test(ua);
    // « Add to Dock » arrived with Safari 17.
    const safariVersion = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
    if (isSafari && /Macintosh/.test(ua) && safariVersion >= 17) return "safari";
    return null;
}

export function detectOs(userAgent: string): InstallOs {
    return /Macintosh|Mac OS X/.test(userAgent) ? "mac" : "win";
}

function readDismissed(): boolean {
    return document.cookie.split("; ").includes(`${DISMISS_COOKIE}=1`);
}

/** Retient « continuer dans le navigateur » pour ce navigateur (dix ans). */
export function rememberDismissal(): void {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // eslint-disable-next-line unicorn/no-document-cookie -- Cookie Store API absente de Safari et Firefox
    document.cookie = `${DISMISS_COOKIE}=1; Max-Age=315360000; Path=/; SameSite=Lax${secure}`;
}

/** How long the start of the app may wait for `getInstalledRelatedApps()`. */
export const INSTALLED_LOOKUP_TIMEOUT_MS = 500;

/** `null` (unknown, treated as not installed) when the browser cannot tell, fails or is too slow. */
async function readInstalled(): Promise<boolean | null> {
    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    if (typeof nav.getInstalledRelatedApps !== "function") return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), INSTALLED_LOOKUP_TIMEOUT_MS);
    });
    try {
        const lookup = nav.getInstalledRelatedApps().then((apps) => apps.length > 0);
        return await Promise.race([lookup, timeout]);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Montre l'écran si besoin et rend la main quand la personne choisit de rester dans le
 * navigateur. Ne lève jamais d'erreur : au pire, l'app s'ouvre comme avant.
 */
export async function showInstallScreenIfNeeded(parsedUrl: { location: string; params: URLParams }): Promise<void> {
    try {
        const isDismissed = readDismissed();
        // Rewritten on every start: Safari keeps a cookie written by script for 7 days at most.
        if (isDismissed) rememberDismissal();
        const cheapEnv = {
            userAgent: navigator.userAgent,
            maxTouchPoints: navigator.maxTouchPoints ?? 0,
            isElectron: Boolean(window.electron),
            isStandalone:
                window.matchMedia?.("(display-mode: standalone)").matches ||
                Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
            isDismissed,
            // Chrome et Edge exposent l'évènement même s'il n'a pas encore été envoyé.
            hasInstallPrompt: "onbeforeinstallprompt" in window,
            // Only the front door: like upstream's deep-link rule in `index.ts`.
            hasUrlParams: Object.keys(parsedUrl.params).length > 0 || parsedUrl.location.length > 0,
        };
        if (skipInstallScreen(cheapEnv)) return;
        const env: InstallEnvironment = { ...cheapEnv, isInstalled: await readInstalled() };
        const installCase = decideInstallCase(env);
        if (!installCase) return;

        const { renderInstallScreen } = await import(
            /* webpackChunkName: "leveragers-install-screen" */
            "./InstallScreen"
        );
        await renderInstallScreen(installCase, detectOs(env.userAgent));
    } catch (e) {
        logger.warn("Install screen skipped", e);
    }
}
