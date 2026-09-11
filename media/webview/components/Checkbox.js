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

  // src/webview/components/Checkbox.tsx
  function Checkbox({ checked, onChange, label, disabled, className }) {
    const element = /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "dlg-checkbox",
        type: "checkbox",
        checked,
        disabled,
        onChange: (e) => onChange(e.target.checked)
      }
    );
    if (!label) {
      return element;
    }
    return /* @__PURE__ */ React.createElement("label", { className: `dlg-checkbox-row ${className || ""}`.trim() }, element, /* @__PURE__ */ React.createElement("span", null, label));
  }
})();
