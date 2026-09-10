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

  // src/webview/vscode.ts
  var vscode = acquireVsCodeApi();

  // src/webview/useVscodeRpc.ts
  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function useVscodeRpc() {
    const pendingRef = useRef(/* @__PURE__ */ new Map());
    const pushHandlersRef = useRef(/* @__PURE__ */ new Map());
    useEffect(() => {
      const handler = (event) => {
        const msg = event.data || {};
        if (!msg.requestId) {
          return;
        }
        const pending = pendingRef.current.get(msg.requestId);
        if (pending) {
          pendingRef.current.delete(msg.requestId);
          if (msg.type === "requestError") {
            pending.reject(msg.error || "\u672A\u77E5\u9519\u8BEF");
          } else {
            pending.resolve(msg.payload);
          }
          return;
        }
        const handlers = pushHandlersRef.current.get(msg.type || "");
        if (handlers) {
          for (const h of handlers) {
            try {
              h(msg.payload, msg.requestId);
            } catch {
            }
          }
        }
      };
      window.addEventListener("message", handler);
      return () => window.removeEventListener("message", handler);
    }, []);
    function request(type, payload = {}) {
      const requestId = uid(type);
      return new Promise((resolve, reject) => {
        pendingRef.current.set(requestId, { resolve: (p) => resolve(p), reject });
        vscode.postMessage({ type, requestId, ...payload });
      });
    }
    function post(type, payload = {}) {
      const requestId = uid(type);
      vscode.postMessage({ type, requestId, ...payload });
      return requestId;
    }
    function onPush(type, handler) {
      let set = pushHandlersRef.current.get(type);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        pushHandlersRef.current.set(type, set);
      }
      set.add(handler);
      return () => {
        const cur = pushHandlersRef.current.get(type);
        if (cur) {
          cur.delete(handler);
        }
      };
    }
    return { request, post, onPush };
  }

  // src/webview/components/PathInput.tsx
  function PathInput({
    value,
    onChange,
    isDirectory = true,
    placeholder,
    rootPath
  }) {
    const rpc = useVscodeRpc();
    const pendingRequestIdRef = useRef(null);
    useEffect(() => {
      const off = rpc.onPush("dialogResult", (payload, requestId) => {
        if (requestId !== pendingRequestIdRef.current) {
          return;
        }
        pendingRequestIdRef.current = null;
        if (!payload?.fsPath) {
          return;
        }
        if (rootPath && payload.fsPath.startsWith(rootPath)) {
          onChange("." + payload.fsPath.slice(rootPath.length));
        } else {
          onChange(payload.fsPath);
        }
      });
      return off;
    }, [rootPath]);
    function handleBrowse() {
      pendingRequestIdRef.current = rpc.post(isDirectory ? "openDirectoryDialog" : "openFileDialog");
    }
    return /* @__PURE__ */ React.createElement("div", { className: "dlg-path-input" }, /* @__PURE__ */ React.createElement(TextField, { value, onChange, placeholder }), /* @__PURE__ */ React.createElement(Button, { variant: "ghost", onClick: handleBrowse }, "\u6D4F\u89C8"));
  }
})();
