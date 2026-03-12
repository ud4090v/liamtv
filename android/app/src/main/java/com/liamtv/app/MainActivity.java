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
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        layout.setPadding(80, 40, 80, 40);
        layout.setBackgroundColor(0xFF0a0a1a);

        TextView title = new TextView(this);
        title.setText("LiamTV Setup");
        title.setTextSize(32);
        title.setTextColor(0xFFff6b35);
        title.setGravity(android.view.Gravity.CENTER);
        title.setPadding(0, 0, 0, 20);
        layout.addView(title);

        TextView desc = new TextView(this);
        desc.setText("Enter your Netlify site name to connect to your playlist.\nExample: my-cool-site");
        desc.setTextSize(16);
        desc.setTextColor(0x99FFFFFF);
        desc.setGravity(android.view.Gravity.CENTER);
        desc.setPadding(0, 0, 0, 40);
        layout.addView(desc);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER);

        TextView prefix = new TextView(this);
        prefix.setText("https://");
        prefix.setTextSize(18);
        prefix.setTextColor(0x66FFFFFF);
        row.addView(prefix);

        final EditText input = new EditText(this);
        input.setHint("your-site-name");
        input.setTextSize(18);
        input.setTextColor(0xFFFFFFFF);
        input.setHintTextColor(0x44FFFFFF);
        input.setBackgroundColor(0x22FFFFFF);
        input.setPadding(20, 16, 20, 16);
        input.setSingleLine(true);
        input.setMinimumWidth(400);
        row.addView(input);

        TextView suffix = new TextView(this);
        suffix.setText(".netlify.app");
        suffix.setTextSize(18);
        suffix.setTextColor(0x66FFFFFF);
        row.addView(suffix);

        layout.addView(row);

        Button btn = new Button(this);
        btn.setText("Connect and Watch");
        btn.setTextSize(20);
        btn.setTextColor(0xFF1a0000);
        btn.setBackgroundColor(0xFFff6b35);
        btn.setPadding(60, 20, 60, 20);
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        btnParams.topMargin = 40;
        btnParams.gravity = android.view.Gravity.CENTER;
        btn.setLayoutParams(btnParams);
        btn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String siteName = input.getText().toString().trim();
                if (siteName.isEmpty()) return;
                String url;
                if (siteName.contains(".")) {
                    url = siteName.startsWith("http") ? siteName : "https://" + siteName;
                    if (!url.contains("/tv-player")) url += "/tv-player.html";
                } else {
                    url = "https://" + siteName + ".netlify.app/tv-player.html";
                }
                saveUrl(url);
                launchPlayer(url);
            }
        });
        layout.addView(btn);

        setupView = layout;
        rootLayout.addView(layout, new FrameLayout.LayoutParams(
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
        ws.setUserAgentString(ws.getUserAgentString() + " LiamTV-Android/1.0");

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
