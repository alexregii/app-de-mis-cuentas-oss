if (typeof window !== "undefined" && !("OffscreenCanvas" in window)) {
  class OffscreenCanvasFallback {
    private readonly element = document.createElement("canvas");

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }

    get width() {
      return this.element.width;
    }

    set width(value: number) {
      this.element.width = value;
    }

    get height() {
      return this.element.height;
    }

    set height(value: number) {
      this.element.height = value;
    }

    getContext(contextId: "2d", options?: CanvasRenderingContext2DSettings) {
      return this.element.getContext(contextId, options);
    }

    transferToImageBitmap() {
      return this.element as unknown as ImageBitmap;
    }
  }

  Object.defineProperty(window, "OffscreenCanvas", {
    configurable: true,
    value: OffscreenCanvasFallback,
  });
}
