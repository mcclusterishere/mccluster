/* Control Room markdown for AI replies.

   The resident model answers in markdown the way any assistant does, and
   pre-wrap text showed it as a wall of asterisks and backticks. This turns
   a small, safe subset into HTML: fenced code, inline code, headings,
   lists, quotes, rules, bold, italic and http(s) links.

   Everything is escaped FIRST and only then recognised, so nothing the
   model writes can become live markup. No state, no network. */
(function () {
  "use strict";

  var ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ENTITIES[c]; });
  }

  /* Reasoning models (qwen3 among them) can emit <think>…</think> ahead of
     the answer. That is working, not reply: drop a closed block, anything
     before a stray closing tag, and an unterminated block to the end. */
  function stripThinking(value) {
    var s = String(value || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
    var close = s.search(/<\/think>/i);
    if (close >= 0) s = s.slice(close + 8);
    var open = s.search(/<think>/i);
    if (open >= 0) s = s.slice(0, open);
    return s.trim();
  }

  function inline(raw) {
    return String(raw).split(/(`[^`\n]+`)/).map(function (part, i) {
      if (i % 2 === 1) return "<code>" + esc(part.slice(1, -1)) + "</code>";
      return esc(part)
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
    }).join("");
  }

  var FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
  var FENCE_END = /^\s*```\s*$/;
  var HEADING = /^(#{1,6})\s+(.*)$/;
  var RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  var BULLET = /^\s*[-*+]\s+/;
  var NUMBER = /^\s*(\d+)[.)]\s+/;
  var QUOTE = /^\s*>\s?/;

  function render(value) {
    var lines = stripThinking(value).replace(/\r\n?/g, "\n").split("\n");
    var html = [], para = [], i = 0;
    function flush() {
      if (para.length) html.push("<p>" + para.map(inline).join("<br>") + "</p>");
      para = [];
    }
    while (i < lines.length) {
      var line = lines[i];
      var fence = line.match(FENCE);
      if (fence) {
        flush();
        var code = [];
        i += 1;
        while (i < lines.length && !FENCE_END.test(lines[i])) { code.push(lines[i]); i += 1; }
        i += 1;
        html.push('<div class="cr-md-code"><div class="cr-md-code__bar"><span>' + esc(fence[1] || "code") + '</span>' +
          '<button class="cr-md-code__copy" type="button" data-action="ai-copy-code">Copy</button></div>' +
          '<pre><code>' + esc(code.join("\n")) + '</code></pre></div>');
        continue;
      }
      if (!line.trim()) { flush(); i += 1; continue; }
      if (RULE.test(line)) { flush(); html.push("<hr>"); i += 1; continue; }
      var heading = line.match(HEADING);
      if (heading) {
        flush();
        var level = Math.min(6, heading[1].length + 2);
        html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
        i += 1;
        continue;
      }
      if (BULLET.test(line) || NUMBER.test(line)) {
        flush();
        var ordered = !BULLET.test(line);
        var marker = ordered ? NUMBER : BULLET;
        var start = ordered ? Number(line.match(NUMBER)[1]) : 1;
        var items = [];
        while (i < lines.length && marker.test(lines[i])) {
          items.push(lines[i].replace(marker, ""));
          i += 1;
          /* An indented line that is not itself a list item continues the
             item above it rather than breaking the list. */
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBER.test(lines[i])) {
            items[items.length - 1] += " " + lines[i].trim();
            i += 1;
          }
        }
        var tag = ordered ? "ol" : "ul";
        html.push("<" + tag + (ordered && start !== 1 ? ' start="' + start + '"' : "") + ">" +
          items.map(function (item) { return "<li>" + inline(item) + "</li>"; }).join("") + "</" + tag + ">");
        continue;
      }
      if (QUOTE.test(line)) {
        flush();
        var quoted = [];
        while (i < lines.length && QUOTE.test(lines[i])) { quoted.push(lines[i].replace(QUOTE, "")); i += 1; }
        html.push("<blockquote>" + quoted.map(inline).join("<br>") + "</blockquote>");
        continue;
      }
      para.push(line);
      i += 1;
    }
    flush();
    return html.join("");
  }

  window.CR = window.CR || {};
  window.CR.md = { render: render, stripThinking: stripThinking, esc: esc };
})();
