import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import Terminal from "@/pages/Terminal";
import NotFound from "@/pages/not-found";
import { setBaseUrl } from "@workspace/api-client-react";

// Point the generated API client at the Railway backend in production.
// VITE_API_URL = "https://your-app.railway.app" — set in Vercel env vars.
// In development, empty string → relative paths → Vite proxy → localhost:3001.
const _prodApiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
setBaseUrl(_prodApiUrl.replace(/\/+$/, '') || null);

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Terminal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
