package org.mccluster.smsrelay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.concurrent.Executors;

public final class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction()) || !RelayConfig.ready(context)) return;
        Bundle extras = intent.getExtras();
        if (extras == null) return;
        Object[] pdus = (Object[]) extras.get("pdus");
        if (pdus == null || pdus.length == 0) return;
        String format = extras.getString("format");

        StringBuilder body = new StringBuilder();
        String from = "";
        long occurredAt = System.currentTimeMillis();
        for (Object pdu : pdus) {
            SmsMessage message = SmsMessage.createFromPdu((byte[]) pdu, format);
            if (message == null) continue;
            if (from.isBlank()) from = message.getOriginatingAddress() == null ? "" : message.getOriginatingAddress();
            body.append(message.getMessageBody() == null ? "" : message.getMessageBody());
            occurredAt = Math.min(occurredAt, message.getTimestampMillis());
        }
        if (from.isBlank() || body.length() == 0) return;

        final String sender = from;
        final String messageBody = body.toString();
        final long timestamp = occurredAt;
        PendingResult pending = goAsync();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                String externalId = "android-sms:" + digest(sender + "\n" + timestamp + "\n" + messageBody);
                JSONObject payload = new JSONObject()
                        .put("from", sender)
                        .put("body", messageBody)
                        .put("occurred_at", Instant.ofEpochMilli(timestamp).toString())
                        .put("external_id", externalId)
                        .put("idempotency_key", externalId);
                ApiClient.post(context, "/v1/comms/relay/inbound", payload);
            } catch (Exception ignored) {
                // Do not leak SMS content or credentials to logcat.
            } finally {
                pending.finish();
            }
        });
    }

    private static String digest(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b));
        return out.toString();
    }
}
