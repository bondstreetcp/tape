import { useEffect, useState } from "react";

/** True when light mode is active — tracks the `.light` class on <html> and
 *  updates if the theme is toggled. For JS-computed colors (e.g. heatmap tiles)
 *  that can't use CSS variables. */
export function useIsLight(): boolean {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const update = () => setLight(document.documentElement.classList.contains("light"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return light;
}
