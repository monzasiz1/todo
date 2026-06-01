package com.beequ.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Edge-to-Edge aktivieren (Pflicht ab Android 15 / targetSdk 35+, hier
    // explizit fuer Abwaertskompatibilitaet auf Android 14 und aelter).
    // Entspricht dem von Google empfohlenen EdgeToEdge.enable(): die WebView
    // zeichnet hinter Status-/Navigationsleiste, die Systemleisten werden
    // transparent. Die Inset-Behandlung uebernimmt die Web-Schicht ueber
    // viewport-fit=cover + env(safe-area-inset-*) im CSS.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Verhindert, dass das System einen halbtransparenten Schutz-Scrim
      // hinter eine transparente Navigationsleiste legt.
      getWindow().setNavigationBarContrastEnforced(false);
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // WebView darf in den Display-Cutout (Notch) hineinzeichnen; env()
      // liefert dann die korrekten Safe-Area-Werte.
      getWindow().getAttributes().layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }

    // Android WebView Force-Dark deaktivieren.
    // Default auf Android 10+ ist FORCE_DARK_AUTO → die WebView versucht
    // unsere App automatisch dunkel zu "filtern" wenn der User Dark Mode
    // im Systemen hat. Das ueberschreibt unser CSS-Theming und produziert
    // hässliche Farbinversionen. Mit FORCE_DARK_OFF respektiert die WebView
    // ausschliesslich unsere CSS-Variablen + color-scheme.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
      WebSettingsCompat.setForceDark(
        getBridge().getWebView().getSettings(),
        WebSettingsCompat.FORCE_DARK_OFF
      );
    }
  }
}
