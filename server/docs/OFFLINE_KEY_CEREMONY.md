# Offline account-key ceremony

Perform this procedure on an offline, trusted device with two authorized
operators present. The online wallet service must never participate.

1. Generate the mnemonic and seed using audited wallet hardware/software and
   verified entropy.
2. Record and independently verify the mnemonic backup. Store redundant copies
   in separate controlled locations.
3. Derive the Bitcoin account at `m/44'/0'/0'`.
4. Derive the Dogecoin account at `m/44'/3'/0'` from a separately approved
   account policy. A separate seed is preferable when operational isolation is
   required.
5. Export only each account-level extended public key and the root fingerprint.
   Dogecoin's key should use its `dgub` serialization.
6. On a second implementation, independently derive `0/0` and compare the
   resulting address before provisioning production.
7. Transfer the account XPUB, account path, root fingerprint, and a new
   immutable key-reference label to the server configuration.
8. Verify the server's first derived address against the offline device.
9. Wipe temporary media and power down the ceremony device according to the
   organization's key-handling policy.

Never type, photograph, paste, log, upload, or place any mnemonic, seed, XPRV,
WIF, or private key in this repository, its `.env` file, CI, chat, tickets,
monitoring, or database.

## Rotation

An XPUB must never be silently replaced under an existing key reference. Create
a new account/key reference, provision it, verify its first address, and retire
the old account only after all outstanding deposit addresses have been fully
reconciled. The configuration selects one active derivation account per chain;
old account metadata and addresses remain in PostgreSQL and continue to be
monitored through the chain-level provider without needing the old XPUB online.
