package com.beequ.app;

import android.os.Bundle;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

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
