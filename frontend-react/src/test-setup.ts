import "@testing-library/jest-dom/vitest";
import {afterEach} from "vitest";
import {cleanup, configure} from "@testing-library/react";

afterEach(cleanup);
configure({asyncUtilTimeout: 5_000});

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof window !== "undefined") {
  // JSDOM logs `scrollTo` as unimplemented; Playwright covers real scrolling.
  window.scrollTo = () => undefined;
}
