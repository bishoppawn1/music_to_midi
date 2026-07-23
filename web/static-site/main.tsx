import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Home from "../app/page";
import "../app/globals.css";

const root = document.querySelector("#root");

if (!root) throw new Error("The application root is missing.");

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
