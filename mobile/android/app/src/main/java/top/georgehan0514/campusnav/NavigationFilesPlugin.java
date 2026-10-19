package top.georgehan0514.campusnav;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "NavigationFiles")
public class NavigationFilesPlugin extends Plugin {
    @PluginMethod
    public void saveRoutes(PluginCall call) {
        String json = call.getString("json", "");
        if (json.isEmpty() || json.length() > 5000000) { call.reject("路线文件为空或过大"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "atlas-go-routes.json");
        try { startActivityForResult(call, intent, "saveRoutesResult"); }
        catch (Exception error) { call.reject("当前设备没有可用的文件保存应用"); }
    }

    @ActivityCallback
    private void saveRoutesResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { response.put("saved", false); call.resolve(response); return; }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
            if (stream == null) throw new IllegalStateException();
            stream.write(call.getString("json", "").getBytes(StandardCharsets.UTF_8));
            response.put("saved", true); call.resolve(response);
        } catch (Exception error) { call.reject("无法写入文件，请检查目标存储空间"); }
    }
}
