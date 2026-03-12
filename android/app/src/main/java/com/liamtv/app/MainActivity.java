package com.liamtv.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {

    private WebView webView;
    private FrameLayout rootLayout;
    private View setupView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private static final String PREFS = "liamtv_prefs";
    private static final String KEY_SITE_URL = "site_url";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        goFullscreen();

        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(0xFF000000);
        setContentView(rootLayout);

        String savedUrl = getPrefs().getString(KEY_SITE_URL, "");
        String buildUrl = BuildConfig.TV_PLAYER_URL;
        boolean hasBuildUrl = buildUrl != null && !buildUrl.contains("YOURSITE");

        if (!savedUrl.isEmpty()) {
            launchPlayer(savedUrl);
        } else if (hasBuildUrl) {
            launchPlayer(buildUrl);
        } else {
            showSetup();
        }
    }

    private void goFullscreen() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void showSetup() {
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.setBackgroundColor(0xFF0a0a1a);
        scroll.setFillViewport(true);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        layout.setPadding(60, 40, 60, 40);

        TextView title = new TextView(this);
        title.setText("Liam TV");
        title.setTextSize(36);
        title.setTextColor(0xFFff6b35);
        title.setGravity(android.view.Gravity.CENTER);
        title.setPadding(0, 0, 0, 12);
        layout.addView(title);

        TextView desc = new TextView(this);
        desc.setText("Paste your TV link from the Playlist Manager.\nOpen Playlist Manager \u2192 Export tab \u2192 Generate TV Link \u2192 Copy Link");
        desc.setTextSize(14);
        desc.setTextColor(0x99FFFFFF);
        desc.setGravity(android.view.Gravity.CENTER);
        desc.setPadding(0, 0, 0, 24);
        layout.addView(desc);

        final EditText input = new EditText(this);
        input.setHint("Paste TV link here...");
        input.setTextSize(14);
        input.setTextColor(0xFFFFFFFF);
        input.setHintTextColor(0x44FFFFFF);
        input.setBackgroundColor(0x22FFFFFF);
        input.setPadding(24, 20, 24, 20);
        input.setSingleLine(true);
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        input.setLayoutParams(inputParams);
        layout.addView(input);

        Button btn = new Button(this);
        btn.setText("Watch");
        btn.setTextSize(18);
        btn.setTextColor(0xFF1a0000);
        btn.setBackgroundColor(0xFFff6b35);
        btn.setPadding(60, 16, 60, 16);
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        btnParams.topMargin = 24;
        btn.setLayoutParams(btnParams);
        btn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String pasted = input.getText().toString().trim();
                if (pasted.isEmpty()) return;
                String url = pasted.startsWith("http") ? pasted : "https://" + pasted;
                saveUrl(url);
                launchPlayer(url);
            }
        });
        layout.addView(btn);

        scroll.addView(layout);
        setupView = scroll;
        rootLayout.addView(scroll, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        input.requestFocus();
    }

    private void launchPlayer(String url) {
        if (setupView != null) {
            rootLayout.removeView(setupView);
            setupView = null;
        }

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setDatabaseEnabled(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUserAgentString(ws.getUserAgentString() + " LiamTV-Android/1.0");
        webView.setInitialScale(0);

        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void exit() {
                runOnUiThread(() -> finish());
            }
        }, "LiamTV");

        webView.setWebViewClient(new WebViewClient());

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                fullscreenCallback = callback;
                fullscreenView = view;
                rootLayout.addView(view, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                ));
                webView.setVisibility(View.GONE);
            }

            @Override
            public void onHideCustomView() {
                if (fullscreenView != null) {
                    rootLayout.removeView(fullscreenView);
                    fullscreenView = null;
                }
                if (fullscreenCallback != null) {
                    fullscreenCallback.onCustomViewHidden();
                    fullscreenCallback = null;
                }
                if (webView != null) {
                    webView.setVisibility(View.VISIBLE);
                }
            }
        });

        rootLayout.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        webView.loadUrl(url);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (webView != null) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_LEFT:
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                case KeyEvent.KEYCODE_DPAD_UP:
                case KeyEvent.KEYCODE_DPAD_DOWN:
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    webView.dispatchKeyEvent(event);
                    return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            if (fullscreenCallback != null) {
                fullscreenCallback.onCustomViewHidden();
            }
            if (fullscreenView != null) {
                rootLayout.removeView(fullscreenView);
                fullscreenView = null;
            }
            fullscreenCallback = null;
            if (webView != null) webView.setVisibility(View.VISIBLE);
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        goFullscreen();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void saveUrl(String url) {
        getPrefs().edit().putString(KEY_SITE_URL, url).apply();
    }
}
