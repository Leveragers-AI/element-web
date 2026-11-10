/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";
import fetchMock from "@fetch-mock/vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
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

    beforeEach(() => {
        client = vi.mocked(stubClient());
        client.getHomeserverUrl.mockReturnValue("https://matrix.example.com/");
        client.getAccessToken.mockReturnValue("token-of-this-account");
        mockCrypto = {
            getKeyBackupInfo: vi.fn().mockResolvedValue({ version: "1" }),
            loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(),
            restoreKeyBackup: vi.fn(),
            isDehydrationSupported: vi.fn().mockResolvedValue(false),
            getCrossSigningKeyId: vi.fn().mockResolvedValue("masterkeyid"),
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
            .mockImplementation(async (func) => func?.());
        vi.mocked(crossSigningCallbacks.cacheSecretStorageKey!).mockClear();
    });

    it("does nothing when the endpoint does not exist", async () => {
        fetchMock.post(url, 404);
        expect(await confirmDeviceWithEscrowedRecoveryKey(client)).toBe(false);
        expect(accessSecretStorage).not.toHaveBeenCalled();
    });

    it("does nothing when the endpoint is unreachable", async () => {
        fetchMock.post(url, { throws: new TypeError("Failed to fetch") });
        expect(await confirmDeviceWithEscrowedRecoveryKey(client)).toBe(false);
        expect(accessSecretStorage).not.toHaveBeenCalled();
    });

    it("does nothing when the key does not open secret storage", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 wrong" });
        mockSecretStorage.checkKey.mockResolvedValue(false);
        expect(await confirmDeviceWithEscrowedRecoveryKey(client)).toBe(false);
        expect(accessSecretStorage).not.toHaveBeenCalled();
    });

    it("does nothing when unlocking secret storage fails", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        vi.mocked(accessSecretStorage).mockRejectedValue(new Error("boom"));
        expect(await confirmDeviceWithEscrowedRecoveryKey(client)).toBe(false);
    });

    it("confirms the device with the escrowed key, then restores the key backup", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        expect(await confirmDeviceWithEscrowedRecoveryKey(client)).toBe(true);

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
        await vi.waitFor(() => expect(mockCrypto.restoreKeyBackup).toHaveBeenCalled());
        expect(mockCrypto.loadSessionBackupPrivateKeyFromSecretStorage).toHaveBeenCalled();
    });

    it("reports failure when the cross-signing keys are still not trusted afterwards", async () => {
        fetchMock.post(url, { recovery_key: "EsT0 good" });
        mockCrypto.getCrossSigningKeyId.mockResolvedValue(null);
        expect(await confirmDeviceWithEscrowedRecoveryKey(client)).toBe(false);
    });
});
