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
    hasUrlParams: boolean;
}

/**
 * Décide quel écran montrer, ou `null` pour ne rien montrer et ouvrir l'app directement.
 * Fonction pure, testée à part.
 */
export function decideInstallCase(env: InstallEnvironment): InstallCase | null {
    if (env.isElectron || env.isStandalone || env.isDismissed) return null;
    // Retour de connexion (SSO), lien d'invitation : on ne s'intercale pas.
    if (env.hasUrlParams) return null;

    const ua = env.userAgent;
    // Téléphones et tablettes : rien (Element X). Un iPad récent se présente comme un Mac tactile.
    if (/Android|iPhone|iPad|iPod|Mobile/.test(ua)) return null;
    if (/Macintosh/.test(ua) && env.maxTouchPoints > 1) return null;

    if (env.isInstalled) return "installed";
    if (env.hasInstallPrompt) return "chromium";
    if (/Firefox\//.test(ua)) return "firefox";
    const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS|Edg\//.test(ua);
    if (isSafari && /Macintosh/.test(ua)) return "safari";
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

async function readInstalled(): Promise<boolean | null> {
    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    if (typeof nav.getInstalledRelatedApps !== "function") return null;
    try {
        const apps = await nav.getInstalledRelatedApps();
        return apps.length > 0;
    } catch {
        return null;
    }
}

/**
 * Montre l'écran si besoin et rend la main quand la personne choisit de rester dans le
 * navigateur. Ne lève jamais d'erreur : au pire, l'app s'ouvre comme avant.
 */
export async function showInstallScreenIfNeeded(params: URLParams): Promise<void> {
    try {
        const env: InstallEnvironment = {
            userAgent: navigator.userAgent,
            maxTouchPoints: navigator.maxTouchPoints ?? 0,
            isElectron: Boolean(window.electron),
            isStandalone:
                window.matchMedia?.("(display-mode: standalone)").matches ||
                Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
            isDismissed: readDismissed(),
            // Chrome et Edge exposent l'évènement même s'il n'a pas encore été envoyé.
            hasInstallPrompt: "onbeforeinstallprompt" in window,
            isInstalled: await readInstalled(),
            hasUrlParams: Object.keys(params).length > 0,
        };
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
