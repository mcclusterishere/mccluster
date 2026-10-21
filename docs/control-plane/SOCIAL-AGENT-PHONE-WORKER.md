# Social Agent — phone worker contract

> **Status 2026-10-02: parked.** Instagram posting does not use the phone.
> It goes through Meta's official API: the Worker's social publisher
> (`workers/mccluster/src/social/meta.js`), driven from Control → Create →
> Instagram. Instagram's terms forbid automated use of the app, so a phone
> tapping through it would put @mcclusterishere at risk; the API is the
> sanctioned route and carries 100 posts a day.
>
> Agents (Claude, the OVH model) never post directly. They create a
> `social_publish_jobs` row in state `draft` (via `POST /v1/social/publish`
> with `"draft": true`, or a service-role insert), and the owner approves it in
> Control. The cron only claims `queued` and `processing` jobs, so a draft
> cannot be sent by anything but the owner's Approve.
>
> The phone tables and the `social-agent` Edge Function stay in place, unused,
> for work no API can do. If the phone is revived it gets its own separate
> account, never @mcclusterishere, and needs a Mac beside it to build and sign
> WebDriverAgent. The contract below applies then.

The dedicated iPhone is an execution worker, never the source of truth.

## Rules
1. Only execute a job returned by the canonical `social-agent` endpoint.
2. Never invent media, captions, accounts, targets, or posting times.
3. Never publish a job in `draft`, `cancelled`, `failed`, or `succeeded`.
4. Before tapping Instagram's final Share/Post control, confirm the selected media and caption match the claimed job.
5. Report `running` immediately before UI execution, then `succeeded` only after the Instagram UI confirms publication. Otherwise report `failed` with a concise reason.
6. Do not browse DMs, contacts, Photos outside the selected asset, or unrelated apps.
7. Do not delete, edit, follow, unfollow, like, comment, or message unless a future job action explicitly authorizes that capability.
8. If Instagram presents a login, challenge, CAPTCHA, policy warning, account restriction, or ambiguous confirmation, stop and report failure; require a human.
9. One job at a time. Do not retry a publish after an ambiguous final-share result; report failure for operator review to prevent duplicates.
10. The device token is a secret. Keep it in the host environment/keychain; never commit it or print it.

## Device protocol
POST the Edge Function with `x-device-token`.

Pull:
`{"action":"device-pull","device_id":"<uuid>"}`

Progress:
`{"action":"device-report","device_id":"<uuid>","job_id":"<uuid>","state":"running"}`

Finish:
`{"action":"device-report","device_id":"<uuid>","job_id":"<uuid>","state":"succeeded","external_id":"<if known>"}`

Failure:
`{"action":"device-report","device_id":"<uuid>","job_id":"<uuid>","state":"failed","failure":"<reason>"}`

The UI automation adapter is intentionally separate from the web control plane so WebDriverAgent/Appium/iOS changes cannot bypass approval, queue, or audit semantics.
