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

  // src/webview/components/Select.tsx
  function Select({
    value,
    onChange,
    options,
    disabled,
    title,
    className,
    ariaLabel
  }) {
    return /* @__PURE__ */ React.createElement(
      "select",
      {
        className: `dlg-select ${className || ""}`.trim(),
        value,
        disabled,
        title,
        "aria-label": ariaLabel,
        onChange: (e) => onChange(e.target.value)
      },
      options.map((opt) => /* @__PURE__ */ React.createElement("option", { key: opt.value, value: opt.value }, opt.label))
    );
  }
})();
