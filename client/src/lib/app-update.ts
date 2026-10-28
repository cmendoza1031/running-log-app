/**
 * Home-screen web apps keep the old page in memory across deploys. When the app comes back to the
 * foreground, compare the deployed bundle name with the running one and reload if it changed.
 * Native (Capacitor) builds ship their bundle inside the app, so this is web-only.
 */
import { Capacitor } from "@capacitor/core";

const bundleOf = (html: string) => html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1] ?? null;

export function watchForNewVersion(isBusy: () => boolean): () => void {
  if (Capacitor.isNativePlatform() || import.meta.env.DEV) return () => {};
  const running = document.querySelector<HTMLScriptElement>('script[src^="/assets/index-"]')?.getAttribute("src") ?? null;
  if (!running) return () => {};
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== "visible" || isBusy()) return;
    checking = true;
    try {
      const html = await (await fetch("/", { cache: "no-store" })).text();
      const deployed = bundleOf(html);
      if (deployed && deployed !== running) window.location.reload();
    } catch {
      /* offline or server waking up — try again next time */
    } finally {
      checking = false;
    }
  };
  document.addEventListener("visibilitychange", check);
  const timer = window.setInterval(check, 10 * 60 * 1000);
  return () => {
    document.removeEventListener("visibilitychange", check);
    window.clearInterval(timer);
  };
}
