package top.georgehan0514.campusnav;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoiceNavigationPlugin.class);
        registerPlugin(NavigationFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
