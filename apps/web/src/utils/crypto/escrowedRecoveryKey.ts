/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { decodeRecoveryKey } from "matrix-js-sdk/src/crypto-api";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

import { accessSecretStorage, crossSigningCallbacks, withSecretStorageKeyCache } from "../../SecurityManager";
import { initialiseDehydrationIfEnabled } from "../device/dehydration";

const logger = rootLogger.getChild("EscrowedRecoveryKey:");

/** Path, on the homeserver's base URL, of the endpoint that returns the account's escrowed recovery key. */
export const ESCROW_PATH = "/_leveragers/login/v1/recovery-key";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Ask the homeserver's escrow endpoint for this account's recovery key.
 *
 * @returns the encoded recovery key, or null if there is no endpoint, no key, or any error.
 */
export async function fetchEscrowedRecoveryKey(cli: MatrixClient): Promise<string | null> {
    try {
        const accessToken = cli.getAccessToken();
        if (!accessToken) return null;
        const url = cli.getHomeserverUrl().replace(/\/+$/, "") + ESCROW_PATH;
        const response = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            logger.info(`no escrowed recovery key (HTTP ${response.status})`);
            return null;
        }
        const body = await response.json();
        return typeof body?.recovery_key === "string" && body.recovery_key ? body.recovery_key : null;
    } catch (e) {
        logger.info("escrow endpoint unavailable", e);
        return null;
    }
}

/**
 * Confirm this device with the account's escrowed recovery key, without showing anything.
 *
 * Same steps as "Use recovery key" ({@link SetupEncryptionStore.usePassPhrase}): the key is handed to the
 * secret storage key cache instead of being typed in the dialog, then {@link accessSecretStorage} imports the
 * cross-signing keys and signs this device, and the backup key is loaded and the key backup restored in the
 * background.
 *
 * @returns true if this device is now confirmed; false otherwise, in which case the caller carries on with
 *     unmodified Element behaviour.
 */
export async function confirmDeviceWithEscrowedRecoveryKey(cli: MatrixClient): Promise<boolean> {
    const crypto = cli.getCrypto();
    if (!crypto) return false;

    const encodedKey = await fetchEscrowedRecoveryKey(cli);
    if (!encodedKey) return false;

    try {
        const keyId = await cli.secretStorage.getDefaultKeyId();
        const keyTuple = keyId ? await cli.secretStorage.getKey(keyId) : null;
        if (!keyId || !keyTuple) return false;
        const keyInfo = keyTuple[1];
        const key = decodeRecoveryKey(encodedKey);
        if (!(await cli.secretStorage.checkKey(key, keyInfo))) {
            logger.warn("escrowed recovery key does not match the default secret storage key");
            return false;
        }

        const backupInfo = (await crypto.getKeyBackupInfo()) ?? null;
        // The key stays cached until the background part (backup restore) is over, like when it is typed in.
        let secretStorageReady!: () => void;
        const ready = new Promise<void>((resolve) => (secretStorageReady = resolve));
        const operation = withSecretStorageKeyCache(async () => {
            crossSigningCallbacks.cacheSecretStorageKey!(keyId, keyInfo, key);
            await accessSecretStorage(async (): Promise<void> => {
                secretStorageReady();
                await initialiseDehydrationIfEnabled(cli);
                if (backupInfo) {
                    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
                    await crypto.restoreKeyBackup();
                }
            });
        });
        operation.catch((e) => logger.warn("error while restoring from the escrowed recovery key", e));
        await Promise.race([ready, operation]);

        // Same success test as "Use recovery key": our cross-signing keys are now trusted (the signature of
        // this device has been uploaded; the local device list catches up on the next key query).
        const confirmed = Boolean(await crypto.getCrossSigningKeyId());
        logger.info(`device confirmed with escrowed recovery key: ${confirmed}`);
        return confirmed;
    } catch (e) {
        logger.warn("could not confirm device with escrowed recovery key", e);
        return false;
    }
}
