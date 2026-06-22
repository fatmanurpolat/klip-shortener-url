import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { AuthProvider } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/Toast";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/app.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
);
