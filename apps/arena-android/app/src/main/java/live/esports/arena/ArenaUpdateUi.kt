package live.esports.arena

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun ArenaUpdateOverlay(
    state: ArenaUpdateState,
    onCheck: () -> Unit,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
    onDismiss: () -> Unit
) {
    Box(Modifier.fillMaxSize()) {
        when (state) {
            ArenaUpdateState.Idle -> UpdateChip("v${BuildConfig.VERSION_NAME}", onCheck)
            is ArenaUpdateState.Checking -> {
                if (state.manual) {
                    UpdatePanel(
                        title = "CHECKING FOR UPDATE",
                        body = "Comparing build ${BuildConfig.VERSION_CODE} with the ARENA update channel.",
                        meta = null,
                        busy = true,
                        primaryLabel = null,
                        onPrimary = {},
                        allowDismiss = false,
                        onDismiss = onDismiss
                    )
                } else {
                    UpdateChip("v${BuildConfig.VERSION_NAME}", onCheck)
                }
            }
            is ArenaUpdateState.Current -> UpdatePanel(
                title = "ARENA IS UP TO DATE",
                body = "You are already on the newest available build.",
                meta = "Installed build ${BuildConfig.VERSION_CODE} · channel build ${state.latestVersionCode}",
                primaryLabel = null,
                onPrimary = {},
                onDismiss = onDismiss
            )
            is ArenaUpdateState.Available -> UpdatePanel(
                title = "UPDATE AVAILABLE · ${state.manifest.versionName}",
                body = state.manifest.releaseNotes.ifBlank { "A newer ARENA build is ready." },
                meta = updateMeta(state.manifest),
                primaryLabel = "DOWNLOAD & UPDATE",
                onPrimary = onDownload,
                onDismiss = onDismiss
            )
            is ArenaUpdateState.Downloading -> {
                val percent = if (state.totalBytes > 0L) {
                    ((state.downloadedBytes * 100L) / state.totalBytes).coerceIn(0L, 100L)
                } else null
                UpdatePanel(
                    title = "DOWNLOADING UPDATE",
                    body = if (percent == null) "Downloading verified APK…" else "Downloading verified APK… $percent%",
                    meta = "${formatUpdateBytes(state.downloadedBytes)} / ${formatUpdateBytes(state.totalBytes)}",
                    busy = true,
                    primaryLabel = null,
                    onPrimary = {},
                    allowDismiss = false,
                    onDismiss = onDismiss
                )
            }
            is ArenaUpdateState.Verifying -> UpdatePanel(
                title = "VERIFYING UPDATE",
                body = "Checking SHA-256, package ID, version, and signing certificate before Android can install it.",
                meta = updateMeta(state.manifest),
                busy = true,
                primaryLabel = null,
                onPrimary = {},
                allowDismiss = false,
                onDismiss = onDismiss
            )
            is ArenaUpdateState.Ready -> UpdatePanel(
                title = "VERIFIED · READY TO INSTALL",
                body = "The downloaded APK matches the published hash and the signing key already installed on this phone.",
                meta = updateMeta(state.manifest),
                primaryLabel = "INSTALL",
                onPrimary = onInstall,
                onDismiss = onDismiss
            )
            is ArenaUpdateState.PermissionRequired -> UpdatePanel(
                title = "ALLOW ARENA UPDATES",
                body = "Android needs one-time permission for ARENA to open its verified APK in the system installer.",
                meta = updateMeta(state.ready.manifest),
                primaryLabel = "ALLOW & INSTALL",
                onPrimary = onInstall,
                onDismiss = onDismiss
            )
            is ArenaUpdateState.Error -> UpdatePanel(
                title = "UPDATE COULDN'T FINISH",
                body = state.message,
                meta = state.manifest?.let(::updateMeta),
                primaryLabel = if (state.manifest == null) "CHECK AGAIN" else "RETRY DOWNLOAD",
                onPrimary = if (state.manifest == null) onCheck else onDownload,
                onDismiss = onDismiss
            )
        }
    }
}

@Composable
private fun BoxScope.UpdateChip(label: String, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .align(Alignment.BottomEnd)
            .navigationBarsPadding()
            .padding(end = 12.dp, bottom = 8.dp)
            .semantics { contentDescription = "ARENA_UPDATE_CONTROL" }
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = ArenaSurface.copy(alpha = 0.94f),
        border = BorderStroke(1.dp, ArenaLine.copy(alpha = 0.8f))
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
            color = ArenaMuted,
            fontSize = 8.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun BoxScope.UpdatePanel(
    title: String,
    body: String,
    meta: String?,
    busy: Boolean = false,
    primaryLabel: String?,
    onPrimary: () -> Unit,
    allowDismiss: Boolean = true,
    onDismiss: () -> Unit
) {
    Surface(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .fillMaxWidth()
            .semantics { contentDescription = "ARENA_UPDATE_PANEL" },
        shape = RoundedCornerShape(16.dp),
        color = ArenaSurface,
        border = BorderStroke(1.dp, ArenaCyan.copy(alpha = 0.5f)),
        shadowElevation = 8.dp
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (busy) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = ArenaCyan,
                        strokeWidth = 2.dp
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    title,
                    color = ArenaText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Text(
                body,
                color = ArenaMuted,
                fontSize = 10.sp,
                lineHeight = 14.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
            meta?.let {
                Text(
                    it,
                    color = ArenaCyan,
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (primaryLabel != null || allowDismiss) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (allowDismiss) {
                        TextButton(onClick = onDismiss) {
                            Text("CLOSE", color = ArenaMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (primaryLabel != null) {
                        TextButton(onClick = onPrimary) {
                            Text(primaryLabel, color = ArenaCyan, fontSize = 9.sp, fontWeight = FontWeight.Black)
                        }
                    }
                }
            }
        }
    }
}

private fun updateMeta(manifest: ArenaUpdateManifest): String {
    val commit = manifest.commit?.take(7)?.let { " · $it" }.orEmpty()
    return "Build ${manifest.versionCode} · ${formatUpdateBytes(manifest.sizeBytes)}$commit"
}
