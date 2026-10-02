# Social Agent — phone worker contract

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
