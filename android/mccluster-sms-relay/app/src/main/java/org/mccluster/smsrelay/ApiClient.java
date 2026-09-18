package org.mccluster.smsrelay;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ApiClient {
    private ApiClient() {}

    static JSONObject post(Context context, String path, JSONObject body) throws Exception {
        if (!RelayConfig.ready(context)) throw new IllegalStateException("relay is not configured");
        URL url = new URL(RelayConfig.apiBase(context) + path);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IllegalStateException("cleartext relay API denied");

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-McCluster-Relay-Id", RelayConfig.deviceId(context));
        connection.setRequestProperty("X-McCluster-Relay-Token", RelayConfig.token(context));
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        connection.getOutputStream().write(bytes);

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String response = read(stream);
        connection.disconnect();
        JSONObject json = response.isBlank() ? new JSONObject() : new JSONObject(response);
        if (status < 200 || status >= 300) {
            throw new IllegalStateException("relay API " + status + ": " + json.optString("error", "request failed"));
        }
        return json;
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            for (String line; (line = reader.readLine()) != null;) out.append(line);
        }
        return out.toString();
    }
}
