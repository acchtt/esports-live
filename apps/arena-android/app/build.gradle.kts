import java.io.File
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

android {
    namespace = "live.esports.arena"
    compileSdk = 36

    defaultConfig {
        applicationId = "live.esports.arena"
        minSdk = 24
        targetSdk = 36
        versionCode = env("ARENA_ANDROID_VERSION_CODE")?.toIntOrNull() ?: 46
        versionName = env("ARENA_ANDROID_VERSION_NAME") ?: "0.3.3"

        buildConfigField(
            "String",
            "API_BASE_URL",
            "\"${env("ARENA_ANDROID_API_URL") ?: "https://mobile-demo-esports-live-api.acchtt.workers.dev"}\""
        )
        buildConfigField("String", "BUILD_SHA", "\"${env("MOBILE_V3_COMMIT_SHA") ?: "local"}\"")
    }

    signingConfigs {
        create("arenaDebug") {
            val path = env("ARENA_ANDROID_DEBUG_KEYSTORE_PATH")
            if (path != null) {
                storeFile = File(path)
                storePassword = env("ARENA_ANDROID_DEBUG_STORE_PASSWORD") ?: "android"
                keyAlias = env("ARENA_ANDROID_DEBUG_KEY_ALIAS") ?: "androiddebugkey"
                keyPassword = env("ARENA_ANDROID_DEBUG_KEY_PASSWORD") ?: "android"
            }
        }
        create("arenaRelease") {
            val path = env("ARENA_ANDROID_RELEASE_KEYSTORE_PATH")
            if (path != null) {
                storeFile = File(path)
                storePassword = env("ARENA_ANDROID_RELEASE_STORE_PASSWORD")
                keyAlias = env("ARENA_ANDROID_RELEASE_KEY_ALIAS")
                keyPassword = env("ARENA_ANDROID_RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            if (env("ARENA_ANDROID_DEBUG_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("arenaDebug")
            }
            isMinifyEnabled = false
        }
        release {
            val releaseSigning = signingConfigs.getByName("arenaRelease")
            if (releaseSigning.storeFile != null) signingConfig = releaseSigning
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.08.00")

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-svg:2.7.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
}
