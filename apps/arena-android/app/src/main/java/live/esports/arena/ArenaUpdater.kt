package live.esports.arena

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal sealed interface ArenaUpdateState {
    data object Idle : ArenaUpdateState
    data class Checking(val manual: Boolean) : ArenaUpdateState
    data class Current(val latestVersionCode: Long) : ArenaUpdateState
    data class Available(val manifest: ArenaUpdateManifest) : ArenaUpdateState
    data class Downloading(
        val manifest: ArenaUpdateManifest,
        val downloadedBytes: Long,
        val totalBytes: Long
    ) : ArenaUpdateState
    data class Verifying(val manifest: ArenaUpdateManifest) : ArenaUpdateState
    data class Ready(val manifest: ArenaUpdateManifest, val apk: File) : ArenaUpdateState
    data class PermissionRequired(val ready: Ready) : ArenaUpdateState
    data class Error(val message: String, val manifest: ArenaUpdateManifest? = null) : ArenaUpdateState
}

internal class ArenaUpdater(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)

    var state by mutableStateOf<ArenaUpdateState>(ArenaUpdateState.Idle)
        private set

    init {
        worker.execute(::cleanupObsoleteApks)
    }

    fun checkForUpdate(silent: Boolean = true) {
        if (!BuildConfig.IN_APP_UPDATE_ENABLED) return
        if (!busy.compareAndSet(false, true)) return
        post { state = ArenaUpdateState.Checking(manual = !silent) }
        worker.execute {
            try {
                Log.i("ARENA", "ARENA_UPDATE_CHECK_START current=${BuildConfig.VERSION_CODE}")
                val manifest = parseArenaUpdateManifest(fetchText(BuildConfig.UPDATE_MANIFEST_URL))
                if (manifest.packageId != context.packageName) {
                    throw SecurityException("Update manifest package does not match ARENA.")
                }
                if (shouldOfferArenaUpdate(manifest, BuildConfig.VERSION_CODE.toLong(), context.packageName)) {
                    post { state = ArenaUpdateState.Available(manifest) }
                    Log.i(
                        "ARENA",
                        "ARENA_UPDATE_AVAILABLE current=${BuildConfig.VERSION_CODE} latest=${manifest.versionCode} commit=${manifest.commit ?: "unknown"}"
                    )
                } else {
                    cleanupObsoleteApks()
                    post {
                        state = if (silent) ArenaUpdateState.Idle else ArenaUpdateState.Current(manifest.versionCode)
                    }
                    Log.i(
                        "ARENA",
                        "ARENA_UPDATE_CURRENT current=${BuildConfig.VERSION_CODE} latest=${manifest.versionCode}"
                    )
                }
            } catch (error: Exception) {
                Log.w("ARENA", "ARENA_UPDATE_CHECK_FAILED", error)
                post {
                    state = if (silent) ArenaUpdateState.Idle else ArenaUpdateState.Error(userMessage(error))
                }
            } finally {
                busy.set(false)
            }
        }
    }

    fun downloadUpdate() {
        val manifest = when (val current = state) {
            is ArenaUpdateState.Available -> current.manifest
            is ArenaUpdateState.Error -> current.manifest
            else -> null
        } ?: return
        if (!busy.compareAndSet(false, true)) return
        post { state = ArenaUpdateState.Downloading(manifest, 0L, manifest.sizeBytes) }
        worker.execute {
            val directory = updateDirectory()
            val target = File(directory, "arena-${manifest.versionCode}.apk")
            val part = File(directory, "arena-${manifest.versionCode}.apk.part")
            try {
                target.delete()
                part.delete()
                val connection = openHttp(manifest.apkUrl, "application/vnd.android.package-archive", 120_000)
                var downloaded = 0L
                var lastReportAt = 0L
                try {
                    val total = manifest.sizeBytes.takeIf { it > 0L }
                        ?: connection.contentLengthLong.takeIf { it > 0L }
                        ?: 0L
                    connection.inputStream.use { input ->
                        FileOutputStream(part).use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                downloaded += read
                                val now = System.currentTimeMillis()
                                if (now - lastReportAt >= 250L) {
                                    lastReportAt = now
                                    post { state = ArenaUpdateState.Downloading(manifest, downloaded, total) }
                                }
                            }
                            output.fd.sync()
                        }
                    }
                } finally {
                    connection.disconnect()
                }

                if (downloaded != manifest.sizeBytes) {
                    throw SecurityException("Downloaded update size does not match the published build.")
                }
                if (!part.renameTo(target)) {
                    part.copyTo(target, overwrite = true)
                    part.delete()
                }

                post { state = ArenaUpdateState.Verifying(manifest) }
                verifyDownloadedApk(target, manifest)
                post { state = ArenaUpdateState.Ready(manifest, target) }
                Log.i(
                    "ARENA",
                    "ARENA_UPDATE_VERIFIED versionCode=${manifest.versionCode} sha256=${manifest.sha256}"
                )
            } catch (error: Exception) {
                part.delete()
                target.delete()
                Log.w("ARENA", "ARENA_UPDATE_DOWNLOAD_FAILED versionCode=${manifest.versionCode}", error)
                post { state = ArenaUpdateState.Error(userMessage(error), manifest) }
            } finally {
                busy.set(false)
            }
        }
    }

    fun install(activity: Activity) {
        if (!BuildConfig.IN_APP_UPDATE_ENABLED) return
        val ready = when (val current = state) {
            is ArenaUpdateState.Ready -> current
            is ArenaUpdateState.PermissionRequired -> current.ready
            else -> null
        } ?: return

        if (!ready.apk.isFile) {
            state = ArenaUpdateState.Error("The verified update file is no longer available.", ready.manifest)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            state = ArenaUpdateState.PermissionRequired(ready)
            val permissionIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            )
            activity.startActivity(permissionIntent)
            Log.i("ARENA", "ARENA_UPDATE_INSTALL_PERMISSION_REQUIRED")
            return
        }

        try {
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.updates",
                ready.apk
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                clipData = ClipData.newRawUri("ARENA update", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(intent)
            Log.i("ARENA", "ARENA_UPDATE_INSTALLER_OPENED versionCode=${ready.manifest.versionCode}")
        } catch (error: Exception) {
            Log.w("ARENA", "ARENA_UPDATE_INSTALL_FAILED", error)
            state = ArenaUpdateState.Error(userMessage(error), ready.manifest)
        }
    }

    fun resumePendingInstall(activity: Activity) {
        val pending = state as? ArenaUpdateState.PermissionRequired ?: return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()) {
            state = pending.ready
            install(activity)
        }
    }

    fun dismiss() {
        when (state) {
            is ArenaUpdateState.Downloading,
            is ArenaUpdateState.Verifying -> Unit
            else -> state = ArenaUpdateState.Idle
        }
    }

    fun close() {
        worker.shutdownNow()
    }

    private fun verifyDownloadedApk(file: File, manifest: ArenaUpdateManifest) {
        val actualSha = sha256Hex(file)
        if (actualSha != manifest.sha256) {
            throw SecurityException("Downloaded update checksum does not match.")
        }

        val flags = signingFlags()
        @Suppress("DEPRECATION")
        val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags)
            ?: throw SecurityException("Android could not inspect the downloaded APK.")
        if (archive.packageName != manifest.packageId) {
            throw SecurityException("Downloaded update package does not match ARENA.")
        }
        val archiveVersion = PackageInfoCompat.getLongVersionCode(archive)
        if (archiveVersion != manifest.versionCode || archiveVersion <= BuildConfig.VERSION_CODE.toLong()) {
            throw SecurityException("Downloaded update version is not newer than this build.")
        }

        val archiveSigners = signingDigests(archive)
        if (manifest.signerSha256 !in archiveSigners) {
            throw SecurityException("Downloaded update signer does not match the published signer.")
        }

        @Suppress("DEPRECATION")
        val installed = context.packageManager.getPackageInfo(context.packageName, flags)
        val installedSigners = signingDigests(installed)
        if (archiveSigners.isEmpty() || installedSigners.isEmpty() || archiveSigners != installedSigners) {
            throw SecurityException("Downloaded update is not signed by the installed ARENA key.")
        }
    }

    private fun signingFlags(): Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        PackageManager.GET_SIGNING_CERTIFICATES
    } else {
        @Suppress("DEPRECATION")
        PackageManager.GET_SIGNATURES
    }

    @Suppress("DEPRECATION")
    private fun signingDigests(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners?.toList().orEmpty()
        } else {
            info.signatures?.toList().orEmpty()
        }
        return signatures.map { signature -> sha256Hex(signature.toByteArray()) }.toSet()
    }

    private fun fetchText(url: String): String {
        val connection = openHttp(url, "application/json", 30_000)
        return try {
            val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            if (text.length > 128 * 1024) throw IOException("Update manifest is unexpectedly large.")
            text
        } finally {
            connection.disconnect()
        }
    }

    private fun openHttp(url: String, accept: String, readTimeoutMs: Int): HttpURLConnection {
        var current = URL(url)
        repeat(6) {
            val connection = (current.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                requestMethod = "GET"
                connectTimeout = 15_000
                readTimeout = readTimeoutMs
                useCaches = false
                setRequestProperty("Accept", accept)
                setRequestProperty("User-Agent", "ARENA/${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            }
            val status = connection.responseCode
            if (status in 300..399) {
                val location = connection.getHeaderField("Location")
                connection.disconnect()
                if (location.isNullOrBlank()) throw IOException("Update download redirect is missing a destination.")
                current = URL(current, location)
            } else {
                if (status !in 200..299) {
                    connection.disconnect()
                    throw IOException("Update server returned HTTP $status.")
                }
                return connection
            }
        }
        throw IOException("Update server redirected too many times.")
    }

    private fun sha256Hex(file: File): String = file.inputStream().use { input ->
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun updateDirectory(): File = File(context.filesDir, "updates").apply { mkdirs() }

    private fun cleanupObsoleteApks() {
        val currentVersion = BuildConfig.VERSION_CODE.toLong()
        updateDirectory().listFiles().orEmpty().forEach { file ->
            val version = Regex("arena-(\\d+)\\.apk").matchEntire(file.name)
                ?.groupValues
                ?.getOrNull(1)
                ?.toLongOrNull()
            if (file.name.endsWith(".part") || (version != null && version <= currentVersion)) {
                file.delete()
            }
        }
    }

    private fun userMessage(error: Throwable): String = when (error) {
        is SecurityException -> error.message ?: "The downloaded update could not be verified."
        else -> error.message?.takeIf { it.isNotBlank() }?.take(180)
            ?: "Could not reach the ARENA update channel."
    }

    private fun post(action: () -> Unit) {
        main.post(action)
    }
}
