// This file holds JS strings that can be injected into the WebView
// to command the epub bridge at runtime.
// The bridge itself lives in assets/epub-bridge/epub-bridge.html

export const JS_LOAD_BOOK = (urlOrBase64: string) =>
  `window.whisper.loadBook(${JSON.stringify(urlOrBase64)}); true;`;

export const JS_LOAD_BOOK_BASE64 = (base64: string) =>
  `window.whisper.loadBookFromBase64(${JSON.stringify(base64)}); true;`;

export const JS_GO_TO_CFI = (cfi: string) =>
  `window.whisper.goTo(${JSON.stringify(cfi)}); true;`;

export const JS_GO_TO_CHAPTER = (index: number) =>
  `window.whisper.goToChapter(${index}); true;`;

export const JS_SET_FONT_SIZE = (px: number) =>
  `window.whisper.setFontSize(${px}); true;`;

export const JS_SET_THEME = (theme: 'light' | 'dark' | 'sepia' | 'eink') =>
  `window.whisper.setTheme(${JSON.stringify(theme)}); true;`;

export const JS_SET_FONT_FAMILY = (family: string) =>
  `window.whisper.setFontFamily(${JSON.stringify(family)}); true;`;

export const JS_SET_MARGIN = (margin: string) =>
  `window.whisper.setMargin(${JSON.stringify(margin)}); true;`;

export const JS_SET_LINE_HEIGHT = (value: number) =>
  `window.whisper.setLineHeight(${value}); true;`;

export const JS_GENERATE_LOCATIONS =
  `window.whisper.generateLocations(); true;`;

export const JS_SEARCH = (query: string, requestId: string): string =>
  `window.whisper.search(${JSON.stringify(query)}, ${JSON.stringify(requestId)});`;
