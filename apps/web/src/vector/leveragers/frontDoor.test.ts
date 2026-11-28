/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    findServer,
    isAllowedServer,
    keepLastEmail,
    LOOKUP_TIMEOUT_MS,
    PRO_SERVER,
    readLastEmail,
    rememberEmail,
} from "./frontDoor";

const BASE = "https://front.example";
const TID = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const msUrl = (domain: string): string =>
    `https://login.microsoftonline.com/${domain}/v2.0/.well-known/openid-configuration`;

type Answer = number | { status?: number; body: unknown } | "network" | "hang" | "not-json";

/** A fake `fetch` answering by URL; a URL without an answer fails the test. */
function fakeFetch(answers: Record<string, Answer>): typeof fetch & { urls: string[] } {
    const urls: string[] = [];
    const fn = (async (url: string, init?: RequestInit): Promise<Response> => {
        urls.push(url);
        const answer = answers[url];
        if (answer === undefined) throw new Error(`unexpected request ${url}`);
        if (answer === "network") throw new TypeError("Failed to fetch");
        if (answer === "hang") {
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            });
        }
        if (answer === "not-json") return new Response("<html>", { status: 200 });
        if (typeof answer === "number") return new Response(null, { status: answer });
        return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
    }) as typeof fetch & { urls: string[] };
    fn.urls = urls;
    return fn;
}

const file = (server: unknown): Answer => ({ body: { v: 1, server } });
const msIssuer = (tid: string): Answer => ({ body: { issuer: `https://login.microsoftonline.com/${tid}/v2.0` } });

describe("findServer", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("signs a non-ASCII domain in on the pro server without asking anything", async () => {
        const f = fakeFetch({});
        expect(await findServer("marie@société.fr", BASE, f)).toEqual({ server: PRO_SERVER });
        expect(await findServer("marie@exampLE.cOMK", BASE, f)).toEqual({ server: PRO_SERVER });
        expect(f.urls).toEqual([]);
    });

    it.each(["", "marie", "marie@", "marie@localhost", "marie@-example.com", "marie@example..com", "a@b_c.com"])(
        "refuses the malformed address %j without asking anything",
        async (input) => {
            const f = fakeFetch({});
            expect(await findServer(input, BASE, f)).toEqual({ error: "invalid_email" });
            expect(f.urls).toEqual([]);
        },
    );

    it("trims, takes the part after the last @ and lowercases it", async () => {
        const f = fakeFetch({ [`${BASE}/d/acme.example.json`]: file("acme.chat.leveragers.com") });
        expect(await findServer('  "a@b"@ACME.Example  ', `${BASE}/`, f)).toEqual({
            server: "acme.chat.leveragers.com",
        });
        expect(f.urls).toEqual([`${BASE}/d/acme.example.json`]);
    });

    it("uses the domain file when there is one", async () => {
        const f = fakeFetch({ [`${BASE}/d/theseis.example.json`]: file("theseis.chat.leveragers.com") });
        expect(await findServer("jo@theseis.example", BASE, f)).toEqual({ server: "theseis.chat.leveragers.com" });
    });

    it.each([
        ["a server outside .leveragers.com", file("chat.example.com")],
        ["a look-alike domain", file("evilleragers.com")],
        ["the bare domain", file("leveragers.com")],
        ["a suffix trick", file("chat.leveragers.com.example.com")],
        ["an uppercase name", file("Chat.leveragers.com")],
        ["another version", { body: { v: 2, server: PRO_SERVER } }],
        ["a version as text", { body: { v: "1", server: PRO_SERVER } }],
        ["no server", { body: { v: 1 } }],
        ["a number as server", file(42)],
        ["an array", { body: [{ v: 1, server: PRO_SERVER }] }],
        ["null", { body: null }],
        ["no JSON", "not-json" as Answer],
    ])("treats a domain file with %s as a front-door error", async (_label, answer) => {
        const f = fakeFetch({ [`${BASE}/d/acme.example.json`]: answer });
        expect(await findServer("jo@acme.example", BASE, f)).toEqual({ error: "front_door" });
    });

    it.each([403, 429, 500, 503, 204, 301])("treats a %i from the front door as a front-door error", async (status) => {
        const f = fakeFetch({ [`${BASE}/d/acme.example.json`]: status });
        expect(await findServer("jo@acme.example", BASE, f)).toEqual({ error: "front_door" });
        expect(f.urls).toHaveLength(1);
    });

    it("treats a network error as a front-door error", async () => {
        const f = fakeFetch({ [`${BASE}/d/acme.example.json`]: "network" });
        expect(await findServer("jo@acme.example", BASE, f)).toEqual({ error: "front_door" });
    });

    it("gives up on a slow front door after the timeout", async () => {
        vi.useFakeTimers();
        const f = fakeFetch({ [`${BASE}/d/acme.example.json`]: "hang" });
        const result = findServer("jo@acme.example", BASE, f);
        await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS);
        expect(await result).toEqual({ error: "front_door" });
    });

    describe("without a domain file", () => {
        const d = `${BASE}/d/contoso.example.json`;
        const t = `${BASE}/t/${TID}.json`;

        it("uses the Microsoft tenant file when there is one", async () => {
            const f = fakeFetch({
                [d]: 404,
                [msUrl("contoso.example")]: msIssuer(TID),
                [t]: file("contoso.leveragers.com"),
            });
            expect(await findServer("jo@contoso.example", BASE, f)).toEqual({ server: "contoso.leveragers.com" });
            expect(f.urls).toEqual([d, msUrl("contoso.example"), t]);
        });

        it("lowercases the tenant ID and accepts an issuer without the last slash or in capitals", async () => {
            const f = fakeFetch({
                [d]: 404,
                [msUrl("contoso.example")]: {
                    body: { issuer: `HTTPS://LOGIN.MICROSOFTONLINE.COM/${TID.toUpperCase()}/V2.0/` },
                },
                [t]: file("contoso.leveragers.com"),
            });
            expect(await findServer("jo@contoso.example", BASE, f)).toEqual({ server: "contoso.leveragers.com" });
        });

        it("signs in on the pro server when the tenant has no file", async () => {
            const f = fakeFetch({ [d]: 404, [msUrl("contoso.example")]: msIssuer(TID), [t]: 404 });
            expect(await findServer("jo@contoso.example", BASE, f)).toEqual({ server: PRO_SERVER });
        });

        it.each([500, 429, "network" as Answer, file("chat.example.com")])(
            "treats a tenant file answer %j as a front-door error",
            async (answer) => {
                const f = fakeFetch({ [d]: 404, [msUrl("contoso.example")]: msIssuer(TID), [t]: answer });
                expect(await findServer("jo@contoso.example", BASE, f)).toEqual({ error: "front_door" });
            },
        );

        it.each([
            ["an unknown domain (400)", 400 as Answer],
            ["a Microsoft outage", 500 as Answer],
            ["a network error", "network" as Answer],
            ["no JSON", "not-json" as Answer],
            ["no issuer", { body: {} }],
            ["another issuer", { body: { issuer: "https://sts.windows.net/" + TID + "/" } }],
            ["a tenant ID that is not one", { body: { issuer: "https://login.microsoftonline.com/common/v2.0" } }],
        ])("signs in on the pro server after %s", async (_label, answer) => {
            const f = fakeFetch({ [d]: 404, [msUrl("contoso.example")]: answer });
            expect(await findServer("jo@contoso.example", BASE, f)).toEqual({ server: PRO_SERVER });
            expect(f.urls).toEqual([d, msUrl("contoso.example")]);
        });

        it("signs in on the pro server when Microsoft is too slow", async () => {
            vi.useFakeTimers();
            const f = fakeFetch({ [d]: 404, [msUrl("contoso.example")]: "hang" });
            const result = findServer("jo@contoso.example", BASE, f);
            await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS);
            expect(await result).toEqual({ server: PRO_SERVER });
        });
    });
});

describe("isAllowedServer", () => {
    it.each(["chat.leveragers.com", "theseis.chat.leveragers.com", "acme.leveragers.com", "a-b.c.leveragers.com"])(
        "accepts %s",
        (server) => expect(isAllowedServer(server)).toBe(true),
    );

    it.each([
        "leveragers.com",
        "chat.example.com",
        "evilleragers.com",
        "x.leveragers.com.example",
        "-a.leveragers.com",
        "",
        3,
    ])("refuses %j", (server) => expect(isAllowedServer(server)).toBe(false));
});

describe("last email", () => {
    afterEach(() => {
        // eslint-disable-next-line unicorn/no-document-cookie -- the cookie under test
        document.cookie = "lvg_last_email=; Max-Age=0; Path=/";
    });

    it("is empty at first, then gives back what was remembered", () => {
        expect(readLastEmail()).toBe("");
        rememberEmail("Jo.Doe+x@Example.com");
        expect(readLastEmail()).toBe("Jo.Doe+x@Example.com");
        keepLastEmail();
        expect(readLastEmail()).toBe("Jo.Doe+x@Example.com");
    });

    it("writes nothing for an empty email", () => {
        keepLastEmail();
        expect(document.cookie).not.toContain("lvg_last_email");
    });
});
