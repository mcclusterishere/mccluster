package org.mccluster.smsrelay;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity {
    private EditText api;
    private EditText device;
    private EditText token;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildUi());
        refreshStatus();
    }

    private ScrollView buildUi() {
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("McCluster SMS Relay");
        title.setTextSize(26);
        layout.addView(title);

        TextView copy = new TextView(this);
        copy.setText("Pairs this Android phone + SIM with McCluster Communications. The relay token is encrypted with Android Keystore and never written to logs.");
        copy.setPadding(0, pad / 2, 0, pad);
        layout.addView(copy);

        api = field("API URL", RelayConfig.apiBase(this));
        device = field("Relay device UUID", RelayConfig.deviceId(this));
        token = field("One-time enrollment token", "");
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(api);
        layout.addView(device);
        layout.addView(token);

        Button start = new Button(this);
        start.setText("Save & start relay");
        start.setOnClickListener(v -> saveAndStart());
        layout.addView(start);

        Button stop = new Button(this);
        stop.setText("Stop relay");
        stop.setOnClickListener(v -> {
            RelayConfig.setEnabled(this, false);
            stopService(new Intent(this, RelayService.class));
            refreshStatus();
        });
        layout.addView(stop);

        status = new TextView(this);
        status.setPadding(0, pad, 0, 0);
        layout.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private EditText field(String hint, String value) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(false);
        input.setText(value);
        return input;
    }

    private void saveAndStart() {
        try {
            String enteredToken = token.getText().toString().trim();
            if (enteredToken.isBlank()) enteredToken = RelayConfig.token(this);
            RelayConfig.save(this, api.getText().toString(), device.getText().toString(), enteredToken);
            requestRelayPermissions();
            RelayService.start(this);
            token.setText("");
            refreshStatus();
        } catch (Exception error) {
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void requestRelayPermissions() {
        List<String> requested = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) requested.add(Manifest.permission.RECEIVE_SMS);
        if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) requested.add(Manifest.permission.SEND_SMS);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requested.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!requested.isEmpty()) requestPermissions(requested.toArray(new String[0]), 1001);
    }

    private void refreshStatus() {
        if (status == null) return;
        status.setText(RelayConfig.ready(this)
                ? "Configured. Relay service is enabled for device " + RelayConfig.deviceId(this) + ". Keep this phone powered, online, and connected to its active SIM."
                : "Not active. Enroll this phone through the owner-only /v1/comms/relay-devices API, then paste the returned device UUID and one-time relay token here.");
    }
}
