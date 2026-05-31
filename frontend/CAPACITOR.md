# Capacitor — Native App Builds (Android + iOS)

## Voraussetzungen

**Android:**
- [Android Studio](https://developer.android.com/studio) installieren (bringt JDK + Android SDK + Build-Tools mit)
- Mindestens Android SDK Platform 34 + Build-Tools 34.x via SDK Manager installieren
- Environment-Variable `ANDROID_HOME` auf das SDK-Verzeichnis (z.B. `C:\Users\<user>\AppData\Local\Android\Sdk`)

**iOS** (nur auf macOS möglich):
- Xcode 15+ aus dem App Store
- CocoaPods (`sudo gem install cocoapods`)
- Auf macOS dann: `npx cap add ios` ausführen

## Erstmaliger Build (Android)

```bash
cd frontend

# 1) Web-App bauen + Capacitor synchronisieren
npm run cap:sync

# 2) Android Studio mit dem Projekt öffnen
npm run cap:android
# → öffnet android/ in Android Studio

# In Android Studio:
#   Build → Generate Signed Bundle / APK → Android App Bundle (.aab)
#   Signing-Key: neu erstellen (für ersten Release) oder bestehenden wählen
#   Bundle-Speicherort: ein sicherer Ordner OUTSIDE des Repos!
```

## Iteration (Code-Änderung → neuer Build)

```bash
cd frontend
npm run cap:sync       # baut Web-App + kopiert dist/ in android/app/.../public/
# dann in Android Studio: Run oder Build Bundle
```

## API-URL für nativen Build

Im Web läuft die App same-origin (`/api`). In der nativen App läuft die WebView von `capacitor://localhost` — `/api` zeigt ins Leere. Setze in einer **`.env.production.local`** (nicht committen!):

```
VITE_API_BASE_URL=https://deine-produktions-domain.de/api
```

Das wird beim nächsten `vite build` in den nativen Bundle eingebaut.

## Was bereits konfiguriert ist

- **App-ID**: `de.beequ.app` (`capacitor.config.json`)
- **App-Name**: `BeeQu`
- **WebView Force-Dark deaktiviert** ([MainActivity.java](android/app/src/main/java/de/beequ/app/MainActivity.java)) — Android WebView wendet sein eigenes Auto-Darkening NICHT mehr auf unsere App an, unser CSS-Theming gewinnt.
- **`background_color`** im Manifest auf dunkles `#0B1220` (Premium-Look).
- **`androidScheme: https`** — Service Worker funktioniert, kein Mixed-Content-Stress.

## Play Store Release Checkliste

- [ ] Signing-Key erstellt und sicher gebackupt (Verlust = neuer App-Eintrag nötig)
- [ ] versionCode + versionName in `android/app/build.gradle` hochzählen vor jedem Upload
- [ ] `targetSdkVersion 34+` (Play Store Pflicht 2026)
- [ ] App Privacy Policy URL bereit (Pflicht für Play Console)
- [ ] Data Safety Form ausgefüllt (Supabase = User-Daten, Stripe = Payment, etc.)
- [ ] Erst Internal Test Track, dann Closed Beta, dann Production
- [ ] Wenn IAP geplant: **Google Play Billing** verwenden (Stripe für digitale Goods nicht erlaubt)

## App Store Release (iOS, nur auf macOS)

```bash
cd frontend
npx cap add ios          # einmalig
npm run cap:sync         # Build + Sync
npx cap open ios         # öffnet Xcode

# In Xcode:
#   Signing & Capabilities → Team auswählen
#   Product → Archive → App Store Connect Upload
```
