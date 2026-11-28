/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/*
 * Email screen (Leveragers): what a signed-out app shows instead of Element's welcome and sign-in
 * pages. The front door picks the chat server for the email (`frontDoor.ts`), then Element's own
 * sign-in starts on that server with the email as `login_hint`. Drawn over the page in its own
 * React root, with the install screen's look; Element's root is not touched.
 */

import React, { type JSX, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { _t } from "../../languageHandler";
import { installScreenCss } from "./installScreenStyles";
import { Icon, Mark } from "./InstallScreen";
import { findServer, readLastEmail, rememberEmail } from "./frontDoor";

/** Starts Element's sign-in on `server` with `email` as hint; `false` when it could not start. */
export type StartSignIn = (server: string, email: string) => Promise<boolean>;

const signInCss = `
.lvgI-form{margin-top:24px;display:grid;gap:8px}
.lvgI-label{font-size:.875rem;font-weight:600;color:var(--ink)}
.lvgI-input{width:100%;min-height:44px;padding:0 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:var(--ink);font:inherit;font-size:1rem;margin:0}
.lvgI-input:focus-visible{outline:2px solid var(--primary);outline-offset:1px;border-color:var(--primary)}
.lvgI-input[aria-invalid="true"]{border-color:#b91c1c}
.lvgInstall .lvgI-error{font-size:.8125rem;color:#b91c1c}
.lvgI-form .lvgI-btn{margin-top:8px}
.lvgI-btn[aria-busy="true"]::after{content:"";width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:lvgS-spin .8s linear infinite}
@keyframes lvgS-spin{to{transform:rotate(360deg)}}
`;

interface Props {
    frontDoorUrl: string;
    startSignIn: StartSignIn;
}

export function SignInScreen({ frontDoorUrl, startSignIn }: Props): JSX.Element {
    const [email, setEmail] = useState(readLastEmail);
    const [error, setError] = useState<"invalid_email" | "front_door" | null>(null);
    const [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        input.current?.focus();
        // Back from the sign-in page, the browser may restore this page as it was left: busy.
        const onPageShow = (e: PageTransitionEvent): void => {
            if (e.persisted) setBusy(false);
        };
        window.addEventListener("pageshow", onPageShow);
        return () => window.removeEventListener("pageshow", onPageShow);
    }, []);

    const onSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (busy) return;
        const typed = email.trim();
        setBusy(true);
        setError(null);
        const found = await findServer(typed, frontDoorUrl);
        if ("error" in found) {
            if (found.error === "front_door") rememberEmail(typed);
            setError(found.error);
            setBusy(false);
            return;
        }
        rememberEmail(typed);
        let started = false;
        try {
            started = await startSignIn(found.server, typed);
        } catch {
            started = false;
        }
        // On success the browser is leaving for the sign-in page: stay busy until it goes.
        if (!started) {
            setError("front_door");
            setBusy(false);
        }
    };

    let errorText: string | null = null;
    if (error === "invalid_email") errorText = _t("leveragers_sign_in|invalid_email");
    if (error === "front_door") errorText = _t("leveragers_sign_in|front_door_error");

    return (
        <div className="lvgInstall" role="dialog" aria-modal="true" aria-labelledby="lvgS-title">
            <aside className="lvgI-brand">
                <div className="lvgI-lockup">
                    <Mark />
                    <div>
                        <p className="lvgI-name lvgI-display">Agents</p>
                        <p className="lvgI-by">by Leveragers</p>
                    </div>
                </div>
                <div className="lvgI-pitch">
                    <h2>{_t("leveragers_install|hero_title")}</h2>
                </div>
                <ul>
                    <li>
                        <Icon name="shield" />
                        {_t("leveragers_install|brand_encrypted")}
                    </li>
                    <li>
                        <Icon name="lock" />
                        {_t("leveragers_install|brand_private")}
                    </li>
                </ul>
            </aside>
            <main className="lvgI-main">
                <section className="lvgI-content">
                    <h1 id="lvgS-title">{_t("action|sign_in")}</h1>
                    <form className="lvgI-form" noValidate onSubmit={onSubmit}>
                        <label className="lvgI-label" htmlFor="lvgS-email">
                            {_t("leveragers_sign_in|email_label")}
                        </label>
                        {/* type="text": Chrome's type="email" turns a non-ASCII domain into punycode. */}
                        <input
                            ref={input}
                            id="lvgS-email"
                            className="lvgI-input"
                            type="text"
                            inputMode="email"
                            autoComplete="email"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            aria-invalid={error === "invalid_email"}
                            aria-describedby={errorText ? "lvgS-error" : undefined}
                        />
                        {errorText && (
                            <p id="lvgS-error" className="lvgI-error" role="alert">
                                {errorText}
                            </p>
                        )}
                        <button type="submit" className="lvgI-btn lvgI-btn-primary" disabled={busy} aria-busy={busy}>
                            {_t("leveragers_sign_in|continue")}
                        </button>
                    </form>
                </section>
            </main>
        </div>
    );
}

let shown = false;

/**
 * Shows the screen over the page, once. It stays until the browser leaves for the sign-in page:
 * a signed-out app has nothing else to show.
 */
export function renderSignInScreen(frontDoorUrl: string, startSignIn: StartSignIn): void {
    if (shown) return;
    shown = true;
    const style = document.createElement("style");
    style.textContent = installScreenCss + signInCss;
    document.head.appendChild(style);
    const container = document.createElement("div");
    document.body.appendChild(container);
    createRoot(container).render(
        <StrictMode>
            <SignInScreen frontDoorUrl={frontDoorUrl} startSignIn={startSignIn} />
        </StrictMode>,
    );
}
