import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Arbitrage from "@/pages/Arbitrage";
import HedgeCenter from "@/pages/HedgeCenter";
import Analytics from "@/pages/Analytics";
import Lines from "@/pages/Lines";
import PnL from "@/pages/PnL";
import Jobs from "@/pages/Jobs";
import Layout from "@/components/Layout";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <Layout>
          <Route path="/" component={Dashboard} />
          <Route path="/arbitrage" component={Arbitrage} />
          <Route path="/hedge" component={HedgeCenter} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/lines" component={Lines} />
          <Route path="/pnl" component={PnL} />
          <Route path="/jobs" component={Jobs} />
        </Layout>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
