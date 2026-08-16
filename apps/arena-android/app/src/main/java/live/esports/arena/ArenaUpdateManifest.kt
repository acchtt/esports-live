package live.esports.arena

import org.json.JSONObject
import java.util.Locale

internal data class ArenaUpdateManifest(
    val schemaVersion: Int,
    val packageId: String,
    val versionCode: Long,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val signerSha256: String,
    val sizeBytes: Long,
    val releaseNotes: String,
    val publishedAt: String?,
    val commit: String?
)

internal fun parseArenaUpdateManifest(payload: String): ArenaUpdateManifest {
    val json = JSONObject(payload)
    val manifest = ArenaUpdateManifest(
        schemaVersion = json.getInt("schemaVersion"),
        packageId = json.getString("packageId").trim(),
        versionCode = json.getLong("versionCode"),
        versionName = json.getString("versionName").trim(),
        apkUrl = json.getString("apkUrl").trim(),
        sha256 = normalizeSha256(json.getString("sha256")),
        signerSha256 = normalizeSha256(json.getString("signerSha256")),
        sizeBytes = json.getLong("sizeBytes"),
        releaseNotes = json.optString("releaseNotes").trim(),
        publishedAt = json.optString("publishedAt").trim().takeIf { it.isNotEmpty() },
        commit = json.optString("commit").trim().takeIf { it.isNotEmpty() }
    )

    require(manifest.schemaVersion == 1) { "Unsupported update manifest schema." }
    require(manifest.packageId.isNotEmpty()) { "Update package is missing." }
    require(manifest.versionCode > 0) { "Update version code is invalid." }
    require(manifest.versionName.isNotEmpty()) { "Update version name is missing." }
    require(manifest.apkUrl.startsWith("https://")) { "Update APK URL must use HTTPS." }
    require(isValidSha256(manifest.sha256)) { "Update checksum is invalid." }
    require(isValidSha256(manifest.signerSha256)) { "Update signer digest is invalid." }
    require(manifest.sizeBytes > 0) { "Update size is invalid." }
    return manifest
}

internal fun shouldOfferArenaUpdate(
    manifest: ArenaUpdateManifest,
    currentVersionCode: Long,
    currentPackageId: String
): Boolean = manifest.packageId == currentPackageId && manifest.versionCode > currentVersionCode

internal fun normalizeSha256(value: String): String = value
    .trim()
    .replace(":", "")
    .lowercase(Locale.ROOT)

internal fun isValidSha256(value: String): Boolean = Regex("^[0-9a-f]{64}$").matches(normalizeSha256(value))

internal fun formatUpdateBytes(bytes: Long): String = when {
    bytes < 1024L -> "$bytes B"
    bytes < 1024L * 1024L -> String.format(Locale.US, "%.1f KB", bytes / 1024.0)
    else -> String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
}
