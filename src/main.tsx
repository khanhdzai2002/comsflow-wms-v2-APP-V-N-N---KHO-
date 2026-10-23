import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "@/components/workspace";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workspace />
  </StrictMode>,
);
