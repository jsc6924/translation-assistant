"use strict";
(() => {
  // src/webview/react-shared-runtime.ts
  var shared = globalThis.DLTXTReactShared;
  if (!shared || !shared.React || !shared.ReactDOMClient) {
    throw new Error("Shared React vendor is not loaded.");
  }
  var React = shared.React;
  var {
    Fragment,
    useEffect,
    useRef,
    useState
  } = shared.React;
  var createRoot = shared.ReactDOMClient.createRoot;

  // src/webview/components/Button.tsx
  function Button({
    onClick,
    disabled,
    variant = "primary",
    size = "normal",
    title,
    type = "button",
    className,
    children
  }) {
    const classes = ["dlg-btn", `dlg-btn--${variant}`];
    if (size === "icon") {
      classes.push("dlg-btn--icon");
    }
    if (size === "icon-sm") {
      classes.push("dlg-btn--icon-sm");
    }
    if (className) {
      classes.push(className);
    }
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        type,
        className: classes.join(" "),
        onClick,
        disabled,
        title
      },
      children
    );
  }
})();
