import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Pencil,
  Trash2,
  Package,
  Wrench,
  Eye,
  EyeOff,
  Globe,
  FileWarning,
} from "lucide-react";
import type { ServiceCatalogItem, PackageConfig, PlatformCatalogItem, ComplaintCategoryConfig } from "@shared/schema";
import { PageHeader } from "@/components/CRMPrimitives";

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  if (user?.role !== "admin") {
    navigate("/");
    return null;
  }

  return (
    <div className="crm-page space-y-6">
      <PageHeader eyebrow="System configuration" title="Admin Settings" description="Manage services, packages, marketing platforms, and complaint categories." />

      <Tabs defaultValue="services" className="space-y-4">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger value="services" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
            <Wrench className="w-4 h-4" />
            Services
          </TabsTrigger>
          <TabsTrigger value="packages" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
            <Package className="w-4 h-4" />
            Packages
          </TabsTrigger>
          <TabsTrigger value="platforms" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
            <Globe className="w-4 h-4" />
            Platforms
          </TabsTrigger>
          <TabsTrigger value="complaints" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white gap-2">
            <FileWarning className="w-4 h-4" />
            Complaint Categories
          </TabsTrigger>
        </TabsList>

        <TabsContent value="services">
          <ServicesSection />
        </TabsContent>

        <TabsContent value="packages">
          <PackagesSection />
        </TabsContent>

        <TabsContent value="platforms">
          <PlatformsSection />
        </TabsContent>

        <TabsContent value="complaints">
          <ComplaintCategoriesSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ComplaintCategoriesSection() {
  const { toast } = useToast();
  const [newLabel, setNewLabel] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<ComplaintCategoryConfig | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const { data: categories = [], isLoading } = useQuery<ComplaintCategoryConfig[]>({
    queryKey: ["/api/complaint-categories"],
  });

  const createMutation = useMutation({
    mutationFn: async (label: string) => (await apiRequest("POST", "/api/complaint-categories", { label })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/complaint-categories"] });
      setAddOpen(false);
      setNewLabel("");
      toast({ title: "Complaint category added" });
    },
    onError: (error: Error) => toast({ title: "Could not add category", description: error.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: number; label?: string; isActive?: boolean }) =>
      (await apiRequest("PATCH", `/api/complaint-categories/${id}`, updates)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/complaint-categories"] });
      setEditItem(null);
      toast({ title: "Complaint category updated" });
    },
    onError: (error: Error) => toast({ title: "Could not update category", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Complaint Categories</h2>
          <p className="text-sm text-slate-400">Choose the dropdown options available when admins or sales/support raise complaints.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" /> Add Category
        </Button>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        {isLoading ? <div className="py-12 text-center text-slate-500">Loading categories…</div> : (
          <table className="w-full">
            <thead><tr className="border-b border-slate-800">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase">Category</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase">Status</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800">
              {categories.map(item => <tr key={item.id} className="hover:bg-slate-800/30">
                <td className="px-5 py-3.5">
                  <p className="text-sm font-medium text-white">{item.label}</p>
                  <p className="text-xs text-slate-600 font-mono">{item.key}</p>
                </td>
                <td className="px-5 py-3.5"><div className="flex items-center gap-2">
                  <Switch checked={item.isActive} onCheckedChange={isActive => updateMutation.mutate({ id: item.id, isActive })} />
                  <span className="text-xs text-slate-400">{item.isActive ? "Active" : "Inactive"}</span>
                </div></td>
                <td className="px-5 py-3.5 text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditItem(item); setEditLabel(item.label); }}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </td>
              </tr>)}
            </tbody>
          </table>
        )}
      </div>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader><DialogTitle>Add Complaint Category</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2"><Label>Category name</Label><Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Missed Deadline" className="bg-slate-800 border-slate-700" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button><Button disabled={!newLabel.trim() || createMutation.isPending} onClick={() => createMutation.mutate(newLabel.trim())}>Add Category</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader><DialogTitle>Edit Complaint Category</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2"><Label>Category name</Label><Input value={editLabel} onChange={e => setEditLabel(e.target.value)} className="bg-slate-800 border-slate-700" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button><Button disabled={!editLabel.trim() || updateMutation.isPending} onClick={() => editItem && updateMutation.mutate({ id: editItem.id, label: editLabel.trim() })}>Save Changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServicesSection() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<ServiceCatalogItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<ServiceCatalogItem | null>(null);
  const [newName, setNewName] = useState("");
  const [editName, setEditName] = useState("");

  const { data: services = [], isLoading } = useQuery<ServiceCatalogItem[]>({
    queryKey: ["/api/services-catalog"],
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/services-catalog", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services-catalog"] });
      setAddOpen(false);
      setNewName("");
      toast({ title: "Success", description: "Service added successfully" });
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => ({})) : {};
      toast({ title: "Error", description: body.message || "Failed to add service", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, isActive }: { id: number; name?: string; isActive?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/services-catalog/${id}`, { name, isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services-catalog"] });
      setEditItem(null);
      toast({ title: "Success", description: "Service updated" });
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => ({})) : {};
      toast({ title: "Error", description: body.message || "Failed to update service", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/services-catalog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services-catalog"] });
      setDeleteItem(null);
      toast({ title: "Success", description: "Service deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete service", variant: "destructive" });
    },
  });

  const openEdit = (item: ServiceCatalogItem) => {
    setEditItem(item);
    setEditName(item.name);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Services Catalog</h2>
          <p className="text-sm text-slate-400">
            These services will be available when creating a Custom Package order.
          </p>
        </div>
        <Button
          onClick={() => { setAddOpen(true); setNewName(""); }}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Service
        </Button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : services.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Wrench className="w-10 h-10 mb-3 opacity-40" />
            <p className="font-medium">No services yet</p>
            <p className="text-sm">Add your first service to get started</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Service Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {services.map((svc) => (
                <tr key={svc.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-medium text-white">{svc.name}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={svc.isActive}
                        onCheckedChange={(checked) =>
                          updateMutation.mutate({ id: svc.id, isActive: checked })
                        }
                        disabled={updateMutation.isPending}
                      />
                      <span className="text-xs text-slate-400">{svc.isActive ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-400 hover:text-white hover:bg-slate-700 h-8 w-8 p-0"
                        onClick={() => openEdit(svc)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-300 hover:bg-red-950/30 h-8 w-8 p-0"
                        onClick={() => setDeleteItem(svc)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Add New Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-slate-300">Service Name</Label>
            <Input
              placeholder="e.g. LinkedIn Banner"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createMutation.mutate(newName.trim()); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newName.trim())}
              disabled={!newName.trim() || createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createMutation.isPending ? "Adding..." : "Add Service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Edit Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-slate-300">Service Name</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              onKeyDown={(e) => {
                if (e.key === "Enter" && editItem && editName.trim()) {
                  updateMutation.mutate({ id: editItem.id, name: editName.trim() });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} className="border-slate-700 text-slate-300 hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={() => editItem && updateMutation.mutate({ id: editItem.id, name: editName.trim() })}
              disabled={!editName.trim() || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
        <AlertDialogContent className="bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to delete <span className="text-white font-medium">"{deleteItem?.name}"</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PackagesSection() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<PackageConfig | null>(null);
  const [deleteItem, setDeleteItem] = useState<PackageConfig | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [editLabel, setEditLabel] = useState("");

  const PROTECTED_KEYS = ["custom"];

  const { data: packages = [], isLoading } = useQuery<PackageConfig[]>({
    queryKey: ["/api/package-configs"],
  });

  const createMutation = useMutation({
    mutationFn: async ({ key, label }: { key: string; label: string }) => {
      const res = await apiRequest("POST", "/api/package-configs", { key, label });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/package-configs"] });
      setAddOpen(false);
      setNewLabel("");
      setNewKey("");
      toast({ title: "Success", description: "Package added successfully" });
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => ({})) : {};
      toast({ title: "Error", description: body.message || "Failed to add package", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, label, isActive }: { id: number; label?: string; isActive?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/package-configs/${id}`, { label, isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/package-configs"] });
      setEditItem(null);
      toast({ title: "Success", description: "Package updated" });
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => ({})) : {};
      toast({ title: "Error", description: body.message || "Failed to update package", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/package-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/package-configs"] });
      setDeleteItem(null);
      toast({ title: "Success", description: "Package deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete package", variant: "destructive" });
    },
  });

  const openEdit = (item: PackageConfig) => {
    setEditItem(item);
    setEditLabel(item.label);
  };

  const handleLabelChange = (val: string) => {
    setNewLabel(val);
    setNewKey(val.trim().toLowerCase().replace(/\s+/g, "_"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Package Configuration</h2>
          <p className="text-sm text-slate-400">
            Manage package names and add custom packages available when creating orders.
            The <span className="text-blue-400 font-medium">Custom Order</span> type is always available.
          </p>
        </div>
        <Button
          onClick={() => { setAddOpen(true); setNewLabel(""); setNewKey(""); }}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Package
        </Button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Label</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Key</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {packages.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-medium text-white">{pkg.label}</td>
                  <td className="px-5 py-3.5">
                    <code className="text-xs bg-slate-800 text-blue-300 px-2 py-0.5 rounded">{pkg.key}</code>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pkg.isActive}
                        onCheckedChange={(checked) =>
                          updateMutation.mutate({ id: pkg.id, isActive: checked })
                        }
                        disabled={updateMutation.isPending}
                      />
                      <span className="text-xs text-slate-400">{pkg.isActive ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-400 hover:text-white hover:bg-slate-700 h-8 w-8 p-0"
                        onClick={() => openEdit(pkg)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {!PROTECTED_KEYS.includes(pkg.key) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-300 hover:bg-red-950/30 h-8 w-8 p-0"
                          onClick={() => setDeleteItem(pkg)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="hover:bg-slate-800/30 transition-colors opacity-60">
                <td className="px-5 py-3.5 text-sm font-medium text-white">Custom Order</td>
                <td className="px-5 py-3.5">
                  <code className="text-xs bg-slate-800 text-blue-300 px-2 py-0.5 rounded">custom</code>
                </td>
                <td className="px-5 py-3.5">
                  <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">System</Badge>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <span className="text-xs text-slate-500">Built-in</span>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Add New Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Package Label <span className="text-slate-500 text-xs">(shown to users)</span></Label>
              <Input
                placeholder="e.g. Premium Bundle"
                value={newLabel}
                onChange={(e) => handleLabelChange(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Package Key <span className="text-slate-500 text-xs">(auto-generated, must be unique)</span></Label>
              <Input
                placeholder="e.g. premium_bundle"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ key: newKey, label: newLabel })}
              disabled={!newLabel.trim() || !newKey.trim() || createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createMutation.isPending ? "Adding..." : "Add Package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Edit Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Package Label</Label>
              <Input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editItem && editLabel.trim()) {
                    updateMutation.mutate({ id: editItem.id, label: editLabel.trim() });
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs">Package Key (cannot be changed)</Label>
              <code className="block text-xs bg-slate-800 text-blue-300 px-3 py-2 rounded border border-slate-700">{editItem?.key}</code>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} className="border-slate-700 text-slate-300 hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={() => editItem && updateMutation.mutate({ id: editItem.id, label: editLabel.trim() })}
              disabled={!editLabel.trim() || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
        <AlertDialogContent className="bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Package</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to delete <span className="text-white font-medium">"{deleteItem?.label}"</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PlatformsSection() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<PlatformCatalogItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<PlatformCatalogItem | null>(null);
  const [newName, setNewName] = useState("");
  const [newHasCampaign, setNewHasCampaign] = useState(false);
  const [editName, setEditName] = useState("");
  const [editHasCampaign, setEditHasCampaign] = useState(false);

  const { data: platforms = [], isLoading } = useQuery<PlatformCatalogItem[]>({
    queryKey: ["/api/platforms-catalog"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; hasCampaignFields: boolean }) => {
      const res = await apiRequest("POST", "/api/platforms-catalog", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platforms-catalog"] });
      setAddOpen(false);
      setNewName("");
      setNewHasCampaign(false);
      toast({ title: "Success", description: "Platform added successfully" });
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => ({})) : {};
      toast({ title: "Error", description: body.message || "Failed to add platform", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; name?: string; isActive?: boolean; hasCampaignFields?: boolean }) => {
      const { id, ...rest } = data;
      const res = await apiRequest("PATCH", `/api/platforms-catalog/${id}`, rest);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platforms-catalog"] });
      setEditItem(null);
      toast({ title: "Success", description: "Platform updated" });
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => ({})) : {};
      toast({ title: "Error", description: body.message || "Failed to update platform", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/platforms-catalog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platforms-catalog"] });
      setDeleteItem(null);
      toast({ title: "Success", description: "Platform deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete platform", variant: "destructive" });
    },
  });

  const openEdit = (item: PlatformCatalogItem) => {
    setEditItem(item);
    setEditName(item.name);
    setEditHasCampaign(item.hasCampaignFields);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Marketing Platforms</h2>
          <p className="text-sm text-slate-400">Configure where clients come from. Enable "Campaign Fields" for platforms that use Facebook-style ad tracking.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" /> Add Platform
        </Button>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm">Loading...</p>
      ) : platforms.length === 0 ? (
        <p className="text-slate-400 text-sm">No platforms configured yet.</p>
      ) : (
        <div className="space-y-2">
          {platforms.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-3 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-blue-400" />
                <span className="text-white font-medium">{item.name}</span>
                {item.hasCampaignFields && (
                  <Badge variant="outline" className="border-purple-500 text-purple-400 text-xs">Campaign Fields</Badge>
                )}
                {!item.isActive && (
                  <Badge variant="outline" className="border-slate-600 text-slate-500 text-xs">Inactive</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateMutation.mutate({ id: item.id, isActive: !item.isActive })}
                  className="text-slate-400 hover:text-white"
                  title={item.isActive ? "Deactivate" : "Activate"}
                >
                  {item.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(item)} className="text-slate-400 hover:text-white">
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteItem(item)} className="text-slate-400 hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Add Platform</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Platform Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Facebook, TikTok, Referral..."
                className="bg-slate-800 border-slate-700 text-white"
                onKeyDown={(e) => e.key === "Enter" && newName.trim() && createMutation.mutate({ name: newName.trim(), hasCampaignFields: newHasCampaign })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-white">Campaign Fields</Label>
                <p className="text-xs text-slate-400 mt-0.5">Show Campaign / Ad Set / Creative inputs for this platform</p>
              </div>
              <Switch checked={newHasCampaign} onCheckedChange={setNewHasCampaign} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAddOpen(false); setNewName(""); setNewHasCampaign(false); }} className="text-slate-300 hover:text-white">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ name: newName.trim(), hasCampaignFields: newHasCampaign })}
              disabled={!newName.trim() || createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createMutation.isPending ? "Adding..." : "Add Platform"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle>Edit Platform</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Platform Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-white">Campaign Fields</Label>
                <p className="text-xs text-slate-400 mt-0.5">Show Campaign / Ad Set / Creative inputs for this platform</p>
              </div>
              <Switch checked={editHasCampaign} onCheckedChange={setEditHasCampaign} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditItem(null)} className="text-slate-300 hover:text-white">Cancel</Button>
            <Button
              onClick={() => editItem && updateMutation.mutate({ id: editItem.id, name: editName.trim(), hasCampaignFields: editHasCampaign })}
              disabled={!editName.trim() || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
        <AlertDialogContent className="bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Platform</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to delete <span className="text-white font-medium">"{deleteItem?.name}"</span>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
