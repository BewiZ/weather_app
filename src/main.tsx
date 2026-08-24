import React, { Component, ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string; errors: { message: string; stack: string; time: string }[] }
> {
  state = {
    hasError: false,
    error: "",
    errors: (window as any).__debugErrors || [],
  };

  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Component stack:", info.componentStack);

    const entry = {
      message: error.message,
      stack: info.componentStack || '',
      time: new Date().toLocaleTimeString('zh-CN'),
    };
    const prev = (window as any).__debugErrors || this.state.errors || [];
    const updated = [...prev, entry];
    (window as any).__debugErrors = updated;

    try {
      localStorage.setItem('__debugErrors', JSON.stringify(updated));
    } catch (_) { /* ignore */ }

    this.setState((prev) => ({
      ...prev,
      hasError: true,
      error: error.message,
      errors: updated,
    }));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            backgroundColor: "#0f172a",
            color: "#f8fafc",
            padding: "1.5rem 1rem",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            fontFamily: "sans-serif",
            fontSize: "0.8rem",
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: "#ef4444", fontWeight: 700, fontSize: "1rem", marginBottom: "0.75rem" }}>
            ⚠ 应用出错
          </div>
          <div
            style={{
              background: "#1e293b",
              padding: "0.6rem",
              borderRadius: "0.5rem",
              fontFamily: "monospace",
              fontSize: "0.65rem",
              color: "#fca5a5",
              whiteSpace: "pre-wrap",
              textAlign: "left",
              wordBreak: "break-all",
              maxWidth: "100%",
              maxHeight: "25vh",
              overflow: "auto",
            }}
          >
            {this.state.error}
          </div>
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: "" });
                window.location.reload();
              }}
              style={{
                padding: "0.4rem 1rem",
                backgroundColor: "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: "0.4rem",
                cursor: "pointer",
                fontSize: "0.75rem",
              }}
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </ErrorBoundary>,
);
