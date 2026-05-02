import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { AnalyticsSkeleton } from "@/components/PageSkeleton";
import { Redirect } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, isToday, startOfMonth, startOfDay, isSameDay, isSameMonth } from "date-fns";
import { 
  Users, 
  Target, 
  TrendingUp, 
  CheckCircle2, 
  Clock, 
  XCircle,
  BarChart3,
  Calendar as CalendarIcon,
  Megaphone,
  Layers,
  Palette,
  Download,
  Headphones,
  Package,
  DollarSign,
  FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface OrderService {
  id: number;
  orderId: number;
  serviceType: string;
  quantity: number;
  instructions?: string;
  status: string;
}

interface OrderWithServices {
  id: number;
  orderNumber: string;
  clientName: string;
  status: string;
  assignedToId?: number;
  readyDate?: string;
  paymentStatus?: string;
  totalPrice?: number;
  advanceAmount?: number;
  remainingAmount?: number;
  campaign?: string;
  adSet?: string;
  creative?: string;
  createdAt?: string;
  createdById?: number;
  services: OrderService[];
  assignee?: {
    id: number;
    name: string;
  };
}

interface User {
  id: number;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  color = "blue",
  testId
}: { 
  title: string; 
  value: string | number; 
  icon: any; 
  color?: "blue" | "green" | "purple" | "orange" | "red";
  testId?: string;
}) {
  const colors = {
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-green-500/10 text-green-500",
    purple: "bg-purple-500/10 text-purple-500",
    orange: "bg-orange-500/10 text-orange-500",
    red: "bg-red-500/10 text-red-500",
  };

  return (
    <div className="glass-panel p-6 rounded-2xl border border-slate-800" data-testid={testId}>
      <div className="flex justify-between items-start mb-4">
        <div className={cn("p-3 rounded-xl", colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      <p className="text-sm text-slate-400">{title}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth().toString());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [marketingMonth, setMarketingMonth] = useState(new Date().getMonth().toString());
  const [marketingYear, setMarketingYear] = useState(new Date().getFullYear().toString());
  const [performanceMonth, setPerformanceMonth] = useState(new Date().getMonth().toString());
  const [performanceYear, setPerformanceYear] = useState(new Date().getFullYear().toString());
  const [supportMonth, setSupportMonthRaw] = useState(new Date().getMonth().toString());
  const [supportYear, setSupportYearRaw] = useState(new Date().getFullYear().toString());
  const [supportDay, setSupportDay] = useState(new Date().getDate().toString());

  const setSupportMonth = (val: string) => {
    setSupportMonthRaw(val);
    const maxDay = new Date(parseInt(supportYear), parseInt(val) + 1, 0).getDate();
    if (parseInt(supportDay) > maxDay) setSupportDay(maxDay.toString());
  };
  const setSupportYear = (val: string) => {
    setSupportYearRaw(val);
    const maxDay = new Date(parseInt(val), parseInt(supportMonth) + 1, 0).getDate();
    if (parseInt(supportDay) > maxDay) setSupportDay(maxDay.toString());
  };
  
  const { data: orders, isLoading } = useQuery<OrderWithServices[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });
  
  const { data: teamMembers } = useQuery<User[]>({
    queryKey: ["/api/users"],
    staleTime: 5 * 60 * 1000,
  });

  // Only admin can access analytics
  if (user?.role !== "admin") {
    return <Redirect to="/" />;
  }

  if (isLoading) return <AnalyticsSkeleton />;

  const designers = teamMembers?.filter(u =>
    u.role === "designer" ||
    (u.isActive && orders?.some(o => o.assignedToId === u.id))
  ) || [];
  const now = new Date();
  const monthStart = startOfMonth(now);
  
  // Filter orders by selected month for monthly reports
  const selectedMonthOrders = orders?.filter(o => {
    const createdDate = new Date(o.createdAt!);
    return createdDate.getMonth().toString() === selectedMonth;
  }) || [];

  // Designer Performance Calculations
  // Only approved orders count toward performance — status must reach ready/delivered
  const getDesignerMetrics = (designerId: number) => {
    const assignedOrders = orders?.filter(
      o => o.assignedToId === designerId && o.advancePaymentStatus === 'approved'
    ) || [];
    
    // Completed today = status is ready/delivered AND readyDate (or createdAt fallback) is today
    const completedToday = assignedOrders.filter(o => {
      if (o.status !== 'ready' && o.status !== 'delivered') return false;
      const d = o.readyDate ? new Date(o.readyDate) : new Date(o.createdAt!);
      return isToday(d);
    }).length;
    
    // Completed this month = status is ready/delivered AND readyDate (or createdAt fallback) is in current month
    const completedThisMonth = assignedOrders.filter(o => {
      if (o.status !== 'ready' && o.status !== 'delivered') return false;
      const d = o.readyDate ? new Date(o.readyDate) : new Date(o.createdAt!);
      return d >= monthStart;
    }).length;
    
    // Total completed = orders currently in ready or delivered status
    const totalCompleted = assignedOrders.filter(
      o => o.status === 'ready' || o.status === 'delivered'
    ).length;
    
    // Pending = new or working status
    const pendingOrders = assignedOrders.filter(
      o => o.status === 'new' || o.status === 'working'
    ).length;
    
    // Canceled
    const canceledOrders = assignedOrders.filter(o => o.status === 'canceled').length;
    
    // Average daily completion rate (days elapsed this month so far)
    const daysElapsed = now.getDate();
    const avgDailyRate = daysElapsed > 0 ? (completedThisMonth / daysElapsed).toFixed(1) : "0";
    
    return {
      completedToday,
      completedThisMonth,
      totalCompleted,
      pendingOrders,
      canceledOrders,
      avgDailyRate,
      totalAssigned: assignedOrders.length,
    };
  };

  // Filter orders by selected month/year for marketing analytics
  const marketingOrders = orders?.filter(o => {
    const createdDate = new Date(o.createdAt!);
    return createdDate.getMonth().toString() === marketingMonth && 
           createdDate.getFullYear().toString() === marketingYear;
  }) || [];

  // Filter orders by selected month/year for performance analytics (approved only)
  // Use readyDate if available, fall back to createdAt for historical/imported orders
  const performanceOrders = orders?.filter(o => {
    if (o.advancePaymentStatus !== 'approved') return false;
    if (o.status !== 'ready' && o.status !== 'delivered') return false;
    const perfDate = o.readyDate ? new Date(o.readyDate) : new Date(o.createdAt!);
    return perfDate.getMonth().toString() === performanceMonth && 
           perfDate.getFullYear().toString() === performanceYear;
  }) || [];

  // Platform Analytics Calculations
  const getPlatformMetrics = () => {
    const platforms = new Map<string, {
      total: number;
      campaigns: Map<string, {
        total: number;
        adSets: Map<string, {
          total: number;
          creatives: Map<string, { total: number }>;
        }>;
      }>;
    }>();

    marketingOrders.forEach(order => {
      const platformName = (order as any).platform || "Unknown";
      if (!platforms.has(platformName)) {
        platforms.set(platformName, { total: 0, campaigns: new Map() });
      }
      const plat = platforms.get(platformName)!;
      plat.total++;

      if (order.campaign) {
        const campaignName = order.campaign;
        const adSetName = order.adSet || "No Ad Set";
        const creativeName = order.creative || "No Creative";

        if (!plat.campaigns.has(campaignName)) {
          plat.campaigns.set(campaignName, { total: 0, adSets: new Map() });
        }
        const campaign = plat.campaigns.get(campaignName)!;
        campaign.total++;

        if (!campaign.adSets.has(adSetName)) {
          campaign.adSets.set(adSetName, { total: 0, creatives: new Map() });
        }
        const adSet = campaign.adSets.get(adSetName)!;
        adSet.total++;

        if (!adSet.creatives.has(creativeName)) {
          adSet.creatives.set(creativeName, { total: 0 });
        }
        adSet.creatives.get(creativeName)!.total++;
      }
    });

    return platforms;
  };

  // Marketing Analytics Calculations - simplified to show just order counts
  const getCampaignMetrics = () => {
    const campaigns = new Map<string, {
      total: number;
      adSets: Map<string, {
        total: number;
        creatives: Map<string, { total: number }>;
      }>;
    }>();
    
    marketingOrders.forEach(order => {
      const campaignName = order.campaign || "Uncategorized";
      const adSetName = order.adSet || "No Ad Set";
      const creativeName = order.creative || "No Creative";
      
      if (!campaigns.has(campaignName)) {
        campaigns.set(campaignName, { total: 0, adSets: new Map() });
      }
      
      const campaign = campaigns.get(campaignName)!;
      campaign.total++;
      
      if (!campaign.adSets.has(adSetName)) {
        campaign.adSets.set(adSetName, { total: 0, creatives: new Map() });
      }
      
      const adSet = campaign.adSets.get(adSetName)!;
      adSet.total++;
      
      if (!adSet.creatives.has(creativeName)) {
        adSet.creatives.set(creativeName, { total: 0 });
      }
      
      const creative = adSet.creatives.get(creativeName)!;
      creative.total++;
    });
    
    return campaigns;
  };

  const platformMetrics = getPlatformMetrics();
  const campaignMetrics = getCampaignMetrics();

  // Get designer metrics for specific month/year
  const getDesignerMetricsMonthly = (designerId: number) => {
    const completedOrders = performanceOrders.filter(o => o.assignedToId === designerId);
    return {
      completedThisMonth: completedOrders.length,
    };
  };
  
  // Top summary stats — approved orders only, readyDate tracks when order was completed
  const totalCompletedToday = orders?.filter(
    o => o.advancePaymentStatus === 'approved' && o.readyDate && isToday(new Date(o.readyDate))
  ).length || 0;
  const totalCompletedThisMonth = orders?.filter(
    o => o.advancePaymentStatus === 'approved' && o.readyDate && new Date(o.readyDate) >= monthStart
  ).length || 0;
  
  // Best performing designer
  const designerPerformance = designers.map(d => ({
    ...d,
    metrics: getDesignerMetrics(d.id)
  })).sort((a, b) => b.metrics.completedThisMonth - a.metrics.completedThisMonth);
  
  const bestDesigner = designerPerformance[0];
  
  // Best performing campaign
  const campaignArray = Array.from(campaignMetrics.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.total - a.total);
  const bestCampaign = campaignArray[0];

  // Platform array sorted by order count
  const platformArray = Array.from(platformMetrics.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.total - a.total);
  const bestPlatform = platformArray[0];

  const supportAgents = teamMembers?.filter(u => u.role === "support") || [];
  
  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const supportDaysInMonth = getDaysInMonth(parseInt(supportMonth), parseInt(supportYear));

  const getSupportOrders = (filterType: 'day' | 'month') => {
    return orders?.filter(o => {
      if (!o.createdAt) return false;
      if (o.advancePaymentStatus !== 'approved') return false;
      const createdDate = new Date(o.createdAt);
      if (filterType === 'day') {
        return createdDate.getMonth().toString() === supportMonth &&
               createdDate.getFullYear().toString() === supportYear &&
               createdDate.getDate().toString() === supportDay;
      }
      return createdDate.getMonth().toString() === supportMonth &&
             createdDate.getFullYear().toString() === supportYear;
    }) || [];
  };

  const supportMonthOrders = getSupportOrders('month');
  const supportDayOrders = getSupportOrders('day');

  const getSupportAgentMetrics = (agentId: number) => {
    const agentMonthOrders = supportMonthOrders.filter(o => o.createdById === agentId);
    const agentDayOrders = supportDayOrders.filter(o => o.createdById === agentId);

    // All-time approved orders placed by this agent
    const totalOrders = (orders || []).filter(
      o => o.createdById === agentId && o.advancePaymentStatus === 'approved'
    ).length;

    const totalRevenue = agentMonthOrders.reduce((sum, o) => sum + (o.advanceAmount || 0) + (o.remainingAmount || 0), 0);
    const collectedAmount = agentMonthOrders.reduce((sum, o) => sum + (o.advanceAmount || 0), 0);
    const pendingAmount = agentMonthOrders.reduce((sum, o) => sum + (o.remainingAmount || 0), 0);

    return {
      totalMonthOrders: agentMonthOrders.length,
      totalDayOrders: agentDayOrders.length,
      totalOrders,
      totalRevenue,
      collectedAmount,
      pendingAmount,
    };
  };

  const exportSupportPDF = () => {
    const doc = new jsPDF();
    const monthName = format(new Date(parseInt(supportYear), parseInt(supportMonth), 1), "MMMM yyyy");
    const dayLabel = format(new Date(parseInt(supportYear), parseInt(supportMonth), parseInt(supportDay)), "MMM dd, yyyy");
    
    doc.setFontSize(18);
    doc.text(`Support Agent Performance - ${monthName}`, 14, 22);
    doc.setFontSize(11);
    doc.text(`Day: ${dayLabel} | Generated: ${format(new Date(), "MMM dd, yyyy h:mm a")}`, 14, 32);
    
    const tableData = supportAgents.map(agent => {
      const metrics = getSupportAgentMetrics(agent.id);
      return [
        agent.username,
        metrics.totalOrders,
        metrics.totalMonthOrders,
        metrics.totalDayOrders,
        `Rs ${Math.round(metrics.totalRevenue / 100).toLocaleString()}`,
        `Rs ${Math.round(metrics.collectedAmount / 100).toLocaleString()}`,
        `Rs ${Math.round(metrics.pendingAmount / 100).toLocaleString()}`,
      ];
    });

    autoTable(doc, {
      startY: 40,
      head: [["Agent", "Total Orders", "Month Orders", "Day Orders", "Total Revenue", "Collected", "Pending"]],
      body: tableData,
      headStyles: { fillColor: [37, 99, 235] }
    });

    doc.save(`support-performance-${monthName.replace(" ", "-")}.pdf`);
  };

  const exportDesignerPDF = () => {
    const doc = new jsPDF();
    const monthName = format(new Date(parseInt(performanceYear), parseInt(performanceMonth), 1), "MMMM yyyy");
    
    doc.setFontSize(18);
    doc.text(`Designer Performance Report - ${monthName}`, 14, 22);
    doc.setFontSize(11);
    doc.text(`Generated: ${format(new Date(), "MMM dd, yyyy h:mm a")}`, 14, 32);
    
    const tableData = designers.map(d => {
      const metrics = getDesignerMetricsMonthly(d.id);
      return [d.name, metrics.completedThisMonth];
    });

    autoTable(doc, {
      startY: 40,
      head: [["Designer", "Completions"]],
      body: tableData,
      headStyles: { fillColor: [37, 99, 235] }
    });

    doc.save(`designer-performance-${monthName.replace(" ", "-")}.pdf`);
  };

  const exportMarketingPDF = () => {
    const doc = new jsPDF();
    const monthName = format(new Date(parseInt(marketingYear), parseInt(marketingMonth), 1), "MMMM yyyy");
    
    doc.setFontSize(18);
    doc.text(`Marketing Analytics Report - ${monthName}`, 14, 22);
    doc.setFontSize(11);
    doc.text(`Generated: ${format(new Date(), "MMM dd, yyyy h:mm a")}`, 14, 32);
    
    const platformTableData: (string | number)[][] = platformArray.map(p => [p.name, p.total]);

    autoTable(doc, {
      startY: 40,
      head: [["Platform", "Orders"]],
      body: platformTableData,
      headStyles: { fillColor: [37, 99, 235] },
    });

    const campaignTableData: (string | number)[][] = [];
    platformMetrics.forEach((plat, platName) => {
      if (plat.campaigns.size > 0) {
        plat.campaigns.forEach((campaign, campaignName) => {
          campaignTableData.push([platName, campaignName, "", "", campaign.total]);
          campaign.adSets.forEach((adSet, adSetName) => {
            campaignTableData.push(["", "", adSetName, "", adSet.total]);
            adSet.creatives.forEach((creative, creativeName) => {
              campaignTableData.push(["", "", "", creativeName, creative.total]);
            });
          });
        });
      }
    });

    if (campaignTableData.length > 0) {
      const currentY = (doc as any).lastAutoTable?.finalY || 80;
      doc.setFontSize(14);
      doc.text("Campaign Tracking", 14, currentY + 14);
      autoTable(doc, {
        startY: currentY + 20,
        head: [["Platform", "Campaign", "Ad Set", "Creative", "Orders"]],
        body: campaignTableData,
        headStyles: { fillColor: [124, 58, 237] },
      });
    }

    doc.save(`marketing-analytics-${monthName.replace(" ", "-")}.pdf`);
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-display text-white mb-2" data-testid="text-analytics-title">Analytics Dashboard</h1>
        <p className="text-slate-400">Track designer performance and marketing effectiveness.</p>
      </div>

      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Completed Today" 
          value={totalCompletedToday} 
          icon={CheckCircle2} 
          color="green"
          testId="stat-completed-today"
        />
        <StatCard 
          title="Completed This Month" 
          value={totalCompletedThisMonth} 
          icon={TrendingUp}
          color="blue"
          testId="stat-completed-month"
        />
        <StatCard 
          title="Best Designer" 
          value={bestDesigner?.name || "N/A"} 
          icon={Users}
          color="purple"
          testId="stat-best-designer"
        />
        <StatCard 
          title="Best Platform" 
          value={bestPlatform?.name || "N/A"} 
          icon={Megaphone}
          color="orange"
          testId="stat-best-campaign"
        />
      </div>

      <Tabs defaultValue="designers" className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800 p-1 mb-6">
          <TabsTrigger value="designers" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white" data-testid="tab-designer-analytics">
            Designer Performance
          </TabsTrigger>
          <TabsTrigger value="marketing" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white" data-testid="tab-marketing-analytics">
            Marketing Analytics
          </TabsTrigger>
          <TabsTrigger value="support" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white" data-testid="tab-support-analytics">
            Support Performance
          </TabsTrigger>
        </TabsList>

        {/* Designer Performance Tab */}
        <TabsContent value="designers">
          <div className="space-y-6">
            {/* Monthly Performance Filter */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-slate-400" />
                <Select value={performanceMonth} onValueChange={setPerformanceMonth}>
                  <SelectTrigger className="w-32 bg-slate-900 border-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month, idx) => (
                      <SelectItem key={idx} value={idx.toString()} className="text-slate-300">{month}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={performanceYear} onValueChange={setPerformanceYear}>
                  <SelectTrigger className="w-24 bg-slate-900 border-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    {[2024, 2025, 2026, 2027].map((year) => (
                      <SelectItem key={year} value={year.toString()} className="text-slate-300">{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-slate-500">{performanceOrders.length} completed orders</p>
              </div>
              <Button variant="outline" onClick={exportDesignerPDF} data-testid="button-export-designer-pdf">
                <Download className="w-4 h-4 mr-2" />
                Export PDF
              </Button>
            </div>

            {/* Monthly Performance */}
            <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  Monthly Designer Performance
                </h3>
                <p className="text-sm text-slate-500">Approved orders completed (Ready/Delivered) in selected month</p>
              </div>
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow className="border-slate-800">
                    <TableHead className="text-slate-400">Designer</TableHead>
                    <TableHead className="text-slate-400 text-center">Completed Orders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {designers.map((designer) => {
                    const monthlyMetrics = getDesignerMetricsMonthly(designer.id);
                    return (
                      <TableRow key={designer.id} className="border-slate-800">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm text-slate-300">
                              {designer.name.charAt(0)}
                            </div>
                            <span className="text-white font-medium">{designer.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-2xl font-bold text-blue-400">{monthlyMetrics.completedThisMonth}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {designers.length === 0 && (
                    <TableRow className="border-slate-800">
                      <TableCell colSpan={2} className="text-center text-slate-500 py-8">
                        No designers found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Overall Performance */}
            <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  Overall Designer Performance
                </h3>
                <p className="text-sm text-slate-500">All-time performance — approved orders only. Status locks at Ready/Delivered and cannot be reversed.</p>
              </div>
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow className="border-slate-800">
                    <TableHead className="text-slate-400">Designer</TableHead>
                    <TableHead className="text-slate-400 text-center">Completed Today</TableHead>
                    <TableHead className="text-slate-400 text-center">Completed This Month</TableHead>
                    <TableHead className="text-slate-400 text-center">Total Completed</TableHead>
                    <TableHead className="text-slate-400 text-center">Pending</TableHead>
                    <TableHead className="text-slate-400 text-center">Canceled</TableHead>
                    <TableHead className="text-slate-400 text-center">Avg Daily Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {designerPerformance.map((designer) => (
                    <TableRow key={designer.id} className="border-slate-800" data-testid={`row-designer-${designer.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm text-slate-300">
                            {designer.name.charAt(0)}
                          </div>
                          <span className="text-white font-medium">{designer.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={cn(
                          "border-0",
                          designer.metrics.completedToday > 0 ? "text-green-500" : "text-slate-500"
                        )}>
                          {designer.metrics.completedToday}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-blue-400 font-medium">{designer.metrics.completedThisMonth}</span>
                      </TableCell>
                      <TableCell className="text-center text-slate-300">{designer.metrics.totalCompleted}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={cn(
                          "border-0",
                          designer.metrics.pendingOrders > 0 ? "text-yellow-500" : "text-slate-500"
                        )}>
                          {designer.metrics.pendingOrders}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={cn(
                          "border-0",
                          designer.metrics.canceledOrders > 0 ? "text-red-500" : "text-slate-500"
                        )}>
                          {designer.metrics.canceledOrders}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-purple-400">{designer.metrics.avgDailyRate}/day</TableCell>
                    </TableRow>
                  ))}
                  {designers.length === 0 && (
                    <TableRow className="border-slate-800">
                      <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                        No designers found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* Marketing Analytics Tab */}
        <TabsContent value="marketing">
          <div className="space-y-6">
            {/* Month/Year Filter */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-slate-400" />
                <Select value={marketingMonth} onValueChange={setMarketingMonth}>
                  <SelectTrigger className="w-32 bg-slate-900 border-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month, idx) => (
                      <SelectItem key={idx} value={idx.toString()} className="text-slate-300">{month}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={marketingYear} onValueChange={setMarketingYear}>
                  <SelectTrigger className="w-24 bg-slate-900 border-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    {[2024, 2025, 2026, 2027].map((year) => (
                      <SelectItem key={year} value={year.toString()} className="text-slate-300">{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-slate-500">{marketingOrders.length} orders</p>
              </div>
              <Button variant="outline" onClick={exportMarketingPDF} data-testid="button-export-marketing-pdf">
                <Download className="w-4 h-4 mr-2" />
                Export PDF
              </Button>
            </div>

            {/* Platform Breakdown */}
            <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-orange-500" />
                  Platform Breakdown
                </h3>
                <p className="text-sm text-slate-500">Where clients are coming from this month</p>
              </div>

              {platformArray.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No platform data yet. Orders will show here once clients are tagged with a platform.
                </div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {platformArray.map((plat) => (
                    <div key={plat.name} className="p-4" data-testid={`platform-${plat.name}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-orange-500/10 rounded-lg">
                            <Megaphone className="w-4 h-4 text-orange-500" />
                          </div>
                          <div>
                            <p className="text-white font-medium">{plat.name}</p>
                            <p className="text-xs text-slate-500">Platform</p>
                          </div>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-white">{plat.total}</p>
                          <p className="text-xs text-slate-500">Orders</p>
                        </div>
                      </div>

                      {/* Campaign Tracking (only for platforms with campaign data) */}
                      {plat.campaigns.size > 0 && (
                        <div className="ml-8 space-y-2">
                          {Array.from(plat.campaigns.entries()).map(([campaignName, campaign]) => (
                            <div key={campaignName} className="bg-slate-900/50 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Layers className="w-4 h-4 text-blue-500" />
                                  <span className="text-slate-300 font-medium">{campaignName}</span>
                                  <span className="text-xs text-slate-500">Campaign</span>
                                </div>
                                <Badge variant="secondary" className="text-white">{campaign.total} orders</Badge>
                              </div>
                              {/* Ad Sets */}
                              <div className="ml-6 mt-2 space-y-1">
                                {Array.from(campaign.adSets.entries()).map(([adSetName, adSet]) => (
                                  <div key={adSetName} className="mb-2">
                                    <div className="flex items-center justify-between text-sm py-1">
                                      <div className="flex items-center gap-2">
                                        <Layers className="w-3 h-3 text-indigo-400" />
                                        <span className="text-slate-400">{adSetName}</span>
                                        <span className="text-xs text-slate-600">Ad Set</span>
                                      </div>
                                      <span className="text-slate-300">{adSet.total}</span>
                                    </div>
                                    {/* Creatives */}
                                    <div className="ml-5 space-y-0.5">
                                      {Array.from(adSet.creatives.entries()).map(([creativeName, creative]) => (
                                        <div key={creativeName} className="flex items-center justify-between text-xs py-0.5">
                                          <div className="flex items-center gap-1.5">
                                            <Palette className="w-3 h-3 text-purple-400" />
                                            <span className="text-slate-500">{creativeName}</span>
                                          </div>
                                          <span className="text-slate-400">{creative.total}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Support Performance Tab */}
        <TabsContent value="support">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-slate-400" />
                <Select value={supportDay} onValueChange={setSupportDay}>
                  <SelectTrigger className="w-20 bg-slate-900 border-slate-800 text-white" data-testid="select-support-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 max-h-60">
                    {Array.from({ length: supportDaysInMonth }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={day.toString()} className="text-slate-300">{day}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={supportMonth} onValueChange={setSupportMonth}>
                  <SelectTrigger className="w-32 bg-slate-900 border-slate-800 text-white" data-testid="select-support-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month, idx) => (
                      <SelectItem key={idx} value={idx.toString()} className="text-slate-300">{month}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={supportYear} onValueChange={setSupportYear}>
                  <SelectTrigger className="w-24 bg-slate-900 border-slate-800 text-white" data-testid="select-support-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    {[2024, 2025, 2026, 2027].map((year) => (
                      <SelectItem key={year} value={year.toString()} className="text-slate-300">{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-slate-500">{supportMonthOrders.length} approved orders this month</p>
              </div>
              <Button variant="outline" onClick={exportSupportPDF} data-testid="button-export-support-pdf">
                <Download className="w-4 h-4 mr-2" />
                Export PDF
              </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-panel p-5 rounded-2xl border border-slate-800">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Package className="w-4 h-4 text-blue-500" />
                  </div>
                  <span className="text-sm text-slate-400">Monthly Orders</span>
                </div>
                <p className="text-2xl font-bold text-white" data-testid="text-support-month-total">{supportMonthOrders.length}</p>
                <p className="text-xs text-slate-500 mt-1">Approved orders this month</p>
              </div>
              <div className="glass-panel p-5 rounded-2xl border border-slate-800">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-green-500/10 rounded-lg">
                    <DollarSign className="w-4 h-4 text-green-500" />
                  </div>
                  <span className="text-sm text-slate-400">Monthly Revenue</span>
                </div>
                <p className="text-2xl font-bold text-white" data-testid="text-support-month-revenue">
                  ₨{Math.round(supportMonthOrders.reduce((s, o) => s + (o.advanceAmount || 0) + (o.remainingAmount || 0), 0) / 100).toLocaleString()}
                </p>
                <p className="text-xs text-slate-500 mt-1">Collected + remaining of approved</p>
              </div>
              <div className="glass-panel p-5 rounded-2xl border border-slate-800">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-orange-500/10 rounded-lg">
                    <FileText className="w-4 h-4 text-orange-500" />
                  </div>
                  <span className="text-sm text-slate-400">Today's Orders</span>
                </div>
                <p className="text-2xl font-bold text-white" data-testid="text-support-day-total">{supportDayOrders.length}</p>
                <p className="text-xs text-slate-500 mt-1">Approved orders on selected day</p>
              </div>
            </div>

            {/* Per-Agent Monthly Overview */}
            <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Headphones className="w-5 h-5 text-blue-500" />
                  Support Agent Monthly Summary
                </h3>
                <p className="text-sm text-slate-500">
                  Orders placed by each support agent in {format(new Date(parseInt(supportYear), parseInt(supportMonth), 1), "MMMM yyyy")}
                </p>
              </div>
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow className="border-slate-800">
                    <TableHead className="text-slate-400">Agent</TableHead>
                    <TableHead className="text-slate-400 text-center">Total Orders</TableHead>
                    <TableHead className="text-slate-400 text-center">Month Orders</TableHead>
                    <TableHead className="text-slate-400 text-center">Day Orders</TableHead>
                    <TableHead className="text-slate-400 text-center">Total Revenue</TableHead>
                    <TableHead className="text-slate-400 text-center">Collected</TableHead>
                    <TableHead className="text-slate-400 text-center">Pending</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supportAgents.map((agent) => {
                    const metrics = getSupportAgentMetrics(agent.id);
                    return (
                      <TableRow key={agent.id} className="border-slate-800" data-testid={`row-support-agent-${agent.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm text-slate-300">
                              {agent.username.charAt(0)}
                            </div>
                            <span className="text-white font-medium">{agent.username}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-xl font-bold text-purple-400">{metrics.totalOrders}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-xl font-bold text-blue-400">{metrics.totalMonthOrders}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-lg font-bold text-green-400">{metrics.totalDayOrders}</span>
                        </TableCell>
                        <TableCell className="text-center text-slate-300">
                          ₨{Math.round(metrics.totalRevenue / 100).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center text-green-400">
                          ₨{Math.round(metrics.collectedAmount / 100).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center text-yellow-400">
                          ₨{Math.round(metrics.pendingAmount / 100).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {supportAgents.length === 0 && (
                    <TableRow className="border-slate-800">
                      <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                        No support agents found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Day's Order Details */}
            <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-green-500" />
                  Orders on {format(new Date(parseInt(supportYear), parseInt(supportMonth), parseInt(supportDay)), "MMM dd, yyyy")}
                </h3>
                <p className="text-sm text-slate-500">{supportDayOrders.length} orders placed on selected day</p>
              </div>
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow className="border-slate-800">
                    <TableHead className="text-slate-400">Order #</TableHead>
                    <TableHead className="text-slate-400">Client</TableHead>
                    <TableHead className="text-slate-400">Created By</TableHead>
                    <TableHead className="text-slate-400 text-center">Status</TableHead>
                    <TableHead className="text-slate-400 text-center">Payment</TableHead>
                    <TableHead className="text-slate-400 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supportDayOrders.map((order) => {
                    const createdBy = teamMembers?.find(u => u.id === order.createdById);
                    return (
                      <TableRow key={order.id} className="border-slate-800" data-testid={`row-support-order-${order.id}`}>
                        <TableCell className="text-blue-400 font-medium">{order.orderNumber || "-"}</TableCell>
                        <TableCell className="text-white">{order.clientName}</TableCell>
                        <TableCell className="text-slate-300">{createdBy?.username || "Unknown"}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={cn("border-0", {
                            "text-blue-400": order.status === "new",
                            "text-yellow-400": order.status === "working",
                            "text-purple-400": order.status === "ready",
                            "text-green-400": order.status === "delivered",
                            "text-red-400": order.status === "canceled",
                          })}>
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={cn("border-0", {
                            "text-green-400": order.paymentStatus === "paid",
                            "text-yellow-400": order.paymentStatus === "pending",
                          })}>
                            {order.paymentStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-slate-300">
                          {"\u20A8"} {Math.round((order.totalPrice || 0) / 100).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {supportDayOrders.length === 0 && (
                    <TableRow className="border-slate-800">
                      <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                        No orders placed on this day
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
