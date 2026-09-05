/**
 * The component smoke harness: a jsdom window on the Node globals, React Testing Library, and the
 * Next app-router contexts a client view expects (Link / useRouter / usePathname / useSearchParams).
 *
 * Import this module FIRST in a UI test (ESM evaluates imports in order, and Testing Library binds
 * `document` when it loads). Network is stubbed: every fetch answers 503 with `{}`, so a view that
 * fetches in an effect renders its own "couldn't load" path instead of hanging or hitting a server.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/u/sp500", pretendToBeVisual: true });
const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;

const define = (name: string, value: unknown) => {
  try { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); } catch { /* a locked Node global — leave it */ }
};
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
for (const k of [
  "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLButtonElement", "HTMLAnchorElement",
  "Element", "Node", "Text", "DocumentFragment", "SVGElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "InputEvent",
  "FocusEvent", "DOMParser", "MutationObserver", "getComputedStyle", "localStorage", "sessionStorage", "history", "location",
  "requestAnimationFrame", "cancelAnimationFrame",
]) if (k in win) define(k, typeof win[k] === "function" && !/^[A-Z]/.test(k) ? (win[k] as (...a: unknown[]) => unknown).bind(win) : win[k]);

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
if (!("ResizeObserver" in globalThis)) define("ResizeObserver", Observer);
if (!("IntersectionObserver" in globalThis)) define("IntersectionObserver", Observer);
if (typeof win.matchMedia !== "function") {
  win.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } })) as typeof window.matchMedia;
}
define("matchMedia", win.matchMedia);
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// no network in a smoke test — every call reads as a server that is down
define("fetch", async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } }));

import type { ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

const noop = () => {};
const router = { push: noop, replace: noop, prefetch: noop, back: noop, forward: noop, refresh: noop, hmrRefresh: noop };

/** Render a client view inside the app-router contexts a page would provide. */
export function renderView(ui: ReactNode, opts: { pathname?: string } = {}): RenderResult {
  return render(
    <AppRouterContext.Provider value={router as never}>
      <PathnameContext.Provider value={opts.pathname ?? "/u/sp500"}>
        <SearchParamsContext.Provider value={new URLSearchParams() as never}>{ui}</SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

/** Run `fn` with console.error captured; returns what React (or the view) complained about. */
export function capturingErrors<T>(fn: () => T): { result: T; errors: string[] } {
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map((x) => (typeof x === "string" ? x : String(x))).join(" ")); };
  try { return { result: fn(), errors }; } finally { console.error = orig; }
}
