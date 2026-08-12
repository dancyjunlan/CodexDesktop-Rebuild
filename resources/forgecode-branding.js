(() => {
  const appName = "__FORGECODE_NAME__";
  const sidebarName = "艾极科技";
  const exactNames = new Set(["Codex", "OpenAI Codex", "Codex (Dev)"]);
  const hiddenWorkspaceNames = new Set(["ChatGPT Work"]);
  // React may recreate the selector after its label has already been branded.
  // Match both states so it remains a fixed ForgeCode product label.
  const workspaceSelectorNames = new Set(["Work", "工作", appName]);
  const textReplacements = new Map([
    ["Use ChatGPT Work", `Use ${appName}`],
    ["使用 ChatGPT Work", `使用 ${appName}`],
  ]);
  const homeGreetingLabels = new Set([
    "What should we build?",
    "\u6211\u4eec\u8be5\u6784\u5efa\u4ec0\u4e48\uff1f",
  ]);
  const homeGreeting = "\u827e\u6781\u79d1\u6280\u667a\u80fd\u8bbe\u8ba1\u52a9\u624b";
  const hiddenNavigationLabels = new Set([
    "Pull requests",
    "Scheduled",
    "Plugins",
    "\u62c9\u53d6\u8bf7\u6c42",
    "\u5df2\u5b89\u6392",
    "\u63d2\u4ef6",
  ]);
  const hiddenSuggestionLabels = new Set([
    "Explore and understand code",
    "Build a new feature, app, or tool",
    "Review code and suggest improvements",
    "Fix bugs and failures",
    "\u63a2\u7d22\u5e76\u7406\u89e3\u4ee3\u7801",
    "\u6784\u5efa\u65b0\u529f\u80fd\u3001\u5e94\u7528\u6216\u5de5\u5177",
    "\u5ba1\u67e5\u4ee3\u7801\u5e76\u63d0\u51fa\u4fee\u6539\u5efa\u8bae",
    "\u4fee\u590d\u95ee\u9898\u548c\u5931\u8d25",
  ]);
  let scheduled = false;

  function replaceHomeBrandMark() {
    const defaultMark = document.querySelector('[data-testid="home-icon"]');
    if (!defaultMark || defaultMark.parentElement?.querySelector(".aigeek-home-mark")) return;
    defaultMark.setAttribute("data-aigeek-home-default-mark", "");

    const mark = document.createElement("span");
    mark.className = "aigeek-home-mark";
    mark.setAttribute("aria-label", appName);
    mark.innerHTML = [
      '<img class="aigeek-home-mark-static" src="./aigeek-mark.png" alt="" />',
      '<img class="aigeek-home-mark-shatter" src="./aigeek-logo-shatter.gif" alt="" />',
    ].join("");
    defaultMark.after(mark);
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

      if (homeGreetingLabels.has(trimmed)) {
        node.nodeValue = value.replace(trimmed, homeGreeting);
        continue;
      }

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
        node.nodeValue = value.replace(trimmed, sidebarName);
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

  function hideUnwantedItem(element, kind) {
    const control = element.closest("button, a, [role='button'], [role='link']");
    const target = control || element.parentElement;
    if (target) target.setAttribute("data-aigeek-hide", kind);
  }

  function hideUnwantedSurfaces(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const label = node.nodeValue.trim();
      const element = node.parentElement;
      if (!element) continue;

      if (hiddenNavigationLabels.has(label) && element.getBoundingClientRect().left < 300) {
        hideUnwantedItem(element, "navigation");
      } else if (hiddenSuggestionLabels.has(label)) {
        hideUnwantedItem(element, "suggestion");
      }
    }

  }

  function refresh() {
    scheduled = false;
    document.title = appName;
    replaceVisibleBranding(document.body);
    replaceHomeBrandMark();
    hideUnwantedSurfaces(document.body);
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
