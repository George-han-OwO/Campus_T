import { Capacitor, registerPlugin } from "@capacitor/core";
const NativeVoice = registerPlugin<{
  speak(options: { text: string }): Promise<void>;
  stop(): Promise<void>;
}>("VoiceNavigation");
export async function speak(text: string) {
  if (Capacitor.isNativePlatform()) return NativeVoice.speak({ text });
  if (!("speechSynthesis" in window))
    throw new Error("当前浏览器不支持语音，请在安卓 App 中使用");
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.95;
  await new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) =>
      event.error === "interrupted" || event.error === "canceled"
        ? resolve()
        : reject(new Error("语音服务不可用，请检查中文语音引擎"));
    speechSynthesis.speak(utterance);
  });
}
export function stopVoice() {
  if (Capacitor.isNativePlatform()) void NativeVoice.stop().catch(() => {});
  else if ("speechSynthesis" in window) speechSynthesis.cancel();
}
