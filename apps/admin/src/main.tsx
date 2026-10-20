import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../web/src/App.js";
import "../../web/src/style.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App surface="admin" />
  </StrictMode>,
);
