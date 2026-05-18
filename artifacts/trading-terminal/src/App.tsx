import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, Component } from "react";
import type { ReactNode } from "react";
import Terminal from "@/pages/Terminal";
import NotFound from "@/pages/not-found";
import { setBaseUrl } from "@workspace/api-client-react";

// Point the generated API client at the Railway backend in production.
// VITE_API_URL = "https://your-app.railway.app" — set in Vercel env vars.
// In development, empty string → relative paths → Vite proxy → localhost:3001.
const _prodApiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const API_BASE = _prodApiUrl.replace(/\/+$/, '') || '';
setBaseUrl(API_BASE || null);

// Expose the API base URL globally so components using raw fetch() can prefix it.
(window as any).__QUOTX_API_BASE__ = API_BASE;

// ── Error boundary: catch render errors and show them instead of a blank screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#050d07', color: '#ff5252',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', fontFamily: 'monospace', padding: '2rem',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#00ff85' }}>⚡ QUOTX — Runtime Error</div>
          <div style={{ color: '#ff5252', marginBottom: '0.5rem', fontWeight: 'bold' }}>{this.state.error.name}: {this.state.error.message}</div>
          <pre style={{ color: 'rgba(200,240,210,0.6)', fontSize: '0.75rem', maxWidth: '80vw', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '2rem', padding: '0.5rem 1.5rem', background: '#00ff85', color: '#050d07', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold' }}
          >
            Reload Terminal
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
