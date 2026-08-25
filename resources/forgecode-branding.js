(() => {
  const appName = "__FORGECODE_NAME__";
  const sidebarName = "__FORGECODE_SIDEBAR_NAME__";
  const webviewIcon = "__BRANDING_WEBVIEW_ICON__";
  const titlebarIcon = "__BRANDING_TITLEBAR_ICON__";
  const assetRevision = "__BRANDING_ASSET_REVISION__";
  const webviewAnimation = "__BRANDING_WEBVIEW_ANIMATION__";
  const exactNames = new Set(["Codex", "OpenAI Codex", "Codex (Dev)"]);
  const ui = {
    hideWindowsSandboxBanner: __FORGECODE_HIDE_WINDOWS_SANDBOX_BANNER__,
    hideApiKeyAuthMenuItem: __FORGECODE_HIDE_API_KEY_AUTH_MENU_ITEM__,
    hideLogoutMenuItem: __FORGECODE_HIDE_LOGOUT_MENU_ITEM__,
    hideModelReasoningEffort: __FORGECODE_HIDE_MODEL_REASONING_EFFORT__,
    hideSidebarPetMenuItem: __FORGECODE_HIDE_SIDEBAR_PET_MENU_ITEM__,
    hideSidebarSettingsMenuItem: __FORGECODE_HIDE_SIDEBAR_SETTINGS_MENU_ITEM__,
    hideSidebarHelpButton: __FORGECODE_HIDE_SIDEBAR_HELP_BUTTON__,
    modelPickerLabel: "__FORGECODE_MODEL_PICKER_LABEL__",
    hiddenWindowsSandboxLabels: new Set(__FORGECODE_HIDDEN_WINDOWS_SANDBOX_LABELS__),
    hiddenApiKeyAuthLabels: new Set(__FORGECODE_HIDDEN_API_KEY_AUTH_LABELS__),
    hiddenLogoutLabels: new Set(__FORGECODE_HIDDEN_LOGOUT_LABELS__),
    hiddenSidebarPetLabels: new Set(__FORGECODE_HIDDEN_SIDEBAR_PET_LABELS__),
    hiddenSidebarSettingsLabels: new Set(__FORGECODE_HIDDEN_SIDEBAR_SETTINGS_LABELS__),
    hiddenSidebarHelpButtonLabels: new Set(__FORGECODE_HIDDEN_SIDEBAR_HELP_BUTTON_LABELS__),
    hiddenModelReasoningEffortLabels: new Set(__FORGECODE_HIDDEN_MODEL_REASONING_EFFORT_LABELS__),
    modelPickerModelLabels: new Set(__FORGECODE_MODEL_PICKER_MODEL_LABELS__),
  };
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
  const homeGreeting = "__FORGECODE_HOME_GREETING__";
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

  function brandAssetUrl(fileName) {
    return `./${fileName}?v=${encodeURIComponent(assetRevision)}`;
  }

  function replaceHomeBrandMark() {
    const defaultMark = document.querySelector('[data-testid="home-icon"]');
    if (!defaultMark || defaultMark.parentElement?.querySelector(".aigeek-home-mark")) return;
    defaultMark.setAttribute("data-aigeek-home-default-mark", "");

    const mark = document.createElement("span");
    mark.className = "aigeek-home-mark";
    mark.setAttribute("aria-label", appName);
    mark.innerHTML = [
      `<img class="aigeek-home-mark-static" src="${brandAssetUrl(webviewIcon)}" alt="" />`,
      `<img class="aigeek-home-mark-shatter" src="${brandAssetUrl(webviewAnimation)}" alt="" />`,
    ].join("");
    defaultMark.after(mark);
  }

  function replaceOnboardingHeaderMark() {
    let mark = document.querySelector("[data-branding-onboarding-header-icon]");
    if (!mark) {
      mark = [...document.querySelectorAll("svg.block.size-full")].find((candidate) => {
        const parent = candidate.parentElement;
        if (!parent) return false;
        return parent.classList.contains("pointer-events-none")
          && parent.classList.contains("absolute")
          && parent.classList.contains("z-30");
      });
    }
    if (!mark) return;

    const source = brandAssetUrl(titlebarIcon);
    if (mark instanceof HTMLImageElement) {
      if (mark.getAttribute("src") !== source) mark.setAttribute("src", source);
      mark.setAttribute("data-branding-onboarding-header-icon", "");
      return;
    }

    const image = document.createElement("img");
    image.alt = "";
    image.className = `${mark.getAttribute("class") || "block size-full"} object-contain`;
    image.draggable = false;
    image.src = source;
    image.setAttribute("aria-hidden", "true");
    image.setAttribute("data-branding-onboarding-header-icon", "");
    mark.replaceWith(image);
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

  function hideLabeledSurface(element, kind) {
    const control = element.closest("button, a, [role='button'], [role='menuitem'], [role='link']");
    if (control) {
      control.setAttribute("data-aigeek-hide", kind);
      return;
    }

    let candidate = element;
    for (let depth = 0; depth < 8 && candidate.parentElement; depth += 1) {
      candidate = candidate.parentElement;
      const rect = candidate.getBoundingClientRect();
      const text = candidate.textContent?.trim() ?? "";
      if (rect.width >= 360 && rect.height >= 24 && rect.height <= 180 && text.length <= 500) {
        candidate.setAttribute("data-aigeek-hide", kind);
        return;
      }
    }
  }

  function hideConfiguredSurfaces(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const label = node.nodeValue.trim();
      const element = node.parentElement;
      if (!element) continue;

      if (ui.hideWindowsSandboxBanner && ui.hiddenWindowsSandboxLabels.has(label)) {
        hideLabeledSurface(element, "windows-sandbox");
        continue;
      }
      if (ui.hideApiKeyAuthMenuItem && ui.hiddenApiKeyAuthLabels.has(label)) {
        hideLabeledSurface(element, "api-key-auth");
        continue;
      }
      if (ui.hideLogoutMenuItem && ui.hiddenLogoutLabels.has(label)) {
        hideLabeledSurface(element, "logout");
        continue;
      }
      if (ui.hideModelReasoningEffort && ui.hiddenModelReasoningEffortLabels.has(label)) {
        hideLabeledSurface(element, "model-reasoning-effort");
      }
    }
  }

  function brandModelPickerLabel(root) {
    if (!ui.modelPickerLabel) return;
    for (const row of root.querySelectorAll("[data-model-picker-model-row]")) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (ui.modelPickerModelLabels.has(node.nodeValue.trim())) {
          node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), ui.modelPickerLabel);
        }
      }
    }
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

  function isBottomSidebarSurface(element) {
    const rect = element?.getBoundingClientRect?.();
    return rect != null
      && rect.width > 0
      && rect.height > 0
      && rect.left < 320
      && rect.top > window.innerHeight - 220;
  }

  function hideBottomSidebarSurfaces(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const label = node.nodeValue.trim();
      const element = node.parentElement;
      if (!element || !isBottomSidebarSurface(element)) continue;

      if (ui.hideSidebarPetMenuItem && ui.hiddenSidebarPetLabels.has(label)) {
        hideLabeledSurface(element, "sidebar-pet");
      } else if (ui.hideSidebarSettingsMenuItem && ui.hiddenSidebarSettingsLabels.has(label)) {
        hideLabeledSurface(element, "sidebar-settings");
      }
    }

    if (!ui.hideSidebarHelpButton) return;
    for (const element of root.querySelectorAll("[aria-label], [title]")) {
      if (!isBottomSidebarSurface(element)) continue;
      const labels = [element.getAttribute("aria-label"), element.getAttribute("title")];
      if (labels.some((label) => ui.hiddenSidebarHelpButtonLabels.has(label))) {
        hideUnwantedItem(element, "sidebar-help");
      }
    }
  }

  function refresh() {
    scheduled = false;
    document.title = appName;
    replaceVisibleBranding(document.body);
    replaceOnboardingHeaderMark();
    replaceHomeBrandMark();
    hideUnwantedSurfaces(document.body);
    hideConfiguredSurfaces(document.body);
    hideBottomSidebarSurfaces(document.body);
    brandModelPickerLabel(document.body);
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
