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

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
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
    private DownloadManager downloadManager;
    private long activeDownloadId = -1L;
    private String activeSha256 = "";
    private BroadcastReceiver downloadReceiver;

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
        if (activeDownloadId != -1L) {
            emitState("downloading", "An ARENA update is already downloading.");
            return;
        }
        downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
        request.setTitle("ARENA update");
        request.setDescription("Downloading the latest verified ARENA build");
        request.setMimeType("application/vnd.android.package-archive");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(false);
        File destination = new File(
            getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
            "arena-v3-update.apk"
        );
        if (destination.exists() && !destination.delete()) {
            throw new IllegalStateException("The previous update file could not be replaced.");
        }
        request.setDestinationInExternalFilesDir(
            getContext(),
            Environment.DIRECTORY_DOWNLOADS,
            "arena-v3-update.apk"
        );
        activeSha256 = sha256;
        registerDownloadReceiver();
        activeDownloadId = downloadManager.enqueue(request);
        emitState("downloading", "Downloading the verified ARENA update…");
    }

    private void registerDownloadReceiver() {
        if (downloadReceiver != null) return;
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (completedId != activeDownloadId) return;
                executor.execute(() -> finishDownload(completedId));
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver, filter);
        }
    }

    private void finishDownload(long downloadId) {
        try {
            DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
            try (Cursor cursor = downloadManager.query(query)) {
                if (!cursor.moveToFirst()) throw new IllegalStateException("The completed download was not found.");
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (status != DownloadManager.STATUS_SUCCESSFUL) {
                    int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                    throw new IllegalStateException("Android download failed (" + reason + ").");
                }
            }
            String actualSha = checksum(downloadId);
            if (!activeSha256.equalsIgnoreCase(actualSha)) {
                downloadManager.remove(downloadId);
                throw new SecurityException("The downloaded APK did not pass verification.");
            }
            Uri apk = downloadManager.getUriForDownloadedFile(downloadId);
            if (apk == null) throw new IllegalStateException("Android could not open the downloaded APK.");
            emitState("installing", "Download verified. Opening the Android installer…");
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apk, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(install);
        } catch (Exception error) {
            emitState("failed", "Update failed: " + safeMessage(error));
        } finally {
            activeDownloadId = -1L;
            activeSha256 = "";
        }
    }

    private String checksum(long downloadId) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (ParcelFileDescriptor descriptor = downloadManager.openDownloadedFile(downloadId);
             FileInputStream stream = new FileInputStream(descriptor.getFileDescriptor())) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format(Locale.ROOT, "%02x", item));
        return value.toString();
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
        if (downloadReceiver != null) {
            try {
                getContext().unregisterReceiver(downloadReceiver);
            } catch (IllegalArgumentException ignored) {
                // Receiver was already removed by Android.
            }
            downloadReceiver = null;
        }
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
