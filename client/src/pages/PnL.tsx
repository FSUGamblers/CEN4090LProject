import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { DateRange } from "react-day-picker";
import { TrendingUp, TrendingDown, DollarSign, Download, Calendar, Filter } from "lucide-react";
import Layout from "@/components/Layout";


export default function PnL() {
  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">PnL & Costs</h1>
        <p className="text-sm text-muted-foreground">
          No PnL data yet. This page will display realized and unrealized PnL once bet and cost tracking are implemented.
        </p>
      </div>
    </Layout>
  );
}
