(() => {
  const appName = "__FORGECODE_NAME__";
  const exactNames = new Set(["Codex", "OpenAI Codex", "Codex (Dev)"]);
  const hiddenWorkspaceNames = new Set(["ChatGPT Work"]);
  // React may recreate the selector after its label has already been branded.
  // Match both states so it remains a fixed ForgeCode product label.
  const workspaceSelectorNames = new Set(["Work", "工作", appName]);
  const textReplacements = new Map([
    ["Use ChatGPT Work", `Use ${appName}`],
    ["使用 ChatGPT Work", `使用 ${appName}`],
  ]);
  let scheduled = false;

  function replaceHomeBrandMark() {
    const heading = Array.from(document.querySelectorAll("h1, h2")).find((element) => {
      const text = (element.textContent || "").trim();
      return /what should we build/i.test(text) || text.includes("\u6211\u4eec\u8be5\u6784\u5efa");
    });
    if (!heading) return;

    const host = heading.parentElement;
    if (!host || host.querySelector(":scope > .aigeek-home-mark")) return;

    const siblings = Array.from(host.children);
    const headingIndex = siblings.indexOf(heading);
    const defaultMark = siblings
      .slice(0, headingIndex)
      .reverse()
      .find((element) => element.matches("svg") || element.querySelector("svg"));
    defaultMark?.setAttribute("data-aigeek-home-default-mark", "");

    const mark = document.createElement("span");
    mark.className = "aigeek-home-mark";
    mark.setAttribute("aria-label", appName);
    mark.innerHTML = [
      '<img class="aigeek-home-mark-static" src="./aigeek-mark.png" alt="" />',
      '<img class="aigeek-home-mark-shatter" src="./aigeek-logo-shatter.gif" alt="" />',
    ].join("");
    heading.before(mark);
  }

  function replaceVisibleBranding(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];

    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const value = node.nodeValue;
      const trimmed = value.trim();
      const parent = node.parentElement;
      if (!parent) continue;

      const replacement = textReplacements.get(trimmed);
      if (replacement) {
        node.nodeValue = value.replace(trimmed, replacement);
        continue;
      }

      const rect = parent.getBoundingClientRect();
      if (
        workspaceSelectorNames.has(trimmed)
        && rect.left < 300
        && rect.top < 100
      ) {
        node.nodeValue = value.replace(trimmed, appName);
        parent.setAttribute("data-forgecode-brand", "");
        lockWorkspaceSelector(parent);
        continue;
      }

      if (hiddenWorkspaceNames.has(trimmed)) {
        parent.setAttribute("data-forgecode-hide-workspace-name", "");
        continue;
      }

      if (trimmed === "OpenAI") {
        node.nodeValue = value.replace(trimmed, appName);
        parent.setAttribute("data-forgecode-brand", "");
        continue;
      }

      if (!exactNames.has(trimmed)) continue;

      node.nodeValue = value.replace(trimmed, appName);
      if (rect.left < 300 && rect.top < 180 && rect.width < 260) {
        parent.setAttribute("data-forgecode-brand", "");
      }
    }

    for (const element of root.querySelectorAll("[aria-label], [title], [placeholder]")) {
      for (const attribute of ["aria-label", "title", "placeholder"]) {
        const value = element.getAttribute(attribute);
        if (textReplacements.has(value)) {
          element.setAttribute(attribute, textReplacements.get(value));
        } else if (exactNames.has(value) || value === "OpenAI") {
          element.setAttribute(attribute, appName);
        }
      }
    }
  }

  function lockWorkspaceSelector(element) {
    const control = element.closest("button, [role='button']") || element.parentElement;
    if (!control || control.dataset.forgecodeWorkspaceLocked === "true") return;

    control.dataset.forgecodeWorkspaceLocked = "true";
    control.setAttribute("data-forgecode-workspace-selector", "");
    control.setAttribute("aria-disabled", "true");
    control.setAttribute("aria-expanded", "false");
    control.removeAttribute("aria-haspopup");
    control.tabIndex = -1;
    if ("disabled" in control) control.disabled = true;

    for (const eventName of ["click", "pointerdown", "keydown"]) {
      control.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
  }

  function refresh() {
    scheduled = false;
    document.title = appName;
    replaceVisibleBranding(document.body);
    replaceHomeBrandMark();
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    new MutationObserver(scheduleRefresh).observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-label", "placeholder", "title"],
      childList: true,
      subtree: true,
    });
  });
})();
