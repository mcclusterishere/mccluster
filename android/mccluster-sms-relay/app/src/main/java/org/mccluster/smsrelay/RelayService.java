package org.mccluster.smsrelay;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.IBinder;
import android.telephony.SmsManager;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class RelayService extends Service {
    static final String ACTION_SENT = "org.mccluster.smsrelay.SMS_SENT";
    static final String ACTION_DELIVERED = "org.mccluster.smsrelay.SMS_DELIVERED";
    static final String EXTRA_OUTBOX_ID = "outbox_id";
    private static final int NOTIFICATION_ID = 4107;
    private ScheduledExecutorService executor;

    static void start(Context context) {
        Intent intent = new Intent(context, RelayService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, notification());
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::pollSafely, 0, 10, TimeUnit.SECONDS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!RelayConfig.ready(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollSafely() {
        if (!RelayConfig.ready(this)) return;
        try {
            JSONObject response = ApiClient.post(this, "/v1/comms/relay/outbox/claim", new JSONObject());
            JSONObject item = response.optJSONObject("item");
            if (item != null) send(item);
        } catch (Exception ignored) {
            // Deliberately do not log message bodies or relay credentials. The
            // server health plane will expose stale last_seen/outbox state.
        }
    }

    private void send(JSONObject item) throws Exception {
        String outboxId = item.optString("id", "");
        String destination = item.optString("destination", "");
        String body = item.optString("body", "");
        if (outboxId.isBlank() || destination.isBlank() || body.isBlank()) return;
        if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            reportFailure(outboxId, "SEND_SMS permission is not granted");
            return;
        }

        SmsManager manager = SmsManager.getDefault();
        ArrayList<String> parts = manager.divideMessage(body);
        if (parts == null || parts.isEmpty()) {
            reportFailure(outboxId, "SMS body produced no sendable segments");
            return;
        }

        PendingIntent sent = statusIntent(ACTION_SENT, outboxId, 1);
        PendingIntent delivered = statusIntent(ACTION_DELIVERED, outboxId, 2);
        try {
            if (parts.size() == 1) {
                manager.sendTextMessage(destination, null, parts.get(0), sent, delivered);
            } else {
                ArrayList<PendingIntent> sentIntents = new ArrayList<>();
                ArrayList<PendingIntent> deliveredIntents = new ArrayList<>();
                for (int index = 0; index < parts.size(); index++) {
                    boolean last = index == parts.size() - 1;
                    sentIntents.add(last ? sent : null);
                    deliveredIntents.add(last ? delivered : null);
                }
                manager.sendMultipartTextMessage(destination, null, parts, sentIntents, deliveredIntents);
            }
        } catch (Exception error) {
            reportFailure(outboxId, error.getClass().getSimpleName());
        }
    }

    private PendingIntent statusIntent(String action, String outboxId, int kind) {
        Intent intent = new Intent(this, SmsStatusReceiver.class)
                .setAction(action)
                .putExtra(EXTRA_OUTBOX_ID, outboxId);
        int requestCode = (outboxId + ":" + kind).hashCode();
        return PendingIntent.getBroadcast(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void reportFailure(String outboxId, String error) {
        Executors.newSingleThreadExecutor().execute(() -> SmsStatusReceiver.report(this, outboxId, "failed", error));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel("relay", "McCluster SMS Relay", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Keeps the McCluster SMS relay connected to the enrolled SIM.");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, "relay")
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("McCluster SMS Relay")
                .setContentText("Secure relay is connected")
                .setContentIntent(pending)
                .setOngoing(true)
                .build();
    }
}
