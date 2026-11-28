/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/*
 * Sign-in routing (Leveragers): which chat server an email signs in on, asked of the front door
 * (`login.leveragers.com`, one small file per enterprise domain or Microsoft tenant) before
 * Element's sign-in starts. Same rules in the web, iOS and Android apps.
 */

/** The pro chat server: every email without an enterprise entry signs in there. */
export const PRO_SERVER = "chat.leveragers.com";

/** Read from config.json `leveragers_front_door_url` (a test site points it at a mock). */
export const DEFAULT_FRONT_DOOR_URL = "https://login.leveragers.com";

/** Each request of a lookup gives up after this. */
export const LOOKUP_TIMEOUT_MS = 8000;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
const SERVER_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*\\.leveragers\\.com$`);
const MICROSOFT_ISSUER_RE =
    /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0\/?$/i;
const NON_ASCII_RE = /[\u0080-￿]/;

/** The only chat servers the app signs in on: the pro server, or a name under `.leveragers.com`. */
export function isAllowedServer(server: unknown): server is string {
    return typeof server === "string" && (server === PRO_SERVER || SERVER_RE.test(server));
}

export type LookupResult = { server: string } | { error: "invalid_email" | "front_door" };

const FRONT_DOOR_ERROR: LookupResult = { error: "front_door" };

type Fetch = typeof fetch;

/**
 * GET a JSON file. `body` is `undefined` unless the answer is a 200 holding JSON.
 * Throws on a network error or after {@link LOOKUP_TIMEOUT_MS}.
 */
async function getJson(url: string, fetchFn: Fetch): Promise<{ status: number; body?: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
        const response = await fetchFn(url, { signal: controller.signal, credentials: "omit" });
        if (response.status !== 200) return { status: response.status };
        try {
            return { status: 200, body: await response.json() };
        } catch (e) {
            if (controller.signal.aborted) throw e;
            return { status: 200 };
        }
    } finally {
        clearTimeout(timer);
    }
}

/** A front-door file: `{"v": 1, "server": "<allowed server>"}`, anything else is an error. */
function serverFrom(body: unknown): LookupResult {
    if (typeof body !== "object" || body === null || Array.isArray(body)) return FRONT_DOOR_ERROR;
    const file = body as { v?: unknown; server?: unknown };
    return file.v === 1 && isAllowedServer(file.server) ? { server: file.server } : FRONT_DOOR_ERROR;
}

/** The Microsoft tenant ID of a domain, lowercased; `null` on any failure. */
async function microsoftTenant(domain: string, fetchFn: Fetch): Promise<string | null> {
    try {
        const { body } = await getJson(
            `https://login.microsoftonline.com/${domain}/v2.0/.well-known/openid-configuration`,
            fetchFn,
        );
        const issuer = (body as { issuer?: unknown } | null | undefined)?.issuer;
        if (typeof issuer !== "string") return null;
        return MICROSOFT_ISSUER_RE.exec(issuer)?.[1].toLowerCase() ?? null;
    } catch {
        return null;
    }
}

/**
 * The chat server for a typed email.
 * - non-ASCII domain: the pro server, without asking anything;
 * - malformed address: `invalid_email`;
 * - front door unreachable, slow, refusing or malformed: `front_door`, never the pro server;
 * - Microsoft failure: the pro server.
 */
export async function findServer(
    input: string,
    frontDoorUrl: string = DEFAULT_FRONT_DOOR_URL,
    fetchFn: Fetch = (...args) => fetch(...args),
): Promise<LookupResult> {
    const email = input.trim();
    const at = email.lastIndexOf("@");
    const rawDomain = at < 0 ? "" : email.slice(at + 1);
    if (NON_ASCII_RE.test(rawDomain)) return { server: PRO_SERVER };
    const domain = rawDomain.toLowerCase();
    if (!DOMAIN_RE.test(domain)) return { error: "invalid_email" };

    const base = frontDoorUrl.replace(/\/+$/, "");
    try {
        const byDomain = await getJson(`${base}/d/${domain}.json`, fetchFn);
        if (byDomain.status === 200) return serverFrom(byDomain.body);
        if (byDomain.status !== 404) return FRONT_DOOR_ERROR;

        const tenant = await microsoftTenant(domain, fetchFn);
        if (!tenant) return { server: PRO_SERVER };

        const byTenant = await getJson(`${base}/t/${tenant}.json`, fetchFn);
        if (byTenant.status === 200) return serverFrom(byTenant.body);
        if (byTenant.status === 404) return { server: PRO_SERVER };
        return FRONT_DOOR_ERROR;
    } catch {
        return FRONT_DOOR_ERROR;
    }
}

/**
 * The last email typed on this browser, to pre-fill the field. In a cookie, not in localStorage:
 * Element empties localStorage at sign-out, which is exactly when the field shows again.
 * Never throws: without cookies, the field simply starts empty.
 */
const LAST_EMAIL_COOKIE = "lvg_last_email";

export function readLastEmail(): string {
    try {
        const prefix = `${LAST_EMAIL_COOKIE}=`;
        const entry = document.cookie.split("; ").find((c) => c.startsWith(prefix));
        return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
    } catch {
        return "";
    }
}

export function rememberEmail(email: string): void {
    if (!email) return;
    try {
        const secure = window.location.protocol === "https:" ? "; Secure" : "";
        // eslint-disable-next-line unicorn/no-document-cookie -- no Cookie Store API in Safari and Firefox
        document.cookie = `${LAST_EMAIL_COOKIE}=${encodeURIComponent(email)}; Max-Age=315360000; Path=/; SameSite=Strict${secure}`;
    } catch {
        // Cookies blocked.
    }
}

/** Called at every start: Safari keeps a cookie written by script for 7 days at most. */
export function keepLastEmail(): void {
    rememberEmail(readLastEmail());
}
