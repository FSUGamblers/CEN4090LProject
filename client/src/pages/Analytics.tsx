import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, BarChart3, PieChart as PieChartIcon, Clock, Target, DollarSign } from "lucide-react";
import Layout from "@/components/Layout";


const COLORS = ['hsl(217, 91%, 60%)', 'hsl(159, 100%, 36%)', 'hsl(42, 92%, 56%)', 'hsl(147, 78%, 42%)', 'hsl(341, 75%, 51%)'];


export default function Analytics() {
  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          No analytics data yet. This page will show profitability and performance metrics once those pipelines are implemented.
        </p>
      </div>
    </Layout>
  );
}
