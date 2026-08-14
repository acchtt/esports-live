import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRoot = path.join(packageRoot, 'android', 'app', 'src', 'main');
const javaRoot = path.join(mainRoot, 'java', 'live', 'esports', 'arena');
const manifestPath = path.join(mainRoot, 'AndroidManifest.xml');
const activityPath = path.join(javaRoot, 'MainActivity.java');
const pluginPath = path.join(javaRoot, 'ArenaUpdaterPlugin.java');

const plugin = `package live.esports.arena;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ArenaUpdater")
public class ArenaUpdaterPlugin extends Plugin {
    private static final String MANIFEST_URL =
        "https://github.com/acchtt/esports-live/releases/download/arena-v3-android-latest/arena-v3-latest.json";
    private static final String ALLOWED_APK_PREFIX =
        "https://github.com/acchtt/esports-live/releases/download/arena-v3-android-latest/";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object downloadLock = new Object();
    private boolean activeDownload = false;

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                long currentVersionCode = currentVersionCode();
                String currentVersionName = currentVersionName();
                URL url = new URL(MANIFEST_URL + "?installed=" + currentVersionCode + "&t=" + System.currentTimeMillis());
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(12_000);
                connection.setReadTimeout(18_000);
                connection.setUseCaches(false);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "ARENA-Android/" + currentVersionName);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new IllegalStateException("Update server returned " + status + ".");
                }
                JSONObject manifest;
                try (InputStream stream = connection.getInputStream()) {
                    manifest = new JSONObject(readUtf8(stream));
                }
                if (!"live.esports.arena".equals(manifest.optString("packageId"))) {
                    throw new SecurityException("The update manifest targets a different app.");
                }
                int latestCode = manifest.getInt("versionCode");
                if (latestCode < 1) throw new SecurityException("The update version is invalid.");
                String latestName = manifest.getString("versionName");
                String apkUrl = manifest.getString("apkUrl");
                String sha256 = manifest.getString("sha256").toLowerCase(Locale.ROOT);
                validateApk(apkUrl, sha256);

                JSObject result = new JSObject();
                result.put("available", latestCode > currentVersionCode);
                result.put("currentVersionCode", currentVersionCode);
                result.put("currentVersionName", currentVersionName);
                result.put("latestVersionCode", latestCode);
                result.put("latestVersionName", latestName);
                result.put("apkUrl", apkUrl);
                result.put("sha256", sha256);
                result.put("releaseNotes", manifest.optString("releaseNotes", "A newer ARENA build is ready."));
                result.put("publishedAt", manifest.optString("publishedAt", ""));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not check for updates: " + safeMessage(error), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String apkUrl = call.getString("apkUrl", "");
        String sha256 = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        try {
            validateApk(apkUrl, sha256);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                JSObject result = new JSObject();
                result.put("started", false);
                result.put("permissionRequired", true);
                call.resolve(result);
                return;
            }
            startDownload(apkUrl, sha256);
            JSObject result = new JSObject();
            result.put("started", true);
            result.put("permissionRequired", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not start the update: " + safeMessage(error), error);
        }
    }

    private void validateApk(String apkUrl, String sha256) throws Exception {
        URI uri = new URI(apkUrl);
        if (!"https".equalsIgnoreCase(uri.getScheme())
            || !"github.com".equalsIgnoreCase(uri.getHost())
            || !apkUrl.startsWith(ALLOWED_APK_PREFIX)) {
            throw new SecurityException("The update URL is not an approved ARENA release.");
        }
        if (!sha256.matches("[a-f0-9]{64}")) {
            throw new SecurityException("The update checksum is invalid.");
        }
    }

    private void startDownload(String apkUrl, String sha256) {
        synchronized (downloadLock) {
            if (activeDownload) {
                emitState("downloading", "An ARENA update is already downloading.");
                return;
            }
            activeDownload = true;
        }
        emitDownloadState(0L, -1L);
        executor.execute(() -> downloadAndInstall(apkUrl, sha256));
    }

    private void downloadAndInstall(String apkUrl, String expectedSha256) {
        HttpURLConnection connection = null;
        File partial = null;
        try {
            File updateRoot = new File(getContext().getCacheDir(), "arena-updates");
            if (!updateRoot.exists() && !updateRoot.mkdirs()) {
                throw new IllegalStateException("The secure update folder could not be created.");
            }
            File destination = new File(updateRoot, "arena-v3-update.apk");
            partial = new File(updateRoot, "arena-v3-update.apk.part");
            if (partial.exists() && !partial.delete()) {
                throw new IllegalStateException("The previous partial update could not be replaced.");
            }
            if (destination.exists() && !destination.delete()) {
                throw new IllegalStateException("The previous update could not be replaced.");
            }

            connection = (HttpURLConnection) new URL(apkUrl).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(45_000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            connection.setRequestProperty("User-Agent", "ARENA-Android-Updater/" + currentVersionName());
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("Update download returned " + status + ".");
            }

            long total = connection.getContentLengthLong();
            long downloaded = 0L;
            long lastProgressAt = 0L;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    downloaded += count;
                    long now = System.currentTimeMillis();
                    if (now - lastProgressAt >= 350L) {
                        emitDownloadState(downloaded, total);
                        lastProgressAt = now;
                    }
                }
                output.getFD().sync();
            }

            StringBuilder actualSha = new StringBuilder();
            for (byte item : digest.digest()) {
                actualSha.append(String.format(Locale.ROOT, "%02x", item));
            }
            if (!expectedSha256.equalsIgnoreCase(actualSha.toString())) {
                throw new SecurityException("The downloaded APK did not pass verification.");
            }
            if (!partial.renameTo(destination)) {
                throw new IllegalStateException("The verified update could not be finalized.");
            }

            emitDownloadState(downloaded, downloaded);
            openInstaller(destination);
        } catch (Exception error) {
            if (partial != null && partial.exists()) partial.delete();
            emitState("failed", "Update failed: " + safeMessage(error));
        } finally {
            if (connection != null) connection.disconnect();
            synchronized (downloadLock) {
                activeDownload = false;
            }
        }
    }

    private void openInstaller(File apkFile) {
        Uri apk = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apkFile
        );
        emitState("installing", "Download verified. Opening the Android installer…");
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(apk, "application/vnd.android.package-archive");
        install.setClipData(ClipData.newRawUri("ARENA update", apk));
        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getContext().startActivity(install);
    }

    private void emitDownloadState(long downloaded, long total) {
        JSObject event = new JSObject();
        event.put("state", "downloading");
        event.put("downloadedBytes", downloaded);
        event.put("totalBytes", total);
        if (total > 0L) {
            int progress = (int) Math.min(100L, Math.round(downloaded * 100.0d / total));
            event.put("progress", progress);
            event.put("message", "Downloading verified update… " + progress + "%");
        } else {
            event.put("message", "Downloading the verified ARENA update…");
        }
        notifyListeners("updateState", event, true);
    }

    private String readUtf8(InputStream stream) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
        return new String(output.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
    }

    private PackageInfo packageInfo() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
    }

    private long currentVersionCode() throws Exception {
        PackageInfo info = packageInfo();
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private String currentVersionName() throws Exception {
        String value = packageInfo().versionName;
        return value == null || value.trim().isEmpty() ? "unknown" : value;
    }

    private void emitState(String state, String message) {
        JSObject event = new JSObject();
        event.put("state", state);
        event.put("message", message);
        notifyListeners("updateState", event, true);
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
`;

await mkdir(javaRoot, { recursive: true });
const activity = await readFile(activityPath, 'utf8');
if (!activity.includes('public class MainActivity extends BridgeActivity')) {
  throw new Error('Capacitor MainActivity no longer uses the expected BridgeActivity structure.');
}
const configuredActivity = activity
  .replace('import com.getcapacitor.BridgeActivity;', 'import android.os.Bundle;\n\nimport com.getcapacitor.BridgeActivity;')
  .replace(
    'public class MainActivity extends BridgeActivity {}',
    `public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ArenaUpdaterPlugin.class);
    super.onCreate(savedInstanceState);
  }
}`
  );
if (!configuredActivity.includes('registerPlugin(ArenaUpdaterPlugin.class)')) {
  throw new Error('Could not register ArenaUpdaterPlugin in MainActivity.');
}

const manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes('<uses-permission android:name="android.permission.INTERNET" />')) {
  throw new Error('Capacitor AndroidManifest no longer declares the expected internet permission.');
}
if (!manifest.includes('androidx.core.content.FileProvider') || !manifest.includes('${applicationId}.fileprovider')) {
  throw new Error('Capacitor AndroidManifest no longer exposes the expected secure FileProvider.');
}
const configuredManifest = manifest.replace(
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />'
);

await Promise.all([
  writeFile(pluginPath, plugin),
  writeFile(activityPath, configuredActivity),
  writeFile(manifestPath, configuredManifest)
]);

console.log('Installed ARENA native Android updater bridge.');
