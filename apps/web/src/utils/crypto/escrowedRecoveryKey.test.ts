/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";
import fetchMock from "@fetch-mock/vitest";
import { type IDownloadKeyResult, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { type CryptoApi, decodeRecoveryKey } from "matrix-js-sdk/src/crypto-api";
import { type ServerSideSecretStorage } from "matrix-js-sdk/src/secret-storage";
import { stubClient } from "test-utils";

import { accessSecretStorage, crossSigningCallbacks } from "../../SecurityManager";
import { confirmDeviceWithEscrowedRecoveryKey, ESCROW_PATH } from "./escrowedRecoveryKey";

vi.mock("../../SecurityManager", () => ({
    accessSecretStorage: vi.fn(),
    withSecretStorageKeyCache: vi.fn((fn: () => Promise<unknown>) => fn()),
    crossSigningCallbacks: { cacheSecretStorageKey: vi.fn() },
}));
const mockDeviceListener = vi.hoisted(() => ({ recheck: vi.fn(), getDeviceState: vi.fn(() => "ok") }));
vi.mock("../../device-listener", () => ({ DeviceListener: { sharedInstance: () => mockDeviceListener } }));
vi.mock("matrix-js-sdk/src/crypto-api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("matrix-js-sdk/src/crypto-api")>()),
    decodeRecoveryKey: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
}));

describe("confirmDeviceWithEscrowedRecoveryKey", () => {
    const url = "https://matrix.example.com" + ESCROW_PATH;
    const keyInfo = { algorithm: "m.secret_storage.v1.aes-hmac-sha2" };
    let client: Mocked<MatrixClient>;
    let mockCrypto: Mocked<CryptoApi>;
    let mockSecretStorage: Mocked<ServerSideSecretStorage>;
    // What the homeserver's /keys/query shows for this device.
    let server: { uploaded: boolean; signed: boolean; queries: number; uploadedAtQuery?: number };
    const confirm = () => confirmDeviceWithEscrowedRecoveryKey(client, { waitMs: 50, pollMs: 1 });

    beforeEach(() => {
        server = { uploaded: true, signed: false, queries: 0 };
        client = vi.mocked(stubClient());
        client.getHomeserverUrl.mockReturnValue("https://matrix.example.com/");
        client.getAccessToken.mockReturnValue("token-of-this-account");
        client.downloadKeysForUsers = vi.fn().mockImplementation(async ([userId]: string[]) => {
            if (++server.queries === server.uploadedAtQuery) server.uploaded = true;
            const device = { signatures: { [userId]: server.signed ? { "ed25519:ssk": "sig" } : {} } };
            return {
                device_keys: { [userId]: server.uploaded ? { [client.getDeviceId()!]: device } : {} },
                self_signing_keys: { [userId]: { keys: { "ed25519:ssk": "ssk" } } },
            } as unknown as IDownloadKeyResult;
        });
        mockCrypto = {
            getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
            loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(),
            restoreKeyBackup: vi.fn(),
            isDehydrationSupported: vi.fn().mockResolvedValue(false),
            getCrossSigningKeyId: vi.fn().mockResolvedValue("masterkeyid"),
            crossSignDevice: vi.fn().mockImplementation(async () => {
                server.signed = true;
            }),
            getDeviceVerificationStatus: vi.fn().mockResolvedValue({ crossSigningVerified: true }),
        } as unknown as Mocked<CryptoApi>;
        client.getCrypto.mockReturnValue(mockCrypto);
        mockSecretStorage = {
            getDefaultKeyId: vi.fn().mockResolvedValue("keyid"),
            getKey: vi.fn().mockResolvedValue(["keyid", keyInfo]),
            checkKey: vi.fn().mockResolvedValue(true),
        } as unknown as Mocked<ServerSideSecretStorage>;
        Object.defineProperty(client, "secretStorage", { value: mockSecretStorage });
        vi.mocked(accessSecretStorage)
            .mockReset()
            .mockImplementation(async (func) => {
                // signing the device: the signature only sticks if the device keys are already on the server
                server.signed = server.uploaded;
                await func?.();
            });
        vi.mocked(crossSigningCallbacks.cacheSecretStorageKey!).mockClear();
    });

    it("does nothing when the endpoint does not exist", async () => {
        fetchMock.post(url, 404);
        expect(await confirm()).toBe(false);
        expect(accessSecretStorage).not.toHaveBeenCalled();
    });

    it("does nothing when the endpoint is unreachable", async () => {
        fetchMock.post(url, { throws: new TypeError("Failed to fetch") });
        expect(await confirm()).toBe(false);
        expect(accessSecretStorage).not.toHaveBeenCalled();
    });

    it("does nothing when the key does not open secret storage", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 wrong" });
        mockSecretStorage.checkKey.mockResolvedValue(false);
        expect(await confirm()).toBe(false);
        expect(accessSecretStorage).not.toHaveBeenCalled();
    });

    it("does nothing when unlocking secret storage fails", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        vi.mocked(accessSecretStorage).mockRejectedValue(new Error("boom"));
        expect(await confirm()).toBe(false);
    });

    it("confirms the device with the escrowed key, then restores the key backup", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        expect(await confirm()).toBe(true);

        const call = fetchMock.callHistory.lastCall(url)!;
        expect(new Headers(call.options.headers as HeadersInit).get("authorization")).toBe(
            "Bearer token-of-this-account",
        );
        expect(decodeRecoveryKey).toHaveBeenCalledWith("EsT0 good");
        expect(crossSigningCallbacks.cacheSecretStorageKey).toHaveBeenCalledWith(
            "keyid",
            keyInfo,
            new Uint8Array([1, 2, 3]),
        );
        expect(accessSecretStorage).toHaveBeenCalled();
        expect(mockDeviceListener.recheck).toHaveBeenCalled();
        await vi.waitFor(() => expect(mockCrypto.restoreKeyBackup).toHaveBeenCalled());
        expect(mockCrypto.loadSessionBackupPrivateKeyFromSecretStorage).toHaveBeenCalled();
    });

    it("signs only once the device keys are on the server", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        server.uploaded = false;
        server.uploadedAtQuery = 3; // keys/upload lands late
        expect(await confirm()).toBe(true);
        expect(mockCrypto.crossSignDevice).not.toHaveBeenCalled();
    });

    it("falls back when the device keys never reach the server", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        server.uploaded = false;
        expect(await confirm()).toBe(false);
        expect(accessSecretStorage).not.toHaveBeenCalled();
    });

    it("signs the device again when the server lost the signature", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        vi.mocked(accessSecretStorage).mockImplementation(async (func) => func?.()); // signature lost
        expect(await confirm()).toBe(true);
        expect(mockCrypto.crossSignDevice).toHaveBeenCalledTimes(1);
    });

    it("falls back when the server never shows the device signature", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        vi.mocked(accessSecretStorage).mockImplementation(async (func) => func?.());
        mockCrypto.crossSignDevice.mockResolvedValue(undefined);
        expect(await confirm()).toBe(false);
        expect(mockCrypto.crossSignDevice).toHaveBeenCalledTimes(1);
    });

    it("reports failure when the cross-signing keys are still not trusted afterwards", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        mockCrypto.getCrossSigningKeyId.mockResolvedValue(null);
        expect(await confirm()).toBe(false);
    });
});
