import React from "react";
import ReactDOM from "react-dom/client";
import Dashboard from "./Dashboard";
import { LanguageProvider } from "./i18n";
import "./styles.css";
import "./dark.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider><Dashboard /></LanguageProvider>
  </React.StrictMode>,
);
