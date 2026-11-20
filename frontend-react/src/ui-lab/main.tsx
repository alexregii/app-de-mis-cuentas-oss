import React from "react";
import {createRoot} from "react-dom/client";
import "../ui/ui-system.css";
import "./lab.css";
import "./transaction-actions-tournament.css";
import {UiLabApp} from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <UiLabApp />
  </React.StrictMode>,
);
