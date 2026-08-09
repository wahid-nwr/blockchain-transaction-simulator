import { KMSClient, DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms';
import crypto from 'node:crypto';

const kms = new KMSClient({});

// KMS_PROVIDER=local uses an AES-256-GCM envelope with a master key from env,
// for local dev/test where real AWS KMS access isn't available.
// KMS_PROVIDER=aws (the production default) always goes through real KMS.
function isLocalProvider(): boolean {
    return process.env.KMS_PROVIDER === 'local';
}

export async function encryptWalletKey(
    privateKey: `0x${string}`,
    kmsKeyId: string,
): Promise<Buffer> {
    if (isLocalProvider()) {
        return encryptLocal(privateKey);
    }

    const { CiphertextBlob } = await kms.send(
        new EncryptCommand({ KeyId: kmsKeyId, Plaintext: Buffer.from(privateKey, 'utf-8') }),
    );
    if (!CiphertextBlob) throw new Error('Key encryption failed');
    return Buffer.from(CiphertextBlob);
}

export async function decryptWalletKey(
    ciphertext: Uint8Array,
    kmsKeyId: string,
): Promise<`0x${string}`> {
    if (isLocalProvider()) {
        return decryptLocal(ciphertext);
    }

    const { Plaintext } = await kms.send(
        new DecryptCommand({ CiphertextBlob: ciphertext, KeyId: kmsKeyId }),
    );
    if (!Plaintext) throw new Error('Key decryption failed');
    return Buffer.from(Plaintext).toString('utf-8') as `0x${string}`;
}

// --- local envelope (dev/test only — never reached when KMS_PROVIDER=aws) ---

export function parseLocalMasterKey(raw: string | undefined): Buffer {
    const value = raw?.trim();

    if (!value) {
        throw new Error(
            'LOCAL_KMS_MASTER_KEY is not set. Add a 64-char hex string (32 bytes) to your ' +
                '.env.test (or .env for local dev) — required whenever KMS_PROVIDER=local.',
        );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error(
            `LOCAL_KMS_MASTER_KEY must be exactly 64 hex characters (32 bytes), got ${value.length} ` +
                `characters. Check for a stray quote, trailing newline, or "0x" prefix in your .env file.`,
        );
    }
    return Buffer.from(value, 'hex');
}

function getLocalMasterKey(): Buffer {
    return parseLocalMasterKey(process.env.LOCAL_KMS_MASTER_KEY);
}

function encryptLocal(privateKey: string): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getLocalMasterKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // layout: [12-byte iv][16-byte auth tag][ciphertext]
    return Buffer.concat([iv, authTag, ciphertext]);
}

function decryptLocal(blob: Uint8Array): `0x${string}` {
    const buf = Buffer.from(blob);
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', getLocalMasterKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf-8') as `0x${string}`;
}
