package org.mccluster.smsrelay;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class RelayConfig {
    private static final String PREFS = "mccluster_relay";
    private static final String KEY_ALIAS = "mccluster_relay_token_v1";
    private static final String DEFAULT_API = "https://api.mccluster.org";

    private RelayConfig() {}

    static String apiBase(Context context) {
        String value = prefs(context).getString("api_base", DEFAULT_API);
        return value == null || value.isBlank() ? DEFAULT_API : value.replaceAll("/+$", "");
    }

    static String deviceId(Context context) {
        return value(prefs(context).getString("device_id", ""));
    }

    static boolean enabled(Context context) {
        return prefs(context).getBoolean("enabled", false);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean("enabled", enabled).apply();
    }

    static void save(Context context, String apiBase, String deviceId, String token) throws Exception {
        String api = value(apiBase).replaceAll("/+$", "");
        if (!api.startsWith("https://")) throw new IllegalArgumentException("Relay API must use HTTPS");
        if (!value(deviceId).matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) {
            throw new IllegalArgumentException("Device ID must be a UUID");
        }
        if (value(token).length() < 24) throw new IllegalArgumentException("Relay token is too short");
        prefs(context).edit()
                .putString("api_base", api)
                .putString("device_id", value(deviceId))
                .putString("relay_token", encrypt(value(token)))
                .putBoolean("enabled", true)
                .apply();
    }

    static String token(Context context) {
        String encoded = prefs(context).getString("relay_token", "");
        if (encoded == null || encoded.isBlank()) return "";
        try {
            return decrypt(encoded);
        } catch (Exception ignored) {
            prefs(context).edit().remove("relay_token").putBoolean("enabled", false).apply();
            return "";
        }
    }

    static boolean ready(Context context) {
        return enabled(context) && !deviceId(context).isBlank() && !token(context).isBlank() && apiBase(context).startsWith("https://");
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String value(String value) {
        return value == null ? "" : value.trim();
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry existing = store.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) existing).getSecretKey();

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private static String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private static String decrypt(String value) throws Exception {
        String[] parts = value.split("\\.", 2);
        if (parts.length != 2) throw new IllegalArgumentException("invalid encrypted token");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
