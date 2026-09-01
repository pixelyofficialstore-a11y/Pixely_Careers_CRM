import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { TeamSkeleton } from "@/components/PageSkeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { 
  Plus, 
  Edit2, 
  Key, 
  UserX,
  UserCheck,
  Shield,
  Headphones,
  Palette,
  Link2
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User, SupportDesignerAssignment } from "@shared/schema";
import { useLocation } from "wouter";
import { MetricCard as CRMMetricCard, PageHeader } from "@/components/CRMPrimitives";

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}

export default function TeamPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [assignDesignersUser, setAssignDesignersUser] = useState<User | null>(null);

  const { data: teamMembers, isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: allAssignments } = useQuery<SupportDesignerAssignment[]>({
    queryKey: ["/api/designer-assignments"],
  });

  if (user?.role !== "admin") {
    setLocation("/");
    return null;
  }

  if (isLoading) return <TeamSkeleton />;

  const designers = teamMembers?.filter(u => u.role === 'designer') || [];

  const getAssignedDesignerNames = (supportUserId: number) => {
    const assignments = allAssignments?.filter(a => a.supportUserId === supportUserId) || [];
    if (assignments.length === 0) return "None";
    return assignments.map(a => {
      const designer = teamMembers?.find(u => u.id === a.designerUserId);
      return designer?.name || "Unknown";
    }).join(", ");
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin": return <Shield className="w-4 h-4" />;
      case "support": return <Headphones className="w-4 h-4" />;
      case "designer": return <Palette className="w-4 h-4" />;
      default: return null;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin": return <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">{getRoleIcon(role)} Admin</Badge>;
      case "support": return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">{getRoleIcon(role)} Support</Badge>;
      case "designer": return <Badge className="bg-green-500/10 text-green-400 border-green-500/20">{getRoleIcon(role)} Designer</Badge>;
      default: return null;
    }
  };

  return (
    <div className="crm-page space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <PageHeader eyebrow="Team operations" title="Team Management" description="Manage user accounts, roles, and access permissions." />
        
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary" data-testid="button-create-user">
              <Plus className="w-4 h-4 mr-2" />
              Create User
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-900 border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-white font-display text-xl">Create New User</DialogTitle>
              <DialogDescription className="text-slate-400">Add a new team member to the system.</DialogDescription>
            </DialogHeader>
            <CreateUserForm onSuccess={() => setCreateDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CRMMetricCard label="Admins" value={teamMembers?.filter(u => u.role === 'admin').length || 0} icon={Shield} />
        <CRMMetricCard label="Support" value={teamMembers?.filter(u => u.role === 'support').length || 0} icon={Headphones} />
        <CRMMetricCard label="Designers" value={teamMembers?.filter(u => u.role === 'designer').length || 0} icon={Palette} />
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h3 className="text-lg font-bold text-white">All Users</h3>
          <p className="text-sm text-slate-500">Manage team member accounts and permissions</p>
        </div>
        
        <Table>
          <TableHeader className="bg-slate-900/50">
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-slate-400">Username</TableHead>
              <TableHead className="text-slate-400">Name</TableHead>
              <TableHead className="text-slate-400">Role</TableHead>
              <TableHead className="text-slate-400">Assigned Designers</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Created</TableHead>
              <TableHead className="text-right text-slate-400">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamMembers?.map((member) => (
              <TableRow key={member.id} className="border-slate-800 hover:bg-slate-900/50" data-testid={`row-user-${member.id}`}>
                <TableCell className="font-mono text-sm text-blue-400">{member.username}</TableCell>
                <TableCell className="text-white font-medium">{member.name}</TableCell>
                <TableCell>{getRoleBadge(member.role)}</TableCell>
                <TableCell>
                  {member.role === 'support' ? (
                    <span className="text-slate-300 text-sm">{getAssignedDesignerNames(member.id)}</span>
                  ) : (
                    <span className="text-slate-500 text-sm">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(
                    "border-0",
                    member.isActive ? "text-green-500" : "text-red-500"
                  )}>
                    {member.isActive ? "Active" : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-400 text-sm">
                  {member.createdAt ? format(new Date(member.createdAt), "MMM dd, yyyy") : "-"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {member.role === 'support' && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-slate-400"
                        onClick={() => setAssignDesignersUser(member)}
                        data-testid={`button-assign-designers-${member.id}`}
                      >
                        <Link2 className="w-4 h-4" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-slate-400"
                      onClick={() => setEditingUser(member)}
                      data-testid={`button-edit-${member.id}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-slate-400"
                      onClick={() => setResetPasswordUser(member)}
                      data-testid={`button-reset-password-${member.id}`}
                    >
                      <Key className="w-4 h-4" />
                    </Button>
                    <ToggleStatusButton user={member} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingUser && (
        <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
          <DialogContent className="bg-slate-900 border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-white font-display text-xl">Edit User</DialogTitle>
              <DialogDescription className="text-slate-400">Update user details and permissions.</DialogDescription>
            </DialogHeader>
            <EditUserForm user={editingUser} onSuccess={() => setEditingUser(null)} />
          </DialogContent>
        </Dialog>
      )}

      {resetPasswordUser && (
        <Dialog open={!!resetPasswordUser} onOpenChange={() => setResetPasswordUser(null)}>
          <DialogContent className="bg-slate-900 border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-white font-display text-xl">Reset Password</DialogTitle>
              <DialogDescription className="text-slate-400">Set a new password for {resetPasswordUser.name}.</DialogDescription>
            </DialogHeader>
            <ResetPasswordForm user={resetPasswordUser} onSuccess={() => setResetPasswordUser(null)} />
          </DialogContent>
        </Dialog>
      )}

      {assignDesignersUser && (
        <Dialog open={!!assignDesignersUser} onOpenChange={() => setAssignDesignersUser(null)}>
          <DialogContent className="bg-slate-900 border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-white font-display text-xl">Assign Designers</DialogTitle>
              <DialogDescription className="text-slate-400">
                Select which designers {assignDesignersUser.name} can assign orders to.
              </DialogDescription>
            </DialogHeader>
            <AssignDesignersForm 
              supportUser={assignDesignersUser} 
              designers={designers}
              currentAssignments={allAssignments?.filter(a => a.supportUserId === assignDesignersUser.id) || []}
              onSuccess={() => setAssignDesignersUser(null)} 
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AssignDesignersForm({ 
  supportUser, 
  designers, 
  currentAssignments,
  onSuccess 
}: { 
  supportUser: User; 
  designers: User[];
  currentAssignments: SupportDesignerAssignment[];
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const currentDesignerIds = currentAssignments.map(a => a.designerUserId);
  const [selectedIds, setSelectedIds] = useState<number[]>(currentDesignerIds);

  const saveMutation = useMutation({
    mutationFn: async (designerIds: number[]) => {
      return apiRequest("PUT", `/api/designer-assignments/${supportUser.id}`, { designerIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/designer-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "Designer assignments updated" });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update assignments", variant: "destructive" });
    },
  });

  const toggleDesigner = (designerId: number) => {
    setSelectedIds(prev => 
      prev.includes(designerId) 
        ? prev.filter(id => id !== designerId)
        : [...prev, designerId]
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 max-h-64 overflow-y-auto">
        {designers.filter(d => d.isActive).map(designer => (
          <label 
            key={designer.id} 
            className="flex items-center gap-3 p-3 bg-slate-950/50 rounded-lg border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors"
            data-testid={`checkbox-designer-${designer.id}`}
          >
            <Checkbox
              checked={selectedIds.includes(designer.id)}
              onCheckedChange={() => toggleDesigner(designer.id)}
            />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-xs text-slate-300">
                {designer.name.charAt(0)}
              </div>
              <span className="text-slate-200">{designer.name}</span>
            </div>
          </label>
        ))}
        {designers.filter(d => d.isActive).length === 0 && (
          <p className="text-slate-500 text-center py-4">No active designers found</p>
        )}
      </div>
      <DialogFooter className="pt-2">
        <Button 
          onClick={() => saveMutation.mutate(selectedIds)} 
          className="bg-primary" 
          disabled={saveMutation.isPending}
          data-testid="button-save-assignments"
        >
          {saveMutation.isPending ? "Saving..." : "Save Assignments"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function CreateUserForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("designer");

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User created successfully" });
      onSuccess();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create user", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password || !name) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    if (password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    createMutation.mutate({ username, password, name, role });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-slate-300">Username *</Label>
        <Input 
          value={username} 
          onChange={(e) => setUsername(e.target.value)} 
          className="bg-slate-950 border-slate-800 text-white"
          placeholder="Enter unique username"
          data-testid="input-username"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Full Name *</Label>
        <Input 
          value={name} 
          onChange={(e) => setName(e.target.value)} 
          className="bg-slate-950 border-slate-800 text-white"
          placeholder="Enter full name"
          data-testid="input-name"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Password *</Label>
        <Input 
          type="password"
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
          className="bg-slate-950 border-slate-800 text-white"
          placeholder="Min 8 characters"
          data-testid="input-password"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Role</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="select-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800 text-white">
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="support">Support</SelectItem>
            <SelectItem value="designer">Designer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="pt-4">
        <Button type="submit" className="bg-primary" disabled={createMutation.isPending} data-testid="button-submit-user">
          {createMutation.isPending ? "Creating..." : "Create User"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditUserForm({ user, onSuccess }: { user: User; onSuccess: () => void }) {
  const { toast } = useToast();
  const [username, setUsername] = useState(user.username);
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("PATCH", `/api/users/${user.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User updated successfully" });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({ username, name, role });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-slate-300">Username</Label>
        <Input 
          value={username} 
          onChange={(e) => setUsername(e.target.value)} 
          className="bg-slate-950 border-slate-800 text-white"
          data-testid="input-edit-username"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Full Name</Label>
        <Input 
          value={name} 
          onChange={(e) => setName(e.target.value)} 
          className="bg-slate-950 border-slate-800 text-white"
          data-testid="input-edit-name"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Role</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="select-edit-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800 text-white">
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="support">Support</SelectItem>
            <SelectItem value="designer">Designer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="pt-4">
        <Button type="submit" className="bg-primary" disabled={updateMutation.isPending} data-testid="button-save-user">
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ResetPasswordForm({ user, onSuccess }: { user: User; onSuccess: () => void }) {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState("");

  const resetMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("PATCH", `/api/users/${user.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "Password reset successfully" });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reset password", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    resetMutation.mutate({ password: newPassword });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-slate-300">New Password</Label>
        <Input 
          type="password"
          value={newPassword} 
          onChange={(e) => setNewPassword(e.target.value)} 
          className="bg-slate-950 border-slate-800 text-white"
          placeholder="Min 8 characters"
          data-testid="input-new-password"
        />
      </div>
      <DialogFooter className="pt-4">
        <Button type="submit" className="bg-primary" disabled={resetMutation.isPending} data-testid="button-reset-password">
          {resetMutation.isPending ? "Resetting..." : "Reset Password"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ToggleStatusButton({ user }: { user: User }) {
  const { toast } = useToast();
  
  const toggleMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/users/${user.id}`, { isActive: !user.isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: `User ${user.isActive ? 'disabled' : 'enabled'} successfully` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user status", variant: "destructive" });
    },
  });

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      className={cn("", user.isActive ? "text-red-400" : "text-green-400")}
      onClick={() => toggleMutation.mutate()}
      disabled={toggleMutation.isPending}
      data-testid={`button-toggle-${user.id}`}
    >
      {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
    </Button>
  );
}
