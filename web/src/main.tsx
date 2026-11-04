import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./index.css"
import AppV1 from "@/v1/App"
import AppV2 from "@/v2/App"

// v2 is the default; ?v=1 shows the original design (also tagged design-v1 in git)
const App = new URLSearchParams(location.search).get("v") === "1" ? AppV1 : AppV2

// apply the saved theme before first paint
try { const t = localStorage.getItem("so-theme"); const dark = t ? JSON.parse(t) === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.classList.toggle("dark", dark) } catch { /* ignore */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={100}>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
