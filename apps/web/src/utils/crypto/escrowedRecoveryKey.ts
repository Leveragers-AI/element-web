/*
Copyright 2026 Leveragers.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { decodeRecoveryKey } from "matrix-js-sdk/src/crypto-api";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { sleep } from "matrix-js-sdk/src/utils";

import { accessSecretStorage, crossSigningCallbacks, withSecretStorageKeyCache } from "../../SecurityManager";
import { initialiseDehydrationIfEnabled } from "../device/dehydration";
import { DeviceListener } from "../../device-listener";

const logger = rootLogger.getChild("EscrowedRecoveryKey:");

/** Path, on the homeserver's base URL, of the endpoint that returns the account's escrowed recovery key. */
export const ESCROW_PATH = "/_leveragers/login/v1/recovery-key";
const FETCH_TIMEOUT_MS = 10_000;
/** Bound on each wait for the server (device keys uploaded, device signature present), and poll interval. */
export interface ServerWait {
    waitMs: number;
    pollMs: number;
}
const SERVER_WAIT: ServerWait = { waitMs: 30_000, pollMs: 1_000 };

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

/** This device as the homeserver has it now (fresh `/keys/query`, not the local device list). */
async function deviceOnServer(cli: MatrixClient): Promise<{ uploaded: boolean; crossSigned: boolean }> {
    const userId = cli.getSafeUserId();
    const response = await cli.downloadKeysForUsers([userId]);
    const device = response.device_keys?.[userId]?.[cli.getDeviceId()!];
    const selfSigningKeyIds = Object.keys(response.self_signing_keys?.[userId]?.keys ?? {});
    const signatures = device?.signatures?.[userId] ?? {};
    return { uploaded: Boolean(device), crossSigned: selfSigningKeyIds.some((id) => id in signatures) };
}

/** Poll `check` until it is true or the wait is over. */
async function waitUntil(check: () => Promise<boolean>, { waitMs, pollMs }: ServerWait): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
        try {
            if (await check()) return true;
        } catch (e) {
            logger.debug("check failed, retrying", e);
        }
        if (Date.now() >= deadline) return false;
        await sleep(pollMs);
    }
}

/**
 * Confirm this device with the account's escrowed recovery key, without showing anything.
 *
 * Same steps as "Use recovery key" ({@link SetupEncryptionStore.usePassPhrase}): the key is handed to the
 * secret storage key cache instead of being typed in the dialog, then {@link accessSecretStorage} imports the
 * cross-signing keys and signs this device, and the backup key is loaded and the key backup restored in the
 * background. The device is signed only once its keys are on the server, and success is checked on the server.
 *
 * @returns true if this device is now confirmed; false otherwise, in which case the caller carries on with
 *     unmodified Element behaviour.
 */
export async function confirmDeviceWithEscrowedRecoveryKey(
    cli: MatrixClient,
    serverWait: ServerWait = SERVER_WAIT,
): Promise<boolean> {
    const crypto = cli.getCrypto();
    if (!crypto) return false;

    const encodedKey = await fetchEscrowedRecoveryKey(cli);
    if (!encodedKey) return false;

    try {
        // Sign only once this device's own keys are on the server: a signature uploaded before them is lost
        // when they arrive (seen on Tuwunel over a slow link), leaving the device unverified.
        if (!(await waitUntil(async () => (await deviceOnServer(cli)).uploaded, serverWait))) {
            logger.warn("device keys not on the server in time; not using the escrowed recovery key");
            return false;
        }

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
                // Cache the backup key before the app shows (cheap), so the device listener finds nothing to
                // nag about; dehydration and the restore itself stay in the background.
                if (backupInfo) await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
                secretStorageReady();
                await initialiseDehydrationIfEnabled(cli);
                if (backupInfo) await crypto.restoreKeyBackup();
            });
        });
        operation.catch((e) => logger.warn("error while restoring from the escrowed recovery key", e));
        await Promise.race([ready, operation]);

        if (!(await crypto.getCrossSigningKeyId())) return false;

        // Success only when the server shows this device signed by our self-signing key; sign it again once
        // if the signature is missing.
        let signedAgain = false;
        const confirmed = await waitUntil(async () => {
            if ((await deviceOnServer(cli)).crossSigned) return true;
            if (!signedAgain) {
                signedAgain = true;
                logger.warn("device signature missing on the server; signing again");
                await crypto.crossSignDevice(cli.getDeviceId()!);
            }
            return false;
        }, serverWait);
        if (confirmed) {
            // Let the local device list catch up, then have the device listener withdraw the "Verify this
            // device" toast it queued at the first sync (it does so once everything is "ok"), before the app shows.
            const userId = cli.getSafeUserId();
            await waitUntil(
                async () =>
                    Boolean(
                        (await crypto.getDeviceVerificationStatus(userId, cli.getDeviceId()!))?.crossSigningVerified,
                    ),
                serverWait,
            );
            const deviceListener = DeviceListener.sharedInstance();
            deviceListener.recheck();
            await waitUntil(async () => deviceListener.getDeviceState() === "ok", {
                waitMs: Math.min(serverWait.waitMs, 10_000),
                pollMs: Math.min(serverWait.pollMs, 100),
            });
        }
        logger.info(`device confirmed with escrowed recovery key: ${confirmed}`);
        return confirmed;
    } catch (e) {
        logger.warn("could not confirm device with escrowed recovery key", e);
        return false;
    }
}
