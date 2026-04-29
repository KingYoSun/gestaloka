import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "./theme";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
