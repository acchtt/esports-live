package live.esports.arena

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArenaUpdateManifestTest {
    private fun manifest(
        versionCode: Long = 20L,
        packageId: String = "live.esports.arena"
    ) = ArenaUpdateManifest(
        schemaVersion = 1,
        packageId = packageId,
        versionCode = versionCode,
        versionName = "0.3.4",
        apkUrl = "https://example.test/arena.apk",
        sha256 = "a".repeat(64),
        signerSha256 = "b".repeat(64),
        sizeBytes = 20_000_000L,
        releaseNotes = "Updater test",
        publishedAt = null,
        commit = "1234567"
    )

    @Test
    fun offersOnlyNewerMatchingPackage() {
        assertTrue(shouldOfferArenaUpdate(manifest(20), 19, "live.esports.arena"))
        assertFalse(shouldOfferArenaUpdate(manifest(20), 20, "live.esports.arena"))
        assertFalse(shouldOfferArenaUpdate(manifest(20), 21, "live.esports.arena"))
        assertFalse(shouldOfferArenaUpdate(manifest(20, "other.app"), 19, "live.esports.arena"))
    }

    @Test
    fun normalizesAndValidatesSha256() {
        val colonDigest = List(32) { "AB" }.joinToString(":")
        assertEquals("ab".repeat(32), normalizeSha256(colonDigest))
        assertTrue(isValidSha256("f".repeat(64)))
        assertFalse(isValidSha256("g".repeat(64)))
        assertFalse(isValidSha256("a".repeat(63)))
    }

    @Test
    fun formatsPublishedApkSize() {
        assertEquals("512 B", formatUpdateBytes(512))
        assertEquals("1.5 KB", formatUpdateBytes(1536))
        assertEquals("18.0 MB", formatUpdateBytes(18L * 1024L * 1024L))
    }
}
