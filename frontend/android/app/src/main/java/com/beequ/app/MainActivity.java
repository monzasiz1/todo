package com.beequ.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  // Hintergrundfarbe der System-Leisten-Bereiche. Passt zum dunklen
  // App-Basis-Hintergrund (capacitor.config backgroundColor).
  private static final int SYSTEM_BAR_BG = 0xFF0B1220;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Edge-to-Edge ist ab Android 15 (targetSdk 35+) erzwungen und laesst
    // sich nicht mehr abschalten: die WebView zeichnet hinter Status-/
    // Navigationsleiste. WindowCompat.setDecorFitsSystemWindows(false) setzt
    // das auch auf Android 14 und aelter konsistent (entspricht Googles
    // EdgeToEdge.enable()).
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Verhindert, dass das System einen halbtransparenten Schutz-Scrim
      // hinter eine transparente Navigationsleiste legt.
      getWindow().setNavigationBarContrastEnforced(false);
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // WebView darf bis in den Display-Cutout (Notch) reichen; der Inset-
      // Listener unten haelt den Inhalt davon frei.
      getWindow().getAttributes().layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }

    // Helle (weisse) Status-/Navigationsleisten-Icons, da der Hintergrund
    // hinter den Leisten dunkel ist.
    WindowInsetsControllerCompat controller =
      WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (controller != null) {
      controller.setAppearanceLightStatusBars(false);
      controller.setAppearanceLightNavigationBars(false);
    }

    // Kern-Fix: Android-WebViews melden env(safe-area-inset-*) fuer die
    // System-Leisten NICHT (nur fuer Notches). Das CSS der App stuetzt sich
    // aber komplett auf env() — dadurch lag der Header unter der Statusleiste
    // und der untere Scrollbereich unter der Gestenleiste (Swipes loesten
    // System-Gesten statt Scrollen aus).
    //
    // Loesung: die echten WindowInsets (Systemleisten + Cutout) als Padding
    // auf den Content-Container legen. Damit entspricht der WebView-Viewport
    // wieder dem sichtbaren Bereich (100vh/top:0 stimmen), und die env()-
    // Nullwerte im CSS sind dann korrekt. Funktioniert auf allen Android-
    // Versionen, unabhaengig vom Remote-CSS.
    final View content = getWindow().getDecorView().findViewById(android.R.id.content);
    content.setBackgroundColor(SYSTEM_BAR_BG);
    ViewCompat.setOnApplyWindowInsetsListener(content, (v, windowInsets) -> {
      Insets bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return WindowInsetsCompat.CONSUMED;
    });
    ViewCompat.requestApplyInsets(content);

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
