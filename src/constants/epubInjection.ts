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

export const JS_GENERATE_LOCATIONS =
  `window.whisper.generateLocations(); true;`;

// Immersion reading: highlight the paragraph nearest to `ratio` (0–1) through
// the current page's visible text blocks. Injects a style tag on first call,
// then moves the .whisper-immersion-active class to the target element and
// scrolls it gently into view. Works by reaching into the epub.js iframe.
export const JS_HIGHLIGHT_PROGRESS = (ratio: number) => `
(function(r) {
  try {
    var iframe = document.querySelector('iframe');
    if (!iframe) return;
    var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
    if (!doc) return;
    if (!doc.querySelector('#_wh_imm_style')) {
      var s = doc.createElement('style');
      s.id = '_wh_imm_style';
      s.textContent = '.whisper-immersion-active{background:rgba(255,200,50,0.35)!important;border-radius:3px;transition:background 0.4s;}';
      (doc.head || doc.body).appendChild(s);
    }
    var prev = doc.querySelector('.whisper-immersion-active');
    if (prev) prev.classList.remove('whisper-immersion-active');
    var blocks = Array.from(doc.querySelectorAll('p,h1,h2,h3,h4,li,div.para,div.stanza,blockquote')).filter(function(el){
      var e = el;
      return e.textContent.trim().length > 8 && e.children.length < 5;
    });
    if (!blocks.length) return;
    var idx = Math.min(Math.floor(r * blocks.length), blocks.length - 1);
    var target = blocks[idx];
    target.classList.add('whisper-immersion-active');
    target.scrollIntoView({behavior:'smooth',block:'center'});
  } catch(e) {}
})(${ratio});
true;`;

export const JS_CLEAR_HIGHLIGHT = `
(function() {
  try {
    var iframe = document.querySelector('iframe');
    if (!iframe) return;
    var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
    if (!doc) return;
    var el = doc.querySelector('.whisper-immersion-active');
    if (el) el.classList.remove('whisper-immersion-active');
  } catch(e) {}
})();
true;`;
