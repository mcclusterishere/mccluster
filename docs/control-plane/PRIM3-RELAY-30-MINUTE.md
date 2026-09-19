# PRIM3 Relay — 30-minute activation

This completes the existing McCluster Communications Beta with the Apache-2.0
SMS Gateway for Android app. Twilio is not in the transport path.

## What the owner must provide

1. One Android phone (Android 5+). A spare phone is fine.
2. One active SIM/eSIM with SMS.
3. The SMS Gateway for Android APK.
4. A private WireGuard path from the phone to OVH.

The relay phone's carrier number becomes PRIM3's SMS number.

## Runtime

Android carrier SMS <-> SMS Gateway local server <-> WireGuard <->
mccluster-smsgate-relay on OVH <-> api.mccluster.org comms relay routes <->
Supabase comms ledger/outbox <-> Core sms_assistant_turn <-> local model.

## Android

Install the standard SMS Gateway APK and grant SEND_SMS, RECEIVE_SMS and
READ_PHONE_STATE. Enable Local Server.

Record:
- Local-server username
- Local-server password

Do not expose port 8080 to the public Internet. The bridge must reach it only
through WireGuard.

## McCluster enrollment

From an authenticated owner session call:

POST https://api.mccluster.org/v1/comms/relay-devices

body:
{"label":"PRIM3 Phone","phone_number":"+1XXXXXXXXXX"}

Save the returned device.id and relay_token. The token is returned once.

## OVH configuration

Add to /etc/mccluster/core.env:

MCCLUSTER_OWNER_PHONE=+1YOURPERSONALNUMBER
MCCLUSTER_RELAY_ID=<device.id>
MCCLUSTER_RELAY_TOKEN=<relay_token>
MCCLUSTER_RELAY_PHONE=+1PRIM3NUMBER

# SMS Gateway local server across WireGuard
MCCLUSTER_SMSGATE_ENDPOINT=http://10.77.0.2:8080
MCCLUSTER_SMSGATE_USERNAME=<app username>
MCCLUSTER_SMSGATE_PASSWORD=<app password>

# random: openssl rand -hex 32
MCCLUSTER_SMSGATE_WEBHOOK_TOKEN=<random secret>
MCCLUSTER_SMSGATE_LISTEN_HOST=10.77.0.1
MCCLUSTER_SMSGATE_LISTEN_PORT=4789
MCCLUSTER_SMSGATE_WEBHOOK_URL=http://10.77.0.1:4789/hook/<same random secret>

Enable the service:
sudo systemctl daemon-reload
sudo systemctl enable --now mccluster-smsgate-relay.service
sudo systemctl status mccluster-smsgate-relay.service

## Acceptance test

1. From your personal phone, SMS the PRIM3 number: "Who are you?"
2. The Android app posts sms:received to the OVH bridge.
3. The bridge calls /v1/comms/relay/inbound.
4. Core claims sms_assistant_turn and asks the local model.
5. The reply is written to comms_outbox.
6. The bridge claims it and calls the phone's /message endpoint.
7. Your personal phone receives the reply.

Expected first reply starts with "McCluster's assistant here —".

Do not port an important existing number until this temporary-number test works.
