# McCluster SMS Relay

Private Android/SIM transport for McCluster Communications Beta 1.

The server remains authoritative for contacts, threads, assistant policy, outbox claiming, retries, TAKEOVER/RELEASE, STOP handling, auditing, and proof. This app owns only the physical carrier hop.

## Pairing

1. Enroll a relay device through the owner-authenticated `POST /v1/comms/relay-devices` API with the SIM phone number and a device label.
2. Copy the returned device UUID and one-time relay token into the app.
3. Grant RECEIVE_SMS, SEND_SMS, and notification permissions.
4. Keep the device powered, online, and connected to the enrolled active SIM.

The server stores only the SHA-256 hash of the relay token. The app encrypts the token with an Android Keystore AES-GCM key and disables itself if the encrypted credential can no longer be decrypted.

## Runtime contract

- inbound SMS -> `POST /v1/comms/relay/inbound`
- claim outbound -> `POST /v1/comms/relay/outbox/claim`
- send/delivery receipt -> `POST /v1/comms/relay/delivery`
- authentication headers: `X-McCluster-Relay-Id` and `X-McCluster-Relay-Token`
- API transport is HTTPS-only
- SMS bodies and relay credentials are intentionally not written to logcat

The app is designed for sideload/private fleet use. A real end-to-end acceptance test still requires an Android device with an active carrier SIM; CI can prove only the application build and static contract.
