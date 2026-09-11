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
    useCallback,
    useEffect,
    useRef,
    useState
  } = shared.React;
  var createRoot = shared.ReactDOMClient.createRoot;

  // src/webview/components/TextField.tsx
  function TextField({
    value,
    onChange,
    type = "text",
    placeholder,
    min,
    step,
    disabled,
    title,
    className,
    ariaLabel
  }) {
    return /* @__PURE__ */ React.createElement(
      "input",
      {
        className: `dlg-textfield ${className || ""}`.trim(),
        type,
        value,
        placeholder,
        disabled,
        title,
        "aria-label": ariaLabel,
        min,
        step,
        onChange: (e) => onChange(e.target.value)
      }
    );
  }
})();
