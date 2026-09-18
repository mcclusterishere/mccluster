package org.mccluster.smsrelay;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

import java.util.concurrent.Executors;

public final class SmsStatusReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String outboxId = intent.getStringExtra(RelayService.EXTRA_OUTBOX_ID);
        if (outboxId == null || outboxId.isBlank()) return;
        PendingResult pending = goAsync();
        String action = intent.getAction();
        int result = getResultCode();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                if (RelayService.ACTION_DELIVERED.equals(action)) {
                    report(context, outboxId, result == Activity.RESULT_OK ? "delivered" : "failed", result == Activity.RESULT_OK ? null : "carrier delivery result " + result);
                } else {
                    report(context, outboxId, result == Activity.RESULT_OK ? "sent" : "failed", result == Activity.RESULT_OK ? null : "carrier send result " + result);
                }
            } finally {
                pending.finish();
            }
        });
    }

    static void report(Context context, String outboxId, String status, String error) {
        try {
            JSONObject body = new JSONObject()
                    .put("outbox_id", outboxId)
                    .put("status", status)
                    .put("provider_message_id", "android-sim:" + System.currentTimeMillis());
            if (error != null && !error.isBlank()) body.put("error", error);
            ApiClient.post(context, "/v1/comms/relay/delivery", body);
        } catch (Exception ignored) {
            // Server retries stale claims. Never log SMS payloads or relay secrets.
        }
    }
}
