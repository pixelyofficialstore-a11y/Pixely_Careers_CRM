import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { complaintCategories, type ComplaintCategoryConfig, type OrderWithServices } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ImageDropzone } from "@/components/ImageDropzone";

export const complaintCategoryLabels: Record<(typeof complaintCategories)[number], string> = {
  communication_issue: "Communication Issue", slow_response: "Slow Response", delivery_delay: "Delivery Delay",
  work_quality_issue: "Work Quality Issue", instructions_not_followed: "Instructions Not Followed",
  revision_handling_issue: "Revision Handling Issue", incorrect_information: "Incorrect Information Provided",
  unprofessional_behavior: "Unprofessional Behavior", process_policy_violation: "Process / Policy Violation",
  unauthorized_commitment: "Unauthorized Commitment", other: "Other",
};
type Props = { order: OrderWithServices | null; orders?: OrderWithServices[]; open: boolean; onOpenChange: (open: boolean) => void };
const errorText = (error: Error) => error.message.match(/"message":"([^"]+)"/)?.[1] || "Check the complaint details and try again.";

export function ComplaintDialog({ order, orders = [], open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState(order ? String(order.id) : "");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [evidencePreviews, setEvidencePreviews] = useState<string[]>([]);
  const { data: categoryConfigs = [] } = useQuery<ComplaintCategoryConfig[]>({ queryKey: ["/api/complaint-categories"], staleTime: 300000 });
  const availableCategories = categoryConfigs.length ? categoryConfigs.filter(item => item.isActive) : complaintCategories.map((key, i) => ({ id: -i - 1, key, label: complaintCategoryLabels[key], isActive: true, sortOrder: i, createdAt: null }));
  const eligibleOrders = useMemo(() => orders.filter(item => item.assignedToId), [orders]);
  const selectedOrder = order && !orders.length ? order : eligibleOrders.find(item => String(item.id) === selectedOrderId) || null;

  useEffect(() => {
    if (!open) return;
    setSelectedOrderId(order ? String(order.id) : "");
    setCategory(""); setDescription("");
    setEvidencePreviews(previous => { previous.forEach(URL.revokeObjectURL); return []; });
    setEvidenceFiles([]);
  }, [open, order?.id]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Select an order first.");
      let evidencePayload: Array<{ url: string; fileName: string; fileSize: number }> = [];
      if (evidenceFiles.length) {
        const form = new FormData();
        evidenceFiles.forEach(file => form.append("screenshots", file, file.name));
        const upload = await fetch("/api/complaints/upload", { method: "POST", body: form, credentials: "include" });
        if (!upload.ok) throw new Error((await upload.text()) || "Evidence upload failed.");
        const payload = await upload.json();
        evidencePayload = payload.evidence || [];
        if (!evidencePayload.length) throw new Error("Evidence upload did not return image URLs.");
      }
       const response = await apiRequest("POST", "/api/complaints", {
         orderId: selectedOrder.id,
         complaintAgainstUserId: selectedOrder.assignedToId,
         category,
         description: description.trim(),
          ...(evidencePayload.length ? { evidence: evidencePayload } : {}),
       });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/complaints"] }); queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Complaint raised", description: "The complaint has been recorded." }); onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: "Could not raise complaint", description: errorText(error), variant: "destructive" }),
  });
  const onFiles = (files: File[]) => {
    const available = 5 - evidenceFiles.length;
    const nextFiles = files.slice(0, available);
    if (files.length > available) {
      toast({ title: "Maximum evidence reached", description: "You can attach up to five images to one complaint.", variant: "destructive" });
    }
    if (!nextFiles.length) return;
    setEvidenceFiles(previous => [...previous, ...nextFiles]);
    setEvidencePreviews(previous => [...previous, ...nextFiles.map(file => URL.createObjectURL(file))]);
  };
  const removeEvidence = (index: number) => {
    setEvidenceFiles(previous => previous.filter((_, fileIndex) => fileIndex !== index));
    setEvidencePreviews(previous => {
      const removed = previous[index];
      if (removed) URL.revokeObjectURL(removed);
      return previous.filter((_, previewIndex) => previewIndex !== index);
    });
  };
  const canSubmit = Boolean(selectedOrder?.assignedToId && category && description.trim());
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-lg max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>New Complaint</DialogTitle><DialogDescription className="text-slate-400">Link a clear account of the issue to an assigned order.</DialogDescription></DialogHeader>
    <div className="space-y-5 py-2">
      {orders.length > 0 && <div className="space-y-2"><Label htmlFor="complaint-order">Order</Label><Select value={selectedOrderId} onValueChange={setSelectedOrderId}><SelectTrigger id="complaint-order" className="bg-slate-950 border-slate-700"><SelectValue placeholder="Select an eligible order" /></SelectTrigger><SelectContent>{eligibleOrders.map(item => <SelectItem key={item.id} value={String(item.id)}>#{item.orderNumber || item.id} · {item.clientName} · {item.assignee?.name || "Assigned designer"}</SelectItem>)}</SelectContent></Select></div>}
       {!selectedOrder ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0" />Select an eligible order with an assigned designer.</div> :
           <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">Complaint against <span className="font-medium text-white">{selectedOrder.assignee?.name || "Assigned designer"}</span><span className="ml-1 text-xs text-slate-500">(Designer)</span></div>}
      <div className="space-y-2"><Label htmlFor="complaint-category">Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger id="complaint-category" className="bg-slate-950 border-slate-700"><SelectValue placeholder="Select a category" /></SelectTrigger><SelectContent>{availableCategories.map(item => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="complaint-description">Description</Label><Textarea id="complaint-description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what happened and include the relevant facts." rows={5} maxLength={5000} className="bg-slate-950 border-slate-700 resize-none" /><p className="text-xs text-slate-500">{description.length}/5000</p></div>
       <div className="space-y-3"><Label>Evidence <span className="text-slate-500">(optional · up to 5 images)</span></Label>
          <ImageDropzone
            values={evidenceFiles}
            onFiles={onFiles}
             listenForPaste
            maxFiles={Math.max(1, 5 - evidenceFiles.length)}
            disabled={evidenceFiles.length >= 5 || createMutation.isPending}
            label={evidenceFiles.length >= 5 ? "Maximum evidence attached" : "Add screenshots"}
            description="Paste from clipboard or drag images here"
          />
          {evidenceFiles.length > 0 && <div className="grid grid-cols-2 gap-3">
            {evidenceFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
              <div className="relative"><img src={evidencePreviews[index]} alt={`Evidence preview ${index + 1}`} className="h-28 w-full object-cover" /><Button type="button" variant="secondary" size="icon" className="absolute right-2 top-2 h-7 w-7" onClick={() => removeEvidence(index)} disabled={createMutation.isPending}><X className="w-4 h-4" /></Button></div>
              <div className="space-y-1 p-2"><p className="truncate text-xs text-slate-300">{file.name}</p><div className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span>{(file.size / 1024 / 1024).toFixed(2)} MB</span><span className={createMutation.isPending ? "text-amber-300" : "text-emerald-300"}>{createMutation.isPending ? "Uploading" : "Ready"}</span></div></div>
            </div>)}
          </div>}
          <p className="text-xs text-slate-500">PNG, JPEG, or WebP · maximum 5MB each</p></div>
    </div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending} className="bg-red-600 hover:bg-red-500">{createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Raise Complaint</Button></DialogFooter>
  </DialogContent></Dialog>;
}