package top.georgehan0514.campusnav;

import android.speech.tts.TextToSpeech;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

@CapacitorPlugin(name = "VoiceNavigation")
public class VoiceNavigationPlugin extends Plugin {
    private TextToSpeech engine;
    private boolean initialized = false;
    private String failure;
    private PluginCall waiting;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            engine = new TextToSpeech(getContext(), status -> getActivity().runOnUiThread(() -> {
                initialized = true;
                if (status != TextToSpeech.SUCCESS) failure = "系统语音引擎初始化失败，请检查文字转语音设置";
                else {
                    int language = engine.setLanguage(Locale.SIMPLIFIED_CHINESE);
                    if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) failure = "系统缺少中文语音包，请在文字转语音设置中安装";
                    engine.setSpeechRate(0.95f);
                }
                if (waiting != null) { PluginCall call = waiting; waiting = null; speakReady(call); }
            }));
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!initialized) { if (waiting != null) waiting.resolve(); waiting = call; return; }
            speakReady(call);
        });
    }

    private void speakReady(PluginCall call) {
        if (failure != null || engine == null) { call.reject(failure != null ? failure : "语音引擎不可用"); return; }
        String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > 1500) { call.reject("语音内容为空或过长"); return; }
        int result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "atlas-" + System.nanoTime());
        if (result == TextToSpeech.ERROR) call.reject("系统无法播放语音，请检查中文语音引擎");
        else call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { cancel(); call.resolve(); });
    }

    private void cancel() { if (waiting != null) { waiting.resolve(); waiting = null; } if (engine != null) engine.stop(); }
    @Override
    protected void handleOnPause() { cancel(); }
    @Override
    protected void handleOnDestroy() { cancel(); if (engine != null) { engine.shutdown(); engine = null; } }
}
